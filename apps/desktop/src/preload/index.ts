import { contextBridge, ipcRenderer } from 'electron'

// Define the API that will be exposed to the renderer process
interface ElectronAPI {
  // Basic IPC methods
  ping: () => Promise<string>
  getAppVersion: () => Promise<string>
  invoke: (channel: string, ...args: any[]) => Promise<any>
  
  // Audio recording methods
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  getRecordingStatus: () => Promise<{ isRecording: boolean; error?: string }>
  testRecording: () => Promise<{ success: boolean; message: string }>
  
  // Audio data streaming (T7)
  onAudioChunk: (callback: (data: ArrayBuffer) => void) => void
  
  // Overlay control
  showOverlay: (status: 'recording' | 'error' | 'idle', message?: string) => Promise<void>
  hideOverlay: () => Promise<void>
  
  // Settings
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<void>
}

// Expose the API to the renderer process
const electronAPI: ElectronAPI = {
  ping: () => ipcRenderer.invoke('ping'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  
  // Recording methods
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  getRecordingStatus: () => ipcRenderer.invoke('get-recording-status'),
  testRecording: () => ipcRenderer.invoke('test-recording'),
  
  onAudioChunk: (callback) => {
    ipcRenderer.on('audio-chunk', (_event, data: ArrayBuffer) => {
      callback(data)
    })
  },
  
  showOverlay: (status, message) => ipcRenderer.invoke('show-overlay', status, message),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
}

// Expose the API to window.electron
contextBridge.exposeInMainWorld('electron', electronAPI)

// Type declaration for TypeScript
declare global {
  interface Window {
    electron: ElectronAPI
  }
} 