export interface Logger {
  info(message: string, ...args: any[]): void
  debug(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
}

class MockLogger implements Logger {
  private prefix = '[MockWS]'

  info(message: string, ...args: any[]): void {
    console.log(`${this.prefix} INFO:`, message, ...args)
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      console.log(`${this.prefix} DEBUG:`, message, ...args)
    }
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`${this.prefix} WARN:`, message, ...args)
  }

  error(message: string, ...args: any[]): void {
    console.error(`${this.prefix} ERROR:`, message, ...args)
  }
}

export default new MockLogger() 