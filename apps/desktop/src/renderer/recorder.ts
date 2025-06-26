import log from 'electron-log'

interface AudioCaptureState {
  stream: MediaStream | null
  audioContext: AudioContext | null
  sourceNode: MediaStreamAudioSourceNode | null
  workletNode: AudioWorkletNode | null
  isCapturing: boolean
}

class AudioRecorder {
  private state: AudioCaptureState = {
    stream: null,
    audioContext: null,
    sourceNode: null,
    workletNode: null,
    isCapturing: false,
  }

  async startCapture(): Promise<void> {
    try {
      log.info('Starting audio capture...')

      // Get user media with specific constraints
      this.state.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000, // Target 16kHz for OpenAI
        },
      })

      // Create audio context with target sample rate
      this.state.audioContext = new AudioContext({
        sampleRate: 16000,
      })

      // Check if we got the right sample rate
      if (this.state.audioContext.sampleRate !== 16000) {
        log.warn(`AudioContext sample rate is ${this.state.audioContext.sampleRate}, not 16000`)
        // We'll handle resampling in the worklet if needed
      }

      // Load and register the audio worklet
      await this.state.audioContext.audioWorklet.addModule('worklet.js')

      // Create audio nodes
      this.state.sourceNode = this.state.audioContext.createMediaStreamSource(this.state.stream)
      this.state.workletNode = new AudioWorkletNode(this.state.audioContext, 'pcm16', {
        outputChannelCount: [1], // Mono output
      })

      // Connect the audio graph
      this.state.sourceNode.connect(this.state.workletNode)

      // Handle audio data from worklet
      this.state.workletNode.port.onmessage = (event) => {
        this.handleAudioData(event.data)
      }

      this.state.isCapturing = true
      log.info('Audio capture started successfully')

      // Notify main process of success
      this.sendCaptureResult({ success: true })
    } catch (error) {
      log.error('Audio capture failed:', error)
      
      let errorMessage = 'Unknown error'
      if (error instanceof Error) {
        errorMessage = error.message
      }

      // Handle specific error types
      if (errorMessage.includes('Permission denied')) {
        errorMessage = 'Microphone permission denied. Please enable microphone access in your browser settings.'
      } else if (errorMessage.includes('NotFoundError')) {
        errorMessage = 'No microphone found. Please connect a microphone and try again.'
      } else if (errorMessage.includes('NotAllowedError')) {
        errorMessage = 'Microphone access was denied. Please check your privacy settings.'
      }

      // Cleanup on error
      await this.cleanup()

      // Notify main process of error
      this.sendCaptureResult({ success: false, error: errorMessage })
    }
  }

  async stopCapture(): Promise<void> {
    log.info('Stopping audio capture...')
    
    this.state.isCapturing = false
    await this.cleanup()
    
    log.info('Audio capture stopped')
  }

  private async cleanup(): Promise<void> {
    try {
      // Disconnect audio nodes
      if (this.state.sourceNode) {
        this.state.sourceNode.disconnect()
        this.state.sourceNode = null
      }

      if (this.state.workletNode) {
        this.state.workletNode.disconnect()
        this.state.workletNode = null
      }

      // Close audio context
      if (this.state.audioContext && this.state.audioContext.state !== 'closed') {
        await this.state.audioContext.close()
        this.state.audioContext = null
      }

      // Stop media stream
      if (this.state.stream) {
        this.state.stream.getTracks().forEach(track => {
          track.stop()
        })
        this.state.stream = null
      }
    } catch (error) {
      log.error('Error during cleanup:', error)
    }
  }

  private handleAudioData(data: any) {
    if (!this.state.isCapturing) {
      return
    }

    // Extract audio data and level information
    const { type, data: audioData, level, avgLevel } = data

    if (type === 'audio-chunk') {
      // Send audio data to main process via IPC
      // This will be implemented in T7
      window.electronRecorder?.sendAudioChunk(audioData, level, avgLevel)
    }
  }

  private sendCaptureResult(result: { success: boolean; error?: string }) {
    // Send result back to main process
    window.electronRecorder?.sendCaptureResult(result)
  }

  getStatus() {
    return {
      isCapturing: this.state.isCapturing,
      sampleRate: this.state.audioContext?.sampleRate || null,
      hasStream: !!this.state.stream,
    }
  }
}

// Global recorder instance
const audioRecorder = new AudioRecorder()

// Listen for commands from main process
window.electronRecorder?.onStartCapture(() => {
  audioRecorder.startCapture()
})

window.electronRecorder?.onStopCapture(() => {
  audioRecorder.stopCapture()
})

// Handle window unload
window.addEventListener('beforeunload', () => {
  audioRecorder.stopCapture()
})

// Export for testing/debugging
declare global {
  interface Window {
    audioRecorder: AudioRecorder
  }
}

window.audioRecorder = audioRecorder

log.info('Audio recorder initialized') 