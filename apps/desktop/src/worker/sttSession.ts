import { parentPort } from 'worker_threads'
import WebSocket from 'ws'
import log from 'electron-log'

interface STTMessage {
  type: 'start' | 'audio' | 'end' | 'shutdown'
  data?: any
  apiKey?: string
}

interface TranscriptResult {
  type: 'transcript-partial' | 'transcript-final' | 'error' | 'status'
  text?: string
  confidence?: number
  error?: string
  status?: string
}

class STTSession {
  private ws: WebSocket | null = null
  private isConnected = false
  private isSessionActive = false
  private apiKey: string = ''
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 5
  private heartbeatInterval: NodeJS.Timeout | null = null
  private lastPongReceived = Date.now()
  private audioBuffer: ArrayBuffer[] = []

  constructor() {
    this.setupMessageHandlers()
  }

  private setupMessageHandlers() {
    if (!parentPort) {
      throw new Error('STTSession must run in worker thread')
    }

    parentPort.on('message', (message: STTMessage) => {
      this.handleMessage(message)
    })
  }

  private async handleMessage(message: STTMessage) {
    try {
      switch (message.type) {
        case 'start':
          await this.startSession(message.apiKey || '')
          break
        case 'audio':
          this.appendAudio(message.data)
          break
        case 'end':
          await this.endSession()
          break
        case 'shutdown':
          this.cleanup()
          break
        default:
          log.warn('Unknown message type:', message.type)
      }
    } catch (error) {
      log.error('Error handling STT message:', error)
      this.sendToParent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  private async startSession(apiKey: string) {
    if (!apiKey) {
      throw new Error('API key is required')
    }

    this.apiKey = apiKey
    this.audioBuffer = []
    
    try {
      await this.connect()
      this.sendToParent({ type: 'status', status: 'connected' })
    } catch (error) {
      log.error('Failed to start STT session:', error)
      throw error
    }
  }

  private async connect() {
    return new Promise<void>((resolve, reject) => {
      try {
        const wsUrl = process.env.OPENAI_WS_URL || 'wss://api.openai.com/v1/realtime?intent=transcription'
        
        this.ws = new WebSocket(wsUrl, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'OpenAI-Beta': 'realtime=v1'
          }
        })

        this.ws.on('open', () => {
          log.info('WebSocket connection opened')
          this.isConnected = true
          this.reconnectAttempts = 0
          this.onConnected()
          resolve()
        })

        this.ws.on('message', (data: WebSocket.RawData) => {
          this.handleWebSocketMessage(data)
        })

        this.ws.on('close', (code: number) => {
          log.warn('WebSocket connection closed:', code)
          this.handleDisconnection(code)
        })

        this.ws.on('error', (error: Error) => {
          log.error('WebSocket error:', error)
          this.handleError(error)
          reject(error)
        })

        this.ws.on('pong', () => {
          this.lastPongReceived = Date.now()
        })

      } catch (error) {
        reject(error)
      }
    })
  }

