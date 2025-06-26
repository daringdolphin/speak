import React, { useState, useEffect } from 'react'
import { Meter } from './Meter'

interface OverlayState {
  status: 'recording' | 'error' | 'idle'
  message?: string
  level?: number
  avgLevel?: number
}

const Overlay: React.FC = () => {
  const [state, setState] = useState<OverlayState>({ status: 'idle' })

  useEffect(() => {
    // Listen for overlay updates from main process
    if (window.electronOverlay) {
      window.electronOverlay.onUpdate((newState: OverlayState) => {
        setState(newState)
      })

      // Listen for audio level updates
      window.electronOverlay.onLevelUpdate((level: number, avgLevel: number) => {
        setState(prev => ({ ...prev, level, avgLevel }))
      })
    }
  }, [])

  // Don't render anything when idle
  if (state.status === 'idle') {
    return null
  }

  const isRecording = state.status === 'recording'
  const isError = state.status === 'error'

  return (
    <div className="overlay-container">
      <div className={`overlay-card ${isError ? 'error' : 'recording'}`}>
        <div className="overlay-content">
          {isRecording ? (
            <>
              <div className="mic-section">
                <MicIcon className="mic-icon" />
                <div className="status-text">Listening...</div>
              </div>
              <Meter level={state.level || 0} avgLevel={state.avgLevel || 0} />
            </>
          ) : (
            <div className="error-section">
              <WarningIcon className="warning-icon" />
              <div className="error-text">{state.message || 'Error occurred'}</div>
            </div>
          )}
        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{
        __html: `
        .overlay-container {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .overlay-card {
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-radius: 24px;
          padding: 20px 24px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          min-width: 300px;
          max-width: 350px;
          transition: all 0.3s ease;
        }

        .overlay-card.recording {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(59, 130, 246, 0.3);
        }

        .overlay-card.error {
          background: rgba(239, 68, 68, 0.7);
          border-color: rgba(239, 68, 68, 0.8);
        }

        .overlay-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .mic-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .mic-icon {
          width: 32px;
          height: 32px;
          color: #3B82F6;
          animation: pulse 2s infinite;
        }

        .status-text {
          color: rgba(255, 255, 255, 0.9);
          font-size: 16px;
          font-weight: 500;
        }

        .error-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .warning-icon {
          width: 32px;
          height: 32px;
          color: #FFF;
        }

        .error-text {
          color: #FFF;
          font-size: 14px;
          font-weight: 500;
          text-align: center;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.05);
          }
        }
        `
      }} />
    </div>
  )
}

// Mic Icon Component
const MicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
)

// Warning Icon Component
const WarningIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
  </svg>
)

export default Overlay 