import { createCipher, createDecipher } from 'crypto'
import log from 'electron-log'
import { settings } from '../common/settings'

// Windows DPAPI interface (will be dynamically imported)
interface DPAPIModule {
  protect(data: Buffer): Buffer
  unprotect(encryptedData: Buffer): Buffer
}

export class CryptoService {
  private static instance: CryptoService | null = null
  private dpapi: DPAPIModule | null = null
  private useFallback = false

  private constructor() {
    this.initializeCrypto()
  }

  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService()
    }
    return CryptoService.instance
  }

  private async initializeCrypto() {
    if (process.platform === 'win32') {
      try {
        // Try to load Windows DPAPI (using string to avoid TS resolution)
        this.dpapi = await import('dpapi-addon' as any)
        log.info('Windows DPAPI loaded successfully')
      } catch (error) {
        log.warn('DPAPI not available, falling back to AES encryption:', error)
        this.useFallback = true
      }
    } else {
      log.info('Non-Windows platform detected, using AES encryption')
      this.useFallback = true
    }
  }

  /**
   * Encrypt and store API key securely
   * @param apiKey - The OpenAI API key to encrypt
   * @returns Promise<boolean> - Success status
   */
  async saveApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty')
    }

    try {
      let encryptedKey: string

      if (this.dpapi && !this.useFallback) {
        // Use Windows DPAPI for encryption
        const encrypted = this.dpapi.protect(Buffer.from(apiKey, 'utf8'))
        encryptedKey = encrypted.toString('base64')
        log.info('API key encrypted using Windows DPAPI')
      } else {
        // Fallback to AES encryption with machine-specific key
        encryptedKey = this.encryptWithAES(apiKey)
        log.info('API key encrypted using AES fallback')
      }

      // Store the encrypted key in settings
      settings.set('openaiKeyEncrypted', encryptedKey)
      
      return true
    } catch (error) {
      log.error('Failed to save API key:', error)
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Decrypt and retrieve API key
   * @returns Promise<string | null> - Decrypted API key or null if not found
   */
  async loadApiKey(): Promise<string | null> {
    try {
      const encryptedKey = settings.get('openaiKeyEncrypted')
      
      if (!encryptedKey) {
        return null
      }

      let decryptedKey: string

      if (this.dpapi && !this.useFallback) {
        // Use Windows DPAPI for decryption
        const encrypted = Buffer.from(encryptedKey, 'base64')
        const decrypted = this.dpapi.unprotect(encrypted)
        decryptedKey = decrypted.toString('utf8')
        log.debug('API key decrypted using Windows DPAPI')
      } else {
        // Fallback to AES decryption
        decryptedKey = this.decryptWithAES(encryptedKey)
        log.debug('API key decrypted using AES fallback')
      }

      return decryptedKey
    } catch (error) {
      log.error('Failed to load API key:', error)
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Check if API key exists
   * @returns boolean - True if encrypted API key exists
   */
  hasApiKey(): boolean {
    const encryptedKey = settings.get('openaiKeyEncrypted')
    return !!encryptedKey && encryptedKey.length > 0
  }

  /**
   * Remove stored API key
   * @returns Promise<boolean> - Success status
   */
  async clearApiKey(): Promise<boolean> {
    try {
      settings.set('openaiKeyEncrypted', undefined)
      log.info('API key cleared from storage')
      return true
    } catch (error) {
      log.error('Failed to clear API key:', error)
      return false
    }
  }

  /**
   * Validate API key format (basic validation)
   * @param apiKey - API key to validate
   * @returns boolean - True if format appears valid
   */
  validateApiKeyFormat(apiKey: string): boolean {
    // OpenAI API keys typically start with 'sk-' and are 51 characters long
    return /^sk-[A-Za-z0-9]{48}$/.test(apiKey)
  }

  /**
   * Test API key by making a simple request
   * @param apiKey - API key to test
   * @returns Promise<boolean> - True if key is valid
   */
  async testApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'QuickTranscriber/0.1.0'
        }
      })

      return response.ok
    } catch (error) {
      log.error('API key test failed:', error)
      return false
    }
  }

  // Fallback AES encryption methods
  private encryptWithAES(text: string): string {
    try {
      // Generate machine-specific key (not fully secure but better than plaintext)
      const machineKey = this.getMachineKey()
      const cipher = createCipher('aes-256-cbc', machineKey)
      
      let encrypted = cipher.update(text, 'utf8', 'base64')
      encrypted += cipher.final('base64')
      
      return encrypted
    } catch (error) {
      throw new Error(`AES encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private decryptWithAES(encryptedText: string): string {
    try {
      const machineKey = this.getMachineKey()
      const decipher = createDecipher('aes-256-cbc', machineKey)
      
      let decrypted = decipher.update(encryptedText, 'base64', 'utf8')
      decrypted += decipher.final('utf8')
      
      return decrypted
    } catch (error) {
      throw new Error(`AES decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private getMachineKey(): string {
    // Generate a machine-specific key based on system properties
    // This is not cryptographically secure but provides basic protection
    const os = require('os')
    const crypto = require('crypto')
    
    const machineInfo = [
      os.hostname(),
      os.type(),
      os.platform(),
      os.arch(),
      process.env.USERNAME || process.env.USER || 'default'
    ].join('|')
    
    return crypto.createHash('sha256').update(machineInfo).digest('hex')
  }

  /**
   * Get encryption method being used
   * @returns string - 'DPAPI' or 'AES'
   */
  getEncryptionMethod(): string {
    return this.dpapi && !this.useFallback ? 'DPAPI' : 'AES'
  }
}

// Export singleton instance
export const cryptoService = CryptoService.getInstance() 