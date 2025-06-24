import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Production-optimized logging utility
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development'
  private enabledLevels: LogLevel[] = this.isDevelopment 
    ? ['debug', 'info', 'warn', 'error'] 
    : ['warn', 'error'] // Only warnings and errors in production

  private shouldLog(level: LogLevel): boolean {
    return this.enabledLevels.includes(level)
  }

  debug(service: string, message: string, data?: any) {
    if (this.shouldLog('debug')) {
      console.log(`[${service}] 🔍 ${message}`, data || '')
    }
  }

  info(service: string, message: string, data?: any) {
    if (this.shouldLog('info')) {
      console.log(`[${service}] ✅ ${message}`, data || '')
    }
  }

  warn(service: string, message: string, data?: any) {
    if (this.shouldLog('warn')) {
      console.warn(`[${service}] ⚠️  ${message}`, data || '')
    }
  }

  error(service: string, message: string, error?: any) {
    if (this.shouldLog('error')) {
      console.error(`[${service}] ❌ ${message}`, error || '')
    }
  }

  // Performance tracking for optimization
  time(service: string, operation: string) {
    if (this.isDevelopment) {
      console.time(`[${service}] ${operation}`)
    }
  }

  timeEnd(service: string, operation: string) {
    if (this.isDevelopment) {
      console.timeEnd(`[${service}] ${operation}`)
    }
  }

  // Production metrics (lightweight)
  metric(service: string, operation: string, value: number, unit: string = '') {
    if (process.env.NODE_ENV === 'production') {
      // Only log critical metrics in production
      if (operation.includes('error') || value > 10000) { // Large operations or errors
        console.log(`[METRIC] ${service}.${operation}: ${value}${unit}`)
      }
    } else {
      console.log(`[METRIC] ${service}.${operation}: ${value}${unit}`)
    }
  }
}

export const logger = new Logger()

// Performance optimization utilities
export const performance = {
  // Batch operations for better efficiency
  batchProcess: async <T, R>(
    items: T[], 
    processor: (item: T) => Promise<R>, 
    batchSize: number = 10
  ): Promise<R[]> => {
    const results: R[] = []
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const batchResults = await Promise.all(batch.map(processor))
      results.push(...batchResults)
    }
    return results
  },

  // Debounce for user actions
  debounce: <T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): T => {
    let timeout: NodeJS.Timeout
    return ((...args: any[]) => {
      clearTimeout(timeout)
      timeout = setTimeout(() => func.apply(null, args), wait)
    }) as T
  },

  // Memory-efficient CSV streaming
  csvStream: {
    createChunkedCSV: (headers: string[], maxRowsPerChunk: number = 1000) => {
      let currentChunk: string[] = [headers.join(',')]
      let chunkCount = 0

      return {
        addRow: (row: string[]) => {
          currentChunk.push(row.join(','))
          if (currentChunk.length >= maxRowsPerChunk) {
            return currentChunk.join('\n')
          }
          return null
        },
        finalize: () => currentChunk.join('\n')
      }
    }
  }
}
