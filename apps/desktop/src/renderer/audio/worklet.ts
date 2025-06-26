/// <reference path="./worklet-types.d.ts" />

// Audio Worklet Processor for 16kHz PCM16 conversion
// This runs in the Audio Worklet thread context

class PCMWorklet extends AudioWorkletProcessor {
  private chunkSize = 640 // 20ms at 16kHz (16000 * 0.02 * 2 bytes)
  private buffer = new Float32Array(this.chunkSize / 2)
  private bufferIndex = 0
  private levelHistory: number[] = []

  constructor() {
    super()
  }

  override process(inputs: Float32Array[][], _outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0]
    const channel = input && input[0]
    
    if (!channel) return true

    for (let i = 0; i < channel.length; i++) {
      // Accumulate samples until we have a full 20ms chunk
      const sample = channel[i]
      if (sample !== undefined) {
        this.buffer[this.bufferIndex] = sample
        this.bufferIndex++

        if (this.bufferIndex >= this.buffer.length) {
          this.processChunk()
          this.bufferIndex = 0
        }
      }
    }

    return true
  }

  private processChunk() {
    // Calculate RMS level for UI feedback
    const rms = this.calculateRMS(this.buffer)
    this.levelHistory.push(rms)
    if (this.levelHistory.length > 10) this.levelHistory.shift()

    // Convert to 16-bit PCM with proper quantization
    const pcm16 = new Int16Array(this.buffer.length)
    for (let i = 0; i < this.buffer.length; i++) {
      // Apply soft clipping to prevent distortion
      const sample = this.buffer[i]
      if (sample !== undefined) {
        const clamped = Math.max(-1, Math.min(1, sample))
        pcm16[i] = Math.round(clamped * 0x7FFF)
      }
    }

    // Send audio data and level info
    this.port.postMessage({
      type: 'audio-chunk',
      data: pcm16.buffer,
      level: rms,
      avgLevel: this.levelHistory.reduce((a, b) => a + b) / this.levelHistory.length,
      timestamp: currentTime,
      sampleRate: sampleRate
    }, [pcm16.buffer])
  }

  private calculateRMS(samples: Float32Array): number {
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i] || 0
      sum += sample * sample
    }
    return Math.sqrt(sum / samples.length)
  }
}

// Register the processor
registerProcessor('pcm16', PCMWorklet) 