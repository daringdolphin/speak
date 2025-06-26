import { WebSocketServer, WebSocket } from 'ws'
import { EventEmitter } from 'events'
import log from './logger'

export interface MockServerOptions {
  port?: number
  host?: string
  enableLogging?: boolean
  simulateLatency?: boolean
  latencyMs?: number
  errorRate?: number // 0-1, probability of simulated errors
  autoRespond?: boolean
}

export interface MockTranscriptOptions {
  text: string
  confidence?: number
  delayMs?: number
  enablePartials?: boolean
  partialCount?: number
}

export class MockSTTServer extends EventEmitter {
  private server: WebSocketServer
  private clients = new Set<WebSocket>()
  private options: Required<MockServerOptions>
  private isRunning = false
  private transcriptQueue: MockTranscriptOptions[] = []

  constructor(options: MockServerOptions = {}) {
    super()
    
    this.options = {
      port: options.port || 19000,
      host: options.host || 'localhost',
      enableLogging: options.enableLogging ?? true,
      simulateLatency: options.simulateLatency ?? true,
      latencyMs: options.latencyMs || 100,
      errorRate: options.errorRate || 0,
      autoRespond: options.autoRespond ?? true
    }

    this.server = new WebSocketServer({
      port: this.options.port,
      host: this.options.host
    })

    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    this.server.on('connection', this.handleConnection.bind(this))
    this.server.on('error', this.handleServerError.bind(this))
    
    this.server.on('listening', () => {
      this.isRunning = true
      if (this.options.enableLogging) {
        log.info(`Mock STT server listening on ${this.options.host}:${this.options.port}`)
      }
      this.emit('listening')
    })
  }

  private handleConnection(ws: WebSocket, request: any) {
    if (this.options.enableLogging) {
      log.info(`New client connected from ${request.socket.remoteAddress}`)
    }

    this.clients.add(ws)
    this.emit('client-connected', ws)

    // Setup client event handlers
    ws.on('message', (data) => this.handleClientMessage(ws, data))
    ws.on('close', () => this.handleClientDisconnect(ws))
    ws.on('error', (error) => this.handleClientError(ws, error))

    // Send initial connection confirmation if auto-respond is enabled
    if (this.options.autoRespond) {
      this.sendToClient(ws, {
        type: 'session.created',
        session: {
          id: `session_${Date.now()}`,
          object: 'realtime.session'
        }
      })
    }
  }

  private async handleClientMessage(ws: WebSocket, data: any) {
    try {
      const message = JSON.parse(data.toString())
      
      if (this.options.enableLogging) {
        log.debug('Received message:', message.type)
      }

      // Simulate random errors
      if (Math.random() < this.options.errorRate) {
        this.sendError(ws, 'simulated_error', 'Simulated server error for testing')
        return
      }

      // Simulate latency
      if (this.options.simulateLatency) {
        await this.delay(this.options.latencyMs)
      }

      await this.processMessage(ws, message)
    } catch (error) {
      if (this.options.enableLogging) {
        log.error('Error processing message:', error)
      }
      this.sendError(ws, 'invalid_message', 'Failed to parse message')
    }
  }

  private async processMessage(ws: WebSocket, message: any) {
    switch (message.type) {
      case 'session.update':
        await this.handleSessionUpdate(ws, message)
        break

      case 'input_audio_buffer.append':
        await this.handleAudioAppend(ws, message)
        break

      case 'input_audio_buffer.commit':
        await this.handleAudioCommit(ws, message)
        break

      case 'response.create':
        await this.handleResponseCreate(ws, message)
        break

      default:
        if (this.options.enableLogging) {
          log.warn(`Unhandled message type: ${message.type}`)
        }
    }
  }

  private async handleSessionUpdate(ws: WebSocket, message: any) {
    // Acknowledge session update
    this.sendToClient(ws, {
      type: 'session.updated',
      session: {
        ...message.session,
        id: `session_${Date.now()}`,
        object: 'realtime.session'
      }
    })
  }

  private async handleAudioAppend(ws: WebSocket, message: any) {
    // Simulate audio buffer processing
    this.sendToClient(ws, {
      type: 'input_audio_buffer.committed',
      item_id: `item_${Date.now()}`
    })

    // Optionally detect speech start/stop
    if (Math.random() > 0.7) { // 30% chance of speech detection
      this.sendToClient(ws, {
        type: 'input_audio_buffer.speech_started'
      })

      // Speech stop after random delay
      setTimeout(() => {
        this.sendToClient(ws, {
          type: 'input_audio_buffer.speech_stopped'
        })
      }, 500 + Math.random() * 1000)
    }
  }

