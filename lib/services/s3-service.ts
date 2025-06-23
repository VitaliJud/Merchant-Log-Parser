export interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  region: string
}

export class S3Service {
  private config: S3Config

  constructor(config: S3Config) {
    this.config = config
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
    console.log(`[S3] 🔍 Starting bucket analysis for: ${this.config.bucketName}`)
    
    // Validate bucket access by listing objects in the most recent date folder
    console.log(`[S3] 🪣 Validating bucket access by listing objects...`)
    
    // Generate just the most recent date folder to check
    const recentDateFolders = this.generateRecentDateFolders()
    const mostRecentFolder = recentDateFolders[0]
    console.log(`[S3] 📅 Checking most recent date folder: ${mostRecentFolder}`)

    const activeDates: string[] = []

    try {
      // Check if the most recent folder has files
      console.log(`[S3] 🔍 Checking if folder has files: ${mostRecentFolder}`)
      
      const listUrl = this.buildS3Url('', mostRecentFolder, 1)
      const headers = await this.createSignedHeaders('GET', listUrl, mostRecentFolder)
      
      const filesResponse = await fetch(listUrl, {
        method: 'GET',
        headers,
      })

      if (filesResponse.ok) {
        const xmlText = await filesResponse.text()
        console.log(`[S3] 📡 List response received, parsing XML...`)
        
        const files = this.parseS3ListResponse(xmlText)
        console.log(`[S3] 📋 Found ${files.length} files in ${mostRecentFolder}`)
        
        // Only add to dates if we found at least one file
        if (files.length > 0) {
          const dateStr = mostRecentFolder.replace(/\//g, '-').slice(0, -1) // Convert "2025/06/22/" to "2025-06-22"
          activeDates.push(dateStr)
          console.log(`[S3] ✅ Found files in ${mostRecentFolder}`)
        } else {
          console.log(`[S3] ⚠️  No files found in most recent folder: ${mostRecentFolder}`)
        }
        
        console.log(`[S3] ✅ Bucket access validated successfully`)
      } else {
        // Handle bucket access errors with specific error messages
        const errorText = await filesResponse.text().catch(() => 'Unknown error')
        console.error(`[S3] ❌ Bucket access validation failed: ${filesResponse.status} - ${errorText}`)
        
        if (filesResponse.status === 404) {
          throw new Error(`Bucket "${this.config.bucketName}" not found. Please check the bucket name.`)
        } else if (filesResponse.status === 403) {
          throw new Error(`Access denied to bucket "${this.config.bucketName}". Check your AWS credentials and permissions.`)
        } else {
          throw new Error(`Bucket access failed: ${filesResponse.status} ${filesResponse.statusText}`)
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Bucket')) {
        throw error // Re-throw our specific bucket errors
      }
      throw new Error(`S3 bucket analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    console.log(`[S3] 📊 Analysis summary: ${activeDates.length > 0 ? 'Found' : 'No'} files in most recent date folder`)

    // Simple date range (just the one folder we checked)
    const availableDateRange = activeDates.length > 0 ? activeDates[0] : 'No recent files found'

    console.log(`[S3] 📊 Analysis complete: Bucket access confirmed, ${activeDates.length > 0 ? 'files found' : 'no files found'}`)

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
    console.log(`\n[S3] 📥 Starting log fetch for type: ${logType}, dates: ${startDate} to ${endDate}, limit: ${limit}${isUnlimited ? ' (UNLIMITED)' : ''}`)
    
    try {
      console.log('[S3] 🔐 Preparing AWS authentication...')
      
      // Build date folders to search (YYYY/MM/DD format)
      const dateFolders = this.buildDateFolders(startDate, endDate)
      console.log(`[S3] 📁 Will search ${dateFolders.length} date folder(s)`)
      
      const headers = this.getHeaders(logType === 'all' ? 'api_access' : logType)
      const csvRows = [headers.join(',')]
      let totalProcessedFiles = 0
      let totalLogEntries = 0
      
      // Process each date folder
      for (const folderPath of dateFolders) {
        console.log(`[S3] 📂 Fetching files from folder: "${folderPath}"`)
        
        try {
          const listUrl = this.buildS3Url('', folderPath, 1000)
          const listHeaders = await this.createSignedHeaders('GET', listUrl, folderPath)
          
          const response = await fetch(listUrl, {
            method: 'GET',
            headers: listHeaders,
          })

          console.log(`[S3] 📡 List response status: ${response.status}`)

          if (!response.ok) {
            const errorText = await response.text()
            console.error(`[S3] List error for folder ${folderPath}: ${response.status} - ${errorText}`)
            continue // Skip this folder and try the next one
          }

          const xmlText = await response.text()
          const allFiles = this.parseS3ListResponse(xmlText)
          console.log(`[S3] 📋 Found ${allFiles.length} total files in ${folderPath}`)
          
          if (allFiles.length === 0) {
            console.warn(`[S3] ⚠️  No files found in folder: "${folderPath}"`)
            continue
          }
          
          // Filter files by log type based on filename
          const relevantFiles = allFiles.filter((file: any) => 
            this.shouldProcessFile(file.Key, logType)
          )
          
          console.log(`[S3] 🎯 Filtered to ${relevantFiles.length} relevant files for log type: ${logType}`)
          
          if (relevantFiles.length > 0) {
            console.log('[S3] 📄 Relevant files found:')
            relevantFiles.slice(0, 5).forEach((file: any, index: number) => {
              console.log(`  ${index + 1}. ${file.Key} (${file.Size} bytes)`)
            })
          }
          
          // Process the filtered files
          if (!isUnlimited) {
            const remainingLimit = limit - totalLogEntries
            if (remainingLimit <= 0) {
              console.log(`[S3] 🔢 Reached limit of ${limit} entries, stopping`)
              break
            }
          }
          
          const filesToProcess = isUnlimited 
            ? relevantFiles 
            : relevantFiles.slice(0, Math.min(relevantFiles.length, limit - totalLogEntries))
          
          for (const file of filesToProcess) {
            if (!isUnlimited && totalLogEntries >= limit) break
            
            console.log(`[S3] 🔄 Processing file: ${file.Key}`)
            
            try {
              const fileUrl = this.buildS3Url(file.Key)
              const fileHeaders = await this.createSignedHeaders('GET', fileUrl)
              
              const fileResponse = await fetch(fileUrl, {
                method: 'GET',
                headers: fileHeaders,
              })
              
              if (fileResponse.ok) {
                let logContent: string
                
                // Handle compressed files
                if (file.Key.endsWith('.gz')) {
                  console.log(`[S3] 🗜️  Decompressing .gz file: ${file.Key}`)
                  try {
                    const compressedData = await fileResponse.arrayBuffer()
                    logContent = await this.decompressGzipContent(compressedData)
                    console.log(`[S3] ✅ Successfully decompressed to ${logContent.length} characters`)
                  } catch (gzipError) {
                    console.log(`[S3] ⚠️  Gzip decompression failed, trying as plain text: ${gzipError}`)
                    const textResponse = await fetch(fileUrl, {
                      method: 'GET',
                      headers: fileHeaders,
                    })
                    logContent = await textResponse.text()
                    console.log(`[S3] 📥 Fallback: Read as plain text: ${logContent.length} characters`)
                  }
                } else {
                  logContent = await fileResponse.text()
                  console.log(`[S3] 📥 Downloaded ${logContent.length} characters from ${file.Key}`)
                }
                
                // Show a sample of the content for debugging
                const contentSample = logContent.substring(0, 200).replace(/\n/g, '\\n')
                console.log(`[S3] 👀 Content sample: ${contentSample}...`)
                
                // Detect the actual log type for this file
                const fileLogType = this.getLogTypeFromFileName(file.Key) || logType
                console.log(`[S3] 🏷️  Processing as log type: ${fileLogType}`)
                
                const logLines = this.parseLogContent(logContent, fileLogType)
                console.log(`[S3] 📝 Parsed ${logLines.length} log lines from ${file.Key}`)
               
                const linesToAdd = isUnlimited 
                  ? logLines 
                  : logLines.slice(0, limit - totalLogEntries)
                csvRows.push(...linesToAdd)
                totalLogEntries += linesToAdd.length
                totalProcessedFiles++
                
                console.log(`[S3] ✅ Added ${linesToAdd.length} lines to CSV. Total entries: ${totalLogEntries}`)
                
                if (!isUnlimited && totalLogEntries >= limit) {
                  console.log(`[S3] 🔢 Reached limit of ${limit} entries`)
                  break
                }
              } else {
                const errorText = await fileResponse.text()
                console.error(`[S3] ❌ Failed to download ${file.Key}: ${fileResponse.status} - ${errorText}`)
              }
            } catch (error) {
              console.error(`[S3] ❌ Error processing file ${file.Key}:`, error)
            }
          }
        } catch (error) {
          console.error(`[S3] ❌ Error processing folder ${folderPath}:`, error)
          continue
        }
      }
      
      console.log(`[S3] 🏁 Finished processing${isUnlimited ? ' (UNLIMITED MODE)' : ''}. Files: ${totalProcessedFiles}, Log entries: ${totalLogEntries}`)
      
      if (totalLogEntries === 0) {
        console.warn('[S3] ⚠️  Warning: No data rows generated (only headers)')
        console.log('[S3] 💡 Check your date folder and file naming pattern')
      }
      
      return csvRows.join('\n')
    } catch (error) {
      console.error('[S3] ❌ Error in fetchLogs:', error)
      throw error
    }
  }

  // AWS Signature V4 helper methods
  private async createSignedHeaders(method: string, url: string, prefix?: string): Promise<Record<string, string>> {
    const urlObj = new URL(url)
    const host = urlObj.hostname
    const path = urlObj.pathname
    
    // Parse and sort query parameters
    const queryParams = new URLSearchParams(urlObj.search)
    const sortedParams = new URLSearchParams()
    const paramNames = Array.from(queryParams.keys()).sort()
    for (const name of paramNames) {
      sortedParams.append(name, queryParams.get(name) || '')
    }
    const canonicalQueryString = sortedParams.toString()
    
    const now = new Date()
    const dateStamp = now.toISOString().substring(0, 10).replace(/-/g, '')
    const timeStamp = now.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z'
    
    // Calculate payload hash (empty string for GET requests)
    const payloadHash = await this.sha256('')
    
    // Create canonical headers (must be sorted alphabetically)
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timeStamp}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    
    const canonicalRequest = [
      method,
      path,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n')
    
    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256'
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`
    const stringToSign = [
      algorithm,
      timeStamp,
      credentialScope,
      await this.sha256(canonicalRequest)
    ].join('\n')
    
    // Calculate signature
    const signingKey = await this.getSignatureKey(this.config.secretAccessKey, dateStamp, this.config.region, 's3')
    const signature = await this.hmacSha256(signingKey, stringToSign)
    
    // Create authorization header
    const authorizationHeader = `${algorithm} Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    
    return {
      'Authorization': authorizationHeader,
      'x-amz-date': timeStamp,
      'x-amz-content-sha256': payloadHash
    }
  }

  private async sha256(message: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(message)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async hmacSha256(key: ArrayBuffer, message: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(message)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, data)
    const hashArray = Array.from(new Uint8Array(signature))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async hmacSha256Buffer(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    const data = encoder.encode(message)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    return await crypto.subtle.sign('HMAC', cryptoKey, data)
  }

  private async getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    
    // Step 1: kDate = HMAC("AWS4" + kSecret, Date)
    const secretKey = encoder.encode('AWS4' + key)
    let hmacKey = secretKey.buffer as ArrayBuffer
    let kDate = await this.hmacSha256Buffer(hmacKey, dateStamp)
    
    // Step 2: kRegion = HMAC(kDate, Region)  
    let kRegion = await this.hmacSha256Buffer(kDate, regionName)
    
    // Step 3: kService = HMAC(kRegion, Service)
    let kService = await this.hmacSha256Buffer(kRegion, serviceName)
    
    // Step 4: kSigning = HMAC(kService, "aws4_request")
    return await this.hmacSha256Buffer(kService, 'aws4_request')
  }

  private buildS3Url(key?: string, prefix?: string, maxKeys?: number): string {
    const baseUrl = `https://${this.config.bucketName}.s3.${this.config.region}.amazonaws.com`
    
    if (key) {
      // Direct file access
      return `${baseUrl}/${key}`
    } else {
      // List objects with prefix
      const params = new URLSearchParams()
      if (prefix) params.append('prefix', prefix)
      if (maxKeys) params.append('max-keys', maxKeys.toString())
      return `${baseUrl}?${params.toString()}`
    }
  }

  private parseS3ListResponse(xmlText: string): Array<{ Key: string; Size: number }> {
    const files: Array<{ Key: string; Size: number }> = []
    
    // Simple XML parsing for Contents elements
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g
    const matches = xmlText.match(contentsRegex)
    
    if (matches) {
      for (const match of matches) {
        const keyMatch = match.match(/<Key>(.*?)<\/Key>/)
        const sizeMatch = match.match(/<Size>(\d+)<\/Size>/)
        
        if (keyMatch && sizeMatch) {
          files.push({
            Key: keyMatch[1],
            Size: parseInt(sizeMatch[1], 10)
          })
        }
      }
    }
    
    return files
  }

  private buildDateFolders(startDate: string, endDate: string): string[] {
    console.log(`[S3] 🏗️  Building date folders from: "${startDate}" to "${endDate}"`)
    
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
    
    console.log(`[S3] 📅 Built ${folders.length} date folders:`, folders)
    
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
    console.log(`[S3] 🔍 Analyzing filename: "${fileName}"`)
    
    // Extract log type from filename pattern: {storeHash}.{logType}.{uuid}.{timestamp}.part{number}.json.gz
    // Example: tyaxw7ubhm.api_access.0dbd518a-c6eb-401a-be96-9482f595b803.2025-06-22T06.01.part0.json.gz
    const parts = fileName.split('.')
    
    if (parts.length >= 3) {
      const logType = parts[1] // Second part should be the log type
      console.log(`[S3] 📝 Detected log type: "${logType}" from filename`)
      
      // Validate that it's one of our expected log types
      const validTypes = ['api_access', 'store_access', 'audit']
      if (validTypes.includes(logType)) {
        return logType
      }
    }
    
    console.log(`[S3] ⚠️  Could not detect valid log type from filename: "${fileName}"`)
    return null
  }

  private shouldProcessFile(fileName: string, requestedLogType: string): boolean {
    const detectedType = this.getLogTypeFromFileName(fileName)
    
    if (!detectedType) {
      console.log(`[S3] ❌ Skipping file (no valid log type): ${fileName}`)
      return false
    }
    
    if (requestedLogType === 'all') {
      console.log(`[S3] ✅ Processing file (all types requested): ${fileName}`)
      return true
    }
    
    if (detectedType === requestedLogType) {
      console.log(`[S3] ✅ Processing file (type match): ${fileName}`)
      return true
    }
    
    console.log(`[S3] ⏭️  Skipping file (type mismatch - want: ${requestedLogType}, got: ${detectedType}): ${fileName}`)
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
      console.error('[S3] ❌ Error decompressing gzip data:', error)
      throw new Error(`Failed to decompress gzip file: ${error}`)
    }
  }

  private parseLogContent(content: string, logType: string): string[] {
    console.log(`[S3] 🔍 Parsing JSONL content for log type: ${logType}`)
    
    // Clean and split content into individual JSON lines
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && line.startsWith('{') && line.endsWith('}'))
    
    console.log(`[S3] 📄 Found ${lines.length} valid JSON lines to parse`)
    
    const headers = this.getHeaders(logType)
    const csvRows: string[] = []
    
    for (let i = 0; i < lines.length; i++) {
      try {
        const logEntry = JSON.parse(lines[i])
        const row = headers.map(header => {
          const value = this.getNestedValue(logEntry, header)
          
          // Handle different data types
          if (value === null || value === undefined) {
            return ''
          } else if (typeof value === 'string') {
            // Escape commas and quotes in CSV
            return value.includes(',') || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value
          } else if (typeof value === 'object') {
            // Convert objects to JSON string
            const jsonStr = JSON.stringify(value)
            return jsonStr.includes(',') || jsonStr.includes('"') ? `"${jsonStr.replace(/"/g, '""')}"` : jsonStr
          } else {
            return String(value)
          }
        })
        
        csvRows.push(row.join(','))
      } catch (error) {
        console.warn(`[S3] ⚠️  Failed to parse JSON line ${i + 1}: ${error}`)
        continue
      }
    }
    
    console.log(`[S3] ✅ Successfully converted ${csvRows.length} log entries to CSV format`)
    return csvRows
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      if (current && typeof current === 'object' && key in current) {
        return current[key]
      }
      return null
    }, obj)
  }

  private getHeaders(logType: string): string[] {
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
        "requestTime",
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
        "serverName",
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
        "auditLogEvent.auditLogEntry.addressId",
      ],
    }
    return headers[logType as keyof typeof headers] || []
  }
} 