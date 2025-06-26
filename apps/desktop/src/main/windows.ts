import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import log from 'electron-log'

// const isDev = process.env.NODE_ENV === 'development'
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let recorderWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

export function createRecorderWindow(): BrowserWindow {
  log.info('Creating hidden recorder window for audio capture')
  
  recorderWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false, // Hidden window
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/recorderBridge.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Need access to getUserMedia
    },
  })

  // Load the recorder page
  if (VITE_DEV_SERVER_URL) {
    recorderWindow.loadURL(`${VITE_DEV_SERVER_URL}/recorder.html`)
  } else {
    recorderWindow.loadFile(join(__dirname, '../renderer/recorder.html'))
  }

  // Handle window closed
  recorderWindow.on('closed', () => {
    log.info('Recorder window closed')
    recorderWindow = null
  })

  // Handle any errors
  recorderWindow.webContents.on('render-process-gone', () => {
    log.error('Recorder window render process gone')
  })

  return recorderWindow
}

export function createOverlayWindow(): BrowserWindow {
  log.info('Creating overlay window')
  
  const primaryDisplay = screen.getPrimaryDisplay()
  const { workArea } = primaryDisplay
  
  overlayWindow = new BrowserWindow({
    width: 350,
    height: 120,
    x: workArea.x + workArea.width - 350,
    y: workArea.y + workArea.height - 160,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false, // Initially hidden
    webPreferences: {
      preload: join(__dirname, '../preload/overlayBridge.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // Overlay doesn't need special permissions
    },
  })

  // Load the overlay page
  if (VITE_DEV_SERVER_URL) {
    overlayWindow.loadURL(`${VITE_DEV_SERVER_URL}/overlay.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  // Handle window closed
  overlayWindow.on('closed', () => {
    log.info('Overlay window closed')
    overlayWindow = null
  })

  // Prevent the overlay from taking focus
  overlayWindow.on('blur', () => {
    if (overlayWindow && overlayWindow.isVisible()) {
      overlayWindow.setAlwaysOnTop(true)
    }
  })

  return overlayWindow
}

export function getRecorderWindow(): BrowserWindow | null {
  return recorderWindow
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow
}

export function showOverlay(status: 'recording' | 'error' | 'idle', message?: string) {
  if (!overlayWindow) {
    createOverlayWindow()
  }
  
  if (overlayWindow) {
    overlayWindow.webContents.send('overlay-update', { status, message })
    overlayWindow.show()
    overlayWindow.setAlwaysOnTop(true)
    log.info(`Overlay shown with status: ${status}`)
  }
}

export function hideOverlay() {
  if (overlayWindow && overlayWindow.isVisible()) {
    overlayWindow.hide()
    log.info('Overlay hidden')
  }
}

export function startAudioCapture(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!recorderWindow) {
      createRecorderWindow()
    }

    if (recorderWindow) {
      // Send start capture command to recorder window
      recorderWindow.webContents.send('start-capture')
      log.info('Audio capture start signal sent')
      
      // For now, just resolve immediately
      // The result handling is done through the IPC handler in audioStream.ts
      resolve()
    } else {
      reject(new Error('Failed to create recorder window'))
    }
  })
}

export function stopAudioCapture(): Promise<void> {
  return new Promise((resolve) => {
    if (recorderWindow) {
      recorderWindow.webContents.send('stop-capture')
      log.info('Audio capture stop signal sent')
    }
    resolve()
  })
}

export function cleanupWindows() {
  log.info('Cleaning up all windows')
  
  if (recorderWindow) {
    recorderWindow.close()
    recorderWindow = null
  }
  
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }
} 