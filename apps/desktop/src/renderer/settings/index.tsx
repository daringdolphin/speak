import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

interface SettingsFormData {
  hotkey: string
  openaiKey: string
  showOverlay: boolean
  model: string
  language: string
  maxLatencyMs: number
  telemetryEnabled: boolean
  autoLaunch: boolean
}

const SettingsDialog: React.FC = () => {
  const [formData, setFormData] = useState<SettingsFormData>({
    hotkey: 'Ctrl+Shift+Space',
    openaiKey: '',
    showOverlay: true,
    model: 'gpt-4o-transcribe',
    language: 'en',
    maxLatencyMs: 500,
    telemetryEnabled: false,
    autoLaunch: false
  })
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [testingKey, setTestingKey] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const settings = await window.electron.invoke('get-all-settings')
      setFormData(prev => ({ ...prev, ...settings }))
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}
    
    if (!formData.hotkey.trim()) {
      newErrors.hotkey = 'Hotkey is required'
    }
    
    if (!formData.openaiKey.trim()) {
      newErrors.openaiKey = 'OpenAI API key is required'
    } else if (!formData.openaiKey.startsWith('sk-')) {
      newErrors.openaiKey = 'Invalid OpenAI API key format'
    }
    
    if (formData.maxLatencyMs < 100 || formData.maxLatencyMs > 5000) {
      newErrors.maxLatencyMs = 'Latency must be between 100-5000ms'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) return

    setSaving(true)
    try {
      await window.electron.invoke('save-all-settings', formData)
      await window.electron.invoke('show-notification', 'Settings saved successfully!')
      
      // Close dialog after short delay
      setTimeout(() => {
        window.electron.invoke('close-settings-dialog')
      }, 1000)
      
    } catch (error) {
      console.error('Failed to save settings:', error)
      setErrors({ general: 'Failed to save settings. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const handleTestKey = async () => {
    if (!formData.openaiKey.trim()) {
      setErrors({ openaiKey: 'Enter an API key to test' })
      return
    }

    setTestingKey(true)
    try {
      const result = await window.electron.invoke('test-openai-key', formData.openaiKey)
      if (result.success) {
        setErrors({ openaiKey: '' })
        await window.electron.invoke('show-notification', 'API key is valid!')
      } else {
        setErrors({ openaiKey: result.error || 'Invalid API key' })
      }
    } catch (error) {
      setErrors({ openaiKey: 'Failed to test API key' })
    } finally {
      setTestingKey(false)
    }
  }

  const handleCancel = () => {
    window.electron.invoke('close-settings-dialog')
  }

  const handleReset = () => {
    setFormData({
      hotkey: 'Ctrl+Shift+Space',
      openaiKey: '',
      showOverlay: true,
      model: 'gpt-4o-transcribe',
      language: 'en',
      maxLatencyMs: 500,
      telemetryEnabled: false,
      autoLaunch: false
    })
    setErrors({})
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1>QuickTranscriber Settings</h1>
        <p>Configure your voice transcription preferences</p>
      </div>

      <form className="settings-form" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
        {errors.general && (
          <div className="error-banner">
            {errors.general}
          </div>
        )}

        {/* Recording Settings */}
        <section className="settings-section">
          <h2>Recording</h2>
          
          <div className="form-group">
            <label htmlFor="hotkey">Global Hotkey</label>
            <input
              id="hotkey"
              type="text"
              value={formData.hotkey}
              onChange={(e) => setFormData(prev => ({ ...prev, hotkey: e.target.value }))}
              placeholder="e.g., Ctrl+Shift+Space"
              className={errors.hotkey ? 'error' : ''}
            />
            {errors.hotkey && <span className="error-text">{errors.hotkey}</span>}
            <small>Use format: Ctrl+Shift+Key, Alt+Key, etc.</small>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={formData.showOverlay}
                onChange={(e) => setFormData(prev => ({ ...prev, showOverlay: e.target.checked }))}
              />
              Show recording overlay
            </label>
            <small>Display visual feedback when recording</small>
          </div>
        </section>

        {/* API Settings */}
        <section className="settings-section">
          <h2>OpenAI API</h2>
          
          <div className="form-group">
            <label htmlFor="openaiKey">API Key</label>
            <div className="input-with-button">
              <input
                id="openaiKey"
                type="password"
                value={formData.openaiKey}
                onChange={(e) => setFormData(prev => ({ ...prev, openaiKey: e.target.value }))}
                placeholder="sk-..."
                className={errors.openaiKey ? 'error' : ''}
              />
              <button
                type="button"
                onClick={handleTestKey}
                disabled={testingKey}
                className="test-button"
              >
                {testingKey ? 'Testing...' : 'Test'}
              </button>
            </div>
            {errors.openaiKey && <span className="error-text">{errors.openaiKey}</span>}
            <small>Your OpenAI API key for transcription service</small>
          </div>

          <div className="form-group">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={formData.model}
              onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
            >
              <option value="gpt-4o-transcribe">GPT-4o Transcribe (Recommended)</option>
              <option value="whisper-1">Whisper-1</option>
            </select>
            <small>Transcription model to use</small>
          </div>

          <div className="form-group">
            <label htmlFor="language">Language</label>
            <select
              id="language"
              value={formData.language}
              onChange={(e) => setFormData(prev => ({ ...prev, language: e.target.value }))}
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="auto">Auto-detect</option>
            </select>
            <small>Primary language for transcription</small>
          </div>
        </section>

        {/* Performance Settings */}
        <section className="settings-section">
          <h2>Performance</h2>
          
          <div className="form-group">
            <label htmlFor="maxLatencyMs">Max Latency (ms)</label>
            <input
              id="maxLatencyMs"
              type="number"
              min="100"
              max="5000"
              step="50"
              value={formData.maxLatencyMs}
              onChange={(e) => setFormData(prev => ({ ...prev, maxLatencyMs: parseInt(e.target.value) }))}
              className={errors.maxLatencyMs ? 'error' : ''}
            />
            {errors.maxLatencyMs && <span className="error-text">{errors.maxLatencyMs}</span>}
            <small>Warning threshold for slow transcription</small>
          </div>
        </section>

        {/* Privacy Settings */}
        <section className="settings-section">
          <h2>Privacy & System</h2>
          
          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={formData.telemetryEnabled}
                onChange={(e) => setFormData(prev => ({ ...prev, telemetryEnabled: e.target.checked }))}
              />
              Enable telemetry
            </label>
            <small>Help improve the app by sending anonymous usage data</small>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={formData.autoLaunch}
                onChange={(e) => setFormData(prev => ({ ...prev, autoLaunch: e.target.checked }))}
              />
              Start with Windows
            </label>
            <small>Launch QuickTranscriber when your computer starts</small>
          </div>
        </section>

        {/* Actions */}
        <div className="settings-actions">
          <button type="button" onClick={handleReset} className="reset-button">
            Reset to Defaults
          </button>
          <div className="primary-actions">
            <button type="button" onClick={handleCancel} className="cancel-button">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="save-button">
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </form>

      <style dangerouslySetInnerHTML={{
        __html: `
          .settings-container {
            max-width: 600px;
            margin: 0 auto;
            padding: 24px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
            min-height: 100vh;
          }

          .settings-header {
            margin-bottom: 32px;
            text-align: center;
          }

          .settings-header h1 {
            margin: 0 0 8px 0;
            font-size: 28px;
            font-weight: 600;
            color: #ffffff;
          }

          .settings-header p {
            margin: 0;
            color: #888;
            font-size: 16px;
          }

          .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            gap: 16px;
          }

          .loading-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid #333;
            border-top: 3px solid #007ACC;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .error-banner {
            background: #dc3545;
            color: white;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 24px;
            text-align: center;
          }

          .settings-section {
            margin-bottom: 32px;
            padding: 24px;
            background: #2a2a2a;
            border-radius: 12px;
            border: 1px solid #333;
          }

          .settings-section h2 {
            margin: 0 0 20px 0;
            font-size: 18px;
            font-weight: 600;
            color: #ffffff;
            border-bottom: 1px solid #333;
            padding-bottom: 8px;
          }

          .form-group {
            margin-bottom: 20px;
          }

          .form-group label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            color: #ffffff;
          }

          .form-group input,
          .form-group select {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #444;
            border-radius: 6px;
            background: #1a1a1a;
            color: #ffffff;
            font-size: 14px;
          }

          .form-group input:focus,
          .form-group select:focus {
            outline: none;
            border-color: #007ACC;
            box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
          }

          .form-group input.error,
          .form-group select.error {
            border-color: #dc3545;
          }

          .input-with-button {
            display: flex;
            gap: 8px;
          }

          .input-with-button input {
            flex: 1;
          }

          .test-button {
            padding: 10px 16px;
            background: #007ACC;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            white-space: nowrap;
          }

          .test-button:hover {
            background: #005a9e;
          }

          .test-button:disabled {
            background: #555;
            cursor: not-allowed;
          }

          .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .checkbox-group input[type="checkbox"] {
            width: auto;
            margin: 0;
          }

          .error-text {
            color: #dc3545;
            font-size: 12px;
            margin-top: 4px;
            display: block;
          }

          .form-group small {
            display: block;
            margin-top: 4px;
            color: #888;
            font-size: 12px;
          }

          .settings-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid #333;
          }

          .primary-actions {
            display: flex;
            gap: 12px;
          }

          .reset-button {
            padding: 10px 16px;
            background: transparent;
            color: #888;
            border: 1px solid #444;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          }

          .reset-button:hover {
            background: #333;
            color: #ffffff;
          }

          .cancel-button {
            padding: 10px 20px;
            background: transparent;
            color: #ffffff;
            border: 1px solid #444;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          }

          .cancel-button:hover {
            background: #333;
          }

          .save-button {
            padding: 10px 20px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
          }

          .save-button:hover {
            background: #218838;
          }

          .save-button:disabled {
            background: #555;
            cursor: not-allowed;
          }
        `
      }} />
    </div>
  )
}

// Render the component
const container = document.getElementById('settings-root')
if (container) {
  const root = createRoot(container)
  root.render(<SettingsDialog />)
} 