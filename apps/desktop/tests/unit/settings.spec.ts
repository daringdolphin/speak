import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SettingsStore, SettingsSchema } from '../../packages/common/settings'

// Mock electron-store
vi.mock('electron-store', () => {
  const mockStore = {
    get: vi.fn(),
    set: vi.fn(),
    store: {},
    clear: vi.fn(),
    path: '/mock/path/settings.json',
    onDidChange: vi.fn(() => () => {}),
    onDidAnyChange: vi.fn(() => () => {})
  }
  
  return {
    default: vi.fn(() => mockStore)
  }
})

describe('SettingsStore', () => {
  let settingsStore: SettingsStore
  let mockStoreInstance: any

  beforeEach(() => {
    vi.clearAllMocks()
    settingsStore = SettingsStore.getInstance()
    mockStoreInstance = (settingsStore as any).store
  })

  afterEach(() => {
    // Reset singleton for clean tests
    ;(SettingsStore as any).instance = null
  })

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = SettingsStore.getInstance()
      const instance2 = SettingsStore.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('get/set operations', () => {
    it('should get setting value', () => {
      mockStoreInstance.get.mockReturnValue('Ctrl+Shift+Space')
      
      const result = settingsStore.get('hotkey')
      
      expect(mockStoreInstance.get).toHaveBeenCalledWith('hotkey')
      expect(result).toBe('Ctrl+Shift+Space')
    })

    it('should set setting value with validation', () => {
      settingsStore.set('hotkey', 'Ctrl+Alt+T')
      
      expect(mockStoreInstance.set).toHaveBeenCalledWith('hotkey', 'Ctrl+Alt+T')
    })

    it('should validate boolean settings', () => {
      expect(() => {
        settingsStore.set('showOverlay', true)
      }).not.toThrow()

      expect(() => {
        settingsStore.set('showOverlay', false)
      }).not.toThrow()
    })

    it('should validate number settings with constraints', () => {
      // Valid sample rate
      expect(() => {
        settingsStore.set('sampleRate', 16000)
      }).not.toThrow()

      // Invalid sample rate (too low)
      expect(() => {
        settingsStore.set('sampleRate', 5000)
      }).toThrow()

      // Invalid sample rate (too high)
      expect(() => {
        settingsStore.set('sampleRate', 100000)
      }).toThrow()
    })

    it('should validate latency settings', () => {
      // Valid latency
      expect(() => {
        settingsStore.set('maxLatencyMs', 500)
      }).not.toThrow()

      // Invalid latency (too low)
      expect(() => {
        settingsStore.set('maxLatencyMs', 50)
      }).toThrow()

      // Invalid latency (too high)
      expect(() => {
        settingsStore.set('maxLatencyMs', 10000)
      }).toThrow()
    })
  })

  describe('bulk operations', () => {
    it('should update multiple settings', () => {
      const updates = {
        hotkey: 'Ctrl+Shift+R',
        showOverlay: false,
        maxLatencyMs: 300
      }

      mockStoreInstance.store = {
        hotkey: 'Ctrl+Shift+Space',
        showOverlay: true,
        maxLatencyMs: 500
      }

      settingsStore.update(updates)

      expect(mockStoreInstance.set).toHaveBeenCalledWith('hotkey', 'Ctrl+Shift+R')
      expect(mockStoreInstance.set).toHaveBeenCalledWith('showOverlay', false)
      expect(mockStoreInstance.set).toHaveBeenCalledWith('maxLatencyMs', 300)
    })

    it('should get all settings', () => {
      const mockSettings = {
        hotkey: 'Ctrl+Shift+Space',
        showOverlay: true,
        model: 'gpt-4o-transcribe'
      }
      
      mockStoreInstance.store = mockSettings
      
      const result = settingsStore.getAll()
      expect(result).toEqual(mockSettings)
    })

    it('should reset to defaults', () => {
      settingsStore.reset()
      
      expect(mockStoreInstance.clear).toHaveBeenCalled()
      expect(mockStoreInstance.set).toHaveBeenCalled()
    })
  })

  describe('validation helpers', () => {
    it('should validate hotkey format', () => {
      expect(settingsStore.validateHotkey('Ctrl+Shift+Space')).toBe(true)
      expect(settingsStore.validateHotkey('Alt+F1')).toBe(true)
      expect(settingsStore.validateHotkey('Ctrl+Alt+Shift+A')).toBe(true)
      
      // Invalid formats
      expect(settingsStore.validateHotkey('Space')).toBe(false)
      expect(settingsStore.validateHotkey('Ctrl+')).toBe(false)
      expect(settingsStore.validateHotkey('')).toBe(false)
      expect(settingsStore.validateHotkey('InvalidMod+A')).toBe(false)
    })

    it('should validate model names', () => {
      expect(settingsStore.validateModel('gpt-4o-transcribe')).toBe(true)
      expect(settingsStore.validateModel('whisper-1')).toBe(true)
      
      // Invalid models
      expect(settingsStore.validateModel('invalid-model')).toBe(false)
      expect(settingsStore.validateModel('')).toBe(false)
    })
  })

  describe('event handling', () => {
    it('should set up change listeners', () => {
      const callback = vi.fn()
      
      settingsStore.onDidChange('hotkey', callback)
      
      expect(mockStoreInstance.onDidChange).toHaveBeenCalledWith('hotkey', callback)
    })

    it('should set up any change listeners', () => {
      const callback = vi.fn()
      
      settingsStore.onDidAnyChange(callback)
      
      expect(mockStoreInstance.onDidAnyChange).toHaveBeenCalledWith(callback)
    })
  })

  describe('path access', () => {
    it('should provide settings file path', () => {
      const path = settingsStore.getPath()
      expect(path).toBe('/mock/path/settings.json')
    })
  })
})

