import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import { shortcutManager, shortcuts } from './shortcutManager'
import { createRecorderWindow, createOverlayWindow, showOverlay, hideOverlay, startAudioCapture, stopAudioCapture, cleanupWindows } from './windows'
import { audioStreamHandler } from './ipc/audioStream'
import { sttWorkerManager } from './workerManager'
import { ClipboardService } from './clipboard'
import { systemTray } from './tray'
import { stateManager } from './stateManager'
import { settings } from '../common/settings'
// crypto service is used via stateManager
import { perfMonitor } from './perfMonitor'
import { telemetryService } from './telemetry'
import { registerSettingsHandlers } from './ipc/settingsHandlers'

// Configure logging
log.transports.file.level = 'info'
log.transports.console.level = 'debug'

// const isDev = process.env.NODE_ENV === 'development'
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null
let isRecording = false

function createMainWindow() {
  log.info('Creating main window')
  
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // We need access to some Node APIs for audio
    },
  })

  // Load the app
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

// App event handlers
app.whenReady().then(async () => {
  log.info('App ready, starting initialization')
  
  try {
    // Initialize core services first
    perfMonitor.initialize()
    
    // Initialize telemetry service
    await telemetryService.initialize()
    
    // Register IPC handlers
    registerSettingsHandlers()
    
    // Initialize state manager (handles most of the logic now)
    await stateManager.initialize()
    
    // Create main window
    createMainWindow()
    
    // Initialize shortcut manager with settings
    const hotkey = settings.get('hotkey')
    await shortcutManager.initShortcut(hotkey)
    
    // Setup shortcut event listener - now uses state manager
    shortcuts.on('toggle', async () => {
      log.info('Shortcut triggered')
      
      if (stateManager.isRecording()) {
        log.info('Stopping recording via state manager')
        await stateManager.stopRecording()
      } else if (stateManager.isIdle()) {
        log.info('Starting recording via state manager')
        await stateManager.startRecording()
      } else {
        log.warn(`Cannot toggle from current state: ${stateManager.getCurrentState()}`)
      }
    })
    
    // Listen for state changes to update UI
    stateManager.on('state-changed', (transition) => {
      log.debug(`State changed: ${transition.from} -> ${transition.to}`)
      
      // Update tray state
      if (transition.to === 'recording') {
        systemTray.setState('recording')
      } else if (transition.to === 'error' || transition.to === 'fatal') {
        systemTray.setState('error')
      } else {
        systemTray.setState('idle')
      }
    })
    
    // Listen for performance warnings
    perfMonitor.on('latency-warning', (type, value) => {
      log.warn(`Performance warning: ${type} latency ${Math.round(value)}ms`)
      systemTray.showNotification(
        'Performance Warning', 
        `${type} operation took ${Math.round(value)}ms`
      )
    })
    
    // Listen for settings changes
    settings.onDidChange('hotkey', async (newHotkey) => {
      log.info(`Hotkey changed to: ${newHotkey}`)
      await shortcutManager.initShortcut(newHotkey)
    })
    
    // Create recorder and overlay windows (hidden initially)
    createRecorderWindow()
    createOverlayWindow()
    
    // Initialize system tray
    systemTray.initialize()
    
    log.info('Initialization complete')
  } catch (error) {
    log.error('Initialization failed:', error)
    
    // Try to initialize in a degraded state
    try {
      createMainWindow()
      systemTray.initialize()
      systemTray.showError('Initialization failed - some features may not work')
    } catch (fallbackError) {
      log.error('Fallback initialization also failed:', fallbackError)
    }
  }

  // macOS specific: recreate window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  log.info('App is quitting, cleaning up...')
  
  // Cleanup in order
  shortcutManager.cleanup()
  audioStreamHandler.stopStream()
  
  // Stop STT worker
  if (sttWorkerManager.isRunning()) {
    sttWorkerManager.stopWorker().catch(err => {
      log.error('Error stopping STT worker:', err)
    })
  }
  
  // Cleanup UI components
  systemTray.destroy()
  cleanupWindows()
})

