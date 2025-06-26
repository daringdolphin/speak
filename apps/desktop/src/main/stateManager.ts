import { EventEmitter } from 'events'
import log from 'electron-log'
import { settings } from '../common/settings'
import { sttWorkerManager } from './workerManager'
import { audioStreamHandler } from './ipc/audioStream'
import { ClipboardService } from './clipboard'
import { systemTray } from './tray'
import { showOverlay, hideOverlay, startAudioCapture, stopAudioCapture } from './windows'
import { cryptoService } from './crypto'
import { perfMonitor } from './perfMonitor'

export enum AppState {
  IDLE = 'idle',
  STARTING = 'starting',
  RECORDING = 'recording',
  STOPPING = 'stopping',
  PROCESSING = 'processing',
  ERROR = 'error',
  RECOVERING = 'recovering',
  FATAL = 'fatal'
}

export interface StateTransition {
  from: AppState
  to: AppState
  timestamp: number
  data?: any
}

export interface AppStateData {
  transcript?: string
  confidence?: number
  error?: Error
  latency?: number
  retryCount?: number
}

export class StateManager extends EventEmitter {
  private currentState = AppState.IDLE
  private previousState = AppState.IDLE
  private retryCount = 0
  private readonly MAX_RETRIES = 3
  private errorRecoveryTimer?: NodeJS.Timeout
  private sessionStartTime = 0
  private isInitialized = false

  // Valid state transitions
  private readonly validTransitions: Record<AppState, AppState[]> = {
    [AppState.IDLE]: [AppState.STARTING, AppState.ERROR, AppState.FATAL],
    [AppState.STARTING]: [AppState.RECORDING, AppState.ERROR, AppState.IDLE],
    [AppState.RECORDING]: [AppState.STOPPING, AppState.ERROR, AppState.RECOVERING],
    [AppState.STOPPING]: [AppState.PROCESSING, AppState.ERROR, AppState.IDLE],
    [AppState.PROCESSING]: [AppState.IDLE, AppState.ERROR],
    [AppState.ERROR]: [AppState.RECOVERING, AppState.IDLE, AppState.FATAL],
    [AppState.RECOVERING]: [AppState.RECORDING, AppState.ERROR, AppState.IDLE],
    [AppState.FATAL]: [AppState.IDLE] // Only user reset allowed
  }

  constructor() {
    super()
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    // STT Worker events
    sttWorkerManager.on('transcript-final', this.handleTranscriptFinal.bind(this))
    sttWorkerManager.on('transcript-partial', this.handleTranscriptPartial.bind(this))
    sttWorkerManager.on('error', this.handleSTTError.bind(this))
    sttWorkerManager.on('status', this.handleSTTStatus.bind(this))

    // Settings changes
    settings.onDidChange('hotkey', this.handleHotkeyChange.bind(this))
    settings.onDidChange('maxLatencyMs', this.handleLatencySettingChange.bind(this))
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    try {
      log.info('Initializing state manager')

      // Verify API key is available
      const hasApiKey = cryptoService.hasApiKey()
      if (!hasApiKey) {
        throw new Error('No API key configured')
      }

      // Initialize performance monitoring
      perfMonitor.initialize()

      this.isInitialized = true
      log.info('State manager initialized successfully')
    } catch (error) {
      log.error('Failed to initialize state manager:', error)
      await this.transition(AppState.FATAL, { error: error as Error })
      throw error
    }
  }

  async transition(targetState: AppState, data?: AppStateData): Promise<boolean> {
    // Validate transition
    const isValid = this.isTransitionValid(this.currentState, targetState)
    if (!isValid) {
      log.warn(`Invalid transition attempted: ${this.currentState} -> ${targetState}`)
      return false
    }

    const prevState = this.currentState
    this.previousState = prevState
    this.currentState = targetState

    const transition: StateTransition = {
      from: prevState,
      to: targetState,
      timestamp: Date.now(),
      data
    }

    log.info(`State transition: ${prevState} -> ${targetState}`, data)

    try {
      await this.onStateEnter(targetState, data)
      this.emit('state-changed', transition)
      return true
    } catch (error) {
      log.error(`Error in state ${targetState}:`, error)
      await this.handleStateError(error as Error)
      return false
    }
  }

  private isTransitionValid(from: AppState, to: AppState): boolean {
    return this.validTransitions[from]?.includes(to) ?? false
  }

  private async onStateEnter(state: AppState, data?: AppStateData) {
    // Update UI
    this.updateUI(state, data)

    switch (state) {
      case AppState.IDLE:
        await this.onIdleEnter()
        break
      case AppState.STARTING:
        await this.onStartingEnter()
        break
      case AppState.RECORDING:
        await this.onRecordingEnter()
        break
      case AppState.STOPPING:
        await this.onStoppingEnter()
        break
      case AppState.PROCESSING:
        await this.onProcessingEnter(data)
        break
      case AppState.ERROR:
        await this.onErrorEnter(data)
        break
      case AppState.RECOVERING:
        await this.onRecoveringEnter()
        break
      case AppState.FATAL:
        await this.onFatalEnter(data)
        break
    }
  }

