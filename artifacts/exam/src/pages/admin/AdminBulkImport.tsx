import { useState, useRef } from "react";
import { useCreateExamQuestion } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  ImagePlus,
  X,
  Loader2,
  Save,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CIUDADES = ["Saitama", "Tokyo", "Chiba", "Kanagawa", "Tochigi", "Nagoya", "Osaka"];

interface QuestionRow {
  id: string;
  pregunta: string;
  respuesta: boolean;
  explicacion: string;
  imagenUrl: string | null;
  imagePreview: string | null;
  uploadingImage: boolean;
  saved: boolean;
  saving: boolean;
}

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

function parseLineas(text: string): string[] {
  // Normalizar saltos de línea de Word (\r\n, \r) y otros
  const lines = text.split(/\r\n|\r|\n/);
  const result: string[] = [];
  let current: string[] = [];
  let inQuestion = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Acepta: "1. ", "1- ", "1) ", "1.- ", "1.) " etc. (uno o más separadores, texto opcional)
    const match = trimmed.match(/^(\d+)[.\-)]+\s*(.*)/);
    if (match) {
      // Guardar la pregunta anterior si existe
      if (inQuestion && current.length > 0) {
        const q = current.join(" ").trim();
        if (q.length > 5) result.push(q);
      }
      const texto = match[2].trim();
      current = texto ? [texto] : [];
      inQuestion = true;
    } else if (inQuestion) {
      current.push(trimmed);
    }
  }
  // Última pregunta
  if (inQuestion && current.length > 0) {
    const q = current.join(" ").trim();
    if (q.length > 5) result.push(q);
  }

  return result;
}

let rowCounter = 0;
function newRow(pregunta = "", respuesta = true): QuestionRow {
  return {
    id: `row-${++rowCounter}`,
    pregunta,
    respuesta,
    explicacion: "",
    imagenUrl: null,
    imagePreview: null,
    uploadingImage: false,
    saved: false,
    saving: false,
  };
}

