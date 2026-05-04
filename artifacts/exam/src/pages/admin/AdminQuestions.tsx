import React, { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { 
  useGetExamStats,
  useListExamQuestions,
  useDeleteExamQuestion,
  useUpdateExamQuestion,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Search, 
  Trash2, 
  CheckCircle2, 
  Circle,
  FileQuestion,
  GraduationCap,
  Car,
  MapPin,
  ImageIcon,
  Pencil,
  Loader2,
  X,
  ImagePlus,
  BrainCircuit,
  AlertTriangle,
  ThumbsUp,
  Layers,
  ChevronDown,
  ChevronUp,
  Check,
  RotateCcw,
  Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const CIUDADES = ["Saitama", "Tokyo", "Chiba", "Kanagawa", "Tochigi", "Nagoya", "Osaka"];

async function uploadImage(file: File): Promise<string> {
  const reqRes = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!reqRes.ok) throw new Error("No se pudo obtener la URL de subida");
  const { uploadURL, objectPath } = await reqRes.json();
  const putRes = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!putRes.ok) throw new Error("No se pudo subir la imagen");
  return objectPath as string;
}

type Question = {
  id: number;
  pregunta: string;
  respuesta: boolean;
  explicacion: string | null;
  nivel: number;
  ciudad: string | null;
  examenNumero: number | null;
  imagenUrl: string | null;
  imagenesUrls: string[] | null;
  imagenDescripcion: string | null;
  revisado: boolean;
};

type ImageEntry = {
  objectPath: string;
  preview: string;
};