  private async onIdleEnter() {
    this.retryCount = 0
    this.sessionStartTime = 0
    hideOverlay()
    systemTray.setState('idle')

    // Cleanup any resources
    if (sttWorkerManager.isRunning()) {
      await sttWorkerManager.stopWorker()
    }
    audioStreamHandler.stopStream()
  }

  private async onStartingEnter() {
    this.sessionStartTime = performance.now()
    perfMonitor.startSession()

    // Update UI
    systemTray.setState('recording')
    showOverlay('recording', 'Starting...')

    try {
      // Load API key
      const apiKey = await cryptoService.loadApiKey()
      if (!apiKey) {
        throw new Error('No API key available')
      }

      // Start STT worker if not running
      if (!sttWorkerManager.isRunning()) {
        await sttWorkerManager.startWorker()
        await sttWorkerManager.startSession(apiKey)
      }

      // Start audio capture
      await startAudioCapture()
      audioStreamHandler.startStream()

      // Transition to recording
      await this.transition(AppState.RECORDING)
    } catch (error) {
      await this.transition(AppState.ERROR, { error: error as Error })
    }
  }

  private async onRecordingEnter() {
    showOverlay('recording', 'Listening...')
    perfMonitor.markRecordingStart()
  }

  private async onStoppingEnter() {
    showOverlay('recording', 'Processing...')
    perfMonitor.markRecordingStop()

    try {
      // Stop audio capture first
      await stopAudioCapture()
      audioStreamHandler.stopStream()

      // End STT session
      await sttWorkerManager.endSession()

      // The transcript will come via event handler
    } catch (error) {
      await this.transition(AppState.ERROR, { error: error as Error })
    }
  }

  private async onProcessingEnter(data?: AppStateData) {
    if (!data?.transcript) {
      await this.transition(AppState.ERROR, { error: new Error('No transcript received') })
      return
    }

    try {
      const startTime = performance.now()

      // Copy to clipboard
      const success = await ClipboardService.copyAndVerify(data.transcript)
      
      const latency = performance.now() - startTime
      perfMonitor.recordClipboardLatency(latency)

      if (success) {
        // Check latency warning
        const maxLatency = settings.get('maxLatencyMs')
        if (latency > maxLatency) {
          log.warn(`High clipboard latency: ${Math.round(latency)}ms`)
          showOverlay('error', `Slow operation (${Math.round(latency)}ms)`)
          setTimeout(() => this.transition(AppState.IDLE), 2000)
        } else {
          // Success notification
          systemTray.showNotification(
            'Transcript Ready',
            `"${data.transcript.substring(0, 50)}${data.transcript.length > 50 ? '...' : ''}"`
          )
          await this.transition(AppState.IDLE)
        }
      } else {
        throw new Error('Clipboard verification failed')
      }
    } catch (error) {
      await this.transition(AppState.ERROR, { error: error as Error })
    }
  }

  private async onErrorEnter(data?: AppStateData) {
    const error = data?.error || new Error('Unknown error')
    
    this.retryCount++
    log.error(`Error state entered (attempt ${this.retryCount}):`, error)

    // Show error in UI
    systemTray.setState('error')
    showOverlay('error', `Error: ${error.message}`)

    if (this.retryCount < this.MAX_RETRIES) {
      // Auto-retry with exponential backoff
      const delay = 2000 * Math.pow(1.5, this.retryCount - 1)
      log.info(`Scheduling recovery attempt ${this.retryCount} in ${delay}ms`)
      
      this.errorRecoveryTimer = setTimeout(() => {
        this.transition(AppState.RECOVERING)
      }, delay)
    } else {
      // Max retries exceeded
      await this.transition(AppState.FATAL, { error })
    }
  }

  private async onRecoveringEnter() {
    log.info('Attempting recovery')
    showOverlay('recording', 'Recovering...')

    try {
      // Test components one by one
      
      // 1. Test API key
      const apiKey = await cryptoService.loadApiKey()
      if (!apiKey) {
        throw new Error('No API key available')
      }

      const isKeyValid = await cryptoService.testApiKey(apiKey)
      if (!isKeyValid) {
        throw new Error('Invalid API key')
      }

      // 2. Test audio system
      // This would involve a quick test capture

      // 3. Test STT worker
      if (sttWorkerManager.isRunning()) {
        await sttWorkerManager.stopWorker()
      }
      await sttWorkerManager.startWorker()

      // Recovery successful
      this.retryCount = 0
      log.info('Recovery successful')
      await this.transition(AppState.IDLE)
      
    } catch (error) {
      log.error('Recovery failed:', error)
      await this.transition(AppState.ERROR, { error: error as Error })
    }
  }

  private async onFatalEnter(data?: AppStateData) {
    const error = data?.error || new Error('Fatal error')
    
    log.error('Fatal error state entered:', error)

    // Show persistent error notification
    systemTray.setState('error')
    systemTray.showError('Recording system failed. Click to restart.')
    showOverlay('error', 'System error - please restart')

    // Stop all activities
    if (sttWorkerManager.isRunning()) {
      await sttWorkerManager.stopWorker()
    }
    audioStreamHandler.stopStream()

    // Wait for user intervention (handled externally)
  }

