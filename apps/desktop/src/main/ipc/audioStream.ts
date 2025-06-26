import { ipcMain } from 'electron'
import log from 'electron-log'

interface AudioChunkData {
  data: ArrayBuffer
  level: number
  avgLevel: number
  timestamp: number
}

export class AudioStreamHandler {
  private isStreaming = false
  private chunkCount = 0
  private totalBytes = 0
  private lastLevelUpdate = 0
  private readonly LEVEL_UPDATE_INTERVAL = 100 // Update level every 100ms

  constructor() {
    this.setupIpcHandlers()
  }

  private setupIpcHandlers() {
    // Handle audio chunks from recorder window
    ipcMain.on('audio-chunk', (_event, chunkData: AudioChunkData) => {
      this.handleAudioChunk(chunkData)
    })

    // Handle capture results
    ipcMain.on('capture-result', (_event, result: { success: boolean; error?: string }) => {
      this.handleCaptureResult(result)
    })

    // Basic connectivity test for recorder
    ipcMain.handle('recorder-ping', () => {
      log.debug('Recorder ping received')
      return 'pong'
    })
  }

  private handleAudioChunk(chunkData: AudioChunkData) {
    if (!this.isStreaming) {
      log.debug('Received audio chunk but streaming is not active')
      return
    }

    try {
      const { data, level, avgLevel, timestamp } = chunkData
      
      // Update statistics
      this.chunkCount++
      this.totalBytes += data.byteLength

      // Log periodic statistics
      if (this.chunkCount % 50 === 0) { // Every ~1 second at 20ms chunks
        log.debug(`Audio stream stats: ${this.chunkCount} chunks, ${this.totalBytes} bytes total`)
      }

      // Update level in overlay (throttled)
      const now = Date.now()
      if (now - this.lastLevelUpdate > this.LEVEL_UPDATE_INTERVAL) {
        this.updateOverlayLevel(level, avgLevel)
        this.lastLevelUpdate = now
      }

      // Forward to STT worker (to be implemented in Sprint 2)
      this.forwardToSTTWorker(data, timestamp)

    } catch (error) {
      log.error('Error handling audio chunk:', error)
    }
  }

  private handleCaptureResult(result: { success: boolean; error?: string }) {
    if (result.success) {
      log.info('Audio capture started successfully')
      this.isStreaming = true
      this.chunkCount = 0
      this.totalBytes = 0
    } else {
      log.error('Audio capture failed:', result.error)
      this.isStreaming = false
      
      // Show error in overlay
      this.showOverlayError(result.error || 'Audio capture failed')
    }
  }

  private updateOverlayLevel(level: number, avgLevel: number) {
    // Send level update to overlay window (if it exists)
    try {
      const { getOverlayWindow } = require('../windows')
      const overlayWindow = getOverlayWindow()
      
      if (overlayWindow && overlayWindow.webContents) {
        overlayWindow.webContents.send('level-update', { level, avgLevel })
      }
    } catch (error) {
      // Overlay might not be created yet, ignore
    }
  }

  private showOverlayError(message: string) {
    try {
      const { showOverlay } = require('../windows')
      showOverlay('error', message)
    } catch (error) {
      log.error('Failed to show overlay error:', error)
    }
  }

  private forwardToSTTWorker(audioData: ArrayBuffer, timestamp: number) {
    // Forward audio data to STT worker (Sprint 2: T8-T9)
    try {
      // Import worker manager dynamically to avoid circular dependencies
      const { sttWorkerManager } = require('../workerManager')
      
      if (sttWorkerManager.isRunning()) {
        // Create a copy of the ArrayBuffer since we're transferring it
        const audioDataCopy = audioData.slice(0)
        sttWorkerManager.sendAudio(audioDataCopy)
        
        if (this.chunkCount % 100 === 0) { // Log every ~2 seconds
          log.debug(`Forwarded ${audioData.byteLength} bytes to STT worker at ${timestamp}`)
        }
      } else {
        log.debug('STT worker not running, skipping audio data')
      }
    } catch (error) {
      log.error('Error forwarding audio to STT worker:', error)
    }
  }

  startStream() {
    log.info('Starting audio stream')
    this.isStreaming = true
    this.chunkCount = 0
    this.totalBytes = 0
  }

  stopStream() {
    log.info('Stopping audio stream')
    this.isStreaming = false
    
    if (this.chunkCount > 0) {
      log.info(`Audio stream ended. Processed ${this.chunkCount} chunks, ${this.totalBytes} bytes total`)
    }
  }

  getStreamStats() {
    return {
      isStreaming: this.isStreaming,
      chunkCount: this.chunkCount,
      totalBytes: this.totalBytes,
      avgChunkSize: this.chunkCount > 0 ? this.totalBytes / this.chunkCount : 0
    }
  }
}

// Export singleton instance
export const audioStreamHandler = new AudioStreamHandler() 