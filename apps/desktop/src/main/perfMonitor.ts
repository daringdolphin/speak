import { EventEmitter } from 'events'
import log from 'electron-log'
import { settings } from '../common/settings'
import { showOverlay } from './windows'

export interface PerformanceMetrics {
  sessionId: string
  startTime: number
  endTime?: number
  
  // Recording metrics
  recordingStartTime?: number
  recordingEndTime?: number
  recordingDuration?: number
  
  // Audio processing metrics
  audioChunksProcessed: number
  audioDataBytes: number
  averageChunkProcessingTime: number
  
  // STT metrics
  sttStartTime?: number
  sttEndTime?: number
  sttLatency?: number
  transcriptReceiveTime?: number
  
  // Clipboard metrics
  clipboardStartTime?: number
  clipboardEndTime?: number
  clipboardLatency?: number
  
  // Overall metrics
  totalLatency?: number // From stop to clipboard
  endToEndLatency?: number // From start to clipboard
}

export interface LatencyThresholds {
  clipboardMax: number
  sttMax: number
  totalMax: number
  audioChunkMax: number
}

export class PerformanceMonitor extends EventEmitter {
  private currentSession: PerformanceMetrics | null = null
  private sessionHistory: PerformanceMetrics[] = []
  private readonly MAX_HISTORY = 100
  private thresholds: LatencyThresholds
  private audioChunkTimes: number[] = []
  
  constructor() {
    super()
    this.thresholds = {
      clipboardMax: settings.get('maxLatencyMs'),
      sttMax: 2000, // 2 seconds for STT processing
      totalMax: settings.get('maxLatencyMs'),
      audioChunkMax: 50 // 50ms for audio chunk processing
    }
  }

  initialize() {
    log.info('Performance monitor initialized')
    
    // Watch for settings changes
    settings.onDidChange('maxLatencyMs', (newValue) => {
      this.updateMaxLatency(newValue)
    })
  }

  updateMaxLatency(newLatency: number) {
    this.thresholds.clipboardMax = newLatency
    this.thresholds.totalMax = newLatency
    log.info(`Updated latency thresholds: clipboard=${newLatency}ms, total=${newLatency}ms`)
  }

  startSession(): string {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    this.currentSession = {
      sessionId,
      startTime: performance.now(),
      audioChunksProcessed: 0,
      audioDataBytes: 0,
      averageChunkProcessingTime: 0
    }
    
    this.audioChunkTimes = []
    
    log.debug(`Started performance session: ${sessionId}`)
    return sessionId
  }

  markRecordingStart() {
    if (!this.currentSession) {
      log.warn('No active session for recording start')
      return
    }
    
    this.currentSession.recordingStartTime = performance.now()
    log.debug('Marked recording start')
  }

  markRecordingStop() {
    if (!this.currentSession) {
      log.warn('No active session for recording stop')
      return
    }
    
    const now = performance.now()
    this.currentSession.recordingEndTime = now
    
    if (this.currentSession.recordingStartTime) {
      this.currentSession.recordingDuration = now - this.currentSession.recordingStartTime
      log.debug(`Recording duration: ${Math.round(this.currentSession.recordingDuration)}ms`)
    }
  }

  markSTTStart() {
    if (!this.currentSession) {
      log.warn('No active session for STT start')
      return
    }
    
    this.currentSession.sttStartTime = performance.now()
    log.debug('Marked STT processing start')
  }

  markSTTEnd() {
    if (!this.currentSession) {
      log.warn('No active session for STT end')
      return
    }
    
    const now = performance.now()
    this.currentSession.sttEndTime = now
    this.currentSession.transcriptReceiveTime = now
    
    if (this.currentSession.sttStartTime) {
      this.currentSession.sttLatency = now - this.currentSession.sttStartTime
      
      // Check STT latency threshold
      if (this.currentSession.sttLatency > this.thresholds.sttMax) {
        log.warn(`High STT latency: ${Math.round(this.currentSession.sttLatency)}ms`)
        this.emit('latency-warning', 'stt', this.currentSession.sttLatency)
      }
      
      log.debug(`STT latency: ${Math.round(this.currentSession.sttLatency)}ms`)
    }
  }