  private updateUI(state: AppState, data?: AppStateData) {
    // Update system tray state
    this.updateTrayState(state, data)
    
    // Update overlay state
    this.updateOverlayState(state, data)
    
    // Update window titles and other UI elements if needed
    this.updateWindowState(state, data)
  }

  private updateTrayState(state: AppState, data?: AppStateData) {
    switch (state) {
      case AppState.IDLE:
        systemTray.setState('idle')
        break
        
      case AppState.STARTING:
      case AppState.RECORDING:
      case AppState.STOPPING:
      case AppState.PROCESSING:
        systemTray.setState('recording')
        break
        
      case AppState.ERROR:
      case AppState.RECOVERING:
      case AppState.FATAL:
        systemTray.setState('error')
        // Show error notification for context
        if (data?.error) {
          systemTray.showError(data.error.message)
        }
        break
    }
  }

  private updateOverlayState(state: AppState, data?: AppStateData) {
    switch (state) {
      case AppState.IDLE:
        hideOverlay()
        break
        
      case AppState.STARTING:
        showOverlay('recording', 'Starting...')
        break
        
      case AppState.RECORDING:
        showOverlay('recording', 'Listening...')
        break
        
      case AppState.STOPPING:
        showOverlay('recording', 'Processing...')
        break
        
      case AppState.PROCESSING:
        showOverlay('recording', 'Copying to clipboard...')
        break
        
      case AppState.ERROR:
        const errorMsg = data?.error?.message || 'An error occurred'
        showOverlay('error', `Error: ${errorMsg}`)
        break
        
      case AppState.RECOVERING:
        showOverlay('recording', 'Recovering...')
        break
        
      case AppState.FATAL:
        showOverlay('error', 'System error - Please restart')
        break
    }
  }

  private updateWindowState(state: AppState, data?: AppStateData) {
    // Emit state change for any listening components
    this.emit('ui-update', { state, data, timestamp: Date.now() })
    
    // Log state change for debugging
    log.debug(`UI updated for state: ${state}`, { 
      retryCount: this.retryCount,
      sessionDuration: this.getSessionDuration(),
      error: data?.error?.message
    })
  }



  // Event handlers
  private async handleTranscriptFinal(text: string, confidence?: number) {
    if (this.currentState === AppState.STOPPING) {
      await this.transition(AppState.PROCESSING, { transcript: text, confidence: confidence || 0 })
    }
  }

  private async handleTranscriptPartial(text: string) {
    // Future: handle partial transcripts for live display
    this.emit('transcript-partial', text)
  }

  private async handleSTTError(error: Error) {
    if (this.currentState !== AppState.ERROR && this.currentState !== AppState.FATAL) {
      await this.transition(AppState.ERROR, { error })
    }
  }

  private handleSTTStatus(status: string) {
    log.debug('STT status:', status)
    this.emit('stt-status', status)
  }

  private async handleHotkeyChange(newHotkey: string) {
    log.info('Hotkey changed to:', newHotkey)
    // This would trigger shortcut manager update
    this.emit('hotkey-changed', newHotkey)
  }

  private handleLatencySettingChange(newLatency: number) {
    log.info('Max latency setting changed to:', newLatency)
    perfMonitor.updateMaxLatency(newLatency)
  }

  private async handleStateError(error: Error) {
    log.error('State transition error:', error)
    if (this.currentState !== AppState.ERROR && this.currentState !== AppState.FATAL) {
      await this.transition(AppState.ERROR, { error })
    }
  }

  // Public methods
  async startRecording(): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (this.currentState === AppState.IDLE) {
      return await this.transition(AppState.STARTING)
    }
    
    log.warn(`Cannot start recording from state: ${this.currentState}`)
    return false
  }

  async stopRecording(): Promise<boolean> {
    if (this.currentState === AppState.RECORDING) {
      return await this.transition(AppState.STOPPING)
    }
    
    log.warn(`Cannot stop recording from state: ${this.currentState}`)
    return false
  }

  async reset(): Promise<boolean> {
    log.info('Resetting state manager')
    
    // Clear any timers
    if (this.errorRecoveryTimer) {
      clearTimeout(this.errorRecoveryTimer)
      this.errorRecoveryTimer = undefined as any
    }

    // Reset counters
    this.retryCount = 0
    
    return await this.transition(AppState.IDLE)
  }

  getCurrentState(): AppState {
    return this.currentState
  }

  getPreviousState(): AppState {
    return this.previousState
  }

  isRecording(): boolean {
    return this.currentState === AppState.RECORDING
  }

  isIdle(): boolean {
    return this.currentState === AppState.IDLE
  }

  getRetryCount(): number {
    return this.retryCount
  }

  getSessionDuration(): number {
    return this.sessionStartTime > 0 ? performance.now() - this.sessionStartTime : 0
  }
}

// Export singleton instance
export const stateManager = new StateManager() 