  private async handleAudioCommit(ws: WebSocket, message: any) {
    // Audio committed, ready for transcription
    this.sendToClient(ws, {
      type: 'input_audio_buffer.committed'
    })
  }

  private async handleResponseCreate(ws: WebSocket, message: any) {
    // Process queued transcripts or generate default
    const transcript = this.transcriptQueue.shift() || {
      text: 'Hello, this is a test transcription from the mock server.',
      confidence: 0.95,
      delayMs: 200
    }

    await this.sendTranscript(ws, transcript)
  }

  private async sendTranscript(ws: WebSocket, options: MockTranscriptOptions) {
    const { text, confidence = 0.9, delayMs = 100, enablePartials = false, partialCount = 3 } = options

    // Send partial transcripts if enabled
    if (enablePartials) {
      const words = text.split(' ')
      const wordsPerPartial = Math.max(1, Math.floor(words.length / partialCount))

      for (let i = 0; i < partialCount; i++) {
        const startIndex = i * wordsPerPartial
        const endIndex = i === partialCount - 1 ? words.length : (i + 1) * wordsPerPartial
        const partialText = words.slice(0, endIndex).join(' ')

        this.sendToClient(ws, {
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: `item_${Date.now()}`,
          content_index: 0,
          delta: partialText
        })

        await this.delay(delayMs / partialCount)
      }
    }

    // Send final transcript
    await this.delay(delayMs)
    
    this.sendToClient(ws, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: `item_${Date.now()}`,
      content_index: 0,
      transcript: text,
      confidence: confidence
    })
  }

  private handleClientDisconnect(ws: WebSocket) {
    this.clients.delete(ws)
    if (this.options.enableLogging) {
      log.info('Client disconnected')
    }
    this.emit('client-disconnected', ws)
  }

  private handleClientError(ws: WebSocket, error: Error) {
    if (this.options.enableLogging) {
      log.error('Client error:', error)
    }
    this.emit('client-error', ws, error)
  }

  private handleServerError(error: Error) {
    if (this.options.enableLogging) {
      log.error('Server error:', error)
    }
    this.emit('error', error)
  }

  private sendToClient(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  private sendError(ws: WebSocket, code: string, message: string) {
    this.sendToClient(ws, {
      type: 'error',
      error: {
        type: code,
        code: code,
        message: message,
        param: null,
        event_id: `event_${Date.now()}`
      }
    })
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Public API methods

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('listening', resolve)
      this.server.once('error', reject)
      
      if (!this.isRunning) {
        // Server should start listening automatically
      }
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all client connections
      this.clients.forEach(client => {
        client.close()
      })
      this.clients.clear()

      // Close server
      this.server.close(() => {
        this.isRunning = false
        if (this.options.enableLogging) {
          log.info('Mock STT server stopped')
        }
        resolve()
      })
    })
  }

  // Test helpers

  queueTranscript(options: MockTranscriptOptions) {
    this.transcriptQueue.push(options)
  }

  queueMultipleTranscripts(transcripts: MockTranscriptOptions[]) {
    this.transcriptQueue.push(...transcripts)
  }

  simulateNetworkFailure() {
    this.clients.forEach(client => {
      client.close(1006, 'Network failure simulation')
    })
  }

  simulateServerError() {
    this.clients.forEach(client => {
      this.sendError(client, 'server_error', 'Simulated server error')
    })
  }

  getConnectedClientCount(): number {
    return this.clients.size
  }

  isListening(): boolean {
    return this.isRunning
  }

  getAddress() {
    return this.server.address()
  }

  // Scenario presets for testing

  setupLatencyTest() {
    this.queueTranscript({
      text: 'This is a latency test message.',
      confidence: 0.95,
      delayMs: 50
    })
  }

  setupLongTranscriptTest() {
    const longText = 'This is a very long transcript that should test the system\'s ability to handle longer text content. It includes multiple sentences and should provide a good test case for clipboard operations and latency measurements.'
    
    this.queueTranscript({
      text: longText,
      confidence: 0.88,
      delayMs: 300,
      enablePartials: true,
      partialCount: 5
    })
  }

  setupMultiLanguageTest() {
    this.queueMultipleTranscripts([
      { text: 'Hello, this is English.', confidence: 0.95 },
      { text: 'Hola, esto es español.', confidence: 0.92 },
      { text: 'Bonjour, c\'est du français.', confidence: 0.89 }
    ])
  }

  setupErrorScenarioTest() {
    // Temporarily increase error rate
    const originalErrorRate = this.options.errorRate
    this.options.errorRate = 0.5 // 50% error rate

    setTimeout(() => {
      this.options.errorRate = originalErrorRate
    }, 5000) // Reset after 5 seconds
  }
}

export default MockSTTServer 