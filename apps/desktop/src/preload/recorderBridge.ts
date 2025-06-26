import { contextBridge, ipcRenderer } from 'electron'

// Define the API for the recorder window
interface RecorderAPI {
  // Commands from main process
  onStartCapture: (callback: () => void) => void
  onStopCapture: (callback: () => void) => void
  
  // Send data to main process
  sendAudioChunk: (data: ArrayBuffer, level: number, avgLevel: number) => void
  sendCaptureResult: (result: { success: boolean; error?: string }) => void
  
  // Status methods
  ping: () => Promise<string>
}

// Implement the API
const recorderAPI: RecorderAPI = {
  // Listen for capture commands from main process
  onStartCapture: (callback) => {
    ipcRenderer.on('start-capture', callback)
  },
  
  onStopCapture: (callback) => {
    ipcRenderer.on('stop-capture', callback)
  },
  
  // Send audio data to main process using transferable objects for efficiency
  sendAudioChunk: (data, level, avgLevel) => {
    // Use send instead of invoke for streaming - no response needed
    ipcRenderer.send('audio-chunk', {
      data,
      level,
      avgLevel,
      timestamp: Date.now()
    }, [data]) // Transfer the ArrayBuffer
  },
  
  // Send capture result back to main process
  sendCaptureResult: (result) => {
    ipcRenderer.send('capture-result', result)
  },
  
  // Basic connectivity test
  ping: () => ipcRenderer.invoke('recorder-ping')
}

// Expose the API to the renderer
contextBridge.exposeInMainWorld('electronRecorder', recorderAPI)

// Type declarations for TypeScript
declare global {
  interface Window {
    electronRecorder: RecorderAPI
  }
} 