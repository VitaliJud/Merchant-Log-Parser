"use client"

import { useState, useEffect } from "react"
import { Cloud, Database, Key, Users, Settings, ExternalLink, Copy, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/hooks/use-toast"
import { Navigation } from "@/components/navigation"

export default function HowToPage() {
  const [activeTab, setActiveTab] = useState<"gcs" | "s3">("gcs")
  const [copiedText, setCopiedText] = useState<string | null>(null)

  // Handle anchor navigation
  useEffect(() => {
    const hash = window.location.hash.substring(1) // Remove the #
    if (hash === 'gcs' || hash === 's3') {
      setActiveTab(hash)
    }
  }, [])

  const handleTabChange = (value: string) => {
    setActiveTab(value as "gcs" | "s3")
    // Update the URL hash
    window.history.replaceState(null, '', `#${value}`)
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(label)
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      })
      setTimeout(() => setCopiedText(null), 2000)
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Please copy manually",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Setup Guide</h1>
          <p className="text-muted-foreground text-lg">
            Learn how to create service accounts and configure credentials for accessing your log storage buckets.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger
              value="gcs"
              className="data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700 data-[state=active]:border-blue-300"
            >
              <Cloud className="w-4 h-4 mr-2" />
              Google Cloud (GCS)
            </TabsTrigger>
            <TabsTrigger
              value="s3"
              className="data-[state=active]:bg-green-100 data-[state=active]:text-green-700 data-[state=active]:border-green-300"
            >
              <Database className="w-4 h-4 mr-2" />
              AWS S3
            </TabsTrigger>
          </TabsList>

        <TabsContent value="gcs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Google Cloud Platform Setup
              </CardTitle>
              <CardDescription>
                Create a service account in Google Cloud Platform to access your GCS bucket containing log files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {/* Step 1 */}
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">1</span>
                  Access Google Cloud Console
                </h3>
                <p className="text-muted-foreground mb-3">
                  Navigate to the Google Cloud Console and select your project that contains the log storage bucket.
                </p>
                <Button 
                  variant="outline" 
                  onClick={() => window.open('https://console.cloud.google.com/', '_blank')}
                  className="mb-3"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Google Cloud Console
                </Button>
              </div>

              {/* Step 2 */}
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">2</span>
                  Create Service Account
                </h3>
                <p className="text-muted-foreground mb-3">
                  Navigate to <strong>IAM & Admin → Service Accounts</strong> and create a new service account.
                </p>
                <div className="bg-gray-50 p-4 rounded-md space-y-2">
                  <p><strong>Service Account Name:</strong> <code>log-viewer-service</code></p>
                  <p><strong>Description:</strong> Service account for accessing log storage bucket</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">3</span>
                  Assign Required Permissions
                </h3>
                <p className="text-muted-foreground mb-3">
                  Grant the service account the minimum required permissions to access your log bucket.
                </p>
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-md">
                  <h4 className="font-medium mb-2">Required IAM Roles:</h4>
                  <ul className="space-y-1 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <code>Storage Object Viewer</code> - Read objects in the bucket
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <code>Storage Legacy Bucket Reader</code> - List objects in the bucket
                    </li>
                  </ul>
                </div>
              </div>

              {/* Step 4 */}
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">4</span>
                  Generate JSON Key
                </h3>
                <p className="text-muted-foreground mb-3">
                  Create and download a JSON key file for the service account.
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Click on your created service account</li>
                  <li>Go to the <strong>Keys</strong> tab</li>
                  <li>Click <strong>Add Key → Create new key</strong></li>
                  <li>Select <strong>JSON</strong> format</li>
                  <li>Download the JSON file</li>
                </ol>
              </div>

              {/* Step 5 */}
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">5</span>
                  Extract Credentials
                </h3>
                <p className="text-muted-foreground mb-3">
                  From the downloaded JSON file, you'll need these two values for the log viewer:
                </p>
                <div className="bg-gray-50 p-4 rounded-md space-y-3">
                  <div>
                    <label className="font-medium text-sm">Client Email:</label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="bg-white px-2 py-1 rounded text-sm flex-1">your-service@project-id.iam.gserviceaccount.com</code>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => copyToClipboard('client_email', 'Client Email field name')}
                      >
                        {copiedText === 'Client Email field name' ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="font-medium text-sm">Private Key:</label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="bg-white px-2 py-1 rounded text-sm flex-1">-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----</code>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => copyToClipboard('private_key', 'Private Key field name')}
                      >
                        {copiedText === 'Private Key field name' ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-200 p-3 rounded-md mt-3">
                  <p className="text-sm">
                    <strong>💡 Tip:</strong> Copy the entire private key including the BEGIN and END markers. 
                    The log viewer will automatically handle the formatting.
                  </p>
                </div>
              </div>

            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="s3" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5 text-green-600" />
                Amazon Web Services Setup
              </CardTitle>
              <CardDescription>
                Create an IAM user in AWS with appropriate permissions to access your S3 bucket containing log files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {/* Step 1 */}
              <div className="border-l-4 border-green-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">1</span>
                  Access AWS IAM Console
                </h3>
                <p className="text-muted-foreground mb-3">
                  Navigate to the AWS Management Console and open the IAM (Identity and Access Management) service.
                </p>
                <Button 
                  variant="outline" 
                  onClick={() => window.open('https://console.aws.amazon.com/iam/', '_blank')}
                  className="mb-3"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open AWS IAM Console
                </Button>
              </div>

              {/* Step 2 */}
              <div className="border-l-4 border-green-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">2</span>
                  Create IAM User
                </h3>
                <p className="text-muted-foreground mb-3">
                  Navigate to <strong>Users</strong> and create a new IAM user for programmatic access.
                </p>
                <div className="bg-gray-50 p-4 rounded-md space-y-2">
                  <p><strong>User Name:</strong> <code>log-viewer-user</code></p>
                  <p><strong>Access Type:</strong> Programmatic access</p>
                  <p><strong>AWS Console Access:</strong> Not required</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="border-l-4 border-green-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">3</span>
                  Create Custom Policy
                </h3>
                <p className="text-muted-foreground mb-3">
                  Create a custom policy with minimum required permissions for your log bucket.
                </p>
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-md">
                  <h4 className="font-medium mb-2">Required S3 Permissions:</h4>
                  <ul className="space-y-1 text-sm mb-3">
                    {/* <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <code>s3:ListBucket</code> - List objects in the bucket
                    </li> */}
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <code>s3:GetObject</code> - Download objects from the bucket
                    </li>
                  </ul>
                  
                  <div className="mt-3">
                    <label className="font-medium text-sm">Sample Policy JSON:</label>
                    <div className="bg-white p-3 rounded border mt-2 relative">
                      <pre className="text-xs overflow-x-auto">
{`{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "",
			"Effect": "Allow",
			"Principal": {
				"AWS": "arn:aws:iam::394389787758:user/bigcommerce-log-export"
			},
			"Action": "s3:PutObject",
			"Resource": "arn:aws:s3:::bc-v3-vijionbox-logs-aws/*"
		},
		{
			"Effect": "Allow",
			"Principal": {
				"AWS": "arn:aws:iam::948229325783:user/bc-b2b-vjb-logger"
			},
			"Action": "s3:GetObject",
			"Resource": "arn:aws:s3:::bc-v3-vijionbox-logs-aws/*"
		}
	]
}`}
                      </pre>
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="absolute top-2 right-2"
                        onClick={() => copyToClipboard(`{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "",
			"Effect": "Allow",
			"Principal": {
				"AWS": "arn:aws:iam::394389787758:user/bigcommerce-log-export"
			},
			"Action": "s3:PutObject",
			"Resource": "arn:aws:s3:::bc-v3-vijionbox-logs-aws/*"
		},
		{
			"Effect": "Allow",
			"Principal": {
				"AWS": "arn:aws:iam::948229325783:user/bc-b2b-vjb-logger"
			},
			"Action": "s3:GetObject",
			"Resource": "arn:aws:s3:::bc-v3-vijionbox-logs-aws/*"
		}
	]
}`, 'Policy JSON')}
                      >
                        {copiedText === 'Policy JSON' ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div className="border-l-4 border-green-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">4</span>
                  Attach Policy to User
                </h3>
                <p className="text-muted-foreground mb-3">
                  Attach the custom policy to your IAM user.
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Go to the user you created</li>
                  <li>Click on the <strong>Permissions</strong> tab</li>
                  <li>Click <strong>Add permissions → Attach policies directly</strong></li>
                  <li>Search for and select your custom policy</li>
                  <li>Click <strong>Add permissions</strong></li>
                </ol>
              </div>

              {/* Step 5 */}
              <div className="border-l-4 border-green-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">5</span>
                  Generate Access Keys
                </h3>
                <p className="text-muted-foreground mb-3">
                  Create access keys for the IAM user to use with the log viewer.
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Go to the <strong>Security credentials</strong> tab</li>
                  <li>Click <strong>Create access key</strong></li>
                  <li>Select <strong>Application running outside AWS</strong></li>
                  <li>Add a description tag (optional)</li>
                  <li>Download the credentials or copy them securely</li>
                </ol>
              </div>

              {/* Step 6 */}
              <div className="border-l-4 border-green-500 pl-4">
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">6</span>
                  Required Credentials
                </h3>
                <p className="text-muted-foreground mb-3">
                  You'll need these four values for the log viewer:
                </p>
                <div className="bg-gray-50 p-4 rounded-md space-y-3">
                  <div>
                    <label className="font-medium text-sm">Access Key ID:</label>
                    <code className="bg-white px-2 py-1 rounded text-sm block mt-1">AKIA5ZRW7IPL5TAGJYNU</code>
                  </div>
                  <div>
                    <label className="font-medium text-sm">Secret Access Key:</label>
                    <code className="bg-white px-2 py-1 rounded text-sm block mt-1">wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY</code>
                  </div>
                  <div>
                    <label className="font-medium text-sm">Region:</label>
                    <code className="bg-white px-2 py-1 rounded text-sm block mt-1">us-east-1</code>
                  </div>
                  <div>
                    <label className="font-medium text-sm">Bucket Name:</label>
                    <code className="bg-white px-2 py-1 rounded text-sm block mt-1">your-log-bucket-name</code>
                  </div>
                </div>
                <div className="bg-green-50 border border-green-200 p-3 rounded-md mt-3">
                  <p className="text-sm">
                    <strong>🔒 Security:</strong> Store these credentials securely and never commit them to version control. 
                    Consider using AWS IAM roles for production environments.
                  </p>
                </div>
              </div>

            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Optional additional links */}
      <div className="mt-8 text-center">
        <Button 
          variant="outline"
          onClick={() => window.open('https://github.com/vitalijud', '_blank')}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Report Issues
        </Button>
      </div>
      </div>
    </div>
  )
} 