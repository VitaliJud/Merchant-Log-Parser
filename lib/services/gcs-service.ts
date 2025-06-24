import { SignJWT, importPKCS8 } from 'jose'
import { logger } from '@/lib/utils'

export interface GCSConfig {
  clientEmail: string
  privateKey: string
  bucketName: string
}

export class GCSService {
  private config: GCSConfig

  constructor(config: GCSConfig) {
    this.config = config
  }

  async getAccessToken(): Promise<string> {
    logger.debug('GCS', 'Creating JWT...')
    const jwt = await this.createJWT()
    logger.debug('GCS', 'JWT created, exchanging for access token...')
    const accessToken = await this.exchangeJWTForAccessToken(jwt)
    logger.debug('GCS', 'Access token obtained')
    return accessToken
  }

  async analyzeBucket(): Promise<{
    connected: boolean
    folderCount: number
    fileTypeAnalysis: {
      api_access: number
      store_access: number
      audit: number
      other: number
      total: number
      note?: string
    }
    recentDates: string[]
    sampleFiles: string[]
    recommendations: {
      suggestedLimit: number
      availableDateRange: string
      totalLogFiles: number
      analysisNote?: string
    }
  }> {
    logger.info('GCS', `Starting bucket analysis for: ${this.config.bucketName}`)
    logger.time('GCS', 'bucket-analysis')
    
    const accessToken = await this.getAccessToken()
    logger.debug('GCS', 'Authentication successful')
    
    // Skip bucket validation step - we'll validate access by trying to list objects directly
    // This avoids requiring bucket-level metadata permissions
    logger.debug('GCS', 'Validating bucket access by listing objects...')
    
    // Generate just the most recent date folder to check (reduced from 15 to 1)
    const recentDateFolders = this.generateRecentDateFolders()
    const mostRecentFolder = recentDateFolders[0] // Just check the most recent folder
    logger.debug('GCS', `Checking most recent date folder: ${mostRecentFolder}`)

    const activeDates: string[] = []

    // Check if the most recent folder has files
    logger.debug('GCS', `Checking if folder has files: ${mostRecentFolder}`)
    
    const filesResponse = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${this.config.bucketName}/o?prefix=${encodeURIComponent(mostRecentFolder)}&maxResults=1`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (filesResponse.ok) {
      const filesData = await filesResponse.json()
      const files = filesData.items || []
      
      // Only add to dates if we found at least one file
      if (files.length > 0) {
        const dateStr = mostRecentFolder.replace(/\//g, '-').slice(0, -1) // Convert "2024/01/01/" to "2024-01-01"
        activeDates.push(dateStr)
        logger.debug('GCS', `Found files in ${mostRecentFolder}`)
      } else {
        logger.warn('GCS', `No files found in most recent folder: ${mostRecentFolder}`)
      }
      
      logger.info('GCS', 'Bucket access validated successfully')
    } else {
      // Handle bucket access errors with specific error messages
      const errorText = await filesResponse.text().catch(() => 'Unknown error')
      logger.error('GCS', `Bucket access validation failed: ${filesResponse.status}`, errorText)
      
      if (filesResponse.status === 404) {
        throw new Error(`Bucket "${this.config.bucketName}" not found. Please check the bucket name.`)
      } else if (filesResponse.status === 403) {
        throw new Error(`Access denied to bucket "${this.config.bucketName}". Check your service account permissions.`)
      } else {
        throw new Error(`Bucket access failed: ${filesResponse.status} ${filesResponse.statusText}`)
      }
    }

    logger.debug('GCS', `Analysis summary: ${activeDates.length > 0 ? 'Found' : 'No'} files in most recent date folder`)

    // Simple date range (just the one folder we checked)
    const availableDateRange = activeDates.length > 0 ? activeDates[0] : 'No recent files found'

    logger.timeEnd('GCS', 'bucket-analysis')
    logger.info('GCS', `Analysis complete: Bucket access confirmed, ${activeDates.length > 0 ? 'files found' : 'no files found'}`)

    // Return minimal data for fast analysis
    return {
      connected: true,
      folderCount: activeDates.length, // 0 or 1
      fileTypeAnalysis: {
        api_access: 0,
        store_access: 0,
        audit: 0,
        other: 0,
        total: 0,
        note: 'Quick analysis - only checked most recent date folder for performance'
      },
      recentDates: activeDates,
      sampleFiles: [],
      recommendations: {
        suggestedLimit: 20,
        availableDateRange,
        totalLogFiles: 0,
        analysisNote: `Bucket access confirmed successfully. ${activeDates.length > 0 ? 'Files found in most recent date folder.' : 'No files found in most recent date folder - try different date range.'}`
      }
    }
  }

  // Keep the old method for backward compatibility
  async listFolders(): Promise<number> {
    const analysis = await this.analyzeBucket()
    return analysis.folderCount
  }

  async fetchLogs(logType: string, startDate: string, endDate: string, limit: number): Promise<string> {
    // Check if this is an unlimited request (very high limit means "do not limit")
    const isUnlimited = limit >= 999999
    logger.info('GCS', `Starting log fetch: ${logType}, ${startDate} to ${endDate}, limit: ${limit}${isUnlimited ? ' (UNLIMITED)' : ''}`)
    logger.time('GCS', 'fetch-logs')
    
    try {
      logger.debug('GCS', 'Getting access token...')
      const accessToken = await this.getAccessToken()
      logger.debug('GCS', 'Access token obtained successfully')
      
      // Build date folders to search (YYYY/MM/DD format)
      const dateFolders = this.buildDateFolders(startDate, endDate)
      logger.debug('GCS', `Will search ${dateFolders.length} date folder(s)`)
      
      const headers = this.getHeaders(logType === 'all' ? 'api_access' : logType) // Use first type for headers
      const csvRows = [headers.join(',')]
      let totalProcessedFiles = 0
      let totalLogEntries = 0
      
      // Process each date folder
      for (const folderPath of dateFolders) {
        logger.debug('GCS', `Fetching files from folder: "${folderPath}"`)
        
        const listUrl = `https://storage.googleapis.com/storage/v1/b/${this.config.bucketName}/o?prefix=${encodeURIComponent(folderPath)}&maxResults=1000`
        logger.debug('GCS', `Listing objects from: ${listUrl}`)
        
        const response = await fetch(listUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        logger.debug('GCS', `List response status: ${response.status}`)

        if (!response.ok) {
          const errorText = await response.text()
          logger.error('GCS', `List error for folder ${folderPath}:`, errorText)
          continue // Skip this folder and try the next one
        }

        const data = await response.json()
        const allFiles = data.items || []
        logger.debug('GCS', `Found ${allFiles.length} total files in ${folderPath}`)
        
        if (allFiles.length === 0) {
          logger.warn('GCS', `No files found in folder: "${folderPath}"`)
          continue
        }
        
        // Filter files by log type based on filename
        const relevantFiles = allFiles.filter((file: any) => 
          this.shouldProcessFile(file.name, logType)
        )
        
        logger.debug('GCS', `Filtered to ${relevantFiles.length} relevant files for log type: ${logType}`)
        
        if (relevantFiles.length > 0) {
          logger.debug('GCS', 'Relevant files found:')
          relevantFiles.slice(0, 5).forEach((file: any, index: number) => {
            logger.debug('GCS', `  ${index + 1}. ${file.name} (${file.size} bytes)`)
          })
        }
        
        // Process the filtered files
        if (!isUnlimited) {
          const remainingLimit = limit - totalLogEntries
          if (remainingLimit <= 0) {
            logger.debug('GCS', `Reached limit of ${limit} entries, stopping`)
            break
          }
        }
        
        const filesToProcess = isUnlimited 
          ? relevantFiles 
          : relevantFiles.slice(0, Math.min(relevantFiles.length, limit - totalLogEntries))
        
        for (const file of filesToProcess) {
          if (!isUnlimited && totalLogEntries >= limit) break
          
          logger.debug('GCS', `Processing file: ${file.name}`)
          
          try {
            const downloadUrl = `https://storage.googleapis.com/storage/v1/b/${file.bucket}/o/${encodeURIComponent(file.name)}?alt=media`
            
            const fileResponse = await fetch(downloadUrl, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
              },
            })
            
                         if (fileResponse.ok) {
               let logContent: string
               
               // Check content-type header to determine if file is actually compressed
               const contentType = fileResponse.headers.get('content-type') || ''
               const isActuallyCompressed = contentType.includes('gzip') || contentType.includes('application/gzip')
               
               logger.debug('GCS', `Content-Type: ${contentType}`)
               
               // Check if file appears to be compressed based on name and content-type
               if (file.name.endsWith('.gz')) {
                 if (contentType.includes('text/plain') || contentType.includes('application/json')) {
                   logger.debug('GCS', `File has .gz extension but content-type is ${contentType}, reading as plain text`)
                   logContent = await fileResponse.text()
                   logger.debug('GCS', `Read as plain text: ${logContent.length} characters`)
                 } else {
                   logger.debug('GCS', `Attempting to decompress .gz file: ${file.name}`)
                   try {
                     const compressedData = await fileResponse.arrayBuffer()
                     logContent = await this.decompressGzipContent(compressedData)
                     logger.debug('GCS', `Successfully decompressed to ${logContent.length} characters`)
                   } catch (gzipError) {
                     logger.warn('GCS', `Gzip decompression failed, trying as plain text:`, gzipError)
                     // Reset response and try as plain text
                     const textResponse = await fetch(downloadUrl, {
                       headers: { 'Authorization': `Bearer ${accessToken}` }
                     })
                     logContent = await textResponse.text()
                     logger.debug('GCS', `Fallback: Read as plain text: ${logContent.length} characters`)
                   }
                 }
               } else {
                 logContent = await fileResponse.text()
                 logger.debug('GCS', `Downloaded ${logContent.length} characters from ${file.name}`)
               }
               
               // Show a sample of the content for debugging
               const contentSample = logContent.substring(0, 200).replace(/\n/g, '\\n')
               logger.debug('GCS', `Content sample: ${contentSample}...`)
               
               // Detect the actual log type for this file
               const fileLogType = this.getLogTypeFromFileName(file.name) || logType
               logger.debug('GCS', `Processing as log type: ${fileLogType}`)
               
                             const logLines = this.parseLogContent(logContent, fileLogType)
              logger.debug('GCS', `Parsed ${logLines.length} log lines from ${file.name}`)
             
             const linesToAdd = isUnlimited 
               ? logLines 
               : logLines.slice(0, limit - totalLogEntries)
             csvRows.push(...linesToAdd)
             totalLogEntries += linesToAdd.length
             totalProcessedFiles++
             
             logger.debug('GCS', `Added ${linesToAdd.length} lines to CSV. Total entries: ${totalLogEntries}`)
             
             if (!isUnlimited && totalLogEntries >= limit) {
               logger.debug('GCS', `Reached limit of ${limit} entries`)
               break
             }
            } else {
              const errorText = await fileResponse.text()
              logger.error('GCS', `Failed to download ${file.name}: ${fileResponse.status}`, errorText)
            }
          } catch (error) {
            logger.error('GCS', `Error processing file ${file.name}:`, error)
          }
        }
      }
      
      logger.timeEnd('GCS', 'fetch-logs')
      logger.info('GCS', `Finished processing${isUnlimited ? ' (UNLIMITED MODE)' : ''}. Files: ${totalProcessedFiles}, Log entries: ${totalLogEntries}`)
      
      if (totalLogEntries === 0) {
        logger.warn('GCS', 'Warning: No data rows generated (only headers)')
        logger.warn('GCS', 'Check your date folder and file naming pattern')
      }
      
      return csvRows.join('\n')
    } catch (error) {
      logger.error('GCS', 'Error in fetchLogs:', error)
      throw error
    }
  }

  private async createJWT(): Promise<string> {
    try {
      // Validate private key format before processing
      if (!this.config.privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        throw new Error('Private key must include -----BEGIN PRIVATE KEY----- header. Please check your private key format.')
      }

      if (!this.config.privateKey.includes('-----END PRIVATE KEY-----')) {
        throw new Error('Private key must include -----END PRIVATE KEY----- footer. Please check your private key format.')
      }

      const now = Math.floor(Date.now() / 1000)
      const payload = {
        iss: this.config.clientEmail,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      }

      const cleanedKey = this.config.privateKey
        .replace(/\\n/g, '\n')
        .replace(/^"/, '')
        .replace(/"$/, '')

      const privateKey = await importPKCS8(cleanedKey, 'RS256')
      
      const jwt = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey)

      return jwt
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Private key must include')) {
          throw error // Re-throw our specific validation errors
        } else if (error.message.includes('Invalid key') || error.message.includes('key import')) {
          throw new Error('Invalid private key format. Please ensure you have copied the complete private key including headers and footers.')
        } else {
          throw new Error(`Private key error: ${error.message}`)
        }
      }
      throw error
    }
  }

  private async exchangeJWTForAccessToken(jwt: string): Promise<string> {
    console.log('[GCS] Calling OAuth2 token endpoint...')
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })

    console.log(`[GCS] OAuth2 response status: ${response.status}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[GCS] OAuth2 error:', errorText)
      
      try {
        const errorData = JSON.parse(errorText)
        
        // Handle specific OAuth errors with user-friendly messages
        if (errorData.error === 'invalid_grant') {
          if (errorData.error_description?.includes('Invalid JWT')) {
            throw new Error('Invalid credentials: JWT authentication failed. Check your private key and client email.')
          } else if (errorData.error_description?.includes('email')) {
            throw new Error('Invalid client email: Service account email is incorrect or not found.')  
          } else {
            throw new Error('Invalid credentials: Authentication failed. Please verify your service account credentials.')
          }
        } else if (errorData.error === 'invalid_client') {
          throw new Error('Invalid client email: Service account not found or disabled.')
        } else if (errorData.error === 'unauthorized_client') {
          throw new Error('Access denied: Service account is not authorized. Check your service account permissions.')
        } else {
          throw new Error(`Authentication failed: ${errorData.error} - ${errorData.error_description || 'Unknown error'}`)
        }
      } catch (parseError) {
        // If we can't parse the JSON error response, fall back to generic message
        throw new Error(`Authentication failed: ${response.status} - ${errorText}`)
      }
    }

    const data = await response.json()
    console.log('[GCS] OAuth2 token exchange successful')
    return data.access_token
  }

  private buildDateFolders(startDate: string, endDate: string): string[] {
    console.log(`[GCS] 🏗️  Building date folders from: "${startDate}" to "${endDate}"`)
    
    const folders: string[] = []
    
    // Parse start and end dates
    const [startYear, startMonth, startDay] = startDate.split('/').map(Number)
    const [endYear, endMonth, endDay] = endDate.split('/').map(Number)
    
    const start = new Date(startYear, startMonth - 1, startDay) // Month is 0-indexed
    const end = new Date(endYear, endMonth - 1, endDay)
    
    // Generate all dates in the range
    const currentDate = new Date(start)
    while (currentDate <= end) {
      const year = currentDate.getFullYear()
      const month = String(currentDate.getMonth() + 1).padStart(2, '0')
      const day = String(currentDate.getDate()).padStart(2, '0')
      
      const folderPath = `${year}/${month}/${day}/`
      folders.push(folderPath)
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1)
    }
    
    console.log(`[GCS] 📅 Built ${folders.length} date folders:`, folders)
    
    return folders
  }

  private generateRecentDateFolders(): string[] {
    // Generate just the most recent date folder for quick analysis 
    const folders: string[] = []
    const today = new Date()
    
    // Just get yesterday's folder (most likely to have complete logs)
    const date = new Date(today)
    date.setDate(today.getDate() - 1)
    
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    
    folders.push(`${year}/${month}/${day}/`)
    
    return folders
  }

  private getLogTypeFromFileName(fileName: string): string | null {
    console.log(`[GCS] 🔍 Analyzing filename: "${fileName}"`)
    
    // Extract log type from filename pattern: {storeHash}.{logType}.{timestamp}.gz
    // Examples: abc123.api_access.1234.gz, abc123.store_access.4567.gz
    const parts = fileName.split('.')
    
    if (parts.length >= 3) {
      const logType = parts[1] // Second part should be the log type
      console.log(`[GCS] 📝 Detected log type: "${logType}" from filename`)
      
      // Validate that it's one of our expected log types
      const validTypes = ['api_access', 'store_access', 'audit']
      if (validTypes.includes(logType)) {
        return logType
      }
    }
    
    console.log(`[GCS] ⚠️  Could not detect valid log type from filename: "${fileName}"`)
    return null
  }

  private shouldProcessFile(fileName: string, requestedLogType: string): boolean {
    const detectedType = this.getLogTypeFromFileName(fileName)
    
    if (!detectedType) {
      console.log(`[GCS] ❌ Skipping file (no valid log type): ${fileName}`)
      return false
    }
    
    if (requestedLogType === 'all') {
      console.log(`[GCS] ✅ Processing file (all types requested): ${fileName}`)
      return true
    }
    
    if (detectedType === requestedLogType) {
      console.log(`[GCS] ✅ Processing file (type match): ${fileName}`)
      return true
    }
    
    console.log(`[GCS] ⏭️  Skipping file (type mismatch - want: ${requestedLogType}, got: ${detectedType}): ${fileName}`)
    return false
  }

  private async decompressGzipContent(compressedData: ArrayBuffer): Promise<string> {
    try {
      // Use Node.js zlib to decompress gzip data
      const zlib = await import('zlib')
      const { promisify } = await import('util')
      const gunzip = promisify(zlib.gunzip)
      
      const uint8Array = new Uint8Array(compressedData)
      const decompressed = await gunzip(uint8Array)
      
      return decompressed.toString('utf-8')
    } catch (error) {
      console.error('[GCS] ❌ Error decompressing gzip data:', error)
      throw new Error(`Failed to decompress gzip file: ${error}`)
    }
  }

  private parseLogContent(content: string, logType: string): string[] {
    console.log(`[GCS] 🔍 Parsing JSONL content for log type: ${logType}`)
    
    // Clean and split content into individual JSON lines
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && line.startsWith('{') && line.endsWith('}'))
    
    console.log(`[GCS] 📄 Found ${lines.length} valid JSON lines to parse`)
    
    const headers = this.getHeaders(logType)
    const csvRows: string[] = []
    let successCount = 0
    let errorCount = 0
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      
      try {
        const logEntry = JSON.parse(line)
        successCount++
        
        // Log progress for every 10 entries or first 3
        if (i < 3 || (i + 1) % 10 === 0) {
          console.log(`[GCS] ✅ Parsed JSON entry ${i + 1}/${lines.length}`)
        }
        
        // Extract values based on headers for this log type
        const values = headers.map(header => {
          const value = this.getNestedValue(logEntry, header)
          // Handle different data types and ensure CSV safety
          if (value === null || value === undefined) {
            return ''
          } else if (typeof value === 'string') {
            // Escape commas and quotes in CSV values, and handle newlines
            const cleanValue = value.replace(/[\r\n]/g, ' ').trim()
            return cleanValue.includes(',') || cleanValue.includes('"') ? 
              `"${cleanValue.replace(/"/g, '""')}"` : cleanValue
          } else if (typeof value === 'number') {
            return String(value)
          } else if (typeof value === 'boolean') {
            return String(value)
          } else {
            // For objects/arrays, stringify them
            return JSON.stringify(value).replace(/"/g, '""')
          }
        })
        
        csvRows.push(values.join(','))
        
        // Log sample data for first few entries
        if (i < 3) {
          console.log(`[GCS] 📝 Sample row ${i + 1}:`, values.slice(0, 3).join(' | '), '...')
        }
        
      } catch (parseError) {
        errorCount++
        // Only log first few errors to avoid spam
        if (errorCount <= 3) {
          console.error(`[GCS] ❌ Failed to parse JSON line ${i + 1}: ${parseError}`)
          console.log(`[GCS] 📋 Problematic line (first 150 chars): ${line.substring(0, 150)}...`)
        } else if (errorCount === 4) {
          console.log(`[GCS] ⚠️  Suppressing further parse errors (${errorCount} total so far)...`)
        }
        // Skip invalid JSON lines but continue processing
        continue
      }
    }
    
    console.log(`[GCS] 🏁 JSONL parsing complete: ${successCount} success, ${errorCount} errors`)
    console.log(`[GCS] 📊 Generated ${csvRows.length} CSV rows from ${lines.length} input lines`)
    
    return csvRows
  }

  private getNestedValue(obj: any, path: string): any {
    try {
      // Handle nested object paths like "auditLogEvent.auditLogEntry.sysLogMessage"
      let value = path.split('.').reduce((current, key) => {
        if (current === null || current === undefined) {
          return null
        }
        return current[key]
      }, obj)
      
      // Post-process specific fields for better readability
      if (value !== null && value !== undefined) {
        // Convert Unix timestamps to readable format
        if (path.includes('auditLogEntry.logDate') && typeof value === 'string') {
          const timestamp = parseInt(value)
          if (!isNaN(timestamp) && timestamp > 0) {
            value = new Date(timestamp * 1000).toISOString()
          }
        }
        
        // Clean up sysLogMessage by removing escape characters and formatting
        if (path.includes('auditLogEntry.sysLogMessage') && typeof value === 'string') {
          // Remove excessive escape characters and clean up the message
          value = value
            .replace(/\\n/g, ' ')  // Replace \n with spaces
            .replace(/\\r/g, ' ')  // Replace \r with spaces
            .replace(/\\t/g, ' ')  // Replace \t with spaces
            .replace(/\\\\/g, '\\') // Fix double backslashes
            .replace(/\\"/g, '"')   // Fix escaped quotes
            .trim()
          
          // If it looks like JSON, try to format it nicely (but keep it as a string)
          if (value.includes('{"') || value.includes('"{')) {
            try {
              // Try to extract and clean JSON-like content
              const jsonMatch = value.match(/\{.*\}/)
              if (jsonMatch) {
                const jsonStr = jsonMatch[0]
                const parsed = JSON.parse(jsonStr)
                // Keep the prefix and replace the JSON part with clean version
                const prefix = value.substring(0, value.indexOf(jsonStr))
                value = prefix + JSON.stringify(parsed)
              }
            } catch {
              // If JSON parsing fails, keep the cleaned string as is
            }
          }
        }
        
        // Clean up other string fields by removing escape characters
        if (typeof value === 'string' && !path.includes('sysLogMessage')) {
          value = value
            .replace(/\\n/g, ' ')
            .replace(/\\r/g, ' ')
            .replace(/\\t/g, ' ')
            .trim()
        }
      }
      
      // Reduced debug logging - only for complex audit log paths
      if (path.includes('auditLogEvent') && Math.random() < 0.02) {
        console.log(`[GCS] 🔎 Audit extraction "${path}": ${JSON.stringify(value).substring(0, 50)}...`)
      }
      
      return value
    } catch (error) {
      console.error(`[GCS] ❌ Error extracting path "${path}":`, error)
      return null
    }
  }

  private getHeaders(logType: string): string[] {
    // Updated headers to match your exact specifications
    const headers = {
      api_access: [
        "@timestamp",
        "storeHash", 
        "requestMethod",
        "requestUri",
        "status",
        "authClient",
        "httpUserAgent",
        "requestId",
        "remoteAddr",
        "geoipCountryCode",
        "geoipAsn",
        "sslProtocol",
        "responseTime",
        "requestTime"
      ],
      store_access: [
        "@timestamp",
        "storeHash",
        "requestMethod", 
        "requestUri",
        "status",
        "httpReferer",
        "httpUserAgent",
        "requestId",
        "remoteAddr",
        "geoipCountryCode",
        "geoipAsn",
        "sslProtocol",
        "responseTime",
        "requestTime",
        "serverName"
      ],
      audit: [
        "@timestamp",
        "auditLogEvent.publishedAt",
        "auditLogEvent.summary",
        "auditLogEvent.operationType",
        "auditLogEvent.context.serviceName",
        "auditLogEvent.context.ipAddress",
        "auditLogEvent.context.requestId",
        "auditLogEvent.context.principal.type",
        "auditLogEvent.context.principal.id",
        "auditLogEvent.resource.type",
        "auditLogEvent.resource.id",
        "auditLogEvent.target.type",
        "auditLogEvent.target.id",
        "auditLogEvent.auditLogEntry.staffUserName",
        "auditLogEvent.auditLogEntry.logDate",
        "auditLogEvent.auditLogEntry.ipAddress",
        "auditLogEvent.auditLogEntry.sysLogMessage",
        "auditLogEvent.auditLogEntry.state",
        "auditLogEvent.auditLogEntry.country",
        "auditLogEvent.auditLogEntry.addressId"
      ]
    }
    
    const result = headers[logType as keyof typeof headers] || []
    console.log(`[GCS] 📋 Using headers for ${logType}:`, result)
    return result
  }
} 