export default function AdminBulkImport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateExamQuestion();

  const [nivel, setNivel] = useState<"1" | "2">("1");
  const [ciudad, setCiudad] = useState("Saitama");
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<QuestionRow[]>([newRow()]);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const parseAndLoad = () => {
    const parsed = parseLineas(pasteText);
    if (parsed.length === 0) {
      toast({ title: "No se detectaron preguntas numeradas", variant: "destructive" });
      return;
    }
    setRows(parsed.map(p => newRow(p, true)));
    setPasteText("");
    toast({ title: `${parsed.length} preguntas cargadas — marca V/F para cada una antes de guardar. Se guardarán como pendientes de revisión.` });
  };

  const updateRow = (id: string, patch: Partial<QuestionRow>) => {
    setRows(r => r.map(row => row.id === id ? { ...row, ...patch } : row));
  };

  const removeRow = (id: string) => {
    setRows(r => r.filter(row => row.id !== id));
  };

  const addRow = () => {
    setRows(r => [...r, newRow()]);
  };

  const handleImageSelect = async (id: string, file: File) => {
    updateRow(id, { uploadingImage: true });
    try {
      const objectPath = await uploadImage(file);
      const preview = URL.createObjectURL(file);
      updateRow(id, { imagenUrl: objectPath, imagePreview: preview, uploadingImage: false });
    } catch {
      toast({ title: "Error al subir la imagen", variant: "destructive" });
      updateRow(id, { uploadingImage: false });
    }
  };

  const removeImage = (id: string) => {
    updateRow(id, { imagenUrl: null, imagePreview: null });
  };

  const saveAll = async () => {
    const pending = rows.filter(r => !r.saved && r.pregunta.trim().length > 0);
    if (pending.length === 0) {
      toast({ title: "No hay preguntas para guardar" });
      return;
    }
    let saved = 0;
    let errors = 0;
    for (const row of pending) {
      updateRow(row.id, { saving: true });
      try {
        await createMutation.mutateAsync({
          data: {
            pregunta: row.pregunta.trim(),
            respuesta: row.respuesta,
            explicacion: row.explicacion.trim() || null,
            nivel: Number(nivel),
            ciudad,
            imagenUrl: row.imagenUrl ?? null,
            imagenesUrls: row.imagenUrl ? [row.imagenUrl] : null,
            fuente: "libro_oficial",
            revisado: false,
          },
        });
        updateRow(row.id, { saved: true, saving: false });
        saved++;
      } catch {
        updateRow(row.id, { saving: false });
        errors++;
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/exam/questions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/exam/stats"] });
    if (errors === 0) {
      toast({ title: `✅ ${saved} preguntas guardadas al banco oficial` });
    } else {
      toast({
        title: `${saved} guardadas, ${errors} con error`,
        variant: "destructive",
      });
    }
  };

  const pendingCount = rows.filter(r => !r.saved && r.pregunta.trim().length > 0).length;
  const savedCount = rows.filter(r => r.saved).length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="w-6 h-6" />
            Importar del Libro
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Carga preguntas del libro. Se guardan como <strong>pendientes de revisión</strong> — la respuesta marcada aquí es provisional.
            Ve a la sección de Preguntas para verificar cada una individualmente y la IA podrá usarlas como referencia.
          </p>
        </div>

        {/* Config */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <Label>Tipo de examen</Label>
                <Select value={nivel} onValueChange={v => setNivel(v as "1" | "2")}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Nivel 1 — Karimen (50 preg.)</SelectItem>
                    <SelectItem value="2">Nivel 2 — Honmen (100 preg.)</SelectItem>
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
                    {CIUDADES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Paste area */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              Pegar lista de preguntas
            </CardTitle>
            <CardDescription>
              Pega las preguntas numeradas del libro (ej: "1. Al conducir en autopista…").
              Cada número crea una fila separada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={"1. Al conducir en autopista, el límite es 100km/h.\n2. En zona escolar el límite es 30km/h.\n3. ..."}
              className="min-h-[120px] font-mono text-sm"
            />
            <Button onClick={parseAndLoad} disabled={!pasteText.trim()} variant="outline" size="sm">
              <ClipboardList className="w-4 h-4 mr-2" />
              Cargar preguntas
            </Button>
          </CardContent>
        </Card>

        {/* Question rows */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  Preguntas — {rows.length} total
                  {savedCount > 0 && <span className="ml-2 text-green-600 text-sm font-normal">({savedCount} guardadas)</span>}
                </CardTitle>
                <CardDescription>
                  Para cada pregunta, selecciona la respuesta correcta del libro. La imagen es opcional (solo para preguntas con figura).
                </CardDescription>
              </div>
              <Button onClick={addRow} variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-1" />
                Añadir fila
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((row, idx) => (
              <div
                key={row.id}
                className={cn(
                  "border rounded-lg p-4 space-y-3 transition-colors",
                  row.saved ? "border-green-200 bg-green-50/50" : "border-border bg-card"
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs text-muted-foreground mt-2 w-5 shrink-0 text-right">{idx + 1}</span>

                  {/* Question text */}
                  <Input
                    value={row.pregunta}
                    onChange={e => updateRow(row.id, { pregunta: e.target.value })}
                    placeholder="Texto de la pregunta..."
                    className="flex-1"
                    disabled={row.saved}
                  />

                  {/* V/F toggle */}
                  <button
                    onClick={() => updateRow(row.id, { respuesta: !row.respuesta })}
                    disabled={row.saved}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold border shrink-0 transition-colors",
                      row.respuesta
                        ? "bg-green-100 border-green-300 text-green-700 hover:bg-green-200"
                        : "bg-red-100 border-red-300 text-red-700 hover:bg-red-200",
                      row.saved && "opacity-60 cursor-default"
                    )}
                  >
                    {row.respuesta
                      ? <><CheckCircle2 className="w-4 h-4" /> VERDADERO</>
                      : <><XCircle className="w-4 h-4" /> FALSO</>
                    }
                  </button>

                  {/* Delete */}
                  {!row.saved && (
                    <button
                      onClick={() => removeRow(row.id)}
                      className="text-muted-foreground hover:text-destructive mt-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {row.saved && (
                    <Badge variant="outline" className="border-green-300 text-green-700 mt-1.5 shrink-0">
                      Guardada
                    </Badge>
                  )}
                </div>

                {/* Explanation (optional) */}
                <div className="pl-8">
                  <Input
                    value={row.explicacion}
                    onChange={e => updateRow(row.id, { explicacion: e.target.value })}
                    placeholder="Explicación breve (opcional)..."
                    className="text-sm"
                    disabled={row.saved}
                  />
                </div>

                {/* Image */}
                <div className="pl-8 flex items-center gap-3">
                  {row.imagePreview ? (
                    <div className="relative">
                      <img src={row.imagePreview} alt="figura" className="h-16 w-16 object-contain border rounded" />
                      {!row.saved && (
                        <button
                          onClick={() => removeImage(row.id)}
                          className="absolute -top-1 -right-1 bg-white rounded-full shadow text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ) : !row.saved ? (
                    <button
                      onClick={() => fileInputRefs.current[row.id]?.click()}
                      disabled={row.uploadingImage}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground border border-dashed rounded px-3 py-1.5 hover:text-foreground hover:border-foreground transition-colors"
                    >
                      {row.uploadingImage
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <ImagePlus className="w-3.5 h-3.5" />
                      }
                      Figura (opcional)
                    </button>
                  ) : null}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={el => { fileInputRefs.current[row.id] = el; }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleImageSelect(row.id, file);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Save button */}
        <div className="flex justify-end pb-8">
          <Button
            onClick={saveAll}
            disabled={pendingCount === 0 || createMutation.isPending}
            size="lg"
            className="gap-2"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar {pendingCount > 0 ? `${pendingCount} preguntas` : "todas"} al banco
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
