"use client"

/**
 * Log Sync & Export Tool - Production Version
 * 
 * This component now uses proper backend API routes for secure cloud storage access:
 * - /api/sync-bucket - Lists folders in GCS/S3 buckets
 * - /api/fetch-logs - Retrieves and processes log files into CSV format
 * 
 * Architecture:
 * - Frontend: Collects user credentials and preferences
 * - Backend APIs: Handle cloud authentication and data processing
 * - Services: GCSService for Google Cloud, S3Service for AWS (placeholder)
 * 
 * Security: All cloud credentials stay on the backend, never exposed to browser
 */

import { useState, useRef, useEffect } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { CalendarIcon, Loader2, Download, X, Cloud, Database, ChevronDown, AlertTriangle, BookOpen } from "lucide-react"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "@/hooks/use-toast"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ErrorModal } from "@/components/ui/error-modal"

const gcsFormSchema = z.object({
  gcsClientEmail: z.string().email({ message: "Please enter a valid email address" }),
  gcsPrivateKey: z.string().min(1, { message: "GCS private key is required" }),
  gcsBucketName: z.string().min(1, { message: "GCS bucket name is required" }),
  startDate: z.date({ required_error: "Start date is required" }),
  endDate: z.date({ required_error: "End date is required" }),
  logTypes: z.array(z.enum(["api_access", "store_access", "audit"])).min(1, { message: "Select at least one log type" }),
  limit: z.number().min(1, { message: "Limit must be at least 1" }).max(10000, { message: "Limit cannot exceed 10000" }),
  doNotLimit: z.boolean(),
})

const s3FormSchema = z.object({
  awsAccessKeyId: z.string().min(1, { message: "AWS Access Key ID is required" }),
  awsSecretAccessKey: z.string().min(1, { message: "AWS Secret Access Key is required" }),
  s3BucketName: z.string().min(1, { message: "S3 bucket name is required" }),
  awsRegion: z.string().min(1, { message: "AWS Region is required" }),
  startDate: z.date({ required_error: "Start date is required" }),
  endDate: z.date({ required_error: "End date is required" }),
  logTypes: z.array(z.enum(["api_access", "store_access", "audit"])).min(1, { message: "Select at least one log type" }),
  limit: z.number().min(1, { message: "Limit must be at least 1" }).max(10000, { message: "Limit cannot exceed 10000" }),
  doNotLimit: z.boolean(),
})

type GCSFormValues = z.infer<typeof gcsFormSchema>
type S3FormValues = z.infer<typeof s3FormSchema>

interface ExportProgress {
  current: number
  total: number
  status: string
}

interface GeneratedFile {
  name: string
  data: string
  type: string
}

