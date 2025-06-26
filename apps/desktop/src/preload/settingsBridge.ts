import { contextBridge, ipcRenderer } from 'electron'

// Define the API for the settings window
interface SettingsAPI {
  // Settings management
  invoke: (channel: string, ...args: any[]) => Promise<any>
  
  // Specific settings methods
  getAllSettings: () => Promise<any>
  saveAllSettings: (settings: any) => Promise<void>
  getSetting: (key: string) => Promise<any>
  setSetting: (key: string, value: any) => Promise<void>
  
  // API key testing
  testOpenAIKey: (key: string) => Promise<{ success: boolean; error?: string }>
  
  // Window control
  closeSettingsDialog: () => Promise<void>
  
  // Notifications
  showNotification: (message: string) => Promise<void>
}

// Expose the API to the renderer process
const settingsAPI: SettingsAPI = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  
  getAllSettings: () => ipcRenderer.invoke('get-all-settings'),
  saveAllSettings: (settings) => ipcRenderer.invoke('save-all-settings', settings),
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  
  testOpenAIKey: (key) => ipcRenderer.invoke('test-openai-key', key),
  
  closeSettingsDialog: () => ipcRenderer.invoke('close-settings-dialog'),
  
  showNotification: (message) => ipcRenderer.invoke('show-notification', message),
}

// Expose the API to window.electron
contextBridge.exposeInMainWorld('electron', settingsAPI) 