  recordAudioChunk(processingTime: number, dataSize: number) {
    if (!this.currentSession) return
    
    this.currentSession.audioChunksProcessed++
    this.currentSession.audioDataBytes += dataSize
    this.audioChunkTimes.push(processingTime)
    
    // Calculate rolling average (last 50 chunks)
    const recentTimes = this.audioChunkTimes.slice(-50)
    this.currentSession.averageChunkProcessingTime = 
      recentTimes.reduce((sum, time) => sum + time, 0) / recentTimes.length
    
    // Check audio chunk processing threshold
    if (processingTime > this.thresholds.audioChunkMax) {
      log.warn(`Slow audio chunk processing: ${Math.round(processingTime)}ms`)
      this.emit('latency-warning', 'audio-chunk', processingTime)
    }
    
    // Log every 100 chunks (~ every 2 seconds at 20ms chunks)
    if (this.currentSession.audioChunksProcessed % 100 === 0) {
      log.debug(`Audio processing stats: ${this.currentSession.audioChunksProcessed} chunks, ` +
                `avg ${Math.round(this.currentSession.averageChunkProcessingTime)}ms, ` +
                `${this.currentSession.audioDataBytes} bytes`)
    }
  }

  recordClipboardLatency(latency: number) {
    if (!this.currentSession) {
      log.warn('No active session for clipboard latency')
      return
    }
    
    const now = performance.now()
    this.currentSession.clipboardStartTime = now - latency
    this.currentSession.clipboardEndTime = now
    this.currentSession.clipboardLatency = latency
    
    // Calculate total latency (stop to clipboard)
    if (this.currentSession.recordingEndTime) {
      this.currentSession.totalLatency = now - this.currentSession.recordingEndTime
    }
    
    // Calculate end-to-end latency
    this.currentSession.endToEndLatency = now - this.currentSession.startTime
    
    log.info(`Clipboard latency: ${Math.round(latency)}ms, ` +
             `Total latency: ${Math.round(this.currentSession.totalLatency || 0)}ms`)
    
    // Check clipboard latency threshold
    if (latency > this.thresholds.clipboardMax) {
      log.warn(`High clipboard latency: ${Math.round(latency)}ms (threshold: ${this.thresholds.clipboardMax}ms)`)
      this.emit('latency-warning', 'clipboard', latency)
      
      // Show warning overlay
      showOverlay('error', `Slow clipboard operation (${Math.round(latency)}ms)`)
      setTimeout(() => {
        // The overlay will be hidden by state transition
      }, 2000)
    }
    
    // Check total latency threshold
    if (this.currentSession.totalLatency && this.currentSession.totalLatency > this.thresholds.totalMax) {
      log.warn(`High total latency: ${Math.round(this.currentSession.totalLatency)}ms`)
      this.emit('latency-warning', 'total', this.currentSession.totalLatency)
    }
  }

  endSession(): PerformanceMetrics | null {
    if (!this.currentSession) {
      log.warn('No active session to end')
      return null
    }
    
    this.currentSession.endTime = performance.now()
    
    // Final calculations
    if (!this.currentSession.endToEndLatency) {
      this.currentSession.endToEndLatency = this.currentSession.endTime - this.currentSession.startTime
    }
    
    // Log session summary
    this.logSessionSummary(this.currentSession)
    
    // Store in history
    this.sessionHistory.push({ ...this.currentSession })
    if (this.sessionHistory.length > this.MAX_HISTORY) {
      this.sessionHistory.shift()
    }
    
    const completedSession = this.currentSession
    this.currentSession = null
    this.audioChunkTimes = []
    
    this.emit('session-complete', completedSession)
    return completedSession
  }

