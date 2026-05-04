import { useState, useEffect, useCallback, useRef } from "react";
import { useListExamQuestions, useUpdateExamQuestion } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  ImageIcon,
  Zap,
  Filter,
  BrainCircuit,
  AlertTriangle,
  ThumbsUp,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CIUDADES = ["todas", "Saitama", "Tokyo", "Chiba", "Kanagawa", "Tochigi", "Nagoya", "Osaka"];

type Question = {
  id: number;
  pregunta: string;
  respuesta: boolean;
  explicacion: string | null;
  nivel: number;
  ciudad: string | null;
  imagenUrl: string | null;
  imagenesUrls: string[] | null;
  revisado: boolean;
};

export default function AdminRapidReview() {
  const { toast } = useToast();
  const updateMutation = useUpdateExamQuestion();

  const [nivel, setNivel] = useState<"todas" | "1" | "2">("todas");
  const [ciudad, setCiudad] = useState("todas");
  const [soloSinRevisar, setSoloSinRevisar] = useState(false);
  const [started, setStarted] = useState(false);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [localAnswers, setLocalAnswers] = useState<Record<number, boolean>>({});
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type AiResult = { respuesta: boolean; explicacion: string; confianza: string; referencia?: string | null; advertencia?: string | null };
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const { data, isLoading } = useListExamQuestions(
    {
      ...(nivel !== "todas" ? { nivel: Number(nivel) } : {}),
      ...(ciudad !== "todas" ? { ciudad } : {}),
      ...(soloSinRevisar ? { revisado: false } : {}),
      limit: 500,
      offset: 0,
    },
    { query: { enabled: started } as any }
  );

  useEffect(() => {
    if (data?.items) {
      setQuestions(data.items as Question[]);
      setIndex(0);
      setLocalAnswers({});
      setSavedIds(new Set());
    }
  }, [data]);

  // Clear AI result when changing question
  useEffect(() => { setAiResult(null); }, [index]);

  const current = questions[index];
  const currentAnswer = current
    ? (localAnswers[current.id] ?? current.respuesta)
    : null;

  const saveAnswer = useCallback(async (q: Question, answer: boolean) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: q.id,
        data: { respuesta: answer, revisado: true },
      });
      setSavedIds(prev => new Set([...prev, q.id]));
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [updateMutation, toast]);

  const setAnswer = useCallback((answer: boolean) => {
    if (!current) return;
    setLocalAnswers(prev => ({ ...prev, [current.id]: answer }));
    saveAnswer(current, answer);
    // Auto-advance after brief delay
    setTimeout(() => {
      setIndex(i => Math.min(i + 1, questions.length - 1));
    }, 300);
  }, [current, questions.length, saveAnswer]);

  const goBack = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setIndex(i => Math.min(i + 1, questions.length - 1)), []);

  const consultarIA = useCallback(async () => {
    if (!current || aiLoading) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await fetch("/api/exam/questions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pregunta: current.pregunta,
          nivel: current.nivel,
          guardar: false,
          imagenUrl: current.imagenesUrls?.[0] ?? current.imagenUrl ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error de IA");
      setAiResult({ respuesta: data.respuesta, explicacion: data.explicacion, confianza: data.confianza, referencia: data.referencia ?? null, advertencia: data.advertencia ?? null });
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }, [current, aiLoading, toast]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!started) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "v" || e.key === "V") setAnswer(true);
      else if (e.key === "f" || e.key === "F") setAnswer(false);
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goBack();
      else if (e.key === "a" || e.key === "A") consultarIA();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [started, setAnswer, goNext, goBack, consultarIA]);

  const progress = questions.length > 0 ? ((index + 1) / questions.length) * 100 : 0;
  const reviewedCount = savedIds.size;

  if (!started) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Zap className="w-6 h-6" />
              Revisión Rápida
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Navega pregunta por pregunta y confirma o corrige la respuesta con un teclazo.
              <br />
              <strong>V</strong> = Verdadero · <strong>F</strong> = Falso · <strong>← →</strong> = navegar sin guardar
            </p>
          </div>

          <Card>
            <CardContent className="pt-6 space-y-5">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1">
                  <Label className="flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" />Nivel</Label>
                  <Select value={nivel} onValueChange={v => setNivel(v as any)}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todos los niveles</SelectItem>
                      <SelectItem value="1">Nivel 1 — Karimen</SelectItem>
                      <SelectItem value="2">Nivel 2 — Honmen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Ciudad</Label>
                  <Select value={ciudad} onValueChange={setCiudad}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CIUDADES.map(c => (
                        <SelectItem key={c} value={c}>{c === "todas" ? "Todas" : c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Filtro</Label>
                  <Select
                    value={soloSinRevisar ? "pendientes" : "todas"}
                    onValueChange={v => setSoloSinRevisar(v === "pendientes")}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas las preguntas</SelectItem>
                      <SelectItem value="pendientes">Solo sin revisar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="pt-2">
                <Button onClick={() => setStarted(true)} size="lg" className="gap-2">
                  <Zap className="w-4 h-4" />
                  Iniciar revisión rápida
                </Button>
              </div>

              <div className="border rounded-lg p-4 bg-muted/30 text-sm space-y-1">
                <p className="font-medium flex items-center gap-2"><Keyboard className="w-4 h-4" />Atajos de teclado</p>
                <p className="text-muted-foreground"><kbd className="px-1.5 py-0.5 bg-background border rounded text-xs">V</kbd> → Marcar VERDADERO y avanzar</p>
                <p className="text-muted-foreground"><kbd className="px-1.5 py-0.5 bg-background border rounded text-xs">F</kbd> → Marcar FALSO y avanzar</p>
                <p className="text-muted-foreground"><kbd className="px-1.5 py-0.5 bg-background border rounded text-xs">→</kbd> / <kbd className="px-1.5 py-0.5 bg-background border rounded text-xs">←</kbd> → Navegar sin guardar</p>
                <p className="text-muted-foreground"><kbd className="px-1.5 py-0.5 bg-background border rounded text-xs">A</kbd> → Consultar IA (ver qué dice la IA sobre esta pregunta)</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Cargando preguntas...
        </div>
      </AdminLayout>
    );
  }

  if (questions.length === 0) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
          <p>No se encontraron preguntas con esos filtros.</p>
          <Button variant="outline" onClick={() => setStarted(false)}>Cambiar filtros</Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Revisión Rápida
            </h1>
            <p className="text-sm text-muted-foreground">
              {reviewedCount} revisadas · Pregunta {index + 1} de {questions.length}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setStarted(false)}>
            Cambiar filtros
          </Button>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Question card */}
        {current && (
          <Card className={cn(
            "border-2 transition-colors",
            savedIds.has(current.id) ? "border-green-200" : "border-border"
          )}>
            <CardContent className="pt-6 space-y-6">
              {/* Meta */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">
                  {current.nivel === 1 ? "Karimen" : "Honmen"}
                </Badge>
                {current.ciudad && <Badge variant="outline">{current.ciudad}</Badge>}
                {current.imagenUrl && (
                  <Badge variant="outline" className="gap-1">
                    <ImageIcon className="w-3 h-3" />
                    Con figura
                  </Badge>
                )}
                {savedIds.has(current.id) && (
                  <Badge className="bg-green-100 text-green-700 border-green-200">
                    ✓ Guardada
                  </Badge>
                )}
              </div>

              {/* Image */}
              {current.imagenUrl && (
                <div className="flex justify-center">
                  <img
                    src={`/api/storage${current.imagenUrl}`}
                    alt="figura"
                    className="max-h-40 object-contain border rounded"
                  />
                </div>
              )}

              {/* Question text */}
              <p className="text-lg leading-relaxed font-medium">
                {current.pregunta}
              </p>

              {/* Current answer indicator + AI button */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Respuesta actual:</span>
                  {currentAnswer
                    ? <span className="text-green-600 font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />VERDADERO</span>
                    : <span className="text-red-600 font-semibold flex items-center gap-1"><XCircle className="w-4 h-4" />FALSO</span>
                  }
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={consultarIA}
                  disabled={aiLoading}
                  className="gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50 text-xs h-8"
                >
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5" />}
                  {aiLoading ? "Consultando..." : "Consultar IA"}
                  <kbd className="ml-0.5 px-1 py-0.5 bg-white border rounded text-[10px] text-muted-foreground">A</kbd>
                </Button>
              </div>

              {/* AI result panel */}
              {aiResult && (
                <div className={cn(
                  "rounded-lg border p-3 space-y-2 text-sm",
                  aiResult.respuesta !== currentAnswer
                    ? "border-orange-300 bg-orange-50"
                    : "border-green-300 bg-green-50"
                )}>
                  <div className="flex items-start gap-2 font-semibold">
                    {aiResult.respuesta !== currentAnswer ? (
                      <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                    ) : (
                      <ThumbsUp className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                    )}
                    <span className={aiResult.respuesta !== currentAnswer ? "text-orange-800" : "text-green-800"}>
                      IA dice: <strong>{aiResult.respuesta ? "VERDADERO" : "FALSO"}</strong>
                      {" · "}confianza <strong>{aiResult.confianza}</strong>
                      {aiResult.respuesta !== currentAnswer
                        ? " — ¡DIFIERE de tu respuesta!"
                        : " — coincide ✓"}
                    </span>
                  </div>
                  <p className={cn("text-sm", aiResult.respuesta !== currentAnswer ? "text-orange-700" : "text-green-700")}>
                    {aiResult.explicacion}
                  </p>
                  {aiResult.referencia && (() => {
                    const parts = aiResult.referencia!.split(" / ");
                    const ja = parts[0] ?? aiResult.referencia!;
                    const es = parts[1] ?? null;
                    return (
                      <div className="border-t pt-2 space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fuente del libro 教則</p>
                        <p className="text-xs font-mono bg-white/70 border rounded px-2 py-1.5 leading-relaxed text-slate-700">
                          {ja}
                        </p>
                        {es && (
                          <p className="text-xs text-slate-600 italic px-1">
                            → {es}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  {aiResult.advertencia && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {aiResult.advertencia}
                    </p>
                  )}
                  {aiResult.respuesta !== currentAnswer && current && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-orange-400 text-orange-700 hover:bg-orange-100 h-7 text-xs"
                      onClick={() => {
                        setLocalAnswers(prev => ({ ...prev, [current.id]: aiResult.respuesta }));
                        saveAnswer(current, aiResult.respuesta);
                        setTimeout(() => setIndex(i => Math.min(i + 1, questions.length - 1)), 400);
                      }}
                    >
                      Usar respuesta de la IA y avanzar
                    </Button>
                  )}
                </div>
              )}

              {/* Big V/F buttons */}
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setAnswer(true)}
                  disabled={saving}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 font-bold text-lg transition-all",
                    "hover:scale-105 active:scale-95",
                    currentAnswer
                      ? "border-green-400 bg-green-50 text-green-700"
                      : "border-border hover:border-green-300 hover:bg-green-50/50 text-muted-foreground"
                  )}
                >
                  <CheckCircle2 className="w-8 h-8" />
                  VERDADERO
                  <kbd className="text-xs font-normal px-2 py-0.5 bg-white border rounded">V</kbd>
                </button>
                <button
                  onClick={() => setAnswer(false)}
                  disabled={saving}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 font-bold text-lg transition-all",
                    "hover:scale-105 active:scale-95",
                    !currentAnswer
                      ? "border-red-400 bg-red-50 text-red-700"
                      : "border-border hover:border-red-300 hover:bg-red-50/50 text-muted-foreground"
                  )}
                >
                  <XCircle className="w-8 h-8" />
                  FALSO
                  <kbd className="text-xs font-normal px-2 py-0.5 bg-white border rounded">F</kbd>
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pb-8">
          <Button
            variant="outline"
            onClick={goBack}
            disabled={index === 0}
            className="gap-2"
          >
            <ChevronLeft className="w-4 h-4" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            {index + 1} / {questions.length}
          </span>
          <Button
            variant="outline"
            onClick={goNext}
            disabled={index === questions.length - 1}
            className="gap-2"
          >
            Siguiente
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
