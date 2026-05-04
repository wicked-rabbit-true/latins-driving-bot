import { useState, useRef } from "react";
import { 
  useAnalyzeBatchExamQuestions,
  useCreateExamQuestion,
  useUpdateExamQuestion,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, Sparkles, Save, Trash2, AlertTriangle, ShieldCheck, ShieldAlert, ShieldX, ToggleLeft, ToggleRight, ImagePlus, X, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CIUDADES = ["Saitama", "Tokyo", "Chiba", "Kanagawa", "Tochigi", "Nagoya", "Osaka"];

type Confianza = "alta" | "media" | "baja";

interface ResultItem {
  pregunta: string;
  respuesta: boolean;
  respuestaCorregida: boolean;
  explicacion: string;
  referencia: string | null;
  confianza: Confianza;
  advertencia: string | null;
  fuentes: string[];
  saved: boolean;
  saving: boolean;
  questionId: number | null;
  imagenUrl: string | null;
  uploadingImage: boolean;
  error?: boolean;
}

const CONFIANZA_CONFIG: Record<Confianza, { label: string; icon: typeof ShieldCheck; className: string }> = {
  alta:  { label: "Confianza alta",   icon: ShieldCheck,  className: "text-green-600 bg-green-50 border-green-200" },
  media: { label: "Confianza media",  icon: ShieldAlert,  className: "text-amber-600 bg-amber-50 border-amber-200" },
  baja:  { label: "¡Revisar!",        icon: ShieldX,      className: "text-red-600 bg-red-50 border-red-200" },
};

async function uploadImage(file: File): Promise<string> {
  const reqRes = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!reqRes.ok) throw new Error("No se pudo obtener la URL de subida");
  const { uploadURL, objectPath } = await reqRes.json();
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error("No se pudo subir la imagen");
  return objectPath as string;
}

function parsePreguntas(text: string): string[] {
  const lines = text.split("\n");
  const result: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d+[-.]/.test(trimmed) && current.length > 0) {
      result.push(current.join(" ").trim());
      current = [trimmed];
    } else {
      current.push(trimmed);
    }
  }
  if (current.length > 0) result.push(current.join(" ").trim());
  return result.filter(q => q.length > 0);
}

