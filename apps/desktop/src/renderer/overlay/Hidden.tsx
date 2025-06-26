import React, { useState, useEffect } from 'react'

interface PartialTranscriptProps {
  enabled: boolean
  maxLength?: number
  fadeTimeout?: number
}

interface PartialTranscriptData {
  text: string
  confidence: number
  timestamp: number
  isComplete: boolean
}

/**
 * Hidden component for handling partial transcripts
 * This is future-proofed for live captions feature (currently disabled)
 */
export const PartialTranscriptHandler: React.FC<PartialTranscriptProps> = ({
  enabled = false,
  maxLength = 100,
  fadeTimeout = 3000
}) => {
  const [partialText, setPartialText] = useState<string>('')
  const [confidence, setConfidence] = useState<number>(0)
  const [isVisible, setIsVisible] = useState<boolean>(false)
  const [fadeTimer, setFadeTimer] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!enabled) return

    // Listen for partial transcript updates from main process
    // Note: This will be implemented when partial transcripts are enabled
    if ((window as any).electronOverlay?.onPartialTranscript) {
      const unsubscribe = (window as any).electronOverlay.onPartialTranscript((data: PartialTranscriptData) => {
        handlePartialTranscript(data)
      })

      return unsubscribe
    }
  }, [enabled])

  const handlePartialTranscript = (data: PartialTranscriptData) => {
    if (!enabled) return

    // Clear existing fade timer
    if (fadeTimer) {
      clearTimeout(fadeTimer)
      setFadeTimer(null)
    }

    // Update text with length limiting
    const limitedText = data.text.length > maxLength 
      ? '...' + data.text.slice(-(maxLength - 3))
      : data.text

    setPartialText(limitedText)
    setConfidence(data.confidence || 0)
    setIsVisible(true)

    // If this is a complete transcript, fade out after timeout
    if (data.isComplete) {
      const timer = setTimeout(() => {
        setIsVisible(false)
        setPartialText('')
      }, fadeTimeout)
      setFadeTimer(timer)
    }
  }

  // Don't render if disabled or not visible
  if (!enabled || !isVisible || !partialText) {
    return null
  }

  return (
    <div className="partial-transcript-container">
      <div className={`partial-transcript ${confidence < 0.5 ? 'low-confidence' : ''}`}>
        <div className="transcript-text">{partialText}</div>
        {confidence > 0 && (
          <div className="confidence-indicator">
            <div 
              className="confidence-bar" 
              style={{ width: `${confidence * 100}%` }}
            />
          </div>
        )}
      </div>
      
      <style dangerouslySetInnerHTML={{
        __html: `
        .partial-transcript-container {
          position: absolute;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          pointer-events: none;
          width: 90%;
          max-width: 400px;
        }

        .partial-transcript {
          background: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 8px 12px;
          border-radius: 16px;
          font-size: 14px;
          line-height: 1.4;
          animation: slideUp 0.3s ease-out;
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .partial-transcript.low-confidence {
          background: rgba(255, 165, 0, 0.8);
          color: white;
        }

        .transcript-text {
          margin-bottom: 4px;
          word-wrap: break-word;
        }

        .confidence-indicator {
          height: 2px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 1px;
          overflow: hidden;
        }

        .confidence-bar {
          height: 100%;
          background: linear-gradient(90deg, #ef4444 0%, #f59e0b 50%, #10b981 100%);
          transition: width 0.3s ease;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        `
      }} />
    </div>
  )
}

/**
 * Manager for partial transcript events and state
 */
export class PartialTranscriptManager {
  private isEnabled = false
  private currentText = ''
  private confidence = 0
  private callbacks: Array<(data: PartialTranscriptData) => void> = []

  setEnabled(enabled: boolean) {
    this.isEnabled = enabled
  }

  updatePartialTranscript(text: string, confidence?: number) {
    if (!this.isEnabled) return

    this.currentText = text
    this.confidence = confidence || 0

    const data: PartialTranscriptData = {
      text,
      confidence: confidence || 0,
      timestamp: Date.now(),
      isComplete: false
    }

    this.notifyCallbacks(data)
  }

  completeFinalTranscript(text: string, confidence?: number) {
    if (!this.isEnabled) return

    const data: PartialTranscriptData = {
      text,
      confidence: confidence || 0,
      timestamp: Date.now(),
      isComplete: true
    }

    this.notifyCallbacks(data)
    this.reset()
  }

  onPartialTranscript(callback: (data: PartialTranscriptData) => void): () => void {
    this.callbacks.push(callback)
    
    // Return unsubscribe function
    return () => {
      const index = this.callbacks.indexOf(callback)
      if (index > -1) {
        this.callbacks.splice(index, 1)
      }
    }
  }

  private notifyCallbacks(data: PartialTranscriptData) {
    this.callbacks.forEach(callback => {
      try {
        callback(data)
      } catch (error) {
        console.error('Error in partial transcript callback:', error)
      }
    })
  }

  private reset() {
    this.currentText = ''
    this.confidence = 0
  }

  getCurrentText(): string {
    return this.currentText
  }

  getConfidence(): number {
    return this.confidence
  }

  isActive(): boolean {
    return this.isEnabled
  }
}

// Export singleton instance
export const partialTranscriptManager = new PartialTranscriptManager()

// Export component as default
export default PartialTranscriptHandler 