import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleQuestion, Download, RefreshCw, Clock, CheckCircle2, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface BotQuestion {
  id: string;
  timestamp: string;
  clientNumber: string;
  studentQuestion: string;
  botQuestion: string;
  status: "pendiente" | "respondida";
  carlosAnswer: string | null;
  answeredAt: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchQuestions(): Promise<BotQuestion[]> {
  const res = await fetch("/api/bot-questions");
  if (!res.ok) throw new Error("Error al cargar preguntas");
  return res.json();
}

export default function QuestionsPage() {
  const [filter, setFilter] = useState<"todas" | "pendiente" | "respondida">("todas");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["bot-questions"],
    queryFn: fetchQuestions,
    refetchInterval: 30000,
  });

  const filtered = (data ?? []).filter(q =>
    filter === "todas" ? true : q.status === filter
  );

  const pendientes = (data ?? []).filter(q => q.status === "pendiente").length;
  const respondidas = (data ?? []).filter(q => q.status === "respondida").length;

  function handleExport() {
    window.open("/api/bot-questions/export", "_blank");
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 md:px-8 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <MessageCircleQuestion className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold">Preguntas al Bot</h1>
              <p className="text-xs text-muted-foreground">
                Preguntas que el bot no pudo responder y consultó a Carlos
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <Button size="sm" onClick={handleExport} disabled={!data?.length}>
              <Download className="h-4 w-4 mr-1" />
              Exportar .txt
            </Button>
          </div>
        </div>

        {/* Stats */}
        {data && (
          <div className="flex gap-4 mt-3 flex-wrap">
            <span className="text-sm text-muted-foreground">
              Total: <strong>{data.length}</strong>
            </span>
            <span className="text-sm text-amber-600">
              Pendientes: <strong>{pendientes}</strong>
            </span>
            <span className="text-sm text-green-600">
              Respondidas: <strong>{respondidas}</strong>
            </span>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 mt-3">
          {(["todas", "pendiente", "respondida"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f === "todas" ? "Todas" : f === "pendiente" ? "Pendientes" : "Respondidas"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 md:px-8 py-4 space-y-3 pb-24 md:pb-4">
        {isLoading && (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))
        )}

        {error && (
          <div className="text-center py-16 text-red-500">
            Error al cargar las preguntas. Verifica que el bot esté activo.
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <MessageCircleQuestion className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay preguntas aún</p>
            <p className="text-sm mt-1">
              Aquí aparecerán las dudas que el bot no pueda resolver con el manual
            </p>
          </div>
        )}

        {filtered.map(q => (
          <Card key={q.id} className={`border ${q.status === "pendiente" ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/10" : "border-green-200 bg-green-50/50 dark:bg-green-950/10"}`}>
            <CardContent className="p-4 space-y-3">
              {/* Top row */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-xs">#{q.id}</Badge>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    +{q.clientNumber}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDate(q.timestamp)}
                  </span>
                </div>
                {q.status === "pendiente" ? (
                  <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-xs">
                    ⏳ Pendiente
                  </Badge>
                ) : (
                  <Badge className="bg-green-600 hover:bg-green-700 text-white text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Respondida
                  </Badge>
                )}
              </div>

              {/* Student question */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Pregunta del alumno
                </p>
                <p className="text-sm leading-relaxed bg-background/80 rounded p-2 border">
                  {q.studentQuestion}
                </p>
              </div>

              {/* Bot question to Carlos */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Lo que el bot preguntó a Carlos
                </p>
                <p className="text-sm leading-relaxed bg-background/80 rounded p-2 border italic">
                  {q.botQuestion}
                </p>
              </div>

              {/* Carlos answer */}
              {q.carlosAnswer && (
                <div>
                  <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">
                    Respuesta de Carlos · {formatDate(q.answeredAt!)}
                  </p>
                  <p className="text-sm leading-relaxed bg-green-100/60 dark:bg-green-900/20 rounded p-2 border border-green-200 dark:border-green-800">
                    {q.carlosAnswer}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
