import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useCreateExamSession } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Layout } from "@/components/Layout";
import { Car, GraduationCap, Loader2, ChevronLeft, Shuffle, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CIUDADES = [
  { id: "Saitama",  flag: "🏙️" },
  { id: "Tokyo",    flag: "🗼" },
  { id: "Chiba",    flag: "🌊" },
  { id: "Kanagawa", flag: "⛵" },
  { id: "Tochigi",  flag: "🍂" },
  { id: "Nagoya",   flag: "🏯" },
  { id: "Osaka",    flag: "🌸" },
];

type Step = "ciudad" | "tipo" | "examen";

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createSession = useCreateExamSession();

  const [step, setStep] = useState<Step>("ciudad");
  const [selectedCiudad, setSelectedCiudad] = useState<string | null>(null);
  const [selectedNivel, setSelectedNivel] = useState<1 | 2 | null>(null);
  type ExamenInfo = { numero: number; nombre: string | null };
  const [examenesDisponibles, setExamenesDisponibles] = useState<ExamenInfo[]>([]);
  const [loadingExamenes, setLoadingExamenes] = useState(false);
  const [starting, setStarting] = useState(false);

  const handleCiudadSelect = (ciudad: string) => {
    setSelectedCiudad(ciudad);
    setStep("tipo");
  };

  const handleNivelSelect = async (nivel: 1 | 2) => {
    setSelectedNivel(nivel);
    setLoadingExamenes(true);
    try {
      const res = await fetch(
        `/api/exam/questions/examen-numeros?nivel=${nivel}&ciudad=${selectedCiudad ?? ""}`
      );
      const data = await res.json();
      const numeros: number[] = data.numeros ?? [];
      const examenes: { numero: number; nombre: string | null }[] =
        data.examenes ?? numeros.map((n: number) => ({ numero: n, nombre: null }));
      setExamenesDisponibles(examenes);
      if (numeros.length === 0) {
        // Sin exámenes numerados: iniciar directamente
        await startSession(nivel, null);
      } else {
        setStep("examen");
      }
    } catch {
      // Si falla la consulta, iniciar aleatorio
      await startSession(nivel, null);
    } finally {
      setLoadingExamenes(false);
    }
  };

  const startSession = async (nivel: 1 | 2, examenNumero: number | null) => {
    setStarting(true);
    try {
      const session = await createSession.mutateAsync({
        data: {
          nivel,
          ciudad: selectedCiudad ?? undefined,
          examenNumero: examenNumero ?? undefined,
        },
      });
      setLocation(`/examen/${session.sessionId}`);
    } catch (error: any) {
      const msg = error?.response?.data?.error ?? "No se pudo crear la sesión. Intenta nuevamente.";
      toast({
        title: "Error al iniciar el examen",
        description: msg,
        variant: "destructive",
      });
      setStarting(false);
    }
  };

  const ciudadInfo = CIUDADES.find(c => c.id === selectedCiudad);
  const nivelLabel = selectedNivel === 1 ? "Karimen" : "Honmen";

  // ── Step: examen ──────────────────────────────────────────────────────────
  if (step === "examen" && selectedCiudad && selectedNivel) {
    return (
      <Layout>
        <div className="w-full max-w-3xl space-y-10">
          <div className="text-center space-y-3">
            <button
              onClick={() => { setStep("tipo"); setExamenesDisponibles([]); }}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Cambiar tipo
            </button>
            <h1 className="text-3xl font-bold tracking-tight text-primary">
              {ciudadInfo?.flag} {selectedCiudad} — {nivelLabel}
            </h1>
            <p className="text-muted-foreground">¿Qué examen quieres practicar?</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {/* Aleatorio */}
            <button
              onClick={() => startSession(selectedNivel, null)}
              disabled={starting}
              className={cn(
                "flex flex-col items-center justify-center gap-3 p-6 rounded-xl",
                "border-2 border-dashed border-border/60 bg-card",
                "hover:bg-accent hover:border-primary/40 hover:shadow-md",
                "transition-all duration-200 text-center font-medium",
                starting && "opacity-50 pointer-events-none"
              )}
            >
              {starting ? (
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              ) : (
                <Shuffle className="w-8 h-8 text-muted-foreground" />
              )}
              <span className="text-sm font-semibold">Aleatorio</span>
              <span className="text-xs text-muted-foreground">Mezcla todas las preguntas</span>
            </button>

            {/* Exámenes numerados */}
            {examenesDisponibles.map(ex => (
              <button
                key={ex.numero}
                onClick={() => startSession(selectedNivel, ex.numero)}
                disabled={starting}
                className={cn(
                  "flex flex-col items-center justify-center gap-3 p-6 rounded-xl",
                  "border-2 border-border/60 bg-card",
                  "hover:bg-accent hover:border-primary/40 hover:shadow-md",
                  "transition-all duration-200 text-center font-medium",
                  starting && "opacity-50 pointer-events-none"
                )}
              >
                <BookOpen className="w-8 h-8 text-primary" />
                <span className="text-sm font-semibold">
                  {ex.nombre ?? `Examen ${ex.numero}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ex.nombre ? `Examen ${ex.numero}` : `Preguntas del examen ${ex.numero}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  // ── Step: tipo ────────────────────────────────────────────────────────────
  if (step === "tipo" && selectedCiudad) {
    return (
      <Layout>
        <div className="w-full max-w-4xl space-y-10">
          <div className="text-center space-y-3">
            <button
              onClick={() => { setStep("ciudad"); setSelectedCiudad(null); }}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Cambiar ciudad
            </button>
            <h1 className="text-4xl font-bold tracking-tight text-primary">
              {ciudadInfo?.flag} {selectedCiudad}
            </h1>
            <p className="text-muted-foreground">Elige el tipo de examen que quieres practicar</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <Card className="flex flex-col hover-elevate transition-all border-border/60 overflow-hidden group">
              <div className="h-2 w-full bg-primary/20 group-hover:bg-primary transition-colors" />
              <CardHeader className="text-center pb-2">
                <div className="mx-auto w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
                  <Car className="w-7 h-7" />
                </div>
                <CardTitle className="text-2xl">仮免 Karimen</CardTitle>
                <CardDescription className="text-base mt-2">
                  Permiso provisional de conducir
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 text-center text-muted-foreground space-y-3">
                <p>Conocimientos básicos de las normas de tránsito japonesas.</p>
                <div className="inline-flex items-center gap-2 bg-primary/5 rounded-full px-4 py-2 text-sm font-medium text-primary">
                  50 preguntas · Aprobado ≥ 45 correctas
                </div>
              </CardContent>
              <CardFooter className="pb-8 pt-4 justify-center">
                <Button
                  size="lg"
                  className="w-full sm:w-auto px-10"
                  onClick={() => handleNivelSelect(1)}
                  disabled={loadingExamenes || starting}
                >
                  {loadingExamenes && selectedNivel === 1 ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...</>
                  ) : "Comenzar Karimen"}
                </Button>
              </CardFooter>
            </Card>

            <Card className="flex flex-col hover-elevate transition-all border-border/60 overflow-hidden group">
              <div className="h-2 w-full bg-sidebar-primary/20 group-hover:bg-sidebar-primary transition-colors" />
              <CardHeader className="text-center pb-2">
                <div className="mx-auto w-14 h-14 bg-sidebar-primary/10 rounded-full flex items-center justify-center mb-4 text-sidebar-primary">
                  <GraduationCap className="w-7 h-7" />
                </div>
                <CardTitle className="text-2xl">本免 Honmen</CardTitle>
                <CardDescription className="text-base mt-2">
                  Licencia definitiva de conducir
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 text-center text-muted-foreground space-y-3">
                <p>Situaciones avanzadas y normas complejas de conducción en Japón.</p>
                <div className="inline-flex items-center gap-2 bg-sidebar-primary/5 rounded-full px-4 py-2 text-sm font-medium text-sidebar-primary">
                  100 preguntas · Aprobado ≥ 90 correctas
                </div>
              </CardContent>
              <CardFooter className="pb-8 pt-4 justify-center">
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full sm:w-auto px-10"
                  onClick={() => handleNivelSelect(2)}
                  disabled={loadingExamenes || starting}
                >
                  {loadingExamenes && selectedNivel === 2 ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...</>
                  ) : "Comenzar Honmen"}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Step: ciudad ──────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="w-full max-w-3xl space-y-10">
        <div className="text-center space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-primary">
            Práctica de Exámenes
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Selecciona tu ciudad para empezar a practicar con las preguntas reales de tu examen.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {CIUDADES.map((c) => (
            <button
              key={c.id}
              onClick={() => handleCiudadSelect(c.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-3 p-6 rounded-xl",
                "border-2 border-border/60 bg-card",
                "hover:bg-accent hover:border-primary/40 hover:shadow-md",
                "transition-all duration-200 text-center font-medium"
              )}
            >
              <span className="text-4xl">{c.flag}</span>
              <span className="text-sm font-semibold">{c.id}</span>
            </button>
          ))}
        </div>
      </div>
    </Layout>
  );
}
