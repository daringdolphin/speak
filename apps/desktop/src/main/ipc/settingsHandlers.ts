import { ipcMain, Notification } from 'electron'
import log from 'electron-log'
import { settings } from '../../common/settings'
import { cryptoService } from '../crypto'
import { systemTray } from '../tray'
import { shortcutManager } from '../shortcutManager'
import { telemetryService } from '../telemetry'

/**
 * Register all IPC handlers for settings management
 */
export function registerSettingsHandlers() {
  // Get all settings
  ipcMain.handle('get-all-settings', async () => {
    try {
      const allSettings = settings.store
      
      // Decrypt API key if it exists
      const encryptedKey = settings.get('openaiKeyEncrypted')
      let openaiKey = ''
      if (encryptedKey) {
        try {
          openaiKey = await cryptoService.decrypt(encryptedKey)
        } catch (error) {
          log.warn('Failed to decrypt API key:', error)
        }
      }

      return {
        ...allSettings,
        openaiKey,
        openaiKeyEncrypted: undefined // Don't send encrypted key to renderer
      }
    } catch (error) {
      log.error('Failed to get settings:', error)
      throw error
    }
  })

  // Save all settings
  ipcMain.handle('save-all-settings', async (event, newSettings) => {
    try {
      log.info('Saving settings:', Object.keys(newSettings))

      // Handle API key encryption
      if (newSettings.openaiKey) {
        const encryptedKey = await cryptoService.encrypt(newSettings.openaiKey)
        settings.set('openaiKeyEncrypted', encryptedKey)
        delete newSettings.openaiKey // Don't store plaintext key
      }

      // Save other settings
      Object.keys(newSettings).forEach(key => {
        if (key !== 'openaiKey') {
          settings.set(key, newSettings[key])
        }
      })

      // Apply settings that need immediate action
      if (newSettings.hotkey) {
        await shortcutManager.updateHotkey(newSettings.hotkey)
      }

      if (newSettings.telemetryEnabled !== undefined) {
        // Telemetry service will automatically update via settings listener
        log.info(`Telemetry ${newSettings.telemetryEnabled ? 'enabled' : 'disabled'}`)
      }

      if (newSettings.autoLaunch !== undefined) {
        // This is handled by the tray menu, but we could also set it here
        log.info(`Auto-launch ${newSettings.autoLaunch ? 'enabled' : 'disabled'}`)
      }

      log.info('Settings saved successfully')
      
      // Track settings change event
      telemetryService.trackEvent('settings_changed', {
        keys: Object.keys(newSettings)
      })

    } catch (error) {
      log.error('Failed to save settings:', error)
      throw error
    }
  })

  // Get single setting
  ipcMain.handle('get-setting', async (event, key) => {
    try {
      return settings.get(key)
    } catch (error) {
      log.error(`Failed to get setting ${key}:`, error)
      throw error
    }
  })

  // Set single setting
  ipcMain.handle('set-setting', async (event, key, value) => {
    try {
      settings.set(key, value)
      log.debug(`Setting ${key} updated`)
    } catch (error) {
      log.error(`Failed to set setting ${key}:`, error)
      throw error
    }
  })

  // Test OpenAI API key
  ipcMain.handle('test-openai-key', async (event, apiKey) => {
    try {
      log.info('Testing OpenAI API key')
      
      // Test the key by making a simple API call
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        // Check if whisper or gpt models are available
        const hasRealtimeModels = data.data?.some((model: any) => 
          model.id.includes('gpt-4') || model.id.includes('whisper')
        )
        
        if (hasRealtimeModels) {
          log.info('OpenAI API key test successful')
          return { success: true }
        } else {
          return { 
            success: false, 
            error: 'API key valid but no suitable models found' 
          }
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        log.warn('OpenAI API key test failed:', response.status, errorData)
        
        switch (response.status) {
          case 401:
            return { success: false, error: 'Invalid API key' }
          case 429:
            return { success: false, error: 'Rate limit exceeded' }
          case 403:
            return { success: false, error: 'API key lacks required permissions' }
          default:
            return { 
              success: false, 
              error: `API error: ${response.status} ${errorData.error?.message || ''}` 
            }
        }
      }
    } catch (error) {
      log.error('OpenAI API key test error:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      }
    }
  })

  // Close settings dialog
  ipcMain.handle('close-settings-dialog', async () => {
    try {
      systemTray.closeSettingsDialog()
    } catch (error) {
      log.error('Failed to close settings dialog:', error)
    }
  })

  // Show notification
  ipcMain.handle('show-notification', async (event, message) => {
    try {
      // Show system notification
      if (Notification.isSupported()) {
        new Notification({
          title: 'QuickTranscriber',
          body: message,
          icon: undefined // Could add an icon path here
        }).show()
      }
      
      // Also show tray notification on Windows
      if (process.platform === 'win32') {
        systemTray.showNotification('QuickTranscriber', message)
      }
      
      log.info('Notification shown:', message)
    } catch (error) {
      log.error('Failed to show notification:', error)
    }
  })

  log.info('Settings IPC handlers registered')
} 