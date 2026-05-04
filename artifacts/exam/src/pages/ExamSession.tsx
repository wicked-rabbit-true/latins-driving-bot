import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetExamSession,
  getGetExamSessionQueryKey,
  useAnswerExamQuestion,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Layout } from "@/components/Layout";
import { Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export default function ExamSession() {
  const { sessionId } = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const id = Number(sessionId);

  const { data: session, isLoading, isError } = useGetExamSession(id, {
    query: {
      enabled: !!id,
      queryKey: getGetExamSessionQueryKey(id),
      refetchOnWindowFocus: false,
    },
  });

  const answerMutation = useAnswerExamQuestion();

  const [feedback, setFeedback] = useState<{
    correcto: boolean;
    respuestaCorrecta: boolean;
    explicacion: string;
    siguientePregunta: { numero: number; pregunta: string; imagenUrl?: string | null } | null;
  } | null>(null);

  // Redirect if finished and no pending feedback
  useEffect(() => {
    if (session?.estado === "terminado" && !feedback) {
      setLocation(`/resultado/${id}`);
    }
  }, [session, id, setLocation, feedback]);

  if (isLoading || !session) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Cargando examen...</p>
        </div>
      </Layout>
    );
  }

  if (isError) {
    return (
      <Layout>
        <Card className="max-w-md mx-auto border-destructive">
          <CardContent className="pt-6 text-center space-y-4">
            <XCircle className="w-12 h-12 text-destructive mx-auto" />
            <p>No se pudo cargar la sesión de examen.</p>
            <Button onClick={() => setLocation("/")}>Volver al inicio</Button>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  // The current question comes from: session.preguntaActual (initial/after refresh)
  // or feedback.siguientePregunta (after answering, before next is loaded)
  const currentQuestion = feedback?.siguientePregunta ?? (session as any).preguntaActual;
  const progress = Math.round((session.respondidas / session.totalPreguntas) * 100);
  const currentNum = feedback?.siguientePregunta
    ? feedback.siguientePregunta.numero
    : (session as any).preguntaActual?.numero ?? session.respondidas + 1;

  const handleAnswer = async (respuesta: boolean) => {
    if (answerMutation.isPending) return;

    try {
      const result = await answerMutation.mutateAsync({
        id,
        data: { respuesta },
      });

      setFeedback({
        correcto: result.correcto,
        respuestaCorrecta: result.respuestaCorrecta,
        explicacion: result.explicacion,
        siguientePregunta: result.siguientePregunta ?? null,
      });

      // Update session cache with new counts
      queryClient.setQueryData(getGetExamSessionQueryKey(id), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          respondidas: result.respondidas,
          correctas: result.correctas,
          estado: result.terminado ? "terminado" : "activo",
          preguntaActual: result.siguientePregunta ?? null,
        };
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleNext = () => {
    if (feedback?.siguientePregunta === null && session.estado === "terminado") {
      setLocation(`/resultado/${id}`);
      return;
    }
    setFeedback(null);
  };

  // Show feedback screen after answering
  if (feedback && !feedback.siguientePregunta && session.estado === "terminado") {
    // Last question — show feedback then redirect on next click
    return (
      <Layout>
        <div className="w-full max-w-3xl space-y-8">
          <Progress value={100} className="h-2" />
          <Card className="w-full shadow-lg border-border/50">
            <CardContent className="pt-8">
              <div className={cn(
                "p-6 rounded-lg border flex items-start gap-4",
                feedback.correcto
                  ? "bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400"
                  : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
              )}>
                {feedback.correcto
                  ? <CheckCircle2 className="w-8 h-8 shrink-0" />
                  : <XCircle className="w-8 h-8 shrink-0" />}
                <div>
                  <h3 className="text-lg font-bold mb-2">
                    {feedback.correcto ? "¡Correcto!" : "Incorrecto"}
                  </h3>
                  <p className="text-muted-foreground font-medium">
                    La respuesta correcta era {feedback.respuestaCorrecta ? "VERDADERO" : "FALSO"}.
                  </p>
                  {feedback.explicacion && (
                    <div className="mt-4 pt-4 border-t border-current/10">
                      <p className="text-foreground text-base leading-relaxed">
                        {feedback.explicacion}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end pb-6">
              <Button size="lg" onClick={handleNext} className="group">
                Ver Resultados
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </CardFooter>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!currentQuestion) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Cargando pregunta...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="w-full max-w-3xl space-y-8">
        <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">
          <span>Pregunta {currentNum} de {session.totalPreguntas}</span>
          <span>{progress}% Completado</span>
        </div>
        <Progress value={progress} className="h-2" />

        <Card className="w-full shadow-lg border-border/50">
          <CardHeader className="bg-muted/30 pb-6 space-y-4">
            {(() => {
              const imgs: string[] = (currentQuestion as any).imagenesUrls?.length
                ? (currentQuestion as any).imagenesUrls
                : (currentQuestion as any).imagenUrl
                  ? [(currentQuestion as any).imagenUrl]
                  : [];
              if (imgs.length === 0) return null;
              return (
                <div className={`flex gap-3 ${imgs.length > 1 ? "flex-wrap" : "justify-center"}`}>
                  {imgs.map((url: string, i: number) => (
                    <img
                      key={i}
                      src={`/api/storage${url}`}
                      alt={`Figura ${i + 1}`}
                      className="max-h-52 w-auto rounded-lg border object-contain bg-white"
                    />
                  ))}
                </div>
              );
            })()}
            <CardTitle className="text-2xl leading-relaxed font-medium">
              {currentQuestion.pregunta}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {!feedback ? (
              <div className="grid grid-cols-2 gap-4">
                <Button
                  size="lg"
                  className="h-24 text-xl font-bold bg-blue-500 hover:bg-blue-600 text-white"
                  onClick={() => handleAnswer(true)}
                  disabled={answerMutation.isPending}
                >
                  {answerMutation.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : "VERDADERO"}
                </Button>
                <Button
                  size="lg"
                  className="h-24 text-xl font-bold bg-red-500 hover:bg-red-600 text-white"
                  onClick={() => handleAnswer(false)}
                  disabled={answerMutation.isPending}
                >
                  {answerMutation.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : "FALSO"}
                </Button>
              </div>
            ) : (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                <div className={cn(
                  "p-6 rounded-lg border flex items-start gap-4",
                  feedback.correcto
                    ? "bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400"
                    : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
                )}>
                  {feedback.correcto
                    ? <CheckCircle2 className="w-8 h-8 shrink-0" />
                    : <XCircle className="w-8 h-8 shrink-0" />}
                  <div>
                    <h3 className="text-lg font-bold mb-2">
                      {feedback.correcto ? "¡Correcto!" : "Incorrecto"}
                    </h3>
                    <p className="text-muted-foreground font-medium">
                      La respuesta correcta era {feedback.respuestaCorrecta ? "VERDADERO" : "FALSO"}.
                    </p>
                    {feedback.explicacion && (
                      <div className="mt-4 pt-4 border-t border-current/10">
                        <p className="text-foreground text-base leading-relaxed">
                          {feedback.explicacion}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className={cn("justify-end pb-6", !feedback && "invisible")}>
            <Button size="lg" onClick={handleNext} className="group">
              Siguiente Pregunta
              <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </Layout>
  );
}
