import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Clock, Server, GitBranch, Package } from "lucide-react";

interface StatusResponse {
  deployedRevision: string;
  buildId: string;
  timestamp: string;
  documentAi: {
    enabled: boolean;
    ready: boolean;
    reason?: string;
  };
  version: string;
  environment: string;
}

export default function Status() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/status");
        if (!response.ok) {
          throw new Error(`Failed to fetch status: ${response.statusText}`);
        }
        const data = await response.json();
        setStatus(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch status");
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    // Refresh status every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto p-6 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading deployment status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6 min-h-screen flex items-center justify-center">
        <Card className="max-w-lg w-full border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Error Loading Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <div className="container mx-auto p-6 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Deployment Status</h1>
          <p className="text-muted-foreground">
            Cloud Run deployment information and service status
          </p>
        </div>

        {/* Main Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Service Information
            </CardTitle>
            <CardDescription>Current deployment details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Package className="h-4 w-4" />
                  <span>Version</span>
                </div>
                <p className="text-lg font-mono">{status.version}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Server className="h-4 w-4" />
                  <span>Environment</span>
                </div>
                <Badge variant={status.environment === "production" ? "default" : "secondary"}>
                  {status.environment}
                </Badge>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <GitBranch className="h-4 w-4" />
                  <span>Deployed Revision</span>
                </div>
                <p className="text-sm font-mono break-all">{status.deployedRevision}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <GitBranch className="h-4 w-4" />
                  <span>Build ID</span>
                </div>
                <p className="text-sm font-mono break-all">{status.buildId}</p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Server Timestamp</span>
                </div>
                <p className="text-sm font-mono">
                  {new Date(status.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Document AI Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Document AI Status
            </CardTitle>
            <CardDescription>Google Cloud Document AI configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Enabled</div>
                <div className="flex items-center gap-2">
                  {status.documentAi.enabled ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="font-medium">Yes</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-yellow-600" />
                      <span className="font-medium">No</span>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Ready</div>
                <div className="flex items-center gap-2">
                  {status.documentAi.ready ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="font-medium">Yes</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-yellow-600" />
                      <span className="font-medium">No</span>
                    </>
                  )}
                </div>
              </div>

              {status.documentAi.reason && (
                <div className="space-y-2 md:col-span-2">
                  <div className="text-sm text-muted-foreground">Status Reason</div>
                  <p className="text-sm">{status.documentAi.reason}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground text-center">
          This page refreshes automatically every 30 seconds
        </div>
      </div>
    </div>
  );
}