  private onConnected() {
    // Send session configuration
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['audio'],
        instructions: 'You are a voice transcription assistant. Provide accurate transcriptions of spoken audio.',
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        },
        tools: [],
        tool_choice: 'none',
        temperature: 0.6,
        max_response_output_tokens: 4096
      }
    }

    this.sendWebSocketMessage(sessionConfig)
    this.startHeartbeat()
    this.isSessionActive = true
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (Date.now() - this.lastPongReceived > 10000) {
        log.warn('Heartbeat timeout, reconnecting...')
        this.ws?.close(1006, 'Heartbeat timeout')
        return
      }
      
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, 30000)
  }

  private handleWebSocketMessage(data: WebSocket.RawData) {
    try {
      const message = JSON.parse(data.toString())
      
      switch (message.type) {
        case 'session.created':
          log.info('Transcription session created')
          break
          
        case 'session.updated':
          log.info('Transcription session updated')
          break
          
        case 'input_audio_buffer.committed':
          log.debug('Audio buffer committed')
          break
          
        case 'input_audio_buffer.speech_started':
          log.debug('Speech detected')
          break
          
        case 'input_audio_buffer.speech_stopped':
          log.debug('Speech ended')
          break
          
        case 'conversation.item.input_audio_transcription.completed':
          this.handleTranscriptComplete(message)
          break
          
        case 'conversation.item.input_audio_transcription.failed':
          this.handleTranscriptFailed(message)
          break
          
        case 'error':
          this.handleApiError(message)
          break
          
        default:
          log.debug('Unhandled message type:', message.type)
      }
    } catch (error) {
      log.error('Error parsing WebSocket message:', error)
    }
  }

  private handleTranscriptComplete(message: any) {
    const transcript = message.transcript || ''
    log.info('Transcript completed:', transcript)
    
    this.sendToParent({
      type: 'transcript-final',
      text: transcript,
      confidence: 0.9 // Default confidence, could be extracted from response
    })
  }

  private handleTranscriptFailed(message: any) {
    const error = message.error || 'Transcription failed'
    log.error('Transcript failed:', error)
    
    this.sendToParent({
      type: 'error',
      error: error
    })
  }

  private handleApiError(message: any) {
    const error = message.error || 'API error'
    log.error('OpenAI API error:', error)
    
    this.sendToParent({
      type: 'error',
      error: `API Error: ${error.message || error}`
    })
  }

  private appendAudio(audioData: ArrayBuffer) {
    if (!this.isConnected || !this.isSessionActive) {
      log.debug('Queueing audio data while not connected')
      this.audioBuffer.push(audioData)
      return
    }

    // Send audio data immediately
    this.sendAudioData(audioData)
    
    // Process any queued audio
    if (this.audioBuffer.length > 0) {
      log.info(`Processing ${this.audioBuffer.length} queued audio chunks`)
      const queuedData = this.audioBuffer
      this.audioBuffer = []
      
      queuedData.forEach(data => this.sendAudioData(data))
    }
  }

  private sendAudioData(audioData: ArrayBuffer) {
    const base64Audio = Buffer.from(audioData).toString('base64')
    
    const audioMessage = {
      type: 'input_audio_buffer.append',
      audio: base64Audio
    }

    this.sendWebSocketMessage(audioMessage)
  }

  private async endSession() {
    if (!this.isConnected || !this.isSessionActive) {
      return
    }

    // Commit the audio buffer to finalize transcription
    const commitMessage = {
      type: 'input_audio_buffer.commit'
    }

    this.sendWebSocketMessage(commitMessage)
    
    // Create a response to trigger transcription
    const responseMessage = {
      type: 'response.create'
    }

    this.sendWebSocketMessage(responseMessage)
    
    this.isSessionActive = false
    log.info('STT session ended, waiting for transcription')
  }

  private sendWebSocketMessage(message: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      log.warn('Cannot send message, WebSocket not ready')
    }
  }

  private handleDisconnection(_code: number) {
    this.isConnected = false
    this.isSessionActive = false
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect()
    } else {
      this.sendToParent({
        type: 'error',
        error: 'Max reconnection attempts exceeded'
      })
    }
  }

  private handleError(error: Error) {
    log.error('STT Session error:', error)
    this.sendToParent({
      type: 'error',
      error: error.message
    })
  }

  private scheduleReconnect() {
    const delay = Math.min(100 * Math.pow(1.6, this.reconnectAttempts), 25600)
    this.reconnectAttempts++
    
    log.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`)
    
    setTimeout(async () => {
      try {
        await this.connect()
        this.sendToParent({ type: 'status', status: 'reconnected' })
      } catch (error) {
        log.error('Reconnection failed:', error)
      }
    }, delay)
  }

  private sendToParent(message: TranscriptResult) {
    if (parentPort) {
      parentPort.postMessage(message)
    }
  }

  public cleanup() {
    log.info('Cleaning up STT session')
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    
    this.isConnected = false
    this.isSessionActive = false
  }
}

// Initialize the STT session
const sttSession = new STTSession()

// Handle worker thread termination
process.on('SIGTERM', () => {
  sttSession.cleanup()
  process.exit(0)
}) 