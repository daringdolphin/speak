import { Tray, Menu, nativeImage, app } from 'electron'
// path utilities used in tray icon creation
import log from 'electron-log'

type TrayState = 'idle' | 'recording' | 'error'

export class SystemTray {
  private tray: Tray | null = null
  private currentState: TrayState = 'idle'

  constructor() {
    // Don't create tray immediately, wait for initialize() call
  }

  /**
   * Initialize the system tray
   */
  initialize() {
    if (!this.tray) {
      this.createTray()
    }
  }

  private createTray() {
    try {
      // Create tray icon (using a simple dot for now - can be replaced with actual icons)
      const icon = this.createIcon('idle')
      this.tray = new Tray(icon)
      
      this.tray.setToolTip('QuickTranscriber - Ready')
      this.updateContextMenu()
      
      // Handle tray click events (optional)
      this.tray.on('click', () => {
        log.debug('Tray icon clicked')
        // Could show/hide main window or settings
      })

      log.info('System tray created successfully')
    } catch (error) {
      log.error('Failed to create system tray:', error)
    }
  }

  private createIcon(state: TrayState) {
    // Create simple colored dots as icons
    // For now, use empty icon - in production, these would be proper icon files
    try {
      // Try to use canvas if available
      const canvas = require('canvas')
      const size = 16
      const canvasElement = canvas.createCanvas(size, size)
      const ctx = canvasElement.getContext('2d')
      
      // Clear background
      ctx.clearRect(0, 0, size, size)
      
      // Draw colored dot based on state
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 3, 0, 2 * Math.PI)
      
      switch (state) {
        case 'idle':
          ctx.fillStyle = '#10B981' // Green
          break
        case 'recording':
          ctx.fillStyle = '#EF4444' // Red
          break
        case 'error':
          ctx.fillStyle = '#F59E0B' // Orange
          break
      }
      
      ctx.fill()
      
      // Convert to nativeImage
      const buffer = canvasElement.toBuffer('image/png')
      return nativeImage.createFromBuffer(buffer)
    } catch (error) {
      // Fallback to empty icon if canvas fails
      log.warn('Canvas not available for tray icons, using empty icon:', error)
      return nativeImage.createEmpty()
    }
  }

  private updateContextMenu() {
    if (!this.tray) return

    const template = [
      {
        label: 'QuickTranscriber',
        enabled: false
      },
      {
        type: 'separator' as const
      },
      {
        label: `Status: ${this.getStatusText()}`,
        enabled: false
      },
      {
        type: 'separator' as const
      },
      {
        label: 'Settings...',
        click: () => {
          log.info('Settings clicked (not implemented yet)')
          // TODO: Open settings dialog in T25
        }
      },
      {
        label: 'API Key...',
        click: () => {
          log.info('API Key clicked (not implemented yet)')
          // TODO: Open API key dialog in T25
        }
      },
      {
        label: 'Hotkey...',
        click: () => {
          log.info('Hotkey clicked (not implemented yet)')
          // TODO: Open hotkey dialog in T25
        }
      },
      {
        type: 'separator' as const
      },
      {
        label: 'Launch on Boot',
        type: 'checkbox' as const,
        checked: this.isLaunchOnBootEnabled(),
        click: (menuItem: Electron.MenuItem) => {
          this.toggleLaunchOnBoot(menuItem.checked)
        }
      },
      {
        type: 'separator' as const
      },
      {
        label: 'Show Logs',
        click: () => {
          this.showLogs()
        }
      },
      {
        label: 'Quit',
        click: () => {
          log.info('Quit selected from tray menu')
          app.quit()
        }
      }
    ]

    const contextMenu = Menu.buildFromTemplate(template)
    this.tray.setContextMenu(contextMenu)
  }

  private getStatusText(): string {
    switch (this.currentState) {
      case 'idle':
        return 'Ready'
      case 'recording':
        return 'Recording'
      case 'error':
        return 'Error'
      default:
        return 'Unknown'
    }
  }

  private isLaunchOnBootEnabled(): boolean {
    return app.getLoginItemSettings().openAtLogin
  }

  private toggleLaunchOnBoot(enabled: boolean) {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true // Start minimized to tray
      })
      
      log.info(`Launch on boot ${enabled ? 'enabled' : 'disabled'}`)
    } catch (error) {
      log.error('Failed to toggle launch on boot:', error)
    }
  }

  private showLogs() {
    try {
      const { shell } = require('electron')
      const logPath = log.transports.file.getFile().path
      shell.showItemInFolder(logPath)
      log.info('Opened log file location')
    } catch (error) {
      log.error('Failed to show logs:', error)
    }
  }

  /**
   * Update tray state and icon
   */
  setState(state: TrayState) {
    if (this.currentState === state) return

    this.currentState = state
    
    if (this.tray) {
      // Update icon
      const icon = this.createIcon(state)
      this.tray.setImage(icon)
      
      // Update tooltip
      const tooltips = {
        idle: 'QuickTranscriber - Ready',
        recording: 'QuickTranscriber - Recording',
        error: 'QuickTranscriber - Error'
      }
      
      this.tray.setToolTip(tooltips[state])
      
      // Update context menu
      this.updateContextMenu()
      
      log.debug(`Tray state updated to: ${state}`)
    }
  }

  /**
   * Show notification balloon (Windows)
   */
  showNotification(title: string, content: string) {
    if (this.tray && process.platform === 'win32') {
      this.tray.displayBalloon({
        title,
        content,
        iconType: 'info'
      })
    }
  }

  /**
   * Show error notification
   */
  showError(message: string) {
    this.setState('error')
    this.showNotification('QuickTranscriber Error', message)
  }

  /**
   * Clean up tray resources
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
      log.info('System tray destroyed')
    }
  }
}

// Export singleton instance
export const systemTray = new SystemTray() 