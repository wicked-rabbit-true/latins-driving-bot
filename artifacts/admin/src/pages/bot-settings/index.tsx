import { useQuery } from "@tanstack/react-query";
import { Settings, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface SettingEntry {
  name: string;
  envVar: string;
  value: number;
  source: "env" | "default";
  unit: string;
  description: string;
}

interface BotSettingsData {
  settings: SettingEntry[];
}

export default function BotSettingsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<BotSettingsData>({
    queryKey: ["bot-settings"],
    queryFn: () => fetch("/api/bot/settings").then((r) => r.json()),
    staleTime: 60_000,
  });

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Bot Settings</h1>
            <p className="text-xs text-muted-foreground">
              Live configuration values the bot is currently using
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Active Configuration</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 divide-y divide-border">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="py-4">
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-4 w-64" />
              </div>
            ))
          ) : (
            data?.settings.map((setting) => (
              <SettingRow key={setting.envVar} setting={setting} />
            ))
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Values labeled <span className="font-medium text-foreground">default</span> use the built-in fallback.
        Override them by setting the corresponding environment variable.
      </p>
    </div>
  );
}

function SettingRow({ setting }: { setting: SettingEntry }) {
  const isEnv = setting.source === "env";
  return (
    <div className="py-4 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-sm">{setting.name}</span>
          <Badge
            variant={isEnv ? "default" : "secondary"}
            className="text-[10px] px-1.5 py-0"
          >
            {isEnv ? "env" : "default"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">{setting.description}</p>
        <code className="text-[10px] text-muted-foreground/70 mt-1 block">
          {setting.envVar}
        </code>
      </div>
      <div className="text-right flex-shrink-0">
        <span className="text-2xl font-bold tabular-nums text-foreground">
          {setting.value}
        </span>
        <span className="text-xs text-muted-foreground ml-1">{setting.unit}</span>
      </div>
    </div>
  );
}
