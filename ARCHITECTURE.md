# Merchant Log Parser - Architecture Overview

## Project Structure

This Next.js application has been refactored to follow best practices with proper separation of concerns:

```
Merchant-Log-Parser/
├── app/
│   ├── api/                    # Next.js API Routes
│   │   ├── fetch-logs/         # Endpoint for fetching logs from cloud storage
│   │   └── sync-bucket/        # Endpoint for syncing/listing bucket folders
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/                 # UI Components
│   └── ui/                     # Reusable UI components
├── lib/
│   └── services/               # Business Logic Services
│       ├── gcs-service.ts      # Google Cloud Storage operations
│       └── s3-service.ts       # AWS S3 operations
├── hooks/                      # Custom React hooks
├── log-sync-form.tsx          # Main form component
└── package.json
```

## API Endpoints

### POST `/api/sync-bucket`

Syncs with cloud storage bucket and returns folder count.

**Request Body:**
```json
{
  "bucketType": "gcs" | "s3",
  "bucketName": "bucket-name",
  // For GCS:
  "clientEmail": "service-account@project.iam.gserviceaccount.com",
  "privateKey": "-----BEGIN PRIVATE KEY-----...",
  // For S3:
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG...",
  "region": "us-east-1"
}
```

**Response:**
```json
{
  "folderCount": 42
}
```

### POST `/api/fetch-logs`

Fetches logs from cloud storage and returns CSV data.

**Request Body:**
```json
{
  "bucketType": "gcs" | "s3",
  "logType": "api_access" | "store_access" | "audit" | "all",
  "startDate": "2023/01/01",
  "endDate": "2023/01/31",
  "limit": 20,
  "bucketName": "bucket-name",
  // Plus credentials (same as sync-bucket)
}
```

**Response:** Raw CSV data

## Services

### GCSService

Handles all Google Cloud Storage operations:
- JWT token creation for service account authentication
- OAuth2 token exchange
- Bucket listing and folder counting
- Log file retrieval and processing
- CSV generation from log data

**Key Features:**
- Uses `jose` library for JWT operations
- Proper error handling and authentication
- Configurable folder structure
- JSON log parsing with nested field support

### S3Service

Handles AWS S3 operations (currently simplified):
- Bucket listing (placeholder implementation)
- Log retrieval (sample data generation)
- Folder structure configuration

**Future Implementation:**
- Install `@aws-sdk/client-s3`
- Implement proper S3Client authentication
- Add real S3 API calls for listing and downloading

## Security Features

✅ **Backend-only cloud access** - No credentials exposed to browser
✅ **Proper authentication** - Service account JWT for GCS
✅ **Input validation** - API endpoints validate required fields
✅ **Error handling** - Meaningful error messages returned
✅ **Request cancellation** - Frontend supports aborting operations

## Current Implementation Status

### GCS Integration
- ✅ **Fully Functional** - Real GCS API calls
- ✅ **Authentication** - JWT-based service account auth
- ✅ **File Listing** - Real bucket object listing
- ✅ **Log Processing** - JSON log parsing and CSV conversion
- ✅ **Error Handling** - Proper GCS error responses

### S3 Integration
- ⚠️ **Placeholder** - Sample data generation only
- ❌ **Authentication** - Not implemented yet
- ❌ **File Listing** - Simulated response
- ❌ **Log Processing** - Sample data only

## Next Steps for S3 Implementation

1. **Install AWS SDK:**
   ```bash
   pnpm add @aws-sdk/client-s3
   ```

2. **Update S3Service to use real AWS SDK:**
   ```typescript
   import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
   ```

3. **Implement proper S3 authentication and operations**

## Usage

1. **Frontend Form** (`log-sync-form.tsx`) - Collects user credentials and preferences
2. **API Routes** - Handle cloud storage authentication and operations
3. **Services** - Encapsulate business logic for each cloud provider
4. **CSV Download** - Processed logs returned as downloadable CSV files

## Environment Variables

Consider adding environment variables for:
- Default bucket configurations
- API rate limiting
- Logging levels
- Cloud provider service endpoints

## Monitoring & Logging

The application includes:
- Console logging for debugging
- Error tracking in API routes
- User-friendly error messages in UI
- Progress indicators for long operations 