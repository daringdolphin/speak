import Store from 'electron-store'
import { z } from 'zod'

// Define the settings schema with validation
const SettingsSchema = z.object({
  // Recording settings
  hotkey: z.string().default('Ctrl+Shift+Space'),
  showOverlay: z.boolean().default(true),
  
  // Audio settings
  inputDevice: z.string().optional(),
  sampleRate: z.number().int().min(8000).max(48000).default(16000),
  
  // STT settings
  model: z.string().default('gpt-4o-transcribe'),
  language: z.string().default('en'),
  
  // API settings (encrypted separately)
  openaiKeyEncrypted: z.string().optional(),
  
  // UI settings
  overlayPosition: z.object({
    x: z.number().optional(),
    y: z.number().optional()
  }).default({}),
  
  // Performance settings
  maxLatencyMs: z.number().int().min(100).max(5000).default(500),
  
  // Privacy settings
  telemetryEnabled: z.boolean().default(false),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Advanced settings
  retryAttempts: z.number().int().min(1).max(10).default(3),
  autoLaunch: z.boolean().default(false)
})

export type SettingsType = z.infer<typeof SettingsSchema>

export class SettingsStore {
  private store: Store<SettingsType>
  private static instance: SettingsStore | null = null

  private constructor() {
    this.store = new Store<SettingsType>({
      name: 'settings',
      schema: SettingsSchema.shape as any,
      defaults: SettingsSchema.parse({}) as SettingsType,
      // Validate settings on load
      migrations: {
        '>=0.1.0': (store) => {
          // Migrate any old settings format if needed
          const currentSettings = store.store
          const validatedSettings = SettingsSchema.parse(currentSettings)
          store.clear()
          store.set(validatedSettings)
        }
      }
    })
  }

  static getInstance(): SettingsStore {
    if (!SettingsStore.instance) {
      SettingsStore.instance = new SettingsStore()
    }
    return SettingsStore.instance
  }

  // Type-safe getters
  get<K extends keyof SettingsType>(key: K): SettingsType[K] {
    return this.store.get(key)
  }

  // Type-safe setters with validation
  set<K extends keyof SettingsType>(key: K, value: SettingsType[K]): void {
    // Validate the individual field
    const partial = { [key]: value } as Partial<SettingsType>
    const validated = SettingsSchema.partial().parse(partial)
    this.store.set(key, validated[key] as SettingsType[K])
  }

  // Bulk update with validation
  update(updates: Partial<SettingsType>): void {
    const current = this.getAll()
    const merged = { ...current, ...updates }
    const validated = SettingsSchema.parse(merged)
    
    // Update each field individually for better error handling
    for (const [key, value] of Object.entries(validated)) {
      this.store.set(key as keyof SettingsType, value)
    }
  }

  // Get all settings
  getAll(): SettingsType {
    return this.store.store
  }

  // Reset to defaults
  reset(): void {
    this.store.clear()
    const defaults = SettingsSchema.parse({})
    this.store.set(defaults)
  }

  // File path for debugging
  getPath(): string {
    return this.store.path
  }

  // Watch for changes
  onDidChange<K extends keyof SettingsType>(
    key: K,
    callback: (newValue: SettingsType[K], oldValue: SettingsType[K]) => void
  ): () => void {
    return this.store.onDidChange(key, callback)
  }

  // Watch for any changes
  onDidAnyChange(callback: (newSettings: SettingsType, oldSettings: SettingsType) => void): () => void {
    return this.store.onDidAnyChange(callback)
  }

  // Validation helpers
  validateHotkey(hotkey: string): boolean {
    // Basic hotkey validation - could be enhanced
    const validModifiers = ['Ctrl', 'Alt', 'Shift', 'Meta', 'CmdOrCtrl']
    const parts = hotkey.split('+')
    
    if (parts.length < 2) return false
    
    const modifiers = parts.slice(0, -1)
    const key = parts[parts.length - 1]
    
    return modifiers.every(mod => validModifiers.includes(mod)) && key.length > 0
  }

  validateModel(model: string): boolean {
    const validModels = ['gpt-4o-transcribe', 'whisper-1']
    return validModels.includes(model)
  }
}

// Export singleton instance
export const settings = SettingsStore.getInstance()

// Export types for use in other modules
export { SettingsSchema }
export type { SettingsType } 