function MultiImageUpload({
  images,
  onChange,
}: {
  images: ImageEntry[];
  onChange: (imgs: ImageEntry[]) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList) => {
    setUploading(true);
    const newEntries: ImageEntry[] = [];
    for (const file of Array.from(files)) {
      try {
        const objectPath = await uploadImage(file);
        newEntries.push({ objectPath, preview: URL.createObjectURL(file) });
      } catch {
        toast({ title: `Error al subir ${file.name}`, variant: "destructive" });
      }
    }
    setUploading(false);
    onChange([...images, ...newEntries]);
  };

  const remove = (idx: number) => {
    onChange(images.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {images.map((img, idx) => (
          <div key={idx} className="relative group">
            <img
              src={img.preview}
              alt={`figura ${idx + 1}`}
              className="h-24 w-auto max-w-[160px] object-contain border rounded-lg bg-muted"
            />
            <button
              onClick={() => remove(idx)}
              className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="h-24 w-24 flex flex-col items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground hover:text-foreground hover:border-foreground transition-colors text-xs gap-1"
        >
          {uploading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <ImagePlus className="w-5 h-5" />
              <span>Agregar</span>
            </>
          )}
        </button>
      </div>
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        ref={fileInputRef}
        onChange={e => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {images.length > 0 && (
        <p className="text-xs text-muted-foreground">{images.length} imagen{images.length !== 1 ? "es" : ""} — hover para eliminar</p>
      )}
    </div>
  );
}

function EditDialog({
  question,
  open,
  onClose,
  onSaved,
}: {
  question: Question;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const updateMutation = useUpdateExamQuestion();

  // Build initial images list: imagenesUrls takes priority; fall back to imagenUrl
  const buildInitialImages = (): ImageEntry[] => {
    const urls = question.imagenesUrls ?? (question.imagenUrl ? [question.imagenUrl] : []);
    return urls.map(path => ({ objectPath: path, preview: `/api/storage${path}` }));
  };

  const [pregunta, setPregunta] = useState(question.pregunta);
  const [respuesta, setRespuesta] = useState(question.respuesta);
  const [explicacion, setExplicacion] = useState(question.explicacion ?? "");
  const [nivel, setNivel] = useState(String(question.nivel));
  const [ciudad, setCiudad] = useState(question.ciudad ?? "Saitama");
  const [examenNumero, setExamenNumero] = useState<string>(question.examenNumero != null ? String(question.examenNumero) : "");
  const [images, setImages] = useState<ImageEntry[]>(buildInitialImages);
  const [imagenDescripcion, setImagenDescripcion] = useState(question.imagenDescripcion ?? "");

  type AiResult = { respuesta: boolean; explicacion: string; confianza: string; referencia?: string | null; advertencia?: string | null; preguntaAclaratoria?: string | null };
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [clarificacion, setClarificacion] = useState("");

  const consultarIA = async (extraContext?: string) => {
    setAiLoading(true);
    setAiResult(null);
    setClarificacion("");
    const descFinal = extraContext
      ? [imagenDescripcion.trim(), extraContext.trim()].filter(Boolean).join(" | ")
      : imagenDescripcion.trim() || null;
    try {
      const res = await fetch("/api/exam/questions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pregunta: pregunta.trim(),
          nivel: Number(nivel),
          guardar: false,
          imagenUrl: images[0]?.objectPath ?? null,
          imagenDescripcion: descFinal || null,
          excludeId: question.id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error de IA");
      setAiResult({
        respuesta: data.respuesta,
        explicacion: data.explicacion,
        confianza: data.confianza,
        referencia: data.referencia ?? null,
        advertencia: data.advertencia ?? null,
        preguntaAclaratoria: data.preguntaAclaratoria ?? null,
      });
      // Auto-rellenar solo si la IA coincide con la respuesta seleccionada.
      // Si discrepa, la explicación está escrita desde la perspectiva equivocada.
      if (data.explicacion && data.respuesta === respuesta) {
        setExplicacion(prev => prev.trim() ? prev : data.explicacion);
      }
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    const paths = images.map(i => i.objectPath);
    try {
      await updateMutation.mutateAsync({
        id: question.id,
        data: {
          pregunta: pregunta.trim(),
          respuesta,
          explicacion: explicacion.trim() || null,
          nivel: Number(nivel),
          ciudad,
          examenNumero: examenNumero !== "" ? Number(examenNumero) : null,
          imagenUrl: paths[0] ?? null,
          imagenesUrls: paths.length > 0 ? paths : null,
          imagenDescripcion: imagenDescripcion.trim() || null,
          revisado: true,
        },
      });
      toast({ title: "Pregunta actualizada" });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar pregunta #{question.id}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Pregunta</Label>
            <Textarea
              value={pregunta}
              onChange={e => setPregunta(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Respuesta correcta</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => consultarIA()}
                disabled={aiLoading || !pregunta.trim()}
                className="h-7 text-xs gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50"
              >
                {aiLoading
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <BrainCircuit className="w-3 h-3" />
                }
                {aiLoading ? "Consultando IA..." : "Consultar IA"}
              </Button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setRespuesta(true)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 font-semibold transition-colors",
                  respuesta
                    ? "border-green-400 bg-green-50 text-green-700"
                    : "border-border text-muted-foreground hover:border-green-300"
                )}
              >
                <CheckCircle2 className="w-4 h-4" /> VERDADERO
              </button>
              <button
                onClick={() => setRespuesta(false)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 font-semibold transition-colors",
                  !respuesta
                    ? "border-red-400 bg-red-50 text-red-700"
                    : "border-border text-muted-foreground hover:border-red-300"
                )}
              >
                <X className="w-4 h-4" /> FALSO
              </button>
            </div>

            {/* AI result panel */}
            {aiResult && (
              <div className={cn(
                "rounded-lg border p-3 space-y-2 text-sm",
                aiResult.preguntaAclaratoria
                  ? "border-blue-300 bg-blue-50"
                  : aiResult.respuesta !== respuesta
                    ? "border-orange-300 bg-orange-50"
                    : "border-green-300 bg-green-50"
              )}>
                {/* Clarifying question mode */}
                {aiResult.preguntaAclaratoria ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <BrainCircuit className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-blue-800 text-xs uppercase tracking-wide mb-1">La IA necesita un detalle de la imagen</p>
                        <p className="text-blue-700">{aiResult.preguntaAclaratoria}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={clarificacion}
                        onChange={e => setClarificacion(e.target.value)}
                        placeholder="Tu respuesta…"
                        className="h-8 text-sm flex-1"
                        onKeyDown={e => {
                          if (e.key === "Enter" && clarificacion.trim()) {
                            consultarIA(clarificacion.trim());
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={!clarificacion.trim() || aiLoading}
                        onClick={() => consultarIA(clarificacion.trim())}
                        className="h-8 text-xs bg-blue-600 hover:bg-blue-700"
                      >
                        {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Re-consultar →"}
                      </Button>
                    </div>
                    <p className="text-xs text-blue-600 italic">
                      También puedes responder en el campo "Descripción de imagen" de abajo y volver a Consultar IA.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 font-semibold">
                      {aiResult.respuesta !== respuesta ? (
                        <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
                      ) : (
                        <ThumbsUp className="w-4 h-4 text-green-600 shrink-0" />
                      )}
                      <span className={aiResult.respuesta !== respuesta ? "text-orange-800" : "text-green-800"}>
                        IA dice: <strong>{aiResult.respuesta ? "VERDADERO" : "FALSO"}</strong>
                        {" "}·{" "}
                        confianza <strong>{aiResult.confianza}</strong>
                        {aiResult.respuesta !== respuesta && " — ¡difiere de tu respuesta!"}
                        {aiResult.respuesta === respuesta && " — coincide con tu respuesta ✓"}
                      </span>
                    </div>
                    <p className={aiResult.respuesta !== respuesta ? "text-orange-700" : "text-green-700"}>
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
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {aiResult.advertencia}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {aiResult.explicacion && explicacion.trim() !== aiResult.explicacion.trim() && (
                        aiResult.respuesta !== respuesta ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-red-300 text-red-700 hover:bg-red-50 h-7 text-xs"
                            onClick={() => setExplicacion(aiResult.explicacion)}
                            title="⚠️ Esta explicación justifica la respuesta de la IA, que difiere de la tuya. Edítala antes de guardar."
                          >
                            ↓ Usar explicación (⚠️ revísala — justifica {aiResult.respuesta ? "VERDADERO" : "FALSO"})
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-blue-300 text-blue-700 hover:bg-blue-50 h-7 text-xs"
                            onClick={() => setExplicacion(aiResult.explicacion)}
                          >
                            ↓ Usar esta explicación
                          </Button>
                        )
                      )}
                      {aiResult.respuesta !== respuesta && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-orange-400 text-orange-700 hover:bg-orange-100 h-7 text-xs"
                          onClick={() => {
                            setRespuesta(aiResult.respuesta);
                            if (aiResult.explicacion) setExplicacion(aiResult.explicacion);
                          }}
                        >
                          Usar respuesta de la IA
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Explicación (opcional)</Label>
            <Textarea
              value={explicacion}
              onChange={e => setExplicacion(e.target.value)}
              placeholder="Explicación de por qué es verdadera o falsa..."
              className="min-h-[60px]"
            />
          </div>

          <div className="flex gap-4">
            <div className="space-y-1.5 flex-1">
              <Label>Nivel</Label>
              <Select value={nivel} onValueChange={setNivel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Nivel 1 — Karimen</SelectItem>
                  <SelectItem value="2">Nivel 2 — Honmen</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 flex-1">
              <Label>Ciudad</Label>
              <Select value={ciudad} onValueChange={setCiudad}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CIUDADES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 w-28">
              <Label>Nº Examen</Label>
              <Input
                type="number"
                min="1"
                max="99"
                placeholder="—"
                value={examenNumero}
                onChange={e => setExamenNumero(e.target.value)}
                className="text-center"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Figuras del libro (puedes agregar varias)</Label>
            <MultiImageUpload images={images} onChange={setImages} />
          </div>

          {images.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
                Descripción de imagen(es) para la IA
                <span className="text-xs text-muted-foreground font-normal">(opcional — ayuda cuando hay varias señales)</span>
              </Label>
              <Textarea
                value={imagenDescripcion}
                onChange={e => setImagenDescripcion(e.target.value)}
                placeholder='Ej: "転回禁止 (giro en U prohibido) + 終わり (fin de zona)" o "Policía de perfil con brazo derecho extendido hacia arriba"'
                className="min-h-[60px] text-sm"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || !pregunta.trim()}
          >
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ExamSetMap = Record<string, Record<number, string | null>>;

function examSetKey(ciudad: string, numero: number) { return `${ciudad}::${numero}`; }

export default function AdminQuestions() {
  const [search, setSearch] = useState("");
  const [filterCiudad, setFilterCiudad] = useState<string>("todas");
  const [filterExamenNumero, setFilterExamenNumero] = useState<string>("");
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [showExamNames, setShowExamNames] = useState(false);
  const [bulkCiudad, setBulkCiudad] = useState("Kanagawa");
  const [bulkNivel, setBulkNivel] = useState("1");
  const [bulkExamenNum, setBulkExamenNum] = useState("1");
  const [bulkSoloSin, setBulkSoloSin] = useState(true);
  const [bulkLimite, setBulkLimite] = useState("");
  const [bulkModo, setBulkModo] = useState<"asignar" | "limpiar">("asignar");
  const [bulkDeExamen, setBulkDeExamen] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  // bulk explanation generation
  const [showBulkGen, setShowBulkGen] = useState(false);
  const [bulkGenCiudad, setBulkGenCiudad] = useState("Saitama");
  const [bulkGenNumero, setBulkGenNumero] = useState("1");
  const [bulkGenLoading, setBulkGenLoading] = useState(false);
  const [bulkGenResult, setBulkGenResult] = useState<{ procesadas: number; exitosas: number; errores: number; pendientes: number } | null>(null);
  const [embLoading, setEmbLoading] = useState(false);
  const [embResult, setEmbResult] = useState<{ procesadas: number; exitosas: number; errores: number; pendientes: number; mensaje?: string } | null>(null);
  // exam names
  const [examNames, setExamNames] = useState<ExamSetMap>({});
  const [cityExamNumbers, setCityExamNumbers] = useState<Record<string, number[]>>({}); // all exam numbers per city
  const [editingName, setEditingName] = useState<string | null>(null); // key = ciudad::numero
  const [editingNameValue, setEditingNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  type AiResult = { respuesta: boolean; explicacion: string; confianza: string; referencia?: string | null; advertencia?: string | null };
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [analyzeResults, setAnalyzeResults] = useState<Record<number, AiResult>>({});

  const analyzeQuestion = async (q: Question) => {
    if (analyzingId !== null) return;
    setAnalyzingId(q.id);
    setAnalyzeResults(prev => { const next = { ...prev }; delete next[q.id]; return next; });
    try {
      const imagenUrl = (q.imagenesUrls?.[0] ?? q.imagenUrl ?? null);
      const res = await fetch("/api/exam/questions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pregunta: q.pregunta,
          nivel: q.nivel,
          guardar: false,
          imagenUrl,
          excludeId: q.id,
          skipVerified: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error de IA");
      setAnalyzeResults(prev => ({
        ...prev,
        [q.id]: {
          respuesta: data.respuesta,
          explicacion: data.explicacion,
          confianza: data.confianza,
          referencia: data.referencia ?? null,
          advertencia: data.advertencia ?? null,
        },
      }));
    } catch (err: any) {
      toast({ title: err.message ?? "Error al analizar", variant: "destructive" });
    } finally {
      setAnalyzingId(null);
    }
  };

  const { data: stats } = useGetExamStats();
  const { data: questionsData, isLoading } = useListExamQuestions({
    q: search || undefined,
    ciudad: filterCiudad === "todas" ? undefined : filterCiudad,
    examenNumero: filterExamenNumero !== "" ? Number(filterExamenNumero) : undefined,
    limit: 500,
  });
  const questions = questionsData?.items;

  // Load exam names and all exam numbers per city
  const loadExamNames = async () => {
    try {
      const [setsRes, ...cityNumRes] = await Promise.all([
        fetch("/api/exam/sets"),
        ...CIUDADES.map(c => fetch(`/api/exam/questions/examen-numeros?ciudad=${encodeURIComponent(c)}`)),
      ]);
      if (setsRes.ok) {
        const data = await setsRes.json();
        const map: ExamSetMap = {};
        for (const s of (data.sets ?? [])) {
          if (!map[s.ciudad]) map[s.ciudad] = {};
          map[s.ciudad][s.examen_numero] = s.nombre ?? null;
        }
        setExamNames(map);
      }
      const numMap: Record<string, number[]> = {};
      for (let i = 0; i < CIUDADES.length; i++) {
        const r = cityNumRes[i];
        if (r && r.ok) {
          const d = await r.json();
          if (Array.isArray(d.numeros) && d.numeros.length > 0) {
            numMap[CIUDADES[i]] = d.numeros as number[];
          }
        }
      }
      setCityExamNumbers(numMap);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadExamNames(); }, []);

  const getExamName = (ciudad: string | null, numero: number | null): string | null => {
    if (!ciudad || numero == null) return null;
    return examNames[ciudad]?.[numero] ?? null;
  };

  const startEditName = (ciudad: string, numero: number) => {
    const key = examSetKey(ciudad, numero);
    setEditingName(key);
    setEditingNameValue(examNames[ciudad]?.[numero] ?? "");
  };

  const saveExamName = async (ciudad: string, numero: number) => {
    setSavingName(true);
    try {
      const res = await fetch(`/api/exam/sets/${encodeURIComponent(ciudad)}/${numero}/nombre`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: editingNameValue.trim() || null }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      setExamNames(prev => {
        const next = { ...prev };
        if (!next[ciudad]) next[ciudad] = {};
        next[ciudad] = { ...next[ciudad], [numero]: editingNameValue.trim() || null };
        return next;
      });
      setEditingName(null);
      toast({ title: "Nombre guardado" });
    } catch {
      toast({ title: "No se pudo guardar el nombre", variant: "destructive" });
    } finally {
      setSavingName(false);
    }
  };

  const deleteMutation = useDeleteExamQuestion();

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar esta pregunta?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      toast({ title: "Pregunta eliminada" });
      queryClient.invalidateQueries({ queryKey: ["/api/exam/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exam/stats"] });
    } catch (error) {
      toast({ title: "Error", description: "No se pudo eliminar", variant: "destructive" });
    }
  };

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/exam/questions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/exam/stats"] });
  };

  const handleBulkGenerate = async () => {
    setBulkGenLoading(true);
    setBulkGenResult(null);
    try {
      const res = await fetch("/api/exam/questions/bulk-generate-explanations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciudad: bulkGenCiudad, examenNumero: Number(bulkGenNumero) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al generar");
      setBulkGenResult(data);
      if (data.exitosas > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/exam/questions"] });
        toast({ title: `${data.exitosas} explicaciones generadas y guardadas` });
      } else if (data.pendientes === 0) {
        toast({ title: "Todas las preguntas ya tienen explicación" });
      }
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setBulkGenLoading(false);
    }
  };

  const handleBulkEmbeddings = async () => {
    setEmbLoading(true);
    setEmbResult(null);
    try {
      const res = await fetch("/api/exam/questions/bulk-generate-embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al generar");
      setEmbResult(data);
      if (data.exitosas > 0) toast({ title: `${data.exitosas} embeddings generados (${data.pendientes} restantes)` });
      else if (data.pendientes === 0) toast({ title: data.mensaje ?? "Todas las preguntas ya tienen embedding" });
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setEmbLoading(false);
    }
  };

  const handleBulkAssign = async () => {
    setBulkLoading(true);
    try {
      const isLimpiar = bulkModo === "limpiar";
      if (!isLimpiar && !bulkExamenNum) return;

      const body: Record<string, any> = {
        ciudad: bulkCiudad,
        nivel: Number(bulkNivel),
        examenNumero: isLimpiar ? null : Number(bulkExamenNum),
      };
      if (!isLimpiar && bulkSoloSin) body.soloSinNumero = true;
      if (!isLimpiar && bulkLimite) body.limite = Number(bulkLimite);
      if (isLimpiar && bulkDeExamen) body.deExamen = Number(bulkDeExamen);

      const res = await fetch("/api/exam/questions/bulk-assign-examen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");

      const msg = isLimpiar
        ? `${data.actualizadas} preguntas sin número de examen ahora`
        : `${data.actualizadas} preguntas asignadas al Examen ${bulkExamenNum}`;
      toast({ title: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/exam/questions"] });
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };

  const porCiudad = stats?.porCiudad ?? {};

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Banco de Preguntas</h1>
          <p className="text-muted-foreground mt-2">Gestiona las preguntas del examen de conducir.</p>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6 flex flex-col items-center text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <FileQuestion className="w-5 h-5" />
                </div>
                <div className="text-2xl font-bold">{stats.totalPreguntas}</div>
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 flex flex-col items-center text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                  <Car className="w-5 h-5" />
                </div>
                <div className="text-2xl font-bold">{stats.nivel1}</div>
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Nivel 1 Karimen</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 flex flex-col items-center text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div className="text-2xl font-bold">{stats.nivel2}</div>
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Nivel 2 Honmen</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 flex flex-col items-center text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
                  <Circle className="w-5 h-5" />
                </div>
                <div className="text-2xl font-bold">{stats.pendientesRevision}</div>
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Por Revisar</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Bulk assign exam number */}
        <Card className="border-indigo-200/60">
          <button
            className="w-full text-left"
            onClick={() => setShowBulkAssign(v => !v)}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-600" />
                  <span className="text-indigo-700">Asignar Nº de Examen en lote</span>
                </span>
                {showBulkAssign ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </CardTitle>
            </CardHeader>
          </button>
          {showBulkAssign && (
            <CardContent className="pt-0 space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setBulkModo("asignar")}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                    bulkModo === "asignar"
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  Asignar número
                </button>
                <button
                  onClick={() => setBulkModo("limpiar")}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                    bulkModo === "limpiar"
                      ? "bg-red-500 text-white border-red-500"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  Quitar número
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                {bulkModo === "asignar"
                  ? "Asigna un número de examen a un grupo de preguntas. Usa el límite para asignar solo las primeras N."
                  : "Quita el número de examen de un grupo de preguntas (las deja sin número asignado)."}
              </p>

              <div className="flex flex-wrap gap-4 items-end">
                {/* Shared: ciudad + nivel */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Ciudad</Label>
                  <Select value={bulkCiudad} onValueChange={setBulkCiudad}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CIUDADES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nivel</Label>
                  <Select value={bulkNivel} onValueChange={setBulkNivel}>
                    <SelectTrigger className="w-[155px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Nivel 1 — Karimen</SelectItem>
                      <SelectItem value="2">Nivel 2 — Honmen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {bulkModo === "asignar" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Asignar como Examen Nº</Label>
                      <Input type="number" min="1" max="99" value={bulkExamenNum}
                        onChange={e => setBulkExamenNum(e.target.value)} className="w-20 text-center" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Límite (primeras N)</Label>
                      <Input type="number" min="1" placeholder="Todas"
                        value={bulkLimite} onChange={e => setBulkLimite(e.target.value)} className="w-24 text-center" />
                    </div>
                    <div className="flex items-center gap-2 pb-0.5">
                      <input type="checkbox" id="soloSin" checked={bulkSoloSin}
                        onChange={e => setBulkSoloSin(e.target.checked)} className="rounded" />
                      <Label htmlFor="soloSin" className="text-xs cursor-pointer">Solo las que no tienen número aún</Label>
                    </div>
                    <Button onClick={handleBulkAssign} disabled={bulkLoading || !bulkExamenNum}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white">
                      {bulkLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Layers className="w-4 h-4 mr-2" />}
                      Asignar
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Quitar del Examen Nº (vacío = todos)</Label>
                      <Input type="number" min="1" placeholder="Ej: 1"
                        value={bulkDeExamen} onChange={e => setBulkDeExamen(e.target.value)} className="w-28 text-center" />
                    </div>
                    <Button onClick={handleBulkAssign} disabled={bulkLoading}
                      variant="destructive">
                      {bulkLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <X className="w-4 h-4 mr-2" />}
                      Quitar número
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          )}
        </Card>

        {/* ── Nombres de Exámenes ── */}
        {Object.keys(cityExamNumbers).length > 0 && (
          <Card className="border-violet-200/60">
            <button
              className="w-full text-left"
              onClick={() => setShowExamNames(v => !v)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-violet-600" />
                    <span className="text-violet-700">Nombres de Exámenes</span>
                  </span>
                  {showExamNames ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
              </CardHeader>
            </button>
            {showExamNames && (
              <CardContent className="pt-0 space-y-5">
                <p className="text-xs text-muted-foreground">
                  Asigna nombres personalizados a cada examen (ej. "Saitama 1"). El nombre aparece en la app de práctica en lugar del número.
                </p>
                {CIUDADES.filter(c => (cityExamNumbers[c] ?? []).length > 0).map(ciudad => (
                  <div key={ciudad} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">{ciudad}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-5">
                      {(cityExamNumbers[ciudad] ?? []).map(num => {
                        const key = examSetKey(ciudad, num);
                        const nombre = examNames[ciudad]?.[num] ?? null;
                        const isEditing = editingName === key;
                        return (
                          <div
                            key={num}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                              isEditing
                                ? "border-violet-400 bg-violet-50"
                                : "border-border bg-muted/40 hover:border-violet-300 hover:bg-violet-50/50"
                            )}
                          >
                            <span className="text-xs font-mono text-muted-foreground w-5 text-center">{num}</span>
                            {isEditing ? (
                              <>
                                <input
                                  autoFocus
                                  value={editingNameValue}
                                  onChange={e => setEditingNameValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") saveExamName(ciudad, num);
                                    if (e.key === "Escape") setEditingName(null);
                                  }}
                                  placeholder={`Ej: ${ciudad} ${num}`}
                                  className="text-sm border-0 border-b border-violet-400 bg-transparent px-0 py-0 w-32 focus:outline-none focus:border-violet-600"
                                />
                                <button
                                  onClick={() => saveExamName(ciudad, num)}
                                  disabled={savingName}
                                  className="text-violet-600 hover:text-violet-800"
                                  title="Guardar"
                                >
                                  {savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => setEditingName(null)} className="text-muted-foreground hover:text-foreground" title="Cancelar">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className={cn("font-medium", nombre ? "text-violet-700" : "text-muted-foreground italic")}>
                                  {nombre ?? "Sin nombre"}
                                </span>
                                <button
                                  onClick={() => startEditName(ciudad, num)}
                                  className="text-muted-foreground/50 hover:text-violet-600 transition-colors"
                                  title="Editar nombre"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        )}

        {/* ── Generar Explicaciones en Masa ── */}
        <Card className="border-emerald-200/60">
          <button className="w-full text-left" onClick={() => setShowBulkGen(v => !v)}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-emerald-600" />
                  <span className="text-emerald-700">Generar Explicaciones con IA</span>
                </span>
                {showBulkGen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </CardTitle>
            </CardHeader>
          </button>
          {showBulkGen && (
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Genera y guarda automáticamente explicaciones para las preguntas que ya están revisadas pero no tienen explicación.
                Se procesan <strong>10 preguntas por tandas</strong> — presiona "Continuar" si quedan pendientes.
              </p>
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Ciudad</Label>
                  <Select value={bulkGenCiudad} onValueChange={setBulkGenCiudad}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CIUDADES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Examen Nº</Label>
                  <Input type="number" min="1" max="99" value={bulkGenNumero}
                    onChange={e => setBulkGenNumero(e.target.value)} className="w-20 text-center" />
                </div>
                <Button
                  onClick={handleBulkGenerate}
                  disabled={bulkGenLoading}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {bulkGenLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Generando...</>
                    : <><BrainCircuit className="w-4 h-4 mr-2" />{bulkGenResult?.pendientes ? "Continuar generando" : "Generar explicaciones"}</>
                  }
                </Button>
              </div>
              {bulkGenResult && (
                <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm space-y-1">
                  <p><strong>{bulkGenResult.exitosas}</strong> explicaciones generadas y guardadas</p>
                  {bulkGenResult.errores > 0 && <p className="text-destructive">{bulkGenResult.errores} errores</p>}
                  {bulkGenResult.pendientes > 0
                    ? <p className="text-amber-700">Quedan <strong>{bulkGenResult.pendientes}</strong> preguntas sin explicación — presiona "Continuar" para seguir.</p>
                    : <p className="text-emerald-700 font-medium">¡Todas las preguntas de este examen ya tienen explicación!</p>
                  }
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* ── Generar Embeddings Semánticos ── */}
        <Card className="border-blue-200/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-blue-600" />
                <span className="text-blue-700">Búsqueda Semántica — Generar Embeddings</span>
              </span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Genera representaciones vectoriales de cada pregunta para que el bot detecte preguntas similares aunque usen palabras distintas. Procesa <strong>100 por tanda</strong> (~$0.001 total). Ejecuta varias veces hasta que no queden pendientes.
            </p>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              <Button
                onClick={handleBulkEmbeddings}
                disabled={embLoading}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {embLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Generando...</>
                  : <><BrainCircuit className="w-4 h-4 mr-2" />{embResult?.pendientes ? "Continuar generando" : "Generar embeddings"}</>
                }
              </Button>
              {embResult && (
                <div className="rounded-lg border bg-muted/40 px-4 py-2 text-sm space-y-0.5">
                  <p><strong>{embResult.exitosas}</strong> embeddings guardados</p>
                  {embResult.errores > 0 && <p className="text-destructive">{embResult.errores} errores</p>}
                  {embResult.pendientes > 0
                    ? <p className="text-amber-700">Quedan <strong>{embResult.pendientes}</strong> — presiona "Continuar"</p>
                    : <p className="text-blue-700 font-medium">✓ Todas las preguntas tienen embedding</p>
                  }
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {Object.keys(porCiudad).length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Preguntas por Ciudad
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(porCiudad)
                  .sort(([, a], [, b]) => b - a)
                  .map(([ciudad, count]) => (
                    <button
                      key={ciudad}
                      onClick={() => setFilterCiudad(filterCiudad === ciudad ? "todas" : ciudad)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        filterCiudad === ciudad
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 border-border hover:bg-muted"
                      }`}
                    >
                      {ciudad}
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        filterCiudad === ciudad ? "bg-primary-foreground/20" : "bg-background"
                      }`}>
                        {count}
                      </span>
                    </button>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div className="flex items-baseline gap-3">
              <CardTitle className="text-xl font-semibold">Preguntas</CardTitle>
              {questionsData && (
                <span className="text-sm text-muted-foreground">
                  {questionsData.total} {questionsData.total === 1 ? "pregunta" : "preguntas"}
                  {questionsData.items.length < questionsData.total && ` (mostrando ${questionsData.items.length})`}
                </span>
              )}
            </div>
            <Link href="/admin/analizar">
              <Button>Agregar con IA</Button>
            </Link>
          </CardHeader>
          <div className="px-6 pb-4 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar por palabra clave..." 
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filterCiudad} onValueChange={setFilterCiudad}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Ciudad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las ciudades</SelectItem>
                {CIUDADES.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(() => {
              if (filterCiudad === "todas") {
                return (
                  <div className="relative w-[120px]">
                    <Input
                      type="number"
                      min="1"
                      placeholder="Examen nº"
                      value={filterExamenNumero}
                      onChange={e => setFilterExamenNumero(e.target.value)}
                      className="text-center pr-6"
                    />
                    {filterExamenNumero && (
                      <button
                        onClick={() => setFilterExamenNumero("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              }
              const allNums = cityExamNumbers[filterCiudad] ?? [];
              if (allNums.length === 0) {
                return (
                  <div className="relative w-[140px]">
                    <Input
                      type="number" min="1" placeholder="Examen nº"
                      value={filterExamenNumero}
                      onChange={e => setFilterExamenNumero(e.target.value)}
                      className="text-center pr-6"
                    />
                    {filterExamenNumero && (
                      <button onClick={() => setFilterExamenNumero("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              }
              return (
                <Select
                  value={filterExamenNumero || "__all__"}
                  onValueChange={v => setFilterExamenNumero(v === "__all__" ? "" : v)}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Examen nº" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos los exámenes</SelectItem>
                    {allNums.map(num => {
                      const nombre = examNames[filterCiudad]?.[num] ?? null;
                      return (
                        <SelectItem key={num} value={String(num)}>
                          {nombre ? `Examen ${num} — ${nombre}` : `Examen ${num}`}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              );
            })()}
          </div>
          <div className="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[42px] text-right text-muted-foreground/60 pr-3">#</TableHead>
                  <TableHead className="w-[50px] text-center">Niv</TableHead>
                  <TableHead className="w-[100px]">Ciudad</TableHead>
                  <TableHead>Pregunta</TableHead>
                  <TableHead className="w-[80px] text-center">Rpta</TableHead>
                  <TableHead className="w-[60px] text-center">Imgs</TableHead>
                  <TableHead className="w-[90px] text-center">Estado</TableHead>
                  <TableHead className="w-[90px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      Cargando preguntas...
                    </TableCell>
                  </TableRow>
                ) : questions?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      No se encontraron preguntas.
                    </TableCell>
                  </TableRow>
                ) : (
                  questions?.map((q, idx) => {
                    const imgCount = ((q as any).imagenesUrls as string[] | null)?.length
                      ?? ((q as any).imagenUrl ? 1 : 0);
                    return (
                      <React.Fragment key={q.id}><TableRow className="group/row">
                        <TableCell className="text-right text-xs text-muted-foreground/50 font-mono pr-3">{idx + 1}</TableCell>
                        <TableCell className="text-center font-medium">{q.nivel}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            {q.ciudad ? (
                              <Badge variant="outline" className="text-xs font-normal w-fit">
                                {q.ciudad}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                            {(q as Question).examenNumero != null && q.ciudad && (() => {
                              const num = (q as Question).examenNumero!;
                              const ciudad = q.ciudad!;
                              const key = examSetKey(ciudad, num);
                              const nombre = getExamName(ciudad, num);
                              const isEditing = editingName === key;
                              return (
                                <div className="flex items-center gap-0.5 mt-0.5">
                                  {isEditing ? (
                                    <>
                                      <input
                                        autoFocus
                                        value={editingNameValue}
                                        onChange={e => setEditingNameValue(e.target.value)}
                                        onKeyDown={e => {
                                          if (e.key === "Enter") saveExamName(ciudad, num);
                                          if (e.key === "Escape") setEditingName(null);
                                        }}
                                        placeholder={`Examen ${num}`}
                                        className="text-[10px] border border-indigo-300 rounded px-1 py-0 w-28 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                      />
                                      <button
                                        onClick={() => saveExamName(ciudad, num)}
                                        disabled={savingName}
                                        className="text-indigo-600 hover:text-indigo-800 ml-0.5"
                                        title="Guardar"
                                      >
                                        {savingName ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                      </button>
                                      <button onClick={() => setEditingName(null)} className="text-muted-foreground hover:text-foreground" title="Cancelar">
                                        <X className="w-3 h-3" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-[10px] text-indigo-600 font-medium">
                                        {nombre ? `Examen ${num} — ${nombre}` : `Examen ${num}`}
                                      </span>
                                      <button
                                        onClick={() => startEditName(ciudad, num)}
                                        className="text-indigo-300 hover:text-indigo-600 ml-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity"
                                        title="Editar nombre"
                                      >
                                        <Pencil className="w-2.5 h-2.5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <span className="line-clamp-2 text-sm">{q.pregunta}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={q.respuesta ? "default" : "destructive"}>
                            {q.respuesta ? "V" : "F"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {imgCount > 0 ? (
                            <span className="flex items-center justify-center gap-1 text-purple-600">
                              <ImageIcon className="w-3.5 h-3.5" />
                              <span className="text-xs font-medium">{imgCount}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/30 text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {q.revisado ? (
                            <span className="text-green-600 flex items-center justify-center gap-1 text-xs font-medium">
                              <CheckCircle2 className="w-3 h-3" /> OK
                            </span>
                          ) : (
                            <span className="text-orange-500 flex items-center justify-center gap-1 text-xs font-medium">
                              <Circle className="w-3 h-3" /> PEND
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-purple-500 hover:text-purple-700 hover:bg-purple-50"
                              title="Re-analizar con IA"
                              disabled={analyzingId !== null}
                              onClick={() => analyzeQuestion(q as Question)}
                            >
                              {analyzingId === q.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <RotateCcw className="w-4 h-4" />
                              }
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => setEditingQuestion(q as Question)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDelete(q.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {analyzeResults[q.id] && (
                        <TableRow key={`ai-${q.id}`} className={cn(
                          "hover:bg-opacity-80",
                          analyzeResults[q.id].respuesta === q.respuesta
                            ? "bg-green-50/60 hover:bg-green-50/80"
                            : "bg-orange-50/60 hover:bg-orange-50/80"
                        )}>
                          <TableCell colSpan={2} />
                          <TableCell colSpan={6} className="py-2 pr-4">
                            <div className="flex items-start gap-3">
                              <div className="flex items-center gap-1.5 shrink-0 mt-0.5 flex-wrap">
                                <BrainCircuit className="w-3.5 h-3.5 text-purple-500" />
                                <span className="text-xs font-semibold text-purple-700">IA sin contexto:</span>
                                <span className={cn(
                                  "text-xs font-bold px-1.5 py-0.5 rounded",
                                  analyzeResults[q.id].respuesta ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"
                                )}>
                                  {analyzeResults[q.id].respuesta ? "V" : "F"}
                                </span>
                                {analyzeResults[q.id].respuesta === q.respuesta ? (
                                  <span className="text-xs text-green-600 flex items-center gap-0.5 font-semibold">
                                    <ThumbsUp className="w-3 h-3" /> Coincide — la IA lo sabe sola
                                  </span>
                                ) : (
                                  <span className="text-xs text-orange-600 flex items-center gap-0.5 font-semibold">
                                    <AlertTriangle className="w-3 h-3" /> La IA sola se equivoca — tu corrección protege a los alumnos
                                  </span>
                                )}
                                <span className={cn(
                                  "text-[10px] px-1 py-0.5 rounded ml-1",
                                  analyzeResults[q.id].confianza === "alta" ? "bg-green-100 text-green-700" :
                                  analyzeResults[q.id].confianza === "media" ? "bg-yellow-100 text-yellow-700" :
                                  "bg-red-100 text-red-700"
                                )}>
                                  {analyzeResults[q.id].confianza}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                                {analyzeResults[q.id].explicacion}
                                {analyzeResults[q.id].advertencia && (
                                  <span className="text-orange-600 ml-1">⚠ {analyzeResults[q.id].advertencia}</span>
                                )}
                              </p>
                              <button
                                onClick={() => setAnalyzeResults(prev => { const n = {...prev}; delete n[q.id]; return n; })}
                                className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                                title="Cerrar"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {editingQuestion && (
        <EditDialog
          question={editingQuestion}
          open={!!editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSaved={handleSaved}
        />
      )}
    </AdminLayout>
  );
}
