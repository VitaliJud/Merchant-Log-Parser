import { SignJWT, importPKCS8 } from 'jose'

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
    console.log('[GCS] Creating JWT...')
    const jwt = await this.createJWT()
    console.log('[GCS] JWT created, exchanging for access token...')
    const accessToken = await this.exchangeJWTForAccessToken(jwt)
    console.log('[GCS] Access token obtained')
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
    console.log(`[GCS] 🔍 Starting optimized bucket analysis for: ${this.config.bucketName}`)
    
    const accessToken = await this.getAccessToken()
    console.log(`[GCS] ✅ Authentication successful`)
    
    // Generate recent date folders to check
    const recentDateFolders = this.generateRecentDateFolders()
    console.log(`[GCS] 📅 Will check ${recentDateFolders.length} recent date folders for folder existence`)

    const activeDates: string[] = []

    // Efficiently check which date folders have files (minimal API calls)
    for (const folder of recentDateFolders) {
      console.log(`[GCS] 🔍 Checking if folder has files: ${folder}`)
      
      // Just check if folder has any files (maxResults=1 for efficiency)
      const filesResponse = await fetch(
        `https://storage.googleapis.com/storage/v1/b/${this.config.bucketName}/o?prefix=${encodeURIComponent(folder)}&maxResults=1`,
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
          const dateStr = folder.replace(/\//g, '-').slice(0, -1) // Convert "2024/01/01/" to "2024-01-01"
          activeDates.push(dateStr)
          console.log(`[GCS] ✅ Found files in ${folder}`)
        }
      } else {
        console.log(`[GCS] ⚠️  No access to folder ${folder} or folder doesn't exist`)
      }
    }

    console.log(`[GCS] 📊 Analysis summary: Found ${activeDates.length} active date folders`)

    // Calculate date range
    const earliestDate = activeDates.sort()[0]
    const latestDate = activeDates.sort().reverse()[0]
    const availableDateRange = earliestDate && latestDate ? 
      (earliestDate === latestDate ? latestDate : `${earliestDate} to ${latestDate}`) : 
      'No recent dates found'

    console.log(`[GCS] 📊 Analysis complete: ${activeDates.length} active folders found`)

    // Return minimal data since UI doesn't need file type analysis anymore
    return {
      connected: true,
      folderCount: activeDates.length, // Number of date folders with actual files  
      fileTypeAnalysis: {
        api_access: 0,
        store_access: 0,
        audit: 0,
        other: 0,
        total: 0,
        note: 'File type analysis skipped for performance - optimized for folder count only'
      },
      recentDates: activeDates.slice(0, 10),
      sampleFiles: [],
      recommendations: {
        suggestedLimit: 20, // Simple default
        availableDateRange,
        totalLogFiles: 0,
        analysisNote: `Found ${activeDates.length} active date folders. File sampling skipped for performance.`
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
    console.log(`\n[GCS] 📥 Starting log fetch for type: ${logType}, dates: ${startDate} to ${endDate}, limit: ${limit}${isUnlimited ? ' (UNLIMITED)' : ''}`)
    
    try {
      console.log('[GCS] 🔐 Getting access token...')
      const accessToken = await this.getAccessToken()
      console.log('[GCS] ✅ Access token obtained successfully')
      
      // Build date folders to search (YYYY/MM/DD format)
      const dateFolders = this.buildDateFolders(startDate, endDate)
      console.log(`[GCS] 📁 Will search ${dateFolders.length} date folder(s)`)
      
      const headers = this.getHeaders(logType === 'all' ? 'api_access' : logType) // Use first type for headers
      const csvRows = [headers.join(',')]
      let totalProcessedFiles = 0
      let totalLogEntries = 0
      
      // Process each date folder
      for (const folderPath of dateFolders) {
        console.log(`[GCS] 📂 Fetching files from folder: "${folderPath}"`)
        
        const listUrl = `https://storage.googleapis.com/storage/v1/b/${this.config.bucketName}/o?prefix=${encodeURIComponent(folderPath)}&maxResults=1000`
        console.log(`[GCS] 🔍 Listing objects from: ${listUrl}`)
        
        const response = await fetch(listUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        console.log(`[GCS] 📡 List response status: ${response.status}`)

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`[GCS] List error for folder ${folderPath}:`, errorText)
          continue // Skip this folder and try the next one
        }

        const data = await response.json()
        const allFiles = data.items || []
        console.log(`[GCS] 📋 Found ${allFiles.length} total files in ${folderPath}`)
        
        if (allFiles.length === 0) {
          console.warn(`[GCS] ⚠️  No files found in folder: "${folderPath}"`)
          continue
        }
        
        // Filter files by log type based on filename
        const relevantFiles = allFiles.filter((file: any) => 
          this.shouldProcessFile(file.name, logType)
        )
        
        console.log(`[GCS] 🎯 Filtered to ${relevantFiles.length} relevant files for log type: ${logType}`)
        
        if (relevantFiles.length > 0) {
          console.log('[GCS] 📄 Relevant files found:')
          relevantFiles.slice(0, 5).forEach((file: any, index: number) => {
            console.log(`  ${index + 1}. ${file.name} (${file.size} bytes)`)
          })
        }
        
        // Process the filtered files
        if (!isUnlimited) {
          const remainingLimit = limit - totalLogEntries
          if (remainingLimit <= 0) {
            console.log(`[GCS] 🔢 Reached limit of ${limit} entries, stopping`)
            break
          }
        }
        
        const filesToProcess = isUnlimited 
          ? relevantFiles 
          : relevantFiles.slice(0, Math.min(relevantFiles.length, limit - totalLogEntries))
        
        for (const file of filesToProcess) {
          if (!isUnlimited && totalLogEntries >= limit) break
          
          console.log(`[GCS] 🔄 Processing file: ${file.name}`)
          
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
               
               console.log(`[GCS] 📋 Content-Type: ${contentType}`)
               
               // Check if file appears to be compressed based on name and content-type
               if (file.name.endsWith('.gz')) {
                 if (contentType.includes('text/plain') || contentType.includes('application/json')) {
                   console.log(`[GCS] 💡 File has .gz extension but content-type is ${contentType}, reading as plain text`)
                   logContent = await fileResponse.text()
                   console.log(`[GCS] 📥 Read as plain text: ${logContent.length} characters`)
                 } else {
                   console.log(`[GCS] 🗜️  Attempting to decompress .gz file: ${file.name}`)
                   try {
                     const compressedData = await fileResponse.arrayBuffer()
                     logContent = await this.decompressGzipContent(compressedData)
                     console.log(`[GCS] ✅ Successfully decompressed to ${logContent.length} characters`)
                   } catch (gzipError) {
                     console.log(`[GCS] ⚠️  Gzip decompression failed, trying as plain text: ${gzipError}`)
                     // Reset response and try as plain text
                     const textResponse = await fetch(downloadUrl, {
                       headers: { 'Authorization': `Bearer ${accessToken}` }
                     })
                     logContent = await textResponse.text()
                     console.log(`[GCS] 📥 Fallback: Read as plain text: ${logContent.length} characters`)
                   }
                 }
               } else {
                 logContent = await fileResponse.text()
                 console.log(`[GCS] 📥 Downloaded ${logContent.length} characters from ${file.name}`)
               }
               
               // Show a sample of the content for debugging
               const contentSample = logContent.substring(0, 200).replace(/\n/g, '\\n')
               console.log(`[GCS] 👀 Content sample: ${contentSample}...`)
               
               // Detect the actual log type for this file
               const fileLogType = this.getLogTypeFromFileName(file.name) || logType
               console.log(`[GCS] 🏷️  Processing as log type: ${fileLogType}`)
               
                             const logLines = this.parseLogContent(logContent, fileLogType)
              console.log(`[GCS] 📝 Parsed ${logLines.length} log lines from ${file.name}`)
             
             const linesToAdd = isUnlimited 
               ? logLines 
               : logLines.slice(0, limit - totalLogEntries)
             csvRows.push(...linesToAdd)
             totalLogEntries += linesToAdd.length
             totalProcessedFiles++
             
             console.log(`[GCS] ✅ Added ${linesToAdd.length} lines to CSV. Total entries: ${totalLogEntries}`)
             
             if (!isUnlimited && totalLogEntries >= limit) {
               console.log(`[GCS] 🔢 Reached limit of ${limit} entries`)
               break
             }
            } else {
              const errorText = await fileResponse.text()
              console.error(`[GCS] ❌ Failed to download ${file.name}: ${fileResponse.status} - ${errorText}`)
            }
          } catch (error) {
            console.error(`[GCS] ❌ Error processing file ${file.name}:`, error)
          }
        }
      }
      
      console.log(`[GCS] 🏁 Finished processing${isUnlimited ? ' (UNLIMITED MODE)' : ''}. Files: ${totalProcessedFiles}, Log entries: ${totalLogEntries}`)
      
      if (totalLogEntries === 0) {
        console.warn('[GCS] ⚠️  Warning: No data rows generated (only headers)')
        console.log('[GCS] 💡 Check your date folder and file naming pattern')
      }
      
      return csvRows.join('\n')
    } catch (error) {
      console.error('[GCS] ❌ Error in fetchLogs:', error)
      throw error
    }
  }

  private async createJWT(): Promise<string> {
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
      throw new Error(`Failed to get access token: ${response.status} - ${errorText}`)
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
    // Generate the last 15 days of date folders for analysis (matching 14-day retention + 1 buffer)
    const folders: string[] = []
    const today = new Date()
    
    for (let i = 0; i < 15; i++) {
      const date = new Date(today)
      date.setDate(today.getDate() - i)
      
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      
      folders.push(`${year}/${month}/${day}/`)
    }
    
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