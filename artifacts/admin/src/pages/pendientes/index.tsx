import { useQuery } from "@tanstack/react-query";
import { ClipboardList, MessageCircleQuestion, VolumeX, Tag, RefreshCw, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ConsultarItem {
  id: string;
  phone: string;
  ts: number;
  question: string;
}

interface ManualItem {
  phone: string;
  expiresAt: string;
  sinceMs: number;
}

interface NameApptItem {
  phone: string;
  savedAt: number;
  carlosAnswer: string;
}

interface PendientesData {
  updatedAt: string | null;
  consultarCount: number;
  manualModeCount: number;
  pendingNameCount: number;
  total: number;
  consultarPendientes: ConsultarItem[];
  manualModeChats: ManualItem[];
  pendingNameAppts: NameApptItem[];
}

function fmtMs(ms: number) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `hace ${mins} min`;
  return `hace ${Math.round(mins / 60)} h`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PendientesPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<PendientesData>({
    queryKey: ["bot-pendientes"],
    queryFn: () => fetch("/api/bot-pendientes").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const now = Date.now();

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Bandeja de pendientes</h1>
            {data?.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Actualizado: {fmtDate(data.updatedAt)}
              </p>
            )}
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
          Actualizar
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          icon={<MessageCircleQuestion className="h-5 w-5" />}
          label="Sin respuesta"
          count={data?.consultarCount ?? 0}
          color="text-amber-600"
          bg="bg-amber-50 dark:bg-amber-900/20"
          loading={isLoading}
        />
        <SummaryCard
          icon={<Tag className="h-5 w-5" />}
          label="Esperan nombre"
          count={data?.pendingNameCount ?? 0}
          color="text-blue-600"
          bg="bg-blue-50 dark:bg-blue-900/20"
          loading={isLoading}
        />
        <SummaryCard
          icon={<VolumeX className="h-5 w-5" />}
          label="Bot pausado"
          count={data?.manualModeCount ?? 0}
          color="text-slate-600"
          bg="bg-slate-50 dark:bg-slate-900/20"
          loading={isLoading}
        />
      </div>

      {/* Consultar sin respuesta */}
      <Section
        title="Preguntas [CONSULTAR:] sin respuesta"
        icon={<MessageCircleQuestion className="h-4 w-4 text-amber-600" />}
        badge={data?.consultarCount}
        badgeVariant="secondary"
        loading={isLoading}
        empty={!isLoading && (data?.consultarPendientes?.length ?? 0) === 0}
        emptyText="No hay preguntas pendientes de respuesta."
      >
        {data?.consultarPendientes.map((item) => (
          <ItemRow
            key={item.id}
            title={`#${item.id} — +${item.phone}`}
            subtitle={item.question}
            time={item.ts ? fmtMs(now - item.ts) : undefined}
            tag="CONSULTAR"
            tagColor="bg-amber-100 text-amber-700 dark:bg-amber-900/30"
          />
        ))}
      </Section>

      {/* Citas esperando nombre */}
      {(data?.pendingNameCount ?? 0) > 0 && (
        <Section
          title="Citas esperando nombre del cliente"
          icon={<Tag className="h-4 w-4 text-blue-600" />}
          badge={data?.pendingNameCount}
          badgeVariant="secondary"
          loading={isLoading}
          empty={false}
          emptyText=""
        >
          {data?.pendingNameAppts.map((item) => (
            <ItemRow
              key={item.phone}
              title={`+${item.phone}`}
              subtitle={item.carlosAnswer ? `Carlos confirmó: "${item.carlosAnswer}"` : "Pendiente de nombre"}
              time={item.savedAt ? fmtMs(now - item.savedAt) : undefined}
              tag="NOMBRE"
              tagColor="bg-blue-100 text-blue-700 dark:bg-blue-900/30"
            />
          ))}
        </Section>
      )}

      {/* Chats en modo manual */}
      {(data?.manualModeCount ?? 0) > 0 && (
        <Section
          title="Chats con el bot pausado"
          icon={<VolumeX className="h-4 w-4 text-slate-600" />}
          badge={data?.manualModeCount}
          badgeVariant="secondary"
          loading={isLoading}
          empty={false}
          emptyText=""
        >
          {data?.manualModeChats.map((item) => (
            <ItemRow
              key={item.phone}
              title={`+${item.phone}`}
              subtitle={`Expira: ${fmtDate(item.expiresAt)} — usa @retomar para retomar antes`}
              time={item.sinceMs ? fmtMs(item.sinceMs) : undefined}
              tag="PAUSADO"
              tagColor="bg-slate-100 text-slate-700 dark:bg-slate-900/30"
            />
          ))}
        </Section>
      )}

      {!isLoading && data?.total === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">¡Todo al día!</p>
          <p className="text-sm">No hay ítems pendientes en este momento.</p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon, label, count, color, bg, loading,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
  bg: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        {loading ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <div className={`rounded-lg p-3 ${bg} flex items-center gap-3`}>
            <span className={color}>{icon}</span>
            <div>
              <div className={`text-2xl font-bold ${color}`}>{count}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  title, icon, badge, loading, empty, emptyText, children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: number;
  badgeVariant?: "secondary" | "destructive";
  loading: boolean;
  empty: boolean;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {icon}
          {title}
          {typeof badge === "number" && badge > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {badge}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {loading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : empty ? (
          <p className="text-sm text-muted-foreground py-2">{emptyText}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function ItemRow({
  title, subtitle, time, tag, tagColor,
}: {
  title: string;
  subtitle: string;
  time?: string;
  tag: string;
  tagColor: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sm">{title}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {time && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {time}
            </span>
          )}
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tagColor}`}>
            {tag}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{subtitle}</p>
    </div>
  );
}
