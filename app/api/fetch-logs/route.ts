import { NextRequest, NextResponse } from 'next/server'
import { GCSService } from '@/lib/services/gcs-service'
import { S3Service } from '@/lib/services/s3-service'

interface FetchLogsRequest {
  bucketType: 'gcs' | 's3'
  logType: string
  startDate: string
  endDate: string
  limit: number
  clientEmail?: string
  privateKey?: string
  bucketName?: string
  accessKeyId?: string
  secretAccessKey?: string
  region?: string
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  console.log('\n' + '='.repeat(80))
  console.log('[API] 🚀 /api/fetch-logs POST request received')
  console.log('='.repeat(80))
  
  try {
    const body: FetchLogsRequest = await request.json()
    const { bucketType, logType, startDate, endDate, limit, bucketName } = body

    console.log(`[API] Request parameters:`, {
      bucketType,
      logType,
      startDate,
      endDate,
      limit,
      bucketName,
      clientEmail: body.clientEmail ? '***provided***' : 'missing',
      privateKey: body.privateKey ? '***provided***' : 'missing'
    })

    if (!bucketName) {
      return NextResponse.json(
        { error: 'Bucket name is required' },
        { status: 400 }
      )
    }

    let csvData = ''

    if (bucketType === 'gcs') {
      console.log('[API] Processing GCS request...')
      const { clientEmail, privateKey } = body
      if (!clientEmail || !privateKey) {
        return NextResponse.json(
          { error: 'GCS credentials are required' },
          { status: 400 }
        )
      }

      const gcsService = new GCSService({
        clientEmail,
        privateKey,
        bucketName,
      })
      
      console.log('[API] Calling GCS service...')
      csvData = await gcsService.fetchLogs(logType, startDate, endDate, limit)
      console.log(`[API] GCS service returned ${csvData.length} characters of CSV data`)
    } else if (bucketType === 's3') {
      console.log('[API] Processing S3 request...')
      const { accessKeyId, secretAccessKey, region } = body
      if (!accessKeyId || !secretAccessKey || !region) {
        return NextResponse.json(
          { error: 'AWS credentials are required' },
          { status: 400 }
        )
      }

      const s3Service = new S3Service({
        accessKeyId,
        secretAccessKey,
        bucketName,
        region,
      })
      
      console.log('[API] Calling S3 service...')
      csvData = await s3Service.fetchLogs(logType, startDate, endDate, limit)
      console.log(`[API] S3 service returned ${csvData.length} characters of CSV data`)
    } else {
      return NextResponse.json(
        { error: 'Invalid bucket type' },
        { status: 400 }
      )
    }

    const duration = Date.now() - startTime
    const lineCount = csvData.split('\n').length
    const hasData = lineCount > 1 // More than just headers
    
    console.log('\n' + '='.repeat(80))
    console.log(`[API] ✅ Request completed in ${duration}ms`)
    console.log(`[API] 📊 CSV Stats: ${lineCount} lines, ${csvData.length} characters`)
    console.log(`[API] ${hasData ? '✅ SUCCESS' : '⚠️  WARNING'}: ${hasData ? 'Data found and processed' : 'Only headers returned - no data found'}`)
    console.log('='.repeat(80))

    return new Response(csvData, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Length': csvData.length.toString(),
      },
    })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[API] Fetch logs error after ${duration}ms:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
}