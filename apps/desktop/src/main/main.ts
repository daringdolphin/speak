import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import { shortcutManager, shortcuts } from './shortcutManager'
import { createRecorderWindow, createOverlayWindow, showOverlay, hideOverlay, startAudioCapture, stopAudioCapture, cleanupWindows } from './windows'
import { audioStreamHandler } from './ipc/audioStream'

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
  log.info('App ready, initializing application')
  
  // Create main window
  createMainWindow()
  
  // Initialize audio stream handler
  log.info('Audio stream handler initialized')
  
  // Initialize global shortcuts
  try {
    await shortcutManager.initShortcut()
    log.info('Shortcut manager initialized')
  } catch (error) {
    log.error('Failed to initialize shortcuts:', error)
  }
  
  // Setup shortcut event handlers
  shortcuts.on('toggle', handleShortcutToggle)
  
  // Create recorder and overlay windows (hidden initially)
  createRecorderWindow()
  createOverlayWindow()
  
  log.info('Application initialization complete')

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
  shortcutManager.cleanup()
  audioStreamHandler.stopStream()
  cleanupWindows()
})

// Recording toggle handler
async function handleShortcutToggle() {
  try {
    if (!isRecording) {
      log.info('Starting recording via shortcut')
      isRecording = true
      
      // Show overlay
      showOverlay('recording', 'Listening...')
      
      // Start audio capture
      await startAudioCapture()
      audioStreamHandler.startStream()
      
      log.info('Recording started successfully')
    } else {
      log.info('Stopping recording via shortcut')
      isRecording = false
      
      // Stop audio capture
      await stopAudioCapture()
      audioStreamHandler.stopStream()
      
      // Hide overlay
      hideOverlay()
      
      log.info('Recording stopped successfully')
    }
  } catch (error) {
    log.error('Error toggling recording:', error)
    isRecording = false
    showOverlay('error', `Recording failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    
    // Hide overlay after 3 seconds
    setTimeout(() => hideOverlay(), 3000)
  }
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