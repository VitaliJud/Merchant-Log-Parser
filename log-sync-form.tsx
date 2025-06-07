"use client"

import { useState, useRef } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { CalendarIcon, Loader2, Download, X, Cloud, Database } from "lucide-react"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "@/hooks/use-toast"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const gcsFormSchema = z.object({
  gcsClientEmail: z.string().email({ message: "Please enter a valid email address" }),
  gcsPrivateKey: z.string().min(1, { message: "GCS private key is required" }),
  gcsBucketName: z.string().min(1, { message: "GCS bucket name is required" }),
  startDate: z.date({ required_error: "Start date is required" }),
  endDate: z.date({ required_error: "End date is required" }),
  logType: z.enum(["api_access", "store_access", "audit", "all"], {
    required_error: "Please select a log type",
  }),
  limit: z.number().min(1, { message: "Limit must be at least 1" }).max(1000, { message: "Limit cannot exceed 1000" }),
})

const s3FormSchema = z.object({
  awsAccessKeyId: z.string().min(1, { message: "AWS Access Key ID is required" }),
  awsSecretAccessKey: z.string().min(1, { message: "AWS Secret Access Key is required" }),
  s3BucketName: z.string().min(1, { message: "S3 bucket name is required" }),
  awsRegion: z.string().min(1, { message: "AWS Region is required" }),
  startDate: z.date({ required_error: "Start date is required" }),
  endDate: z.date({ required_error: "End date is required" }),
  logType: z.enum(["api_access", "store_access", "audit", "all"], {
    required_error: "Please select a log type",
  }),
  limit: z.number().min(1, { message: "Limit must be at least 1" }).max(1000, { message: "Limit cannot exceed 1000" }),
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
  const [folderCount, setFolderCount] = useState<number | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([])
  const [startDateOpen, setStartDateOpen] = useState(false)
  const [endDateOpen, setEndDateOpen] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const gcsForm = useForm<GCSFormValues>({
    resolver: zodResolver(gcsFormSchema),
    defaultValues: {
      gcsClientEmail: "",
      gcsPrivateKey: "",
      gcsBucketName: "",
      logType: "all",
      limit: 20,
    },
  })

  const s3Form = useForm<S3FormValues>({
    resolver: zodResolver(s3FormSchema),
    defaultValues: {
      awsAccessKeyId: "",
      awsSecretAccessKey: "",
      s3BucketName: "",
      awsRegion: "",
      logType: "all",
      limit: 20,
    },
  })

  async function onSyncBucket() {
    setSyncLoading(true)
    try {
      // Simulate API call to check folder count
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const count = Math.floor(Math.random() * 100) + 1
      setFolderCount(count)
      toast({
        title: "Bucket Synced",
        description: `Found ${count} folders in the ${bucketType.toUpperCase()} bucket.`,
      })
    } catch (error) {
      toast({
        title: "Sync Failed",
        description: "There was an error syncing the bucket.",
        variant: "destructive",
      })
    } finally {
      setSyncLoading(false)
    }
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

  async function onExportLogs(values: GCSFormValues | S3FormValues) {
    setExportLoading(true)
    setExportProgress({ current: 0, total: 100, status: "Initializing..." })
    setGeneratedFiles([])

    // Create abort controller for this export
    abortControllerRef.current = new AbortController()

    try {
      const formattedStartDate = format(values.startDate, "yyyy/MM/dd")
      const formattedEndDate = format(values.endDate, "yyyy/MM/dd")

      // Simulate the log export process
      const logTypes = values.logType === "all" ? ["api_access", "store_access", "audit"] : [values.logType]
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

        // Simulate processing time
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Generate mock CSV data
        const csvData = generateMockCSV(logType, values.limit)
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

      toast({
        title: "Export Failed",
        description: "There was an error exporting the logs.",
        variant: "destructive",
      })
    } finally {
      setExportLoading(false)
      setTimeout(() => setExportProgress(null), 3000)
    }
  }

  function generateMockCSV(logType: string, limit: number): string {
    const headers = getHeaders(logType)
    const rows = [headers.join(",")]

    for (let i = 0; i < Math.min(limit, 50); i++) {
      const row = headers.map((header) => {
        // Generate mock data based on header type
        if (header.includes("timestamp")) return new Date().toISOString()
        if (header.includes("status")) return Math.random() > 0.8 ? "404" : "200"
        if (header.includes("method")) return ["GET", "POST", "PUT", "DELETE"][Math.floor(Math.random() * 4)]
        if (header.includes("storeHash")) return `store_${Math.random().toString(36).substr(2, 8)}`
        return `sample_${Math.random().toString(36).substr(2, 6)}`
      })
      rows.push(row.join(","))
    }

    return rows.join("\n")
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
        "auditLogEvent.auditLogEntry.sysLogMessage",
        "auditLogEvent.auditLogEntry.staffUserName",
        "auditLogEvent.auditLogEntry.ipAddress",
        "auditLogEvent.context.requestId",
        "auditLogEvent.resource.id",
        "auditLogEvent.operationType",
        "auditLogEvent.summary",
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
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Log Sync & Export Tool</CardTitle>
        <CardDescription>Configure bucket settings to sync and export logs.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={bucketType} onValueChange={(value) => setBucketType(value as "gcs" | "s3")} className="w-full">
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

        {/* Progress and file download sections */}
        {folderCount !== null && (
          <div className="bg-muted p-3 rounded-md text-sm mt-6">
            <span className="font-medium">Folder count:</span> {folderCount} folders found in {bucketType.toUpperCase()}{" "}
            bucket
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
          <FormField
            control={form.control}
            name="logType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Log Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select log type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="api_access">API Access</SelectItem>
                    <SelectItem value="store_access">Store Access</SelectItem>
                    <SelectItem value="audit">Audit</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="limit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Limit</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="20"
                    {...field}
                    onChange={(e) => field.onChange(Number.parseInt(e.target.value) || 0)}
                  />
                </FormControl>
                <FormDescription>Max logs per type (1-1000)</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
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
              Syncing...
            </>
          ) : (
            "Sync Bucket"
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
