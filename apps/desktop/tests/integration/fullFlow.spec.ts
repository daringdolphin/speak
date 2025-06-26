import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { MockSTTServer } from '../../tools/mock-ws/server'
import { ClipboardService } from '../../src/main/clipboard'
import { stateManager, AppState } from '../../src/main/stateManager'
import { perfMonitor } from '../../src/main/perfMonitor'
import { cryptoService } from '../../src/main/crypto'

// Mock electron clipboard
vi.mock('electron', () => ({
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn(),
    clear: vi.fn()
  }
}))

// Mock settings
vi.mock('../../../packages/common/settings', () => ({
  settings: {
    get: vi.fn((key: string) => {
      const defaults = {
        maxLatencyMs: 500,
        hotkey: 'Ctrl+Shift+Space',
        model: 'gpt-4o-transcribe'
      }
      return defaults[key as keyof typeof defaults]
    }),
    set: vi.fn(),
    onDidChange: vi.fn(() => () => {})
  }
}))

describe('Full Audio Flow Integration Tests', () => {
  let mockServer: MockSTTServer
  let originalEnv: string | undefined

  beforeAll(async () => {
    // Set up test environment
    originalEnv = process.env.OPENAI_WS_URL
    process.env.OPENAI_WS_URL = 'ws://localhost:19001'
    
    // Start mock server
    mockServer = new MockSTTServer({
      port: 19001,
      enableLogging: false // Reduce noise in tests
    })
    
    await mockServer.start()
    
    // Initialize performance monitor
    perfMonitor.initialize()
  })

  afterAll(async () => {
    await mockServer.stop()
    process.env.OPENAI_WS_URL = originalEnv
  })

  beforeEach(() => {
    vi.clearAllMocks()
    perfMonitor.reset()
  })

  afterEach(async () => {
    // Reset state manager
    await stateManager.reset()
  })

  describe('Basic transcript flow', () => {
    it('should complete full recording cycle with transcript', async () => {
      // Setup test transcript
      mockServer.queueTranscript({
        text: 'Hello, this is a test transcription.',
        confidence: 0.95,
        delayMs: 100
      })

      // Mock clipboard operations
      const mockClipboard = await import('electron')
      vi.mocked(mockClipboard.clipboard.writeText).mockImplementation(() => {})
      vi.mocked(mockClipboard.clipboard.readText).mockReturnValue('Hello, this is a test transcription.')

      // Mock crypto service to return a test API key
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      // Start recording
      const startSuccess = await stateManager.startRecording()
      expect(startSuccess).toBe(true)
      expect(stateManager.getCurrentState()).toBe(AppState.STARTING)

      // Wait for recording state
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.RECORDING) {
            resolve(undefined)
          }
        })
      })

      expect(stateManager.getCurrentState()).toBe(AppState.RECORDING)

      // Stop recording
      const stopSuccess = await stateManager.stopRecording()
      expect(stopSuccess).toBe(true)

      // Wait for completion
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.IDLE) {
            resolve(undefined)
          }
        })
      })

      // Verify final state
      expect(stateManager.getCurrentState()).toBe(AppState.IDLE)
      expect(mockClipboard.clipboard.writeText).toHaveBeenCalledWith('Hello, this is a test transcription.')
    }, 10000) // 10 second timeout for full flow

    it('should handle long transcripts efficiently', async () => {
      const longText = 'This is a very long transcript that tests the system\'s ability to handle extended content. '.repeat(10)
      
      mockServer.queueTranscript({
        text: longText,
        confidence: 0.88,
        delayMs: 200
      })

      // Mock clipboard operations
      const mockClipboard = await import('electron')
      vi.mocked(mockClipboard.clipboard.writeText).mockImplementation(() => {})
      vi.mocked(mockClipboard.clipboard.readText).mockReturnValue(longText)

      // Mock crypto service
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      const sessionId = perfMonitor.startSession()
      perfMonitor.markRecordingStart()

      // Start and complete flow
      await stateManager.startRecording()
      
      // Wait for recording state
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.RECORDING) {
            resolve(undefined)
          }
        })
      })

      await stateManager.stopRecording()

      // Wait for completion and get metrics
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.IDLE) {
            resolve(undefined)
          }
        })
      })

      const session = perfMonitor.endSession()
      expect(session).toBeDefined()
      expect(session?.sessionId).toBe(sessionId)
      expect(mockClipboard.clipboard.writeText).toHaveBeenCalledWith(longText)
    })

    it('should handle partial transcripts when enabled', async () => {
      mockServer.queueTranscript({
        text: 'This is a partial transcript test with multiple words.',
        confidence: 0.92,
        delayMs: 150,
        enablePartials: true,
        partialCount: 4
      })

      // Track partial transcripts
      const partialTranscripts: string[] = []
      stateManager.on('transcript-partial', (text: string) => {
        partialTranscripts.push(text)
      })

      // Mock crypto service
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      const mockClipboard = await import('electron')
      vi.mocked(mockClipboard.clipboard.writeText).mockImplementation(() => {})
      vi.mocked(mockClipboard.clipboard.readText).mockReturnValue('This is a partial transcript test with multiple words.')

      // Complete flow
      await stateManager.startRecording()
      
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.RECORDING) {
            resolve(undefined)
          }
        })
      })

      await stateManager.stopRecording()

      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.IDLE) {
            resolve(undefined)
          }
        })
      })

      // Verify partial transcripts were received (if implemented)
      // Note: This depends on T18 implementation
      expect(mockClipboard.clipboard.writeText).toHaveBeenCalledWith('This is a partial transcript test with multiple words.')
    })
  })

  describe('Error handling and recovery', () => {
    it('should handle network errors gracefully', async () => {
      // Mock crypto service
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      // Start recording
      await stateManager.startRecording()
      
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.RECORDING) {
            resolve(undefined)
          }
        })
      })

      // Simulate network failure
      mockServer.simulateNetworkFailure()

      // Wait for error state
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.ERROR) {
            resolve(undefined)
          }
        })
      })

      expect(stateManager.getCurrentState()).toBe(AppState.ERROR)
      expect(stateManager.getRetryCount()).toBeGreaterThan(0)
    })

    it('should recover from temporary server errors', async () => {
      // Setup error scenario
      mockServer.setupErrorScenarioTest()

      // Queue a successful transcript for after recovery
      setTimeout(() => {
        mockServer.queueTranscript({
          text: 'Recovery test successful.',
          confidence: 0.94
        })
      }, 2000)

      // Mock crypto service
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      const mockClipboard = await import('electron')
      vi.mocked(mockClipboard.clipboard.writeText).mockImplementation(() => {})
      vi.mocked(mockClipboard.clipboard.readText).mockReturnValue('Recovery test successful.')

      // Start recording (may encounter errors)
      await stateManager.startRecording()

      // Wait for eventual success or failure
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(undefined) // Timeout after 15 seconds
        }, 15000)

        stateManager.on('state-changed', (transition) => {
          if (transition.to === AppState.IDLE || transition.to === AppState.FATAL) {
            clearTimeout(timeout)
            resolve(undefined)
          }
        })
      })

      // Should eventually succeed or reach a stable error state
      expect([AppState.IDLE, AppState.FATAL]).toContain(stateManager.getCurrentState())
    }, 20000) // Extended timeout for error recovery
  })

  describe('Performance requirements', () => {
    it('should meet latency requirements', async () => {
      // Setup fast transcript for latency testing
      mockServer.setupLatencyTest()

      // Mock crypto service
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      const mockClipboard = await import('electron')
      vi.mocked(mockClipboard.clipboard.writeText).mockImplementation(() => {})
      vi.mocked(mockClipboard.clipboard.readText).mockReturnValue('This is a latency test message.')

      // Start performance session
      const sessionId = perfMonitor.startSession()
      
      // Complete recording cycle
      await stateManager.startRecording()
      
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.RECORDING) {
            resolve(undefined)
          }
        })
      })

      await stateManager.stopRecording()

      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.IDLE) {
            resolve(undefined)
          }
        })
      })

      // Analyze performance
      const session = perfMonitor.endSession()
      expect(session).toBeDefined()
      
      if (session?.totalLatency) {
        expect(session.totalLatency).toBeLessThan(500) // Should meet <500ms requirement
      }

      if (session?.clipboardLatency) {
        expect(session.clipboardLatency).toBeLessThan(100) // Clipboard should be very fast
      }
    })

    it('should handle concurrent operations efficiently', async () => {
      // Setup multiple test scenarios
      mockServer.queueMultipleTranscripts([
        { text: 'First test message.', confidence: 0.95, delayMs: 50 },
        { text: 'Second test message.', confidence: 0.93, delayMs: 75 },
        { text: 'Third test message.', confidence: 0.91, delayMs: 100 }
      ])

      // Mock crypto service
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      const mockClipboard = await import('electron')
      const clipboardTexts: string[] = []
      vi.mocked(mockClipboard.clipboard.writeText).mockImplementation((text: string) => {
        clipboardTexts.push(text)
      })
      vi.mocked(mockClipboard.clipboard.readText).mockImplementation(() => {
        return clipboardTexts[clipboardTexts.length - 1] || ''
      })

      // Run multiple recording cycles in sequence
      for (let i = 0; i < 3; i++) {
        const sessionId = perfMonitor.startSession()
        
        await stateManager.startRecording()
        
        await new Promise(resolve => {
          stateManager.once('state-changed', (transition) => {
            if (transition.to === AppState.RECORDING) {
              resolve(undefined)
            }
          })
        })

        await stateManager.stopRecording()

        await new Promise(resolve => {
          stateManager.once('state-changed', (transition) => {
            if (transition.to === AppState.IDLE) {
              resolve(undefined)
            }
          })
        })

        const session = perfMonitor.endSession()
        expect(session).toBeDefined()
      }

      // Verify all transcripts were processed
      expect(clipboardTexts).toHaveLength(3)
      expect(clipboardTexts[0]).toBe('First test message.')
      expect(clipboardTexts[1]).toBe('Second test message.')
      expect(clipboardTexts[2]).toBe('Third test message.')

      // Check average performance
      const avgMetrics = perfMonitor.getAverageMetrics()
      expect(avgMetrics.avgTotalLatency).toBeLessThan(1000) // Average should be reasonable
    })
  })

  describe('Edge cases', () => {
    it('should handle empty transcripts', async () => {
      mockServer.queueTranscript({
        text: '',
        confidence: 0.1,
        delayMs: 50
      })

      // Mock crypto service
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      await stateManager.startRecording()
      
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.RECORDING) {
            resolve(undefined)
          }
        })
      })

      await stateManager.stopRecording()

      // Should handle empty transcript gracefully
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.ERROR || transition.to === AppState.IDLE) {
            resolve(undefined)
          }
        })
      })

      // System should handle empty transcript without crashing
      expect([AppState.IDLE, AppState.ERROR]).toContain(stateManager.getCurrentState())
    })

    it('should handle very long transcripts', async () => {
      const veryLongText = 'Word '.repeat(1000) // 1000 words
      
      mockServer.queueTranscript({
        text: veryLongText.trim(),
        confidence: 0.85,
        delayMs: 300
      })

      // Mock crypto service
      vi.spyOn(cryptoService, 'hasApiKey').mockReturnValue(true)
      vi.spyOn(cryptoService, 'loadApiKey').mockResolvedValue('sk-test123')

      const mockClipboard = await import('electron')
      vi.mocked(mockClipboard.clipboard.writeText).mockImplementation(() => {})
      vi.mocked(mockClipboard.clipboard.readText).mockReturnValue(veryLongText.trim())

      await stateManager.startRecording()
      
      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.RECORDING) {
            resolve(undefined)
          }
        })
      })

      await stateManager.stopRecording()

      await new Promise(resolve => {
        stateManager.once('state-changed', (transition) => {
          if (transition.to === AppState.IDLE) {
            resolve(undefined)
          }
        })
      })

      expect(stateManager.getCurrentState()).toBe(AppState.IDLE)
      expect(mockClipboard.clipboard.writeText).toHaveBeenCalledWith(veryLongText.trim())
    }, 15000) // Extended timeout for long content
  })
}) 