export default function AdminAnalyze() {
  const { toast } = useToast();
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const analysisFileInputRef = useRef<HTMLInputElement | null>(null);

  const [text, setText] = useState("");
  const [nivel, setNivel] = useState<"1" | "2">("1");
  const [ciudad, setCiudad] = useState<string>("Saitama");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [analysisImage, setAnalysisImage] = useState<{ objectPath: string; preview: string } | null>(null);
  const [uploadingAnalysisImage, setUploadingAnalysisImage] = useState(false);
  
  const analyzeMutation = useAnalyzeBatchExamQuestions();
  const createMutation = useCreateExamQuestion();
  const updateMutation = useUpdateExamQuestion();

  const handleAnalysisImageSelect = async (file: File) => {
    setUploadingAnalysisImage(true);
    try {
      const objectPath = await uploadImage(file);
      const preview = URL.createObjectURL(file);
      setAnalysisImage({ objectPath, preview });
    } catch {
      toast({ title: "Error al subir la imagen de figura", variant: "destructive" });
    } finally {
      setUploadingAnalysisImage(false);
    }
  };

  const handleAnalyze = async () => {
    if (!text.trim()) {
      toast({ title: "Ingresa al menos una pregunta", variant: "destructive" });
      return;
    }
    try {
      const preguntas = parsePreguntas(text);
      const response = await analyzeMutation.mutateAsync({
        data: { preguntas, nivel: Number(nivel), ciudad, imagenUrl: analysisImage?.objectPath ?? null }
      });
      const items: ResultItem[] = response.resultados.map((r: any) => ({
        pregunta: r.pregunta,
        respuesta: r.respuesta,
        respuestaCorregida: r.respuesta,
        explicacion: r.explicacion,
        referencia: r.referencia ?? null,
        confianza: (r.confianza ?? "media") as Confianza,
        advertencia: r.advertencia ?? null,
        fuentes: r.fuentes ?? [],
        saved: false,
        saving: false,
        questionId: null,
        imagenUrl: analysisImage?.objectPath ?? null,
        uploadingImage: false,
      }));
      setResults(items);
      const bajas = items.filter(i => i.confianza === "baja").length;
      if (bajas > 0) {
        toast({ 
          title: `${bajas} pregunta(s) marcada(s) para revisar`,
          description: "Revisa las preguntas en rojo antes de guardar.",
          variant: "destructive"
        });
      } else {
        toast({ title: `Análisis completado — ${items.length} preguntas` });
      }
    } catch {
      toast({ 
        title: "Error en el análisis", 
        description: "No se pudo procesar las preguntas.",
        variant: "destructive"
      });
    }
  };

  const toggleRespuesta = (index: number) => {
    setResults(current => current.map((r, i) =>
      i === index ? { ...r, respuestaCorregida: !r.respuestaCorregida } : r
    ));
  };

  const handleSave = async (index: number) => {
    const item = results[index];
    if (item.saved || item.saving) return;

    setResults(current => current.map((r, i) => i === index ? { ...r, saving: true } : r));
    try {
      const created = await createMutation.mutateAsync({
        data: {
          pregunta: item.pregunta,
          respuesta: item.respuestaCorregida,
          explicacion: item.explicacion,
          nivel: Number(nivel) as 1 | 2,
          ciudad,
          revisado: true,
          imagenUrl: item.imagenUrl ?? undefined,
        }
      });
      const newQuestionId = (created as any).id ?? null;
      setResults(current => current.map((r, i) =>
        i === index ? { ...r, saved: true, saving: false, questionId: newQuestionId } : r
      ));
    } catch {
      setResults(current => current.map((r, i) => i === index ? { ...r, saving: false } : r));
      toast({ title: "Error al guardar", variant: "destructive" });
    }
  };

  const handleSaveAll = async () => {
    let saved = 0;
    for (let i = 0; i < results.length; i++) {
      if (!results[i].saved && !results[i].error) {
        await handleSave(i);
        saved++;
      }
    }
    if (saved > 0) toast({ title: `${saved} preguntas guardadas para ${ciudad}` });
  };

  const handleImageSelect = async (index: number, file: File) => {
    const item = results[index];
    if (!item.questionId || item.uploadingImage) return;

    setResults(current => current.map((r, i) => i === index ? { ...r, uploadingImage: true } : r));
    try {
      const objectPath = await uploadImage(file);
      await updateMutation.mutateAsync({
        id: item.questionId,
        data: { imagenUrl: objectPath },
      });
      setResults(current => current.map((r, i) =>
        i === index ? { ...r, imagenUrl: objectPath, uploadingImage: false } : r
      ));
      toast({ title: "Imagen subida correctamente" });
    } catch {
      setResults(current => current.map((r, i) => i === index ? { ...r, uploadingImage: false } : r));
      toast({ title: "Error al subir imagen", variant: "destructive" });
    }
  };

  const handleRemoveImage = async (index: number) => {
    const item = results[index];
    if (!item.questionId || item.uploadingImage) return;

    setResults(current => current.map((r, i) => i === index ? { ...r, uploadingImage: true } : r));
    try {
      await updateMutation.mutateAsync({
        id: item.questionId,
        data: { imagenUrl: null },
      });
      setResults(current => current.map((r, i) =>
        i === index ? { ...r, imagenUrl: null, uploadingImage: false } : r
      ));
    } catch {
      setResults(current => current.map((r, i) => i === index ? { ...r, uploadingImage: false } : r));
      toast({ title: "Error al eliminar imagen", variant: "destructive" });
    }
  };

  const removeResult = (index: number) => {
    setResults(current => current.filter((_, i) => i !== index));
  };

  const pendientes = results.filter(r => !r.saved && !r.error).length;
  const bajas = results.filter(r => r.confianza === "baja" && !r.saved).length;

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analizar Preguntas con IA</h1>
          <p className="text-muted-foreground mt-2">
            La IA analiza cada pregunta y te indica su nivel de confianza. Tú tienes la última palabra — puedes corregir cualquier respuesta antes de guardar.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configuración</CardTitle>
            <CardDescription>Selecciona la ciudad y el nivel antes de analizar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ciudad del examen</Label>
                <Select value={ciudad} onValueChange={setCiudad}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CIUDADES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nivel del examen</Label>
                <Select value={nivel} onValueChange={(v: "1"|"2") => setNivel(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Nivel 1 — Karimen (50 preguntas)</SelectItem>
                    <SelectItem value="2">Nivel 2 — Honmen (100 preguntas)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Preguntas de iGiveTest (una por línea)</Label>
              <Textarea 
                className="min-h-[150px] font-mono text-sm" 
                placeholder="Pega aquí las preguntas tal como aparecen en iGiveTest, una por línea..."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>

            {/* Imagen de figura (opcional) */}
            <div className="space-y-2">
              <Label>Imagen de figura <span className="text-muted-foreground font-normal">(opcional — para preguntas visuales)</span></Label>
              <input
                ref={analysisFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAnalysisImageSelect(file);
                  e.target.value = "";
                }}
              />
              {analysisImage ? (
                <div className="flex items-start gap-3 p-3 border rounded-lg bg-muted/30">
                  <img
                    src={analysisImage.preview}
                    alt="Figura de la pregunta"
                    className="w-24 h-24 object-contain rounded border bg-white"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" /> Imagen lista para el análisis
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">La IA verá esta figura al analizar la(s) pregunta(s)</p>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="outline" onClick={() => analysisFileInputRef.current?.click()}>
                        <ImagePlus className="h-3 w-3 mr-1" /> Cambiar
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => setAnalysisImage(null)}>
                        <X className="h-3 w-3 mr-1" /> Quitar
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => analysisFileInputRef.current?.click()}
                  disabled={uploadingAnalysisImage}
                  className="w-full border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center hover:border-primary/50 hover:bg-muted/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadingAnalysisImage ? (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="text-sm">Subiendo imagen...</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Upload className="h-6 w-6" />
                      <span className="text-sm">Haz clic para subir la figura de la pregunta</span>
                      <span className="text-xs">PNG, JPG, WEBP</span>
                    </div>
                  )}
                </button>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => { setText(""); setResults([]); setAnalysisImage(null); }}>Limpiar</Button>
            <Button onClick={handleAnalyze} disabled={analyzeMutation.isPending || !text.trim()}>
              {analyzeMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analizando...</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Analizar con IA</>
              )}
            </Button>
          </CardFooter>
        </Card>

        {results.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-bold">Resultados — {ciudad} · Nivel {nivel}</h2>
                <div className="flex gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                  <span>{results.length} preguntas</span>
                  {bajas > 0 && (
                    <span className="text-red-600 font-medium flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {bajas} requieren revisión manual
                    </span>
                  )}
                </div>
              </div>
              <Button
                onClick={handleSaveAll}
                disabled={pendientes === 0}
              >
                <Save className="mr-2 h-4 w-4" /> Guardar todas ({pendientes})
              </Button>
            </div>

            {/* Legend */}
            <div className="flex gap-4 flex-wrap text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
              <span className="font-semibold text-foreground">Indicadores:</span>
              <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-green-600" /> Confianza alta — OK</span>
              <span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3 text-amber-600" /> Confianza media — verificar</span>
              <span className="flex items-center gap-1"><ShieldX className="h-3 w-3 text-red-600" /> Confianza baja — REVISAR MANUALMENTE</span>
              <span className="flex items-center gap-1"><ToggleLeft className="h-3 w-3" /> Toca V/F para corregir la respuesta</span>
            </div>
            
            <div className="space-y-3">
              {results.map((item, index) => {
                const conf = CONFIANZA_CONFIG[item.confianza];
                const ConfIcon = conf.icon;
                const fueCorregida = item.respuestaCorregida !== item.respuesta;
                
                return (
                  <Card
                    key={index}
                    className={cn(
                      "transition-all",
                      item.saved ? "opacity-80 border-green-500/20" : "",
                      item.confianza === "baja" && !item.saved ? "border-red-300" : ""
                    )}
                  >
                    <CardHeader className="pb-3 border-b bg-muted/20">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", conf.className)}>
                              <ConfIcon className="h-3 w-3" />
                              {conf.label}
                            </span>
                            {fueCorregida && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border text-blue-600 bg-blue-50 border-blue-200">
                                ✏️ Corregida por Carlos
                              </span>
                            )}
                            {item.imagenUrl && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border text-purple-600 bg-purple-50 border-purple-200">
                                <ImagePlus className="h-3 w-3" /> Con imagen
                              </span>
                            )}
                          </div>
                          <p className="font-medium text-sm leading-snug">{item.pregunta}</p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {item.saved ? (
                            <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Guardada
                            </Badge>
                          ) : (
                            <>
                              <Button variant="outline" size="sm" onClick={() => handleSave(index)} disabled={item.saving}>
                                {item.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                                Guardar
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => removeResult(index)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-3 space-y-3">
                      {/* Answer toggle */}
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">Respuesta:</span>
                        <button
                          onClick={() => !item.saved && toggleRespuesta(index)}
                          disabled={item.saved}
                          className={cn(
                            "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 font-semibold text-sm transition-all",
                            item.respuestaCorregida
                              ? "bg-green-50 border-green-400 text-green-700 hover:bg-green-100"
                              : "bg-red-50 border-red-400 text-red-700 hover:bg-red-100",
                            item.saved ? "opacity-60 cursor-default" : "cursor-pointer"
                          )}
                          title={item.saved ? "" : "Toca para cambiar la respuesta"}
                        >
                          {item.respuestaCorregida
                            ? <><ToggleRight className="h-4 w-4" /> VERDADERO</>
                            : <><ToggleLeft className="h-4 w-4" /> FALSO</>
                          }
                        </button>
                        {!item.saved && (
                          <span className="text-xs text-muted-foreground">← toca para cambiar</span>
                        )}
                      </div>

                      {/* Warning */}
                      {item.advertencia && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                          <span><strong>Atención:</strong> {item.advertencia}</span>
                        </div>
                      )}

                      {/* Explanation */}
                      {item.explicacion && (
                        <p className="text-sm text-muted-foreground">
                          <strong className="text-foreground">Explicación IA: </strong>
                          {item.explicacion}
                        </p>
                      )}

                      {/* Legal reference */}
                      {item.referencia && (
                        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
                          <span className="shrink-0 mt-0.5">📖</span>
                          <span><strong>Fuente reglamentaria: </strong>{item.referencia}</span>
                        </div>
                      )}

                      {/* Image upload — only shown once saved */}
                      {item.saved && item.questionId && (
                        <div className="pt-2 border-t">
                          {item.imagenUrl ? (
                            <div className="flex items-start gap-3">
                              <img
                                src={`/api/storage${item.imagenUrl}`}
                                alt="Imagen de la pregunta"
                                className="h-24 w-auto rounded-lg border object-contain bg-muted"
                              />
                              <div className="flex flex-col gap-2">
                                <span className="text-xs text-muted-foreground">Imagen adjunta</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 text-xs"
                                  onClick={() => handleRemoveImage(index)}
                                  disabled={item.uploadingImage}
                                >
                                  {item.uploadingImage ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <X className="h-3 w-3 mr-1" />}
                                  Quitar imagen
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => fileInputRefs.current[index]?.click()}
                                  disabled={item.uploadingImage}
                                >
                                  <ImagePlus className="h-3 w-3 mr-1" /> Cambiar imagen
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-purple-700 border-purple-200 hover:bg-purple-50"
                              onClick={() => fileInputRefs.current[index]?.click()}
                              disabled={item.uploadingImage}
                            >
                              {item.uploadingImage
                                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Subiendo...</>
                                : <><ImagePlus className="h-4 w-4 mr-2" /> Agregar imagen</>
                              }
                            </Button>
                          )}
                          <input
                            ref={el => { fileInputRefs.current[index] = el; }}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageSelect(index, file);
                              e.target.value = "";
                            }}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