describe('SettingsSchema', () => {
  describe('default values', () => {
    it('should provide correct defaults', () => {
      const defaults = SettingsSchema.parse({})
      
      expect(defaults.hotkey).toBe('Ctrl+Shift+Space')
      expect(defaults.showOverlay).toBe(true)
      expect(defaults.sampleRate).toBe(16000)
      expect(defaults.model).toBe('gpt-4o-transcribe')
      expect(defaults.language).toBe('en')
      expect(defaults.maxLatencyMs).toBe(500)
      expect(defaults.telemetryEnabled).toBe(false)
      expect(defaults.logLevel).toBe('info')
      expect(defaults.retryAttempts).toBe(3)
      expect(defaults.autoLaunch).toBe(false)
    })
  })

  describe('validation', () => {
    it('should validate complete settings object', () => {
      const validSettings = {
        hotkey: 'Ctrl+Alt+R',
        showOverlay: true,
        inputDevice: 'microphone-1',
        sampleRate: 44100,
        model: 'gpt-4o-transcribe',
        language: 'es',
        openaiKeyEncrypted: 'encrypted-key-data',
        overlayPosition: { x: 100, y: 200 },
        maxLatencyMs: 750,
        telemetryEnabled: true,
        logLevel: 'debug' as const,
        retryAttempts: 5,
        autoLaunch: true
      }

      expect(() => SettingsSchema.parse(validSettings)).not.toThrow()
    })

    it('should reject invalid settings', () => {
      const invalidSettings = {
        hotkey: 123, // Should be string
        showOverlay: 'yes', // Should be boolean
        sampleRate: 'high', // Should be number
        maxLatencyMs: -100, // Should be positive
        logLevel: 'verbose', // Invalid enum value
        retryAttempts: 0 // Should be >= 1
      }

      expect(() => SettingsSchema.parse(invalidSettings)).toThrow()
    })

    it('should handle partial settings updates', () => {
      const partialSettings = {
        hotkey: 'Ctrl+Shift+R',
        maxLatencyMs: 400
      }

      expect(() => SettingsSchema.partial().parse(partialSettings)).not.toThrow()
    })

    it('should validate overlay position object', () => {
      const validPosition = { x: 100, y: 200 }
      const partialPosition = { x: 100 }
      const emptyPosition = {}

      expect(() => SettingsSchema.shape.overlayPosition.parse(validPosition)).not.toThrow()
      expect(() => SettingsSchema.shape.overlayPosition.parse(partialPosition)).not.toThrow()
      expect(() => SettingsSchema.shape.overlayPosition.parse(emptyPosition)).not.toThrow()
    })
  })

  describe('type inference', () => {
    it('should infer correct TypeScript types', () => {
      const settings = SettingsSchema.parse({})
      
      // These should compile without TypeScript errors
      const hotkey: string = settings.hotkey
      const showOverlay: boolean = settings.showOverlay
      const sampleRate: number = settings.sampleRate
      const maxLatency: number = settings.maxLatencyMs
      
      expect(typeof hotkey).toBe('string')
      expect(typeof showOverlay).toBe('boolean')
      expect(typeof sampleRate).toBe('number')
      expect(typeof maxLatency).toBe('number')
    })
  })
}) 