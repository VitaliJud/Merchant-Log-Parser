import { NextRequest, NextResponse } from 'next/server'
import { GCSService } from '@/lib/services/gcs-service'

interface TestGCSRequest {
  clientEmail: string
  privateKey: string
  bucketName: string
  prefix?: string // Optional prefix to test specific folder structures
}

export async function POST(request: NextRequest) {
  console.log('[TEST-GCS] Test endpoint called')
  
  try {
    const body: TestGCSRequest = await request.json()
    const { clientEmail, privateKey, bucketName, prefix = '' } = body

    console.log(`[TEST-GCS] Testing bucket: ${bucketName} with prefix: "${prefix}"`)

    if (!clientEmail || !privateKey || !bucketName) {
      return NextResponse.json(
        { error: 'clientEmail, privateKey, and bucketName are required' },
        { status: 400 }
      )
    }

    const gcsService = new GCSService({
      clientEmail,
      privateKey,
      bucketName,
    })

    // Test authentication
    console.log('[TEST-GCS] Testing authentication...')
    const accessToken = await gcsService.getAccessToken()
    console.log('[TEST-GCS] Authentication successful!')

    // Test listing objects with the given prefix (or root if no prefix)
    const listUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o?prefix=${encodeURIComponent(prefix)}&maxResults=10`
    console.log(`[TEST-GCS] Listing objects: ${listUrl}`)

    const response = await fetch(listUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GCS API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const items = data.items || []
    const prefixes = data.prefixes || []

    console.log(`[TEST-GCS] Found ${items.length} files and ${prefixes.length} folders`)

    // Analyze filenames for log type patterns
    const filenamePatterns = items.slice(0, 10).map((item: any) => {
      const fileName = item.name.split('/').pop() || item.name
      const parts = fileName.split('.')
      return {
        fullPath: item.name,
        filename: fileName,
        nameParts: parts,
        possibleLogType: parts.length >= 3 ? parts[1] : 'unknown',
        isCompressed: fileName.endsWith('.gz')
      }
    })

    const detectedLogTypes = [...new Set(
      filenamePatterns
        .map((p: any) => p.possibleLogType)
        .filter((type: string) => ['api_access', 'store_access', 'audit'].includes(type))
    )]

    // Return detailed information about what we found
    return NextResponse.json({
      success: true,
      bucketName,
      prefix: prefix || '(root)',
      totalFiles: items.length,
      totalFolders: prefixes.length,
      sampleFiles: items.slice(0, 5).map((item: any) => ({
        name: item.name,
        size: item.size,
        updated: item.updated
      })),
      folders: prefixes,
      // Show file structure analysis
      fileStructureAnalysis: {
        sampleFilenames: filenamePatterns,
        detectedLogTypes,
        compressionUsed: filenamePatterns.some((p: any) => p.isCompressed),
        filenamePattern: filenamePatterns.length > 0 ? 
          `${filenamePatterns[0].nameParts.length >= 3 ? '{storeHash}.{logType}.{timestamp}' : 'unknown'}.gz` : 
          'no files found'
      },
      // Show folder structure hints
      folderStructureHints: items.slice(0, 10).map((item: any) => {
        const parts = item.name.split('/')
        return {
          fullPath: item.name,
          depth: parts.length,
          folders: parts.slice(0, -1),
          filename: parts[parts.length - 1],
          datePattern: parts.length >= 3 ? `${parts[0]}/${parts[1]}/${parts[2]}` : 'not date-based'
        }
      }),
      suggestedDatePrefixes: [
        // Date-based folder structures (YYYY/MM/DD format)
        '2024/01/01/',
        '2024/01/02/',
        '2024/01/15/',
        '2024/02/01/',
        '2024/03/01/',
        '2023/12/01/',
        '2023/11/01/',
        '2023/10/01/',
      ],
      recommendations: {
        folderStructure: 'Based on your setup, use YYYY/MM/DD/ format',
        filenamePattern: detectedLogTypes.length > 0 ? 
          `Files follow pattern: {storeHash}.{${detectedLogTypes.join('|')}}.{timestamp}.gz` :
          'Check filename patterns manually',
        nextSteps: [
          '1. Try exporting with a specific date (YYYY/MM/DD format)',
          '2. Make sure your date range includes days with actual log files',
          '3. Check that your files follow the {storeHash}.{logType}.{timestamp}.gz pattern'
        ]
      }
    })

  } catch (error) {
    console.error('[TEST-GCS] Error:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        suggestion: 'Check your credentials and bucket name. Make sure the service account has Storage Object Viewer permissions.'
      },
      { status: 500 }
    )
  }
} 