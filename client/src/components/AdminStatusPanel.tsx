import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Server, 
  Clock, 
  GitBranch, 
  Cpu,
  CheckCircle2,
  XCircle
} from "lucide-react";

interface StatusResponse {
  deployedRevision: string;
  serviceName: string;
  buildId: string;
  timestamp: string;
  documentAiEnabled: boolean;
  version: string;
  nodeEnv: string;
  uptimeSeconds: number;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function AdminStatusPanel() {
  const { data: status, isLoading, error } = useQuery<StatusResponse>({
    queryKey: ["status"],
    queryFn: async () => {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  if (isLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="p-4">
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !status) {
    return (
      <Card className="w-full max-w-md border-destructive">
        <CardContent className="p-4">
          <p className="text-destructive text-sm">Failed to load status</p>
        </CardContent>
      </Card>
    );
  }

  const isProduction = status.nodeEnv === "production";
  const isCloudRun = status.deployedRevision !== "local";

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Server className="h-4 w-4" />
          Deployment Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Environment Badge */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Environment</span>
          <Badge variant={isProduction ? "default" : "secondary"}>
            {status.nodeEnv}
          </Badge>
        </div>

        {/* Revision */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            Revision
          </span>
          <code className="text-xs bg-muted px-2 py-1 rounded">
            {status.deployedRevision}
          </code>
        </div>

        {/* Version */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Version</span>
          <span className="text-sm">{status.version}</span>
        </div>

        {/* Document AI Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            Document AI
          </span>
          {status.documentAiEnabled ? (
            <Badge variant="default" className="bg-green-600">
              <CheckCircle2 className="h-3 w-3" />
              Enabled
            </Badge>
          ) : (
            <Badge variant="secondary">
              <XCircle className="h-3 w-3" />
              Disabled
            </Badge>
          )}
        </div>

        {/* Uptime */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Uptime
          </span>
          <span className="text-sm">{formatUptime(status.uptimeSeconds)}</span>
        </div>

        {/* Cloud Run indicator */}
        {isCloudRun && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Running on Cloud Run • {status.serviceName}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