// Recording toggle handler
async function handleShortcutToggle() {
  try {
    if (!isRecording) {
      log.info('Starting recording via shortcut')
      isRecording = true
      
      // Update tray state
      systemTray.setState('recording')
      
      // Show overlay
      showOverlay('recording', 'Listening...')
      
      // Start STT worker if not running
      if (!sttWorkerManager.isRunning()) {
        await sttWorkerManager.startWorker()
        
        // Setup STT event handlers
        sttWorkerManager.on('transcript-final', handleTranscriptFinal)
        sttWorkerManager.on('error', handleSTTError)
        
        // Start STT session (would need API key from settings)
        const apiKey = process.env.OPENAI_API_KEY || 'demo-key'
        await sttWorkerManager.startSession(apiKey)
      }
      
      // Start audio capture
      await startAudioCapture()
      audioStreamHandler.startStream()
      
      log.info('Recording started successfully')
    } else {
      log.info('Stopping recording via shortcut')
      isRecording = false
      
      // Update tray state
      systemTray.setState('idle')
      
      // Stop audio capture
      await stopAudioCapture()
      audioStreamHandler.stopStream()
      
      // End STT session
      await sttWorkerManager.endSession()
      
      // Hide overlay
      hideOverlay()
      
      log.info('Recording stopped successfully')
    }
  } catch (error) {
    log.error('Error toggling recording:', error)
    isRecording = false
    systemTray.setState('error')
    showOverlay('error', `Recording failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    
    // Hide overlay after 3 seconds
    setTimeout(() => hideOverlay(), 3000)
  }
}

// Handle final transcript from STT worker
async function handleTranscriptFinal(text: string, confidence?: number) {
  log.info(`Final transcript received: "${text}" (confidence: ${confidence || 'unknown'})`)
  
  try {
    const startTime = performance.now()
    
    // Copy to clipboard
    const success = await ClipboardService.copyAndVerify(text)
    
    const duration = performance.now() - startTime
    
    if (success) {
      log.info(`Transcript copied to clipboard in ${Math.round(duration)}ms`)
      
      // Show success notification
      systemTray.showNotification('Transcript Ready', `"${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`)
      
      // Check latency and warn if too high
      if (duration > 500) {
        log.warn(`High clipboard latency: ${Math.round(duration)}ms`)
        showOverlay('error', `Slow clipboard operation (${Math.round(duration)}ms)`)
        setTimeout(() => hideOverlay(), 2000)
      }
    } else {
      throw new Error('Clipboard verification failed')
    }
  } catch (error) {
    log.error('Error handling final transcript:', error)
    systemTray.showError('Failed to copy transcript')
    showOverlay('error', 'Failed to copy transcript')
    setTimeout(() => hideOverlay(), 3000)
  }
}

// Handle STT errors
function handleSTTError(error: Error) {
  log.error('STT error:', error)
  systemTray.showError(`Transcription error: ${error.message}`)
  showOverlay('error', `Transcription failed: ${error.message}`)
  setTimeout(() => hideOverlay(), 3000)
}

// Basic IPC handlers for testing
ipcMain.handle('ping', async () => {
  log.info('Received ping from renderer')
  return 'pong'
})

ipcMain.handle('get-app-version', async () => {
  return app.getVersion()
})

// Additional IPC handlers for the UI
ipcMain.handle('get-recording-status', async () => {
  return {
    isRecording,
    shortcutStatus: shortcutManager.getStatus(),
    streamStats: audioStreamHandler.getStreamStats()
  }
})

ipcMain.handle('test-recording', async () => {
  // Manual recording test for debugging
  await handleShortcutToggle()
  return 'Recording test triggered'
})

// Log unhandled errors
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

export { mainWindow } 