  private logSessionSummary(session: PerformanceMetrics) {
    const summary = {
      sessionId: session.sessionId,
      duration: session.endToEndLatency ? Math.round(session.endToEndLatency) : 'N/A',
      recording: session.recordingDuration ? Math.round(session.recordingDuration) : 'N/A',
      sttLatency: session.sttLatency ? Math.round(session.sttLatency) : 'N/A',
      clipboardLatency: session.clipboardLatency ? Math.round(session.clipboardLatency) : 'N/A',
      totalLatency: session.totalLatency ? Math.round(session.totalLatency) : 'N/A',
      audioChunks: session.audioChunksProcessed,
      avgChunkTime: Math.round(session.averageChunkProcessingTime)
    }
    
    log.info('Session summary:', summary)
  }

  getCurrentSession(): PerformanceMetrics | null {
    return this.currentSession ? { ...this.currentSession } : null
  }

  getSessionHistory(): PerformanceMetrics[] {
    return [...this.sessionHistory]
  }

  getAverageMetrics(): {
    avgClipboardLatency: number
    avgSTTLatency: number
    avgTotalLatency: number
    avgRecordingDuration: number
    avgAudioChunkTime: number
  } {
    if (this.sessionHistory.length === 0) {
      return {
        avgClipboardLatency: 0,
        avgSTTLatency: 0,
        avgTotalLatency: 0,
        avgRecordingDuration: 0,
        avgAudioChunkTime: 0
      }
    }
    
    const validSessions = this.sessionHistory.filter(s => s.clipboardLatency !== undefined)
    
    return {
      avgClipboardLatency: this.average(validSessions.map(s => s.clipboardLatency || 0)),
      avgSTTLatency: this.average(validSessions.map(s => s.sttLatency || 0)),
      avgTotalLatency: this.average(validSessions.map(s => s.totalLatency || 0)),
      avgRecordingDuration: this.average(validSessions.map(s => s.recordingDuration || 0)),
      avgAudioChunkTime: this.average(validSessions.map(s => s.averageChunkProcessingTime || 0))
    }
  }

  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length
  }

  // Performance diagnostics
  getPerformanceDiagnostics(): {
    currentThresholds: LatencyThresholds
    recentWarnings: Array<{ type: string; value: number; timestamp: number }>
    systemInfo: {
      memoryUsage: NodeJS.MemoryUsage
      uptime: number
    }
  } {
    const recentWarnings: Array<{ type: string; value: number; timestamp: number }> = []
    
    // This would be populated by actual warning events
    // For now, we'll analyze recent sessions for warnings
    const recentSessions = this.sessionHistory.slice(-10)
    
    recentSessions.forEach(session => {
      if (session.clipboardLatency && session.clipboardLatency > this.thresholds.clipboardMax) {
        recentWarnings.push({
          type: 'clipboard',
          value: session.clipboardLatency,
          timestamp: session.endTime || 0
        })
      }
      
      if (session.sttLatency && session.sttLatency > this.thresholds.sttMax) {
        recentWarnings.push({
          type: 'stt',
          value: session.sttLatency,
          timestamp: session.sttEndTime || 0
        })
      }
    })
    
    return {
      currentThresholds: { ...this.thresholds },
      recentWarnings: recentWarnings.slice(-20), // Last 20 warnings
      systemInfo: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    }
  }

  // Reset all metrics
  reset() {
    this.currentSession = null
    this.sessionHistory = []
    this.audioChunkTimes = []
    log.info('Performance monitor reset')
  }

  // Export metrics for analysis
  exportMetrics(): string {
    const data = {
      thresholds: this.thresholds,
      sessionHistory: this.sessionHistory,
      averageMetrics: this.getAverageMetrics(),
      diagnostics: this.getPerformanceDiagnostics(),
      exportTime: Date.now()
    }
    
    return JSON.stringify(data, null, 2)
  }
}

// Export singleton instance
export const perfMonitor = new PerformanceMonitor() 