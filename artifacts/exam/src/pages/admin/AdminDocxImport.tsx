import { useState, useRef, useCallback } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  Upload,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CIUDADES = ["Saitama", "Tokyo", "Chiba", "Kanagawa", "Tochigi", "Nagoya", "Osaka"];

type ParsedQuestion = {
  pregunta: string;
  respuesta: boolean | null;
};

type PreviewResult = {
  total: number;
  preguntas: ParsedQuestion[];
  rawText: string;
};

type SaveResult = {
  saved: number;
  sinRespuesta: number;
};

type Step = "upload" | "preview" | "saving" | "done";

export default function AdminDocxImport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [nivel, setNivel] = useState("1");
  const [ciudad, setCiudad] = useState("Saitama");
  const [examenNumero, setExamenNumero] = useState("");
  const [step, setStep] = useState<Step>("upload");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [errorRawText, setErrorRawText] = useState<string | null>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.name.match(/\.(docx|doc)$/i)) {
      toast({ title: "Solo archivos Word (.docx)", variant: "destructive" });
      return;
    }
    setFile(f);
    setStep("upload");
    setPreview(null);
  }, [toast]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    setErrorRawText(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const examenParam = examenNumero ? `&examenNumero=${examenNumero}` : "";
      const res = await fetch(`/api/exam/questions/import-docx?guardar=false&nivel=${nivel}&ciudad=${ciudad}${examenParam}`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.rawText) setErrorRawText(data.rawText);
        throw new Error(data.error ?? "Error al analizar");
      }
      setPreview(data as PreviewResult);
      setStep("preview");
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setStep("saving");
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const examenParam2 = examenNumero ? `&examenNumero=${examenNumero}` : "";
      const res = await fetch(`/api/exam/questions/import-docx?guardar=true&nivel=${nivel}&ciudad=${ciudad}${examenParam2}`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al importar");
      setSaveResult(data as SaveResult);
      setStep("done");
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSaveResult(null);
    setStep("upload");
    setShowRaw(false);
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <FileUp className="w-8 h-8 text-primary" />
            Importar desde Word
          </h1>
          <p className="text-muted-foreground mt-2">
            Sube un archivo .docx con las preguntas. Funciona con preguntas numeradas (1. 2. 3.) o como párrafos separados. Las respuestas ○/× / Verdadero/Falso se detectan automáticamente.
          </p>
        </div>

        {/* Config */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configuración</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 flex-wrap">
              <div className="space-y-1.5 flex-1 min-w-[180px]">
                <Label>Nivel del examen</Label>
                <Select value={nivel} onValueChange={setNivel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Nivel 1 — Karimen (50 preguntas)</SelectItem>
                    <SelectItem value="2">Nivel 2 — Honmen (100 preguntas)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex-1 min-w-[140px]">
                <Label>Ciudad</Label>
                <Select value={ciudad} onValueChange={setCiudad}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CIUDADES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 w-32">
                <Label>Nº de Examen</Label>
                <Input
                  type="number"
                  min="1"
                  max="99"
                  placeholder="Ej: 1"
                  value={examenNumero}
                  onChange={e => setExamenNumero(e.target.value)}
                  className="text-center"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload zone */}
        {step === "upload" && (
          <Card>
            <CardContent className="pt-6">
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
                )}
              >
                <div className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center",
                  file ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground"
                )}>
                  {file ? <CheckCircle2 className="w-8 h-8" /> : <Upload className="w-8 h-8" />}
                </div>
                {file ? (
                  <div className="text-center">
                    <p className="font-semibold text-lg">{file.name}</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      {(file.size / 1024).toFixed(0)} KB — haz clic para cambiar
                    </p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="font-semibold text-lg">Arrastra tu archivo Word aquí</p>
                    <p className="text-muted-foreground text-sm mt-1">o haz clic para buscar · solo .docx</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.doc"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              {file && (
                <div className="mt-4 flex justify-end">
                  <Button onClick={handleAnalyze} disabled={loading} size="lg">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
                    Analizar documento
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Debug raw text when parse fails */}
        {step === "upload" && errorRawText && (
          <Card className="border-orange-200 bg-orange-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-orange-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Texto extraído del documento (primeros 1000 caracteres)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-orange-700 mb-2">
                El analizador espera líneas que empiecen con número: <code className="bg-orange-100 px-1 rounded">1.</code> <code className="bg-orange-100 px-1 rounded">2)</code> <code className="bg-orange-100 px-1 rounded">問1</code>, etc.
              </p>
              <pre className="text-xs bg-white border border-orange-200 rounded p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-60">
                {errorRawText}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Preview */}
        {step === "preview" && preview && (
          <div className="space-y-4">
            <Card className="border-blue-200 bg-blue-50/30">
              <CardContent className="pt-5 flex items-start gap-4">
                <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-semibold text-blue-800">
                    Se detectaron <span className="text-2xl">{preview.total}</span> preguntas en el documento
                  </p>
                  <p className="text-sm text-blue-700">
                    Las preguntas sin respuesta detectada quedan como "Pendiente" — podrás corregirlas con Revisión Rápida.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Sample preview (first 20) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Vista previa (primeras {preview.preguntas.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-96 overflow-y-auto">
                {preview.preguntas.map((q, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b last:border-0">
                    <span className="text-muted-foreground text-xs font-mono mt-1 w-6 shrink-0">{i + 1}</span>
                    <p className="text-sm flex-1 leading-relaxed">{q.pregunta}</p>
                    {q.respuesta !== null ? (
                      <Badge variant={q.respuesta ? "default" : "destructive"} className="shrink-0">
                        {q.respuesta ? "V" : "F"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-orange-500 border-orange-300">
                        PEND
                      </Badge>
                    )}
                  </div>
                ))}
                {preview.total > 20 && (
                  <p className="text-center text-sm text-muted-foreground pt-2">
                    ... y {preview.total - 20} preguntas más
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Raw text preview */}
            <button
              onClick={() => setShowRaw(v => !v)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {showRaw ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Ver texto extraído del documento
            </button>
            {showRaw && (
              <pre className="text-xs bg-muted/50 border rounded-lg p-4 max-h-48 overflow-auto whitespace-pre-wrap font-mono">
                {preview.rawText}
              </pre>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={reset}>Cancelar</Button>
              <Button onClick={handleImport} size="lg" className="flex-1">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Importar {preview.total} preguntas a la base de datos
              </Button>
            </div>
          </div>
        )}

        {/* Saving */}
        {step === "saving" && (
          <Card>
            <CardContent className="pt-10 pb-10 flex flex-col items-center gap-6">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-semibold text-lg">Importando preguntas...</p>
                <p className="text-muted-foreground text-sm mt-1">Esto puede tardar unos segundos</p>
              </div>
              <Progress className="w-full max-w-sm" value={undefined} />
            </CardContent>
          </Card>
        )}

        {/* Done */}
        {step === "done" && saveResult && (
          <Card className="border-green-200 bg-green-50/30">
            <CardContent className="pt-10 pb-10 flex flex-col items-center gap-6">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-2xl font-bold text-green-800">¡{saveResult.saved} preguntas importadas!</p>
                {saveResult.sinRespuesta > 0 && (
                  <p className="text-sm text-orange-700 flex items-center justify-center gap-1">
                    <Circle className="w-4 h-4" />
                    {saveResult.sinRespuesta} sin respuesta detectada — ve a <strong>Revisión Rápida</strong> para completarlas
                  </p>
                )}
                {saveResult.sinRespuesta === 0 && (
                  <p className="text-sm text-green-700">Todas las respuestas fueron detectadas automáticamente</p>
                )}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={reset}>Importar otro archivo</Button>
                <Button onClick={() => window.location.href = "/exam/admin/revision"}>
                  Ir a Revisión Rápida
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Format tips */}
        <Card className="bg-muted/30 border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Formatos de Word compatibles</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>✓ <code className="bg-background px-1 rounded">1. Esta señal indica... ○</code> — respuesta al final de la línea</p>
            <p>✓ <code className="bg-background px-1 rounded">1. Esta señal indica...</code> seguido de <code className="bg-background px-1 rounded">○</code> o <code className="bg-background px-1 rounded">×</code> en la siguiente línea</p>
            <p>✓ <code className="bg-background px-1 rounded">問1. Esta señal...</code> — formato japonés</p>
            <p>✓ <code className="bg-background px-1 rounded">1) Esta señal... V</code> o <code className="bg-background px-1 rounded">F</code> al final</p>
            <p className="pt-1 text-orange-600">Si el documento tiene imágenes, se importan solo los textos y luego agregas las fotos manualmente en "Banco de Preguntas" → lápiz ✏️</p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
