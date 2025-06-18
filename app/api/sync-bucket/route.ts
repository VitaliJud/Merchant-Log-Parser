import { NextRequest, NextResponse } from 'next/server'
import { GCSService } from '@/lib/services/gcs-service'
import { S3Service } from '@/lib/services/s3-service'

interface SyncBucketRequest {
  bucketType: 'gcs' | 's3'
  clientEmail?: string
  privateKey?: string
  bucketName?: string
  accessKeyId?: string
  secretAccessKey?: string
  region?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: SyncBucketRequest = await request.json()
    const { bucketType, bucketName } = body

    if (!bucketName) {
      return NextResponse.json(
        { error: 'Bucket name is required' },
        { status: 400 }
      )
    }

    let folderCount = 0

    if (bucketType === 'gcs') {
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
      
      console.log('[API] 🔍 Starting comprehensive GCS bucket analysis...')
      const analysis = await gcsService.analyzeBucket()
      
      return NextResponse.json({
        success: true,
        connected: analysis.connected,
        bucketName,
        folderCount: analysis.folderCount,
        fileTypeAnalysis: analysis.fileTypeAnalysis,
        recentDates: analysis.recentDates,
        sampleFiles: analysis.sampleFiles,
        recommendations: analysis.recommendations,
        message: `Successfully connected to GCS bucket "${bucketName}"`,
        summary: {
          totalLogFiles: analysis.recommendations.totalLogFiles,
          availableDateRange: analysis.recommendations.availableDateRange,
          suggestedLimit: analysis.recommendations.suggestedLimit,
          fileTypeBreakdown: `API Access: ${analysis.fileTypeAnalysis.api_access}, Store Access: ${analysis.fileTypeAnalysis.store_access}, Audit: ${analysis.fileTypeAnalysis.audit}`
        }
      })
    } else if (bucketType === 's3') {
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
      
      console.log('[API] 🔍 Starting S3 bucket analysis...')
      const folderCount = await s3Service.listFolders()
      
      // Return simpler response for S3 (since it's not fully implemented yet)
      return NextResponse.json({
        success: true,
        connected: true,
        bucketName,
        folderCount,
        message: `Connected to S3 bucket "${bucketName}" (placeholder implementation)`,
        fileTypeAnalysis: {
          api_access: 0,
          store_access: 0,
          audit: 0,
          other: 0,
          total: 0
        },
        recommendations: {
          suggestedLimit: 20,
          availableDateRange: 'S3 analysis not yet implemented',
          totalLogFiles: 0
        },
        summary: {
          totalLogFiles: 0,
          availableDateRange: 'S3 analysis not yet implemented',
          suggestedLimit: 20,
          fileTypeBreakdown: 'S3 file type analysis coming soon'
        }
      })
    } else {
      return NextResponse.json(
        { error: 'Invalid bucket type' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Sync bucket error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
} 