import { globalShortcut } from 'electron'
import { EventEmitter } from 'node:events'
import log from 'electron-log'

export const shortcuts = new EventEmitter()

interface ShortcutManagerOptions {
  debounceMs?: number
  maxRetries?: number
}

class ShortcutManager {
  private activeKey: string
  private debounceTimer: NodeJS.Timeout | null = null
  private lastTrigger = 0
  private readonly DEBOUNCE_MS: number
  private readonly MAX_RETRIES: number
  private retryCount = 0
  private isUsingFallback = false

  constructor(options: ShortcutManagerOptions = {}) {
    this.activeKey = 'Ctrl+Shift+Space' // Default hotkey
    this.DEBOUNCE_MS = options.debounceMs ?? 250
    this.MAX_RETRIES = options.maxRetries ?? 3
  }

  async initShortcut(hotkey?: string) {
    if (hotkey) {
      this.activeKey = hotkey
    }

    log.info(`Initializing shortcut: ${this.activeKey}`)

    try {
      // Primary: Electron's built-in globalShortcut (more reliable)
      await this.registerElectronShortcut(this.activeKey)
      this.isUsingFallback = false
      log.info('Successfully registered Electron global shortcut')
    } catch (err) {
      log.warn('Electron globalShortcut failed, attempting fallback:', err)
      
      try {
        // Fallback: uiohook-napi (better than iohook for newer Electron)
        await this.registerUiohookShortcut(this.activeKey)
        this.isUsingFallback = true
        log.info('Successfully registered uiohook-napi shortcut')
      } catch (fallbackErr) {
        log.error('Both shortcut methods failed:', fallbackErr)
        
        if (this.retryCount < this.MAX_RETRIES) {
          this.retryCount++
          log.info(`Retrying shortcut registration (${this.retryCount}/${this.MAX_RETRIES})`)
          setTimeout(() => this.initShortcut(), 1000 * this.retryCount)
        } else {
          throw new Error('Failed to register any shortcut method after retries')
        }
      }
    }
  }

  private async registerElectronShortcut(key: string) {
    // Unregister any existing shortcuts
    globalShortcut.unregisterAll()
    
    const success = globalShortcut.register(key, () => {
      this.handleKeyPress()
    })
    
    if (!success) {
      throw new Error(`Failed to register Electron shortcut: ${key}`)
    }
  }

  private async registerUiohookShortcut(key: string) {
    try {
      // Dynamic import for optional dependency
      const { uIOhook } = await import('uiohook-napi')
      
      // Parse the key combination
      const keyParts = this.parseShortcut(key)
      
      uIOhook.on('keydown', (e) => {
        if (this.matchesShortcut(e, keyParts)) {
          this.handleKeyPress()
        }
      })
      
      uIOhook.start()
      
    } catch (err) {
      throw new Error(`Failed to initialize uiohook-napi: ${err}`)
    }
  }

  private parseShortcut(shortcut: string) {
    const parts = shortcut.toLowerCase().split('+').map(p => p.trim())
    return {
      ctrl: parts.includes('ctrl'),
      shift: parts.includes('shift'),
      alt: parts.includes('alt'),
      key: parts.find(p => !['ctrl', 'shift', 'alt'].includes(p)) || 'space'
    }
  }

  private matchesShortcut(event: any, keyParts: any): boolean {
    // This is a simplified matching logic - in practice you'd need more robust key mapping
    return (
      event.ctrlKey === keyParts.ctrl &&
      event.shiftKey === keyParts.shift &&
      event.altKey === keyParts.alt &&
      event.keycode === this.getKeycodeForKey(keyParts.key)
    )
  }

  private getKeycodeForKey(key: string): number {
    // Simplified keycode mapping - extend as needed
    const keycodes: Record<string, number> = {
      'space': 57,
      'enter': 28,
      'escape': 1,
    }
    
    return keycodes[key] || 0
  }

  private handleKeyPress() {
    const now = Date.now()
    
    // Debounce protection
    if (now - this.lastTrigger < this.DEBOUNCE_MS) {
      log.debug('Shortcut debounced')
      return
    }
    
    log.info('Shortcut triggered')
    this.lastTrigger = now
    shortcuts.emit('toggle')
  }

  async updateHotkey(newKey: string) {
    log.info(`Updating hotkey from ${this.activeKey} to ${newKey}`)
    this.activeKey = newKey
    this.retryCount = 0 // Reset retry count for new key
    
    try {
      await this.initShortcut()
      log.info('Hotkey updated successfully')
    } catch (err) {
      log.error('Failed to update hotkey:', err)
      throw err
    }
  }

  cleanup() {
    log.info('Cleaning up shortcut manager')
    
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    
    // Cleanup Electron shortcuts
    globalShortcut.unregisterAll()
    
    // Cleanup uiohook if used
    if (this.isUsingFallback) {
      try {
        import('uiohook-napi').then(({ uIOhook }) => {
          uIOhook.stop()
        }).catch(() => {
          // Ignore cleanup errors
        })
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  getStatus() {
    return {
      activeKey: this.activeKey,
      isUsingFallback: this.isUsingFallback,
      retryCount: this.retryCount
    }
  }
}

export const shortcutManager = new ShortcutManager() 