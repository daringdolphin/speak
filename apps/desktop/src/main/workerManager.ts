import { Worker } from 'worker_threads'
import { join } from 'path'
import log from 'electron-log'
import { EventEmitter } from 'events'

interface STTWorkerMessage {
  type: 'start' | 'audio' | 'end' | 'shutdown'
  data?: any
  apiKey?: string
}

interface STTWorkerResult {
  type: 'transcript-partial' | 'transcript-final' | 'error' | 'status'
  text?: string
  confidence?: number
  error?: string
  status?: string
}

export class STTWorkerManager extends EventEmitter {
  private worker: Worker | null = null
  private isActive = false

  constructor() {
    super()
  }

  async startWorker() {
    if (this.worker) {
      log.warn('STT worker already running')
      return
    }

    try {
      const workerPath = join(__dirname, '../worker/sttSession.js')
      
      this.worker = new Worker(workerPath)
      this.isActive = true
      
      // Handle messages from worker
      this.worker.on('message', (result: STTWorkerResult) => {
        this.handleWorkerMessage(result)
      })
      
      // Handle worker errors
      this.worker.on('error', (error) => {
        log.error('STT worker error:', error)
        this.emit('error', error)
      })
      
      // Handle worker exit
      this.worker.on('exit', (code) => {
        log.info(`STT worker exited with code ${code}`)
        this.worker = null
        this.isActive = false
        this.emit('worker-exit', code)
      })

      log.info('STT worker started successfully')
    } catch (error) {
      log.error('Failed to start STT worker:', error)
      throw error
    }
  }

  private handleWorkerMessage(result: STTWorkerResult) {
    switch (result.type) {
      case 'transcript-final':
        log.info('Final transcript received:', result.text)
        this.emit('transcript-final', result.text, result.confidence)
        break
        
      case 'transcript-partial':
        log.debug('Partial transcript received:', result.text)
        this.emit('transcript-partial', result.text)
        break
        
      case 'error':
        log.error('STT worker error:', result.error)
        this.emit('error', new Error(result.error))
        break
        
      case 'status':
        log.info('STT worker status:', result.status)
        this.emit('status', result.status)
        break
        
      default:
        log.warn('Unknown worker message type:', result.type)
    }
  }

  async startSession(apiKey: string) {
    if (!this.worker || !this.isActive) {
      throw new Error('STT worker not running')
    }

    const message: STTWorkerMessage = {
      type: 'start',
      apiKey
    }

    this.worker.postMessage(message)
    log.info('STT session start requested')
  }

  sendAudio(audioData: ArrayBuffer) {
    if (!this.worker || !this.isActive) {
      log.warn('Cannot send audio: STT worker not running')
      return
    }

    const message: STTWorkerMessage = {
      type: 'audio',
      data: audioData
    }

    // Use transferable objects for efficient audio data transfer
    this.worker.postMessage(message, [audioData])
  }

  async endSession() {
    if (!this.worker || !this.isActive) {
      log.warn('Cannot end session: STT worker not running')
      return
    }

    const message: STTWorkerMessage = {
      type: 'end'
    }

    this.worker.postMessage(message)
    log.info('STT session end requested')
  }

  async stopWorker() {
    if (!this.worker) {
      return
    }

    log.info('Stopping STT worker')
    
    try {
      // Send shutdown message
      const message: STTWorkerMessage = {
        type: 'shutdown'
      }
      
      this.worker.postMessage(message)
      
      // Give worker time to clean up
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Terminate worker
      await this.worker.terminate()
    } catch (error) {
      log.error('Error stopping STT worker:', error)
    } finally {
      this.worker = null
      this.isActive = false
      log.info('STT worker stopped')
    }
  }

  isRunning(): boolean {
    return this.isActive && this.worker !== null
  }
}

// Export singleton instance
export const sttWorkerManager = new STTWorkerManager() 