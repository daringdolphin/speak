import { contextBridge, ipcRenderer } from 'electron'

// Define the API for the overlay window
interface OverlayAPI {
  // Listen for overlay state updates from main process
  onUpdate: (callback: (state: OverlayState) => void) => void
  
  // Listen for audio level updates from main process
  onLevelUpdate: (callback: (level: number, avgLevel: number) => void) => void
  
  // Send feedback to main process (optional)
  sendFeedback: (type: string, data?: any) => void
}

interface OverlayState {
  status: 'recording' | 'error' | 'idle'
  message?: string
  level?: number
  avgLevel?: number
}

// Implement the API
const overlayAPI: OverlayAPI = {
  // Listen for overlay updates from main process
  onUpdate: (callback) => {
    ipcRenderer.on('overlay-update', (_event, state) => {
      callback(state)
    })
  },
  
  // Listen for audio level updates
  onLevelUpdate: (callback) => {
    ipcRenderer.on('overlay-level-update', (_event, level, avgLevel) => {
      callback(level, avgLevel)
    })
  },
  
  // Send feedback to main process (e.g., user interactions if needed)
  sendFeedback: (type, data) => {
    ipcRenderer.send('overlay-feedback', { type, data })
  }
}

// Expose the API to the renderer
contextBridge.exposeInMainWorld('electronOverlay', overlayAPI)

// Add global type declaration for TypeScript
declare global {
  interface Window {
    electronOverlay: OverlayAPI
  }
} 