export default function LogSyncForm() {
  const [bucketType, setBucketType] = useState<"gcs" | "s3">("gcs")
  const [syncLoading, setSyncLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [bucketAnalysis, setBucketAnalysis] = useState<{
    connected: boolean
    bucketName: string
    folderCount: number
    fileTypeAnalysis: {
      api_access: number
      store_access: number
      audit: number
      other: number
      total: number
      note?: string
    }
    recommendations: {
      suggestedLimit: number
      availableDateRange: string
      totalLogFiles: number
      analysisNote?: string
    }
    summary: {
      fileTypeBreakdown: string
    }
    message: string
  } | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([])
  const [startDateOpen, setStartDateOpen] = useState(false)
  const [endDateOpen, setEndDateOpen] = useState(false)
  const [logTypesDropdownOpen, setLogTypesDropdownOpen] = useState(false)
  const [selectedLogTypes, setSelectedLogTypes] = useState<string[]>([])
  const [doNotLimit, setDoNotLimit] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  
  // Error modal state
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'error' | 'warning'
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'error'
  })

  // Handle anchor navigation
  useEffect(() => {
    const hash = window.location.hash.substring(1) // Remove the #
    if (hash === 'gcs' || hash === 's3') {
      setBucketType(hash)
    }
  }, [])

  const handleTabChange = (value: string) => {
    setBucketType(value as "gcs" | "s3")
    // Update the URL hash
    window.history.replaceState(null, '', `#${value}`)
  }

  const openDocumentation = () => {
    const docUrl = `/how-to#${bucketType}`
    window.open(docUrl, '_blank')
  }

  const gcsForm = useForm<GCSFormValues>({
    resolver: zodResolver(gcsFormSchema),
    defaultValues: {
      gcsClientEmail: "",
      gcsPrivateKey: "",
      gcsBucketName: "",
      logTypes: ["api_access", "store_access", "audit"],
      limit: 20,
      doNotLimit: false,
    },
  })

  const s3Form = useForm<S3FormValues>({
    resolver: zodResolver(s3FormSchema),
    defaultValues: {
      awsAccessKeyId: "",
      awsSecretAccessKey: "",
      s3BucketName: "",
      awsRegion: "",
      logTypes: ["api_access", "store_access", "audit"],
      limit: 20,
      doNotLimit: false,
    },
  })

  // Client-side validation functions
  function validatePrivateKey(privateKey: string): { isValid: boolean; error?: string } {
    if (!privateKey || privateKey.trim() === '') {
      return { isValid: false, error: 'Private key is required.' }
    }

    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      return { 
        isValid: false, 
        error: 'Invalid private key format. The private key must start with "-----BEGIN PRIVATE KEY-----".\n\nPlease ensure you have copied the complete private key including the header and footer.' 
      }
    }

    if (!privateKey.includes('-----END PRIVATE KEY-----')) {
      return { 
        isValid: false, 
        error: 'Invalid private key format. The private key must end with "-----END PRIVATE KEY-----".\n\nPlease ensure you have copied the complete private key including the header and footer.' 
      }
    }

    return { isValid: true }
  }

  function showErrorModal(title: string, message: string, type: 'error' | 'warning' = 'error') {
    setErrorModal({
      isOpen: true,
      title,
      message,
      type
    })
  }

  function closeErrorModal() {
    setErrorModal(prev => ({ ...prev, isOpen: false }))
  }

  async function onSyncBucket() {
    setSyncLoading(true)
    try {
      const currentForm = bucketType === 'gcs' ? gcsForm : s3Form
      const values = currentForm.getValues()
      
      // Validate required fields before syncing
      const result = await currentForm.trigger()
      if (!result) {
        showErrorModal(
          "Validation Failed",
          "Please fill in all required fields before analyzing the bucket."
        )
        return
      }

      // Client-side validation for GCS private key
      if (bucketType === 'gcs' && 'gcsPrivateKey' in values) {
        const privateKeyValidation = validatePrivateKey(values.gcsPrivateKey)
        if (!privateKeyValidation.isValid) {
          showErrorModal(
            "Private Key Format Error",
            privateKeyValidation.error || "Invalid private key format."
          )
          return
        }
      }

      // Call backend API to check bucket
      const analysis = await syncBucketWithBackend(bucketType, values)
      setBucketAnalysis(analysis)
      toast({
        title: "Bucket Connected",
        description: analysis.message || `Successfully connected to ${bucketType.toUpperCase()} bucket.`,
      })
    } catch (error) {
      let errorTitle = "Connection Failed"
      let errorMessage = "There was an error connecting to the bucket."
      
      if (error instanceof Error) {
        const errorText = error.message.toLowerCase()
        
        // Handle specific authentication errors
        if (errorText.includes('private key') || errorText.includes('begin private key')) {
          errorTitle = "Private Key Error"
          errorMessage = "Invalid private key format. Make sure it includes '-----BEGIN PRIVATE KEY-----' and '-----END PRIVATE KEY-----' markers.\n\nPlease copy the complete private key from your service account JSON file."
        } else if (errorText.includes('client email') || errorText.includes('email')) {
          errorTitle = "Client Email Error" 
          errorMessage = "Invalid client email. Please check your service account email address.\n\nThe email should look like: service-account@project-id.iam.gserviceaccount.com"
        } else if (errorText.includes('bucket') && errorText.includes('not found')) {
          errorTitle = "Bucket Not Found"
          errorMessage = "The specified bucket does not exist or you don't have access to it.\n\nPlease verify:\n• The bucket name is correct\n• The bucket exists in your project\n• Your service account has access to the bucket"
        } else if (errorText.includes('access denied') || errorText.includes('unauthorized')) {
          errorTitle = "Access Denied"
          errorMessage = "Your credentials don't have permission to access this bucket.\n\nPlease ensure your service account has the following permissions:\n• Storage Object Viewer\n• Storage Legacy Bucket Reader"
        } else if (errorText.includes('invalid credentials') || errorText.includes('authentication')) {
          errorTitle = "Invalid Credentials"
          errorMessage = "Authentication failed. Please verify your credentials are correct.\n\nCommon issues:\n• Incorrect client email\n• Malformed private key\n• Service account is disabled"
        } else {
          errorMessage = error.message
        }
      }
      
      // Show error modal instead of toast for better visibility
      showErrorModal(errorTitle, errorMessage)
    } finally {
      setSyncLoading(false)
    }
  }

  async function syncBucketWithBackend(bucketType: "gcs" | "s3", values: GCSFormValues | S3FormValues): Promise<any> {
    const apiUrl = '/api/sync-bucket' // Adjust this to your actual backend endpoint
    
    // Prepare the request payload based on bucket type
    const payload = {
      bucketType,
      ...(bucketType === 'gcs' && 'gcsClientEmail' in values ? {
        clientEmail: values.gcsClientEmail,
        privateKey: values.gcsPrivateKey.replace(/\\n/g, '\n'),
        bucketName: values.gcsBucketName,
      } : {}),
      ...(bucketType === 's3' && 'awsAccessKeyId' in values ? {
        accessKeyId: values.awsAccessKeyId,
        secretAccessKey: values.awsSecretAccessKey,
        bucketName: values.s3BucketName,
        region: values.awsRegion,
      } : {}),
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
    }

    const result = await response.json()
    return result
  }

  function stopExport() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setExportLoading(false)
      setExportProgress(null)
      toast({
        title: "Export Stopped",
        description: "The export process has been cancelled.",
      })
    }
  }

  // Helper functions for checkbox UI
  function toggleLogType(logType: string) {
    setSelectedLogTypes(prev => 
      prev.includes(logType) 
        ? prev.filter(type => type !== logType)
        : [...prev, logType]
    )
  }

  function getLogTypeDisplayName(logType: string): string {
    const names = {
      api_access: "API Access",
      store_access: "Store Access", 
      audit: "Audit"
    }
    return names[logType as keyof typeof names] || logType
  }

  async function fetchLogsFromBackend(
    bucketType: "gcs" | "s3", 
    values: GCSFormValues | S3FormValues, 
    logType: string, 
    startDate: string, 
    endDate: string, 
    signal: AbortSignal
  ): Promise<string> {
    const apiUrl = '/api/fetch-logs' // Adjust this to your actual backend endpoint
    
    // Handle unlimited case - use a very high limit when doNotLimit is true
    const effectiveLimit = doNotLimit ? 999999 : values.limit
    
    console.log(`Export request: logType=${logType}, limit=${effectiveLimit}, unlimited=${doNotLimit}`)
    
    // Prepare the request payload based on bucket type
    const payload = {
      bucketType,
      logType,
      startDate,
      endDate,
      limit: effectiveLimit,
      ...(bucketType === 'gcs' && 'gcsClientEmail' in values ? {
        clientEmail: values.gcsClientEmail,
        privateKey: values.gcsPrivateKey.replace(/\\n/g, '\n'), // Ensure proper newline formatting
        bucketName: values.gcsBucketName,
      } : {}),
      ...(bucketType === 's3' && 'awsAccessKeyId' in values ? {
        accessKeyId: values.awsAccessKeyId,
        secretAccessKey: values.awsSecretAccessKey,
        bucketName: values.s3BucketName,
        region: values.awsRegion,
      } : {}),
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal, // For cancellation support
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
    }

    const csvData = await response.text()
    return csvData
  }

  async function onExportLogs(values: GCSFormValues | S3FormValues) {
    setExportLoading(true)
    setExportProgress({ current: 0, total: 100, status: "Initializing..." })
    setGeneratedFiles([])

    // Create abort controller for this export
    abortControllerRef.current = new AbortController()

    try {
      // Client-side validation for GCS private key before export
      if (bucketType === 'gcs' && 'gcsPrivateKey' in values) {
        const privateKeyValidation = validatePrivateKey(values.gcsPrivateKey)
        if (!privateKeyValidation.isValid) {
          showErrorModal(
            "Private Key Format Error",
            privateKeyValidation.error || "Invalid private key format."
          )
          return
        }
      }

      const formattedStartDate = format(values.startDate, "yyyy/MM/dd")
      const formattedEndDate = format(values.endDate, "yyyy/MM/dd")

      // Validate that log types are selected
      if (selectedLogTypes.length === 0) {
        showErrorModal(
          "Export Configuration Error",
          "Please select at least one log type before exporting logs."
        )
        return
      }

      // Process the log export with backend API calls using selected log types
      const logTypes = selectedLogTypes
      const files: GeneratedFile[] = []

      for (let i = 0; i < logTypes.length; i++) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error("Export cancelled")
        }

        const logType = logTypes[i]
        setExportProgress({
          current: Math.floor((i / logTypes.length) * 100),
          total: 100,
          status: `Processing ${logType} logs from ${bucketType.toUpperCase()}...`,
        })

        // Call backend API to fetch logs
        const csvData = await fetchLogsFromBackend(bucketType, values, logType, formattedStartDate, formattedEndDate, abortControllerRef.current.signal)
        const exportTimestamp = Math.floor(new Date().getTime() / 1000)

        files.push({
          name: `${logType}_${bucketType}_${exportTimestamp}.csv`,
          data: csvData,
          type: logType,
        })
      }

      setGeneratedFiles(files)
      setExportProgress({ current: 100, total: 100, status: "Export completed!" })

      toast({
        title: "Logs Exported Successfully",
        description: `Generated ${files.length} CSV file(s) from ${bucketType.toUpperCase()} for download.`,
      })

      console.log("Form values:", {
        bucketType,
        ...values,
        startDate: formattedStartDate,
        endDate: formattedEndDate,
      })
    } catch (error) {
      if (error instanceof Error && error.message === "Export cancelled") {
        return // Already handled in stopExport
      }

      let errorTitle = "Export Failed"
      let errorMessage = "There was an error exporting the logs."
      
      if (error instanceof Error) {
        const errorText = error.message.toLowerCase()
        
        // Handle specific export errors
        if (errorText.includes('private key') || errorText.includes('begin private key')) {
          errorTitle = "Authentication Error During Export"
          errorMessage = "Invalid private key format detected during export.\n\nPlease ensure your private key includes the complete header and footer:\n• -----BEGIN PRIVATE KEY-----\n• -----END PRIVATE KEY-----"
        } else if (errorText.includes('access denied') || errorText.includes('unauthorized')) {
          errorTitle = "Access Denied During Export"
          errorMessage = "Your credentials don't have permission to access the log files.\n\nPlease ensure your service account has:\n• Storage Object Viewer permissions\n• Access to the specific bucket and date folders"
        } else if (errorText.includes('bucket') && errorText.includes('not found')) {
          errorTitle = "Bucket Access Error"
          errorMessage = "The bucket could not be accessed during export.\n\nPlease verify:\n• The bucket name is correct\n• Your service account has proper permissions\n• The bucket exists in your project"
        } else if (errorText.includes('no data') || errorText.includes('no files')) {
          errorTitle = "No Log Data Found"
          errorMessage = "No log files were found for the specified date range and log types.\n\nPlease try:\n• Adjusting the date range\n• Checking if logs exist for those dates\n• Verifying the bucket contains log files"
        } else {
          errorMessage = error.message
        }
      }

      // Show error modal for export errors for better visibility
      showErrorModal(errorTitle, errorMessage)
    } finally {
      setExportLoading(false)
      setTimeout(() => setExportProgress(null), 3000)
    }
  }

  function getHeaders(logType: string): string[] {
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

  function downloadCSV(file: GeneratedFile) {
    const blob = new Blob([file.data], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)

    toast({
      title: "Download Started",
      description: `Downloading ${file.name}`,
    })
  }

  function onGCSSubmit(values: GCSFormValues) {
    onExportLogs(values)
  }

  function onS3Submit(values: S3FormValues) {
    onExportLogs(values)
  }

  return (
    <>
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={closeErrorModal}
        title={errorModal.title}
        message={errorModal.message}
        type={errorModal.type}
      />
      
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Log Sync & Export Tool</CardTitle>
              <CardDescription>Configure bucket settings to sync and export logs.</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={openDocumentation}
              className="flex items-center gap-2 h-9 w-9 p-0"
              title={`Open ${bucketType.toUpperCase()} setup documentation`}
            >
              <BookOpen className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
        <Tabs value={bucketType} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger
              value="gcs"
              className="data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700 data-[state=active]:border-blue-300"
            >
              <Cloud className="w-4 h-4 mr-2" />
              GCS (Google)
            </TabsTrigger>
            <TabsTrigger
              value="s3"
              className="data-[state=active]:bg-green-100 data-[state=active]:text-green-700 data-[state=active]:border-green-300"
            >
              <Database className="w-4 h-4 mr-2" />
              S3 (AWS)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="gcs">
            <Form {...gcsForm}>
              <form onSubmit={gcsForm.handleSubmit(onGCSSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={gcsForm.control}
                    name="gcsClientEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>GCS Client Email</FormLabel>
                        <FormControl>
                          <Input placeholder="log-viewer-bot@project.iam.gserviceaccount.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={gcsForm.control}
                    name="gcsBucketName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>GCS Bucket Name</FormLabel>
                        <FormControl>
                          <Input placeholder="bc-store-logs" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={gcsForm.control}
                  name="gcsPrivateKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GCS Private Key</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwgg...&#10;-----END PRIVATE KEY-----"
                          className="min-h-[100px] font-mono text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Enter your GCS private key, including newlines and special characters.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Common fields for GCS */}
                {renderCommonFields(gcsForm, startDateOpen, setStartDateOpen, endDateOpen, setEndDateOpen)}

                {/* Action buttons */}
                {renderActionButtons()}
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="s3">
            <Form {...s3Form}>
              <form onSubmit={s3Form.handleSubmit(onS3Submit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={s3Form.control}
                    name="awsAccessKeyId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>AWS Access Key ID</FormLabel>
                        <FormControl>
                          <Input placeholder="AKIAIOSFODNN7EXAMPLE" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={s3Form.control}
                    name="s3BucketName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>S3 Bucket Name</FormLabel>
                        <FormControl>
                          <Input placeholder="my-s3-logs-bucket" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={s3Form.control}
                    name="awsRegion"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>AWS Region</FormLabel>
                        <FormControl>
                          <Input placeholder="us-east-1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={s3Form.control}
                    name="awsSecretAccessKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>AWS Secret Access Key</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Common fields for S3 */}
                {renderCommonFields(s3Form, startDateOpen, setStartDateOpen, endDateOpen, setEndDateOpen)}

                {/* Action buttons */}
                {renderActionButtons()}
              </form>
            </Form>
          </TabsContent>
        </Tabs>

        {/* Simplified bucket analysis modal */}
        {bucketAnalysis && (
          <div className="bg-muted p-4 rounded-md text-sm mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-green-700">✅ {bucketAnalysis.message}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBucketAnalysis(null)}
                className="h-6 w-6 p-0 hover:bg-gray-200"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {/* <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="font-medium">Active Date Folders:</span> {bucketAnalysis.folderCount}
              </div>
              <div>
                <span className="font-medium">Available Dates:</span> {bucketAnalysis.recommendations.availableDateRange}
              </div>
            </div> */}
          </div>
        )}

        {exportProgress && (
          <div className="space-y-2 mt-6">
            <div className="flex justify-between text-sm">
              <span>{exportProgress.status}</span>
              <span>{exportProgress.current}%</span>
            </div>
            <Progress value={exportProgress.current} className="w-full" />
          </div>
        )}

        {generatedFiles.length > 0 && (
          <div className="space-y-3 mt-6">
            <h4 className="font-medium">Generated Files:</h4>
            <div className="grid gap-2">
              {generatedFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-md">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground">({file.type})</span>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => downloadCSV(file)}>
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </>
  )

  function renderCommonFields(
    form: any,
    startOpen: boolean,
    setStartOpen: (open: boolean) => void,
    endOpen: boolean,
    setEndOpen: (open: boolean) => void,
  ) {
    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Start Date</FormLabel>
                <Popover open={startOpen} onOpenChange={setStartOpen}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button variant="outline" className="w-full pl-3 text-left font-normal">
                        {field.value ? (
                          format(field.value, "yyyy/MM/dd")
                        ) : (
                          <span className="text-muted-foreground">Select date</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={(date) => {
                        field.onChange(date)
                        setStartOpen(false)
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>End Date</FormLabel>
                <Popover open={endOpen} onOpenChange={setEndOpen}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button variant="outline" className="w-full pl-3 text-left font-normal">
                        {field.value ? (
                          format(field.value, "yyyy/MM/dd")
                        ) : (
                          <span className="text-muted-foreground">Select date</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={(date) => {
                        field.onChange(date)
                        setEndOpen(false)
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Multi-select Log Types with Checkboxes */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Log Types</Label>
            <Popover open={logTypesDropdownOpen} onOpenChange={setLogTypesDropdownOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={logTypesDropdownOpen}
                  className="w-full justify-between"
                >
                  {selectedLogTypes.length === 0
                    ? "Select log types"
                    : selectedLogTypes.length === 3
                    ? "All log types"
                    : `${selectedLogTypes.length} selected`}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <div className="p-2 space-y-2">
                  {["api_access", "store_access", "audit"].map((logType) => (
                    <div
                      key={logType}
                      className="flex items-center space-x-2 p-2 hover:bg-gray-50 cursor-pointer rounded"
                      onClick={() => toggleLogType(logType)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedLogTypes.includes(logType)}
                        onChange={() => toggleLogType(logType)}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <label className="text-sm cursor-pointer">
                        {getLogTypeDisplayName(logType)}
                      </label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {selectedLogTypes.length === 0 && (
              <p className="text-sm text-red-500">Please select at least one log type</p>
            )}
          </div>

          {/* Limit field with "Do not limit" checkbox */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Limit</Label>
            <div className="space-y-3">
                             <FormField
                 control={form.control}
                 name="limit"
                 render={({ field }) => (
                   <FormControl>
                     <Input
                       type="number"
                       placeholder="20"
                       {...field}
                       onChange={(e) => field.onChange(Number.parseInt(e.target.value) || 0)}
                       disabled={doNotLimit}
                       className={doNotLimit ? "bg-gray-100 text-gray-500" : ""}
                     />
                   </FormControl>
                 )}
               />
              
              <div className={`flex items-center space-x-2 p-3 rounded-md ${doNotLimit ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                <input
                  type="checkbox"
                  checked={doNotLimit}
                  onChange={(e) => setDoNotLimit(e.target.checked)}
                  className="h-4 w-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                />
                <div className="flex items-center space-x-2">
                  {doNotLimit && <AlertTriangle className="h-4 w-4 text-red-500" />}
                  <label className={`text-sm cursor-pointer ${doNotLimit ? 'text-red-700 font-medium' : 'text-gray-700'}`}>
                    Do not limit (fetch all available logs)
                  </label>
                </div>
              </div>
              
              
              
              {!doNotLimit && (
                <p className="text-xs text-gray-500">Max logs per type (1-10000)</p>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }

  function renderActionButtons() {
    return (
      <div className="flex justify-end space-x-4">
        <Button type="button" variant="outline" onClick={onSyncBucket} disabled={syncLoading || exportLoading}>
          {syncLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            "Connect to Bucket"
          )}
        </Button>

        {exportLoading && (
          <Button type="button" variant="destructive" onClick={stopExport}>
            <X className="mr-2 h-4 w-4" />
            Stop
          </Button>
        )}

        <Button type="submit" disabled={exportLoading}>
          {exportLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Exporting...
            </>
          ) : (
            "Export Logs"
          )}
        </Button>
      </div>
    )
  }
}
