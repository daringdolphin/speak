// AudioWorklet processor for PCM16 conversion and level detection
// This runs in the audio thread for low-latency processing

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunkSize = 640 // 20ms at 16kHz (16000 * 0.02 * 2 bytes)
    this.buffer = new Float32Array(this.chunkSize / 2)
    this.bufferIndex = 0
    this.levelHistory = []
    this.MAX_LEVEL_HISTORY = 10
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input[0]
    
    if (!channel) return true

    for (let i = 0; i < channel.length; i++) {
      // Accumulate samples until we have a full 20ms chunk
      this.buffer[this.bufferIndex] = channel[i]
      this.bufferIndex++

      if (this.bufferIndex >= this.buffer.length) {
        this.processChunk()
        this.bufferIndex = 0
      }
    }

    return true
  }

  processChunk() {
    // Calculate RMS level for UI feedback
    const rms = this.calculateRMS(this.buffer)
    this.levelHistory.push(rms)
    if (this.levelHistory.length > this.MAX_LEVEL_HISTORY) {
      this.levelHistory.shift()
    }

    // Convert to 16-bit PCM with proper quantization
    const pcm16 = new Int16Array(this.buffer.length)
    for (let i = 0; i < this.buffer.length; i++) {
      // Apply soft clipping to prevent distortion
      const clamped = Math.max(-1, Math.min(1, this.buffer[i]))
      pcm16[i] = Math.round(clamped * 0x7FFF)
    }

    // Calculate average level over recent history
    const avgLevel = this.levelHistory.reduce((a, b) => a + b, 0) / this.levelHistory.length

    // Send audio data and level info
    this.port.postMessage({
      type: 'audio-chunk',
      data: pcm16.buffer,
      level: rms,
      avgLevel: avgLevel,
      timestamp: currentTime,
      sampleRate: sampleRate
    }, [pcm16.buffer])
  }

  calculateRMS(samples) {
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i]
    }
    return Math.sqrt(sum / samples.length)
  }
}

// Register the processor
registerProcessor('pcm16', PCMWorklet) 