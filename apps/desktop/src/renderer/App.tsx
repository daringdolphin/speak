import React, { useState, useEffect } from 'react'

const App: React.FC = () => {
  const [appVersion, setAppVersion] = useState<string>('')
  const [pingResult, setPingResult] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [recordingStatus, setRecordingStatus] = useState<any>(null)

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Test IPC communication
        const version = await window.electron.getAppVersion()
        setAppVersion(version)
        
        const ping = await window.electron.ping()
        setPingResult(ping)
        
        // Get recording status
        const status = await window.electron.invoke('get-recording-status')
        setRecordingStatus(status)
        
        setIsLoading(false)
      } catch (error) {
        console.error('Failed to initialize app:', error)
        setIsLoading(false)
      }
    }

    initializeApp()
    
    // Update recording status every 2 seconds
    const interval = setInterval(async () => {
      try {
        const status = await window.electron.invoke('get-recording-status')
        setRecordingStatus(status)
      } catch (error) {
        console.error('Failed to get recording status:', error)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  const handleTestPing = async () => {
    try {
      const result = await window.electron.ping()
      setPingResult(result)
    } catch (error) {
      console.error('Ping failed:', error)
      setPingResult('Error')
    }
  }

  const handleTestRecording = async () => {
    try {
      await window.electron.invoke('test-recording')
    } catch (error) {
      console.error('Recording test failed:', error)
    }
  }

  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: '#1a1a1a',
        color: '#ffffff'
      }}>
        <div>Loading...</div>
      </div>
    )
  }

  return (
    <div style={{
      padding: '20px',
      height: '100vh',
      background: '#1a1a1a',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <h1 style={{ 
        fontSize: '2rem', 
        marginBottom: '1rem',
        background: 'linear-gradient(45deg, #007ACC, #00D4AA)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}>
        Speak - Voice Transcription
      </h1>
      
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ color: '#cccccc', fontSize: '1rem', marginBottom: '0.5rem' }}>
          System Status
        </h2>
        <div style={{ 
          background: '#2a2a2a', 
          padding: '1rem', 
          borderRadius: '8px',
          border: '1px solid #333'
        }}>
          <p><strong>App Version:</strong> {appVersion}</p>
          <p><strong>IPC Status:</strong> {pingResult === 'pong' ? '✅ Connected' : '❌ Failed'}</p>
          {recordingStatus && (
            <>
              <p><strong>Recording:</strong> {recordingStatus.isRecording ? '🔴 Active' : '⚪ Inactive'}</p>
              <p><strong>Shortcut:</strong> {recordingStatus.shortcutStatus?.activeKey || 'Not set'}</p>
              {recordingStatus.shortcutStatus?.isUsingFallback && (
                <p style={{ color: '#ffaa00' }}>⚠️ Using fallback shortcut method</p>
              )}
              {recordingStatus.streamStats?.isStreaming && (
                <p><strong>Audio Stream:</strong> {recordingStatus.streamStats.chunkCount} chunks processed</p>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ color: '#cccccc', fontSize: '1rem', marginBottom: '0.5rem' }}>
          Development Tools
        </h2>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={handleTestPing}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#007ACC',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: '500'
            }}
          >
            Test IPC Connection
          </button>
          <button
            onClick={handleTestRecording}
            style={{
              padding: '0.75rem 1.5rem',
              background: recordingStatus?.isRecording ? '#dc3545' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: '500'
            }}
          >
            {recordingStatus?.isRecording ? 'Stop Recording' : 'Test Recording'}
          </button>
        </div>
      </div>

      <div style={{ 
        background: '#2a2a2a', 
        padding: '1rem', 
        borderRadius: '8px',
        border: '1px solid #333'
      }}>
        <h3 style={{ color: '#00D4AA', margin: '0 0 0.5rem 0' }}>Sprint 1 Progress (T1-T7)</h3>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>✅ T1: Repo bootstrap complete</li>
          <li>✅ T2: Electron boilerplate complete</li>
          <li>✅ T3: electron-builder & NSIS config</li>
          <li>✅ T4: ShortcutManager with fallbacks</li>
          <li>✅ T5: RecorderWindow skeleton</li>
          <li>✅ T6: AudioWorklet processor</li>
          <li>✅ T7: IPC streaming channel</li>
        </ul>
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#1a4d3a', borderRadius: '6px', border: '1px solid #00D4AA' }}>
          <strong style={{ color: '#00D4AA' }}>🎉 Sprint 1 Complete!</strong>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
            Press <kbd>Ctrl+Shift+Space</kbd> to test recording, or use the "Test Recording" button above.
            Check the overlay in the bottom-right corner when recording starts.
          </p>
        </div>
      </div>
    </div>
  )
}

export default App 