// AudioWorklet global context types
declare const currentTime: number
declare const sampleRate: number
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

// AudioWorkletProcessor base class
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean
} 