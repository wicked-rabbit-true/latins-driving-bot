import { useParams, Link } from "wouter";
import { 
  useGetExamSession, 
  getGetExamSessionQueryKey 
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Layout } from "@/components/Layout";
import { Loader2, Trophy, AlertTriangle, ArrowRight, Home } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export default function ExamResult() {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  
  const { data: session, isLoading, isError } = useGetExamSession(id, {
    query: {
      enabled: !!id,
      queryKey: getGetExamSessionQueryKey(id)
    }
  });

  if (isLoading || !session) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Cargando resultados...</p>
        </div>
      </Layout>
    );
  }

  if (isError) {
    return (
      <Layout>
        <Card className="max-w-md mx-auto border-destructive">
          <CardContent className="pt-6 text-center space-y-4">
            <p>No se pudo cargar el resultado de la sesión.</p>
            <Link href="/">
              <Button>Volver al inicio</Button>
            </Link>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  const percentage = Math.round((session.correctas / session.totalPreguntas) * 100);
  const passed = percentage >= 90;
  const examenNombre = session.nivel === 1 ? "仮免 Karimen" : "本免 Honmen";
  const necesarias = Math.ceil(session.totalPreguntas * 0.9);

  return (
    <Layout>
      <div className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-8 duration-500">
        <Card className="overflow-hidden border-border/50 shadow-xl">
          <div className={cn(
            "h-3 w-full",
            passed ? "bg-green-500" : "bg-destructive"
          )} />
          <CardHeader className="text-center pt-8 pb-4">
            <div className={cn(
              "mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-6",
              passed ? "bg-green-500/10 text-green-500" : "bg-destructive/10 text-destructive"
            )}>
              {passed ? (
                <Trophy className="w-10 h-10" />
              ) : (
                <AlertTriangle className="w-10 h-10" />
              )}
            </div>
            <CardTitle className="text-3xl font-bold">
              {passed ? "¡Felicitaciones, Aprobado!" : "Examen Reprobado"}
            </CardTitle>
            <p className="text-muted-foreground text-lg mt-2">
              {examenNombre}
              {(session as any).ciudad ? ` · ${(session as any).ciudad}` : ""}
              {" · "}{session.totalPreguntas} preguntas
            </p>
          </CardHeader>
          <CardContent className="space-y-8 pb-8">
            <div className="flex flex-col items-center justify-center">
              <span className={cn(
                "text-6xl font-black tabular-nums tracking-tighter",
                passed ? "text-green-500" : "text-destructive"
              )}>
                {percentage}%
              </span>
              <span className="text-muted-foreground font-medium mt-2">
                {session.correctas} de {session.totalPreguntas} correctas
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span>Tu puntaje: {percentage}%</span>
                <span>Necesitas: {necesarias}/{session.totalPreguntas} (90%)</span>
              </div>
              <div className="relative h-4 w-full bg-muted rounded-full overflow-hidden">
                <div 
                  className={cn(
                    "absolute top-0 left-0 h-full transition-all duration-1000 ease-out",
                    passed ? "bg-green-500" : "bg-destructive"
                  )}
                  style={{ width: `${percentage}%` }}
                />
                <div className="absolute top-0 left-[90%] h-full w-0.5 bg-foreground/20" />
              </div>
            </div>

            {!passed && (
              <div className="bg-muted p-4 rounded-lg text-center text-sm text-muted-foreground">
                Sigue practicando. Para aprobar necesitas {necesarias} de {session.totalPreguntas} respuestas correctas. Revisa las preguntas que fallaste y vuelve a intentarlo.
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/50 p-6 flex gap-4 justify-center">
            <Link href="/">
              <Button variant="outline" size="lg" className="font-semibold">
                <Home className="mr-2 w-4 h-4" />
                Volver al Inicio
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </Layout>
  );
}
