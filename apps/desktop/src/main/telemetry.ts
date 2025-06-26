import * as Sentry from '@sentry/electron/main'
import log from 'electron-log'
import { settings } from '../common/settings'
import { app } from 'electron'

class TelemetryService {
  private initialized = false
  private enabled = false

  /**
   * Initialize telemetry service based on user settings
   */
  async initialize() {
    this.enabled = settings.get('telemetryEnabled', false)
    
    if (this.enabled && !this.initialized) {
      await this.enableTelemetry()
    } else if (!this.enabled && this.initialized) {
      this.disableTelemetry()
    }

    // Listen for settings changes
    settings.onDidChange('telemetryEnabled', (newValue) => {
      if (newValue !== this.enabled) {
        this.enabled = newValue
        if (newValue) {
          this.enableTelemetry()
        } else {
          this.disableTelemetry()
        }
      }
    })

    log.info(`Telemetry service initialized - enabled: ${this.enabled}`)
  }

  private async enableTelemetry() {
    try {
      // Only initialize if not already done
      if (this.initialized) return

      Sentry.init({
        dsn: process.env.SENTRY_DSN || '', // Set via environment variable
        environment: process.env.NODE_ENV || 'production',
        release: app.getVersion(),
        
        // Privacy-focused configuration
        beforeSend(event) {
          // Strip potentially sensitive data
          if (event.user) {
            delete event.user.email
            delete event.user.username
          }
          
          // Remove file paths that might contain user info
          if (event.exception?.values) {
            event.exception.values.forEach(exception => {
              if (exception.stacktrace?.frames) {
                exception.stacktrace.frames.forEach(frame => {
                  if (frame.filename) {
                    // Keep only relative paths
                    frame.filename = frame.filename.replace(/^.*[\\\/]/, '')
                  }
                })
              }
            })
          }
          
          return event
        },

        // Only capture errors and performance in production
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
        
        // Set user context (anonymous)
        initialScope: {
          user: {
            id: this.generateAnonymousId(),
          },
          tags: {
            platform: process.platform,
            arch: process.arch,
            version: app.getVersion(),
          }
        }
      })

      this.initialized = true
      log.info('Telemetry enabled')
      
      // Track app startup
      this.trackEvent('app_started', {
        version: app.getVersion(),
        platform: process.platform
      })

    } catch (error) {
      log.error('Failed to initialize telemetry:', error)
    }
  }

  private disableTelemetry() {
    if (this.initialized) {
      try {
        Sentry.close()
        this.initialized = false
        log.info('Telemetry disabled')
      } catch (error) {
        log.error('Failed to disable telemetry:', error)
      }
    }
  }

  /**
   * Track a custom event (only if telemetry enabled)
   */
  trackEvent(eventName: string, properties?: Record<string, any>) {
    if (!this.enabled || !this.initialized) return

    try {
      Sentry.addBreadcrumb({
        message: eventName,
        category: 'user_action',
        data: properties,
        level: 'info'
      })

      // For important events, also create a custom event
      if (this.isImportantEvent(eventName)) {
        Sentry.captureMessage(`Event: ${eventName}`, 'info')
      }
    } catch (error) {
      log.error('Failed to track event:', error)
    }
  }

  /**
   * Track an error (only if telemetry enabled)
   */
  trackError(error: Error, context?: Record<string, any>) {
    if (!this.enabled || !this.initialized) return

    try {
      Sentry.withScope((scope) => {
        if (context) {
          Object.keys(context).forEach(key => {
            scope.setTag(key, context[key])
          })
        }
        Sentry.captureException(error)
      })
    } catch (trackingError) {
      log.error('Failed to track error:', trackingError)
    }
  }

  /**
   * Track performance metrics (only if telemetry enabled)
   */
  trackPerformance(metricName: string, value: number, unit = 'ms') {
    if (!this.enabled || !this.initialized) return

    try {
      Sentry.addBreadcrumb({
        message: `Performance: ${metricName}`,
        category: 'performance',
        data: { value, unit },
        level: 'info'
      })
    } catch (error) {
      log.error('Failed to track performance:', error)
    }
  }

  /**
   * Set user context (anonymous only)
   */
  setUserContext(context: Record<string, any>) {
    if (!this.enabled || !this.initialized) return

    try {
      Sentry.setUser({
        id: this.generateAnonymousId(),
        ...context
      })
    } catch (error) {
      log.error('Failed to set user context:', error)
    }
  }

  /**
   * Check if telemetry is currently enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.initialized
  }

  private generateAnonymousId(): string {
    // Generate a stable anonymous ID based on system info
    // This allows for session tracking without identifying the user
    const crypto = require('crypto')
    const os = require('os')
    
    const systemInfo = `${os.hostname()}-${os.platform()}-${os.arch()}`
    return crypto.createHash('sha256').update(systemInfo).digest('hex').slice(0, 16)
  }

  private isImportantEvent(eventName: string): boolean {
    const importantEvents = [
      'app_started',
      'recording_started',
      'recording_completed',
      'error_occurred',
      'settings_changed',
      'shortcut_changed'
    ]
    return importantEvents.includes(eventName)
  }
}

// Export singleton instance
export const telemetryService = new TelemetryService()

// Convenience functions for common tracking
export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  telemetryService.trackEvent(eventName, properties)
}

export const trackError = (error: Error, context?: Record<string, any>) => {
  telemetryService.trackError(error, context)
}

export const trackPerformance = (metricName: string, value: number, unit = 'ms') => {
  telemetryService.trackPerformance(metricName, value, unit)
} 