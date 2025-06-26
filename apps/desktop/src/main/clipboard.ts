import { clipboard } from 'electron'
import log from 'electron-log'

export class ClipboardService {
  /**
   * Copy text to clipboard and verify the operation
   * @param text - Text to copy to clipboard
   * @returns Promise that resolves to true if successful, false otherwise
   */
  static async copyAndVerify(text: string): Promise<boolean> {
    if (!text || text.trim().length === 0) {
      log.warn('Attempted to copy empty text to clipboard')
      return false
    }

    try {
      const startTime = performance.now()
      
      // Write text to clipboard
      clipboard.writeText(text)
      
      // Small delay to ensure clipboard is updated
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Verify by reading back
      const readBack = clipboard.readText()
      const isSuccess = readBack === text
      
      const duration = performance.now() - startTime
      
      if (isSuccess) {
        log.info(`Successfully copied ${text.length} characters to clipboard in ${Math.round(duration)}ms`)
      } else {
        log.error(`Clipboard verification failed. Expected: "${text}", Got: "${readBack}"`)
      }
      
      return isSuccess
    } catch (error) {
      log.error('Clipboard operation failed:', error)
      return false
    }
  }

  /**
   * Get current clipboard text content
   * @returns Current clipboard text or empty string if unavailable
   */
  static getText(): string {
    try {
      return clipboard.readText()
    } catch (error) {
      log.error('Failed to read clipboard:', error)
      return ''
    }
  }

  /**
   * Check if clipboard contains text
   * @returns True if clipboard has text content
   */
  static hasText(): boolean {
    try {
      const text = clipboard.readText()
      return text.length > 0
    } catch (error) {
      log.error('Failed to check clipboard content:', error)
      return false
    }
  }

  /**
   * Clear clipboard content
   */
  static clear(): void {
    try {
      clipboard.clear()
      log.debug('Clipboard cleared')
    } catch (error) {
      log.error('Failed to clear clipboard:', error)
    }
  }
} 