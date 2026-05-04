import { Link, useLocation } from "wouter";
import { LanguageBadge } from "@/components/LanguageBadge";
import { useState } from "react";
import { 
  ChevronLeft, Edit, Trash2, Cloud, Calendar, Phone, Mail, 
  MapPin, CreditCard, ShieldAlert, Clock, RefreshCw, Car, GraduationCap, CalendarDays,
  FileText, ExternalLink, Download, Loader2, MessageSquare, Send, Key, BookOpen, CheckCircle2, XCircle,
  Languages, ClipboardList, BarChart2, Trophy, TrendingUp, AlertCircle,
  User as UserIcon
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  useGetStudent, getGetStudentQueryKey, 
  useDeleteStudent, useSyncStudentBookitit 
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { getGetStudentsSummaryQueryKey, getListStudentsQueryKey } from "@workspace/api-client-react";

function formatYen(amount: number | null | undefined) {
  if (amount == null) return "¥0";
  return `¥${amount.toLocaleString()}`;
}

function formatDate(dateString: string | null | undefined) {
  if (!dateString) return "Not set";
  return new Date(dateString).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).replace(/\//g, '/');
}

function calcAge(dateString: string | null | undefined): number | null {
  if (!dateString) return null;
  const birth = new Date(dateString);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function toJapaneseEra(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  try {
    const eraFormatter = new Intl.DateTimeFormat("ja-JP-u-ca-japanese", {
      era: "long",
      year: "numeric",
    });
    return eraFormatter.format(date); // e.g. "令和7年" or "平成2年"
  } catch {
    return null;
  }
}

export default function StudentDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: student, isLoading } = useGetStudent(id, { 
    query: { enabled: !!id, queryKey: getGetStudentQueryKey(id) } 
  });
  
  const deleteStudent = useDeleteStudent();
  const syncBookitit = useSyncStudentBookitit();

  const [certState, setCertState] = useState<{
    loading: boolean;
    oneDriveUrl: string | null;
    fileName: string | null;
    error: string | null;
  }>({ loading: false, oneDriveUrl: null, fileName: null, error: null });

  // iGiveTest state
  const [igtExamType,  setIgtExamType]  = useState<string>("");
  const [igtExamType2, setIgtExamType2] = useState<string>("");
  const [igtLoading,   setIgtLoading]   = useState(false);
  const [igtCreds,     setIgtCreds]     = useState<{ username: string; password: string; expiresAt?: string } | null>(null);

  // iGiveTest report state
  type IgtAttempt = { date: string; exam: string; score: number | null; passed: boolean | null; raw: string };
  type IgtReport = { found: boolean; username: string; attempts: IgtAttempt[]; bestScore: number | null; latestScore: number | null; totalAttempts: number; note?: string; error?: string };
  const [igtReportOpen,    setIgtReportOpen]    = useState(false);
  const [igtReportLoading, setIgtReportLoading] = useState(false);
  const [igtReport,        setIgtReport]        = useState<IgtReport | null>(null);
  const [igtReportError,   setIgtReportError]   = useState<string | null>(null);

  // Material state
  const [materialLoading, setMaterialLoading] = useState<string | null>(null);

  // Confirmar state
  const [confirmarType, setConfirmarType] = useState<string>("");
  const [confirmarDate, setConfirmarDate] = useState<string>("");
  const [confirmarTime, setConfirmarTime] = useState<string>("");
  const [confirmarLoading, setConfirmarLoading] = useState(false);

  const queryClient2 = queryClient;

  const handleGenerateCertificate = async () => {
    setCertState({ loading: true, oneDriveUrl: null, fileName: null, error: null });
    try {
      const res = await fetch(`/api/certificates/student/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error desconocido");
      setCertState({ loading: false, oneDriveUrl: data.oneDriveUrl, fileName: data.fileName, error: null });
      toast({ title: "Certificado generado", description: data.oneDriveUrl ? "Subido a OneDrive correctamente." : "Generado (sin subir a OneDrive)." });
    } catch (e: any) {
      setCertState({ loading: false, oneDriveUrl: null, fileName: null, error: e.message });
      toast({ title: "Error al generar certificado", description: e.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteStudent.mutateAsync({ id });
      
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetStudentsSummaryQueryKey() });
      
      toast({
        title: "Student deleted",
        description: "The student has been successfully removed.",
      });
      
      setLocation("/students");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete student.",
        variant: "destructive",
      });
    }
  };

  const handleSync = async () => {
    try {
      const result = await syncBookitit.mutateAsync({ id });
      
      // Update cache with new bookititId if available
      if (result.success && result.bookititId) {
        queryClient.setQueryData(getGetStudentQueryKey(id), (old: any) => 
          old ? { ...old, bookititId: result.bookititId } : old
        );
      }
      
      toast({
        title: result.success ? "Synced Successfully" : "Sync Failed",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    } catch (error) {
      toast({
        title: "Sync Error",
        description: "Failed to connect to Bookitit API.",
        variant: "destructive",
      });
    }
  };

  const handleGetIGTReport = async () => {
    setIgtReportLoading(true);
    setIgtReportError(null);
    setIgtReport(null);
    setIgtReportOpen(true);
    try {
      const res = await fetch(`/api/students/${id}/igivetest/report`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error desconocido");
      setIgtReport(data);
    } catch (e: any) {
      setIgtReportError(e.message);
    } finally {
      setIgtReportLoading(false);
    }
  };

  const handleCreateIGT = async () => {
    if (!igtExamType) { toast({ title: "Selecciona un examen", variant: "destructive" }); return; }
    setIgtLoading(true); setIgtCreds(null);
    try {
      const res = await fetch(`/api/students/${id}/igivetest/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examType: igtExamType, examType2: igtExamType2 || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error desconocido");
      setIgtCreds(data.creds);
      queryClient2.setQueryData(getGetStudentQueryKey(id), data.student);
      toast({ title: "✅ Acceso iGiveTest creado", description: `Usuario: ${data.creds.username} — Credenciales enviadas por WhatsApp` });
    } catch (e: any) {
      toast({ title: "Error creando acceso", description: e.message, variant: "destructive" });
    } finally { setIgtLoading(false); }
  };

  const handleDisableIGT = async () => {
    setIgtLoading(true);
    try {
      const res = await fetch(`/api/students/${id}/igivetest/disable`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error desconocido");
      setIgtCreds(null);
      queryClient2.setQueryData(getGetStudentQueryKey(id), data.student);
      toast({ title: "✅ Acceso iGiveTest desactivado" });
    } catch (e: any) {
      toast({ title: "Error desactivando acceso", description: e.message, variant: "destructive" });
    } finally { setIgtLoading(false); }
  };

  const handleSendMaterial = async (type: string) => {
    setMaterialLoading(type);
    try {
      const res = await fetch(`/api/students/${id}/send-material`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      toast({ title: "✅ Material en cola", description: data.message });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setMaterialLoading(null); }
  };

  const handleConfirmar = async () => {
    if (!confirmarType) { toast({ title: "Selecciona el tipo de confirmación", variant: "destructive" }); return; }
    if (!confirmarDate || !confirmarTime) { toast({ title: "Ingresa fecha y hora", variant: "destructive" }); return; }
    setConfirmarLoading(true);
    try {
      const [y, m, d] = confirmarDate.split("-");
      const dateForBot = `${d}/${m}/${y}`;
      const res = await fetch(`/api/students/${id}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: confirmarType, date: dateForBot, time: confirmarTime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      toast({ title: "✅ Confirmación en cola", description: data.message });
      setConfirmarDate(""); setConfirmarTime(""); setConfirmarType("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setConfirmarLoading(false); }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6 w-full">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-64 col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full text-center">
        <h2 className="text-2xl font-bold mb-2">Student Not Found</h2>
        <p className="text-muted-foreground mb-6">The student you're looking for does not exist.</p>
        <Button asChild>
          <Link href="/students">Back to Students</Link>
        </Button>
      </div>
    );
  }

  const isPaid = (student.montoRestante || 0) <= 0;
  const isPartial = (student.montoPagado || 0) > 0 && (student.montoRestante || 0) > 0;

  return (
    <>
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <header className="p-4 md:p-6 border-b border-border bg-card shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-full shrink-0">
            <Link href="/students">
              <ChevronLeft className="h-5 w-5" />
              <span className="sr-only">Back</span>
            </Link>
          </Button>
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-14 w-14 rounded-full bg-primary flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-primary-foreground uppercase">
                {student.nombre.charAt(0)}
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight truncate">{student.nombre}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {student.codigoAlumno && (
                  <Badge className="text-xs font-mono bg-primary text-primary-foreground">
                    {student.codigoAlumno}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs font-normal">
                  ID: {student.id}
                </Badge>
                {student.bookititId && (
                  <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 border-blue-500/20">
                    <Cloud className="h-3 w-3 mr-1" />
                    Bookitit
                  </Badge>
                )}
                <LanguageBadge language={student.preferredLanguage} />
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 ml-14 sm:ml-0">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/students/${id}/edit`}>
              <Edit className="h-4 w-4 mr-2" /> Edit
            </Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {student.nombre}'s record from the database. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleDelete} 
                  disabled={deleteStudent.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleteStudent.isPending ? "Deleting..." : "Delete Student"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6 bg-muted/30">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Info */}
          <div className="md:col-span-2 space-y-6">
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <UserIcon className="h-5 w-5 text-primary" />
                  Personal Information
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Phone className="h-4 w-4" /> Phone
                  </div>
                  <div className="font-medium text-base">{student.telefono}</div>
                </div>
                
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Mail className="h-4 w-4" /> Email
                  </div>
                  <div className="font-medium text-base">{student.email || "—"}</div>
                </div>
                
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Calendar className="h-4 w-4" /> Fecha de nacimiento
                  </div>
                  {student.fechaNacimiento ? (
                    <div>
                      <div className="font-medium text-base">{formatDate(student.fechaNacimiento)}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {toJapaneseEra(student.fechaNacimiento) && (
                          <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded font-medium">
                            {toJapaneseEra(student.fechaNacimiento)}生
                          </span>
                        )}
                        {calcAge(student.fechaNacimiento) !== null && (
                          <span className="text-sm font-bold text-primary">
                            {calcAge(student.fechaNacimiento)}歳
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="font-medium text-base">—</div>
                  )}
                </div>
                
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <UserIcon className="h-4 w-4" /> Género
                  </div>
                  <div className="font-medium text-base">{student.sexo || "—"}</div>
                </div>
                
                <div className="sm:col-span-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <MapPin className="h-4 w-4" /> Address
                  </div>
                  <div className="font-medium text-base">
                    {student.codigoPostal && `〒${student.codigoPostal} `}
                    {student.direccion || "—"}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Car className="h-5 w-5 text-primary" />
                  Course Details
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Car className="h-4 w-4" /> License Type
                  </div>
                  <div className="font-medium text-base">
                    {student.tipoLicencia ? (
                      <Badge variant="outline" className="text-sm px-2 py-0.5">
                        {student.tipoLicencia}
                      </Badge>
                    ) : "—"}
                  </div>
                </div>
                
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <ShieldAlert className="h-4 w-4" /> Visa Expiration
                  </div>
                  <div className="font-medium text-base">{formatDate(student.expiracionVisa)}</div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <MapPin className="h-4 w-4" /> Departamento / 都道府県
                  </div>
                  <div className="font-medium text-base">
                    {student.prefectura ? (
                      <Badge variant="outline" className="text-sm px-2 py-0.5 capitalize">
                        {{
                          tochigi:  "Tochigi（栃木県）",
                          saitama:  "Saitama（埼玉県）",
                          kanagawa: "Kanagawa（神奈川県）",
                          tokyo:    "Tokyo（東京都）",
                        }[student.prefectura] ?? student.prefectura}
                      </Badge>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 text-sm">Sin departamento</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Languages className="h-4 w-4" /> Preferred Language
                  </div>
                  <div className="font-medium text-base">
                    {student.preferredLanguage ? (
                      <Badge variant="secondary" className="text-sm px-2 py-0.5 font-mono uppercase">
                        {student.preferredLanguage}
                      </Badge>
                    ) : "—"}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <ClipboardList className="h-4 w-4" /> Centro examen 100 preguntas
                  </div>
                  <div className="font-medium text-base">
                    {student.examen100Departamento ? (
                      <Badge variant="outline" className="text-sm px-2 py-0.5 capitalize">
                        {{
                          tochigi: "Tochigi（栃木）",
                          saitama: "Saitama（埼玉）",
                          chiba:   "Chiba（千葉）",
                        }[student.examen100Departamento] ?? student.examen100Departamento}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <CalendarDays className="h-4 w-4" /> Fin del internado / 合宿終了
                  </div>
                  <div className="font-medium text-base">
                    {student.internadoFechaFin ? (
                      <span>{formatDate(student.internadoFechaFin)}</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </div>
                </div>

                {student.tsuruokaGraduado && (
                  <div className="sm:col-span-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <GraduationCap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        Graduado/a de Tsuruoka (卒業証明書)
                      </span>
                    </div>
                    <div className="text-sm text-emerald-700 dark:text-emerald-300">
                      {student.tsuruokaFechaGraduacion
                        ? <>Fecha de graduación: <span className="font-medium">{formatDate(student.tsuruokaFechaGraduacion)}</span></>
                        : "Certificado recibido — fecha no registrada"}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {student.notas && (
              <Card className="shadow-sm bg-yellow-50/50 dark:bg-yellow-900/10 border-yellow-100 dark:border-yellow-900/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2 text-yellow-800 dark:text-yellow-500">
                    Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm">{student.notas}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="shadow-sm border-primary/20 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-primary" />
                    Payment
                  </span>
                  <Badge 
                    variant={isPaid ? "default" : isPartial ? "secondary" : "destructive"}
                    className={
                      isPaid ? "bg-green-500 hover:bg-green-600 text-white" : 
                      isPartial ? "bg-amber-500 hover:bg-amber-600 text-white" : ""
                    }
                  >
                    {isPaid ? "Paid" : isPartial ? "Partial" : "Pending"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Course Value</span>
                  <span className="font-medium">{formatYen(student.valorCurso)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Amount Paid</span>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {formatYen(student.montoPagado)}
                  </span>
                </div>
                <Separator className="bg-primary/20" />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">Balance Due</span>
                  <span className={`text-xl font-bold ${isPaid ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                    {formatYen(student.montoRestante)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Cloud className="h-5 w-5 text-blue-500" />
                  Bookitit Integration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {student.bookititId ? (
                  <div className="bg-muted p-3 rounded-md border border-border">
                    <p className="text-sm text-muted-foreground mb-1">Bookitit Client ID</p>
                    <p className="font-mono font-medium">{student.bookititId}</p>
                  </div>
                ) : (
                  <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-500 text-sm">
                    This student is not synced with Bookitit scheduling system.
                  </div>
                )}
                
                <Button 
                  className="w-full" 
                  variant={student.bookititId ? "outline" : "default"}
                  onClick={handleSync}
                  disabled={syncBookitit.isPending}
                >
                  {syncBookitit.isPending ? (
                    <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Syncing...</>
                  ) : student.bookititId ? (
                    <><RefreshCw className="mr-2 h-4 w-4" /> Force Sync Update</>
                  ) : (
                    <><Cloud className="mr-2 h-4 w-4" /> Sync to Bookitit</>
                  )}
                </Button>
              </CardContent>
            </Card>
            
            <Card className="shadow-sm border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-950/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-blue-800 dark:text-blue-400">
                  <CalendarDays className="h-4 w-4" />
                  Fecha de inscripción / 入校日
                </CardTitle>
              </CardHeader>
              <CardContent>
                {student.fechaInscripcion ? (
                  <div>
                    <div className="font-semibold text-lg">{formatDate(student.fechaInscripcion)}</div>
                    {toJapaneseEra(student.fechaInscripcion) && (
                      <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded font-medium mt-1 inline-block">
                        {toJapaneseEra(student.fechaInscripcion)}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Sin fecha de inscripción — requerida para el certificado
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-primary" />
                  Estado del Proceso
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Examen 50 preguntas</span>
                  <Badge
                    className={
                      student.examen50Estado === 'aprobado'
                        ? "bg-green-500 text-white hover:bg-green-600"
                        : "bg-amber-500 text-white hover:bg-amber-600"
                    }
                  >
                    {student.examen50Estado === 'aprobado' ? '✓ Aprobado' : '⏳ Pendiente'}
                  </Badge>
                </div>

                <Separator />

                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Internado (合宿)
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Inicio</span>
                    <span className="font-medium">
                      {student.internadoFechaInicio ? formatDate(student.internadoFechaInicio) : (
                        <span className="text-amber-600 dark:text-amber-400 text-xs">Sin fecha</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Finalización</span>
                    <span className="font-medium">
                      {student.internadoFechaFin ? formatDate(student.internadoFechaFin) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </span>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Examen 100 preguntas</span>
                  <Badge
                    className={
                      student.examen100Estado === 'aprobado'
                        ? "bg-green-500 text-white hover:bg-green-600"
                        : "bg-amber-500 text-white hover:bg-amber-600"
                    }
                  >
                    {student.examen100Estado === 'aprobado' ? '✓ Aprobado' : '⏳ Pendiente'}
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Centro examen 100 preguntas</span>
                  {student.examen100Departamento ? (
                    <Badge variant="outline" className="text-sm px-2 py-0.5 capitalize">
                      {{
                        tochigi: "Tochigi（栃木）",
                        saitama: "Saitama（埼玉）",
                        chiba:   "Chiba（千葉）",
                      }[student.examen100Departamento] ?? student.examen100Departamento}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <CreditCard className="h-3.5 w-3.5" /> Pago
                  </span>
                  <Badge
                    className={
                      student.pagoEstado === 'pagado'
                        ? "bg-green-500 text-white hover:bg-green-600"
                        : "bg-red-500 text-white hover:bg-red-600"
                    }
                  >
                    {student.pagoEstado === 'pagado' ? '✓ Pagado' : '⏳ Pendiente'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  教習証明書
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Genera el certificado de matrícula (教習証明書) en formato Word y lo sube automáticamente a OneDrive.
                </p>

                {certState.error && (
                  <div className="bg-destructive/10 text-destructive text-xs p-2 rounded-md border border-destructive/20">
                    {certState.error}
                  </div>
                )}

                {certState.oneDriveUrl && (
                  <div className="bg-green-50 dark:bg-green-950/30 p-2 rounded-md border border-green-200 dark:border-green-900/50 space-y-2">
                    <p className="text-xs font-medium text-green-800 dark:text-green-400">
                      ✓ {certState.fileName}
                    </p>
                    <a
                      href={certState.oneDriveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir en OneDrive
                    </a>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateCertificate}
                    disabled={certState.loading}
                  >
                    {certState.loading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generando...</>
                    ) : (
                      <><FileText className="mr-2 h-4 w-4" /> Generar + OneDrive</>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Descargar directamente"
                    asChild
                  >
                    <a href={`/api/certificates/student/${id}/download`} download>
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" />
              Added on {formatDate(student.createdAt)}
            </div>
          </div>
        </div>

        {/* ── Acciones Bot WhatsApp (full width) ───────────────────────────── */}
        <div className="mt-2">
          <h2 className="flex items-center gap-2 text-base font-semibold mb-4 text-green-700 dark:text-green-400">
            <MessageSquare className="h-5 w-5" />
            Acciones WhatsApp Bot
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            {/* ── iGiveTest ───────────────────────── */}
            <Card className="shadow-sm border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/30 dark:bg-indigo-950/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-indigo-800 dark:text-indigo-300">
                  <Key className="h-4 w-4" />
                  iGiveTest
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">

                {student.igtUsername && (
                  <div className="bg-indigo-100 dark:bg-indigo-900/40 rounded-md p-3 text-sm space-y-1 border border-indigo-200 dark:border-indigo-800/40">
                    <div className="flex items-center gap-1 text-green-700 dark:text-green-400 font-medium mb-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Acceso activo
                    </div>
                    <p><span className="text-muted-foreground">Usuario:</span> <span className="font-mono font-medium">{student.igtUsername}</span></p>
                    <p><span className="text-muted-foreground">Examen:</span> {student.igtExamType}{student.igtExamType2 ? ` / ${student.igtExamType2}` : ""}</p>
                    {student.igtExpiresAt && (
                      <p className="text-xs text-muted-foreground">Expira: {new Date(student.igtExpiresAt).toLocaleDateString('es-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' })}</p>
                    )}
                  </div>
                )}

                {igtCreds && (
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/40 rounded-md p-3 text-sm space-y-1">
                    <p className="font-medium text-green-800 dark:text-green-400 mb-1">Credenciales creadas:</p>
                    <p><span className="text-muted-foreground">Usuario:</span> <span className="font-mono">{igtCreds.username}</span></p>
                    <p><span className="text-muted-foreground">Contraseña:</span> <span className="font-mono">{igtCreds.password}</span></p>
                  </div>
                )}

                <div className="space-y-2">
                  <Select value={igtExamType} onValueChange={setIgtExamType}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Tipo examen principal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="honmen-chiba">Honmen Chiba</SelectItem>
                      <SelectItem value="tochigi-karimen-1">Tochigi Karimen 1</SelectItem>
                      <SelectItem value="tochigi-karimen-2">Tochigi Karimen 2</SelectItem>
                      <SelectItem value="tochigi-100">Tochigi 100</SelectItem>
                      <SelectItem value="english-100-3">English 100-3</SelectItem>
                      <SelectItem value="illustrations-2025">Illustrations 2025</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={igtExamType2 || "none"} onValueChange={v => setIgtExamType2(v === "none" ? "" : v)}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Examen secundario (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Ninguno —</SelectItem>
                      <SelectItem value="honmen-chiba">Honmen Chiba</SelectItem>
                      <SelectItem value="tochigi-karimen-1">Tochigi Karimen 1</SelectItem>
                      <SelectItem value="tochigi-karimen-2">Tochigi Karimen 2</SelectItem>
                      <SelectItem value="tochigi-100">Tochigi 100</SelectItem>
                      <SelectItem value="english-100-3">English 100-3</SelectItem>
                      <SelectItem value="illustrations-2025">Illustrations 2025</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                  size="sm"
                  onClick={handleCreateIGT}
                  disabled={igtLoading}
                >
                  {igtLoading ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Creando...</> : <><Key className="mr-1 h-4 w-4" /> Crear / Renovar Acceso</>}
                </Button>

                {student.igtUsername && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20"
                    onClick={handleDisableIGT}
                    disabled={igtLoading}
                  >
                    {igtLoading ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Desactivando...</> : <><XCircle className="mr-1 h-4 w-4" /> Desactivar Acceso</>}
                  </Button>
                )}

                {student.igtUsername && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                    onClick={handleGetIGTReport}
                    disabled={igtReportLoading}
                  >
                    {igtReportLoading
                      ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Cargando...</>
                      : <><BarChart2 className="mr-1 h-4 w-4" /> Ver Reporte de Exámenes</>}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* ── @material100* ────────────────────── */}
            <Card className="shadow-sm border-teal-100 dark:border-teal-900/30 bg-teal-50/30 dark:bg-teal-950/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-teal-800 dark:text-teal-300">
                  <BookOpen className="h-4 w-4" />
                  Material 100 Preguntas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Envía el PDF y las instrucciones del material de 100 preguntas según la prefectura del estudiante.
                </p>
                {[
                  { key: "chiba",    label: "🗓️ Chiba",           color: "bg-teal-600 hover:bg-teal-700" },
                  { key: "tochigi",  label: "🌿 Tochigi",         color: "bg-emerald-600 hover:bg-emerald-700" },
                  { key: "saitama",  label: "🔵 Saitama (Konosu)",color: "bg-blue-600 hover:bg-blue-700" },
                ].map(({ key, label, color }) => (
                  <Button
                    key={key}
                    className={`w-full text-white ${color}`}
                    size="sm"
                    disabled={materialLoading !== null}
                    onClick={() => handleSendMaterial(key)}
                  >
                    {materialLoading === key ? (
                      <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Enviando...</>
                    ) : (
                      <><Send className="mr-1 h-4 w-4" /> {label}</>
                    )}
                  </Button>
                ))}
              </CardContent>
            </Card>

            {/* ── @confirmar* ──────────────────────── */}
            <Card className="shadow-sm border-amber-100 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-950/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-amber-800 dark:text-amber-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmación de Cita
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={confirmarType} onValueChange={setConfirmarType}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Tipo de confirmación" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yamagata">Yamagata (50 preguntas)</SelectItem>
                    <SelectItem value="50konosu">Konosu 50 preguntas</SelectItem>
                    <SelectItem value="50tochigi">Tochigi 50 preguntas</SelectItem>
                    <SelectItem value="100tochigi">Tochigi 100 preguntas</SelectItem>
                    <SelectItem value="100konosu">Konosu 100 preguntas</SelectItem>
                    <SelectItem value="100chiba">Chiba 100 preguntas</SelectItem>
                    <SelectItem value="kumagaya">Kumagaya</SelectItem>
                  </SelectContent>
                </Select>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground font-medium">Fecha de la cita</label>
                  <input
                    type="date"
                    value={confirmarDate}
                    onChange={e => setConfirmarDate(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground font-medium">Hora (ej: 09:00)</label>
                  <input
                    type="time"
                    value={confirmarTime}
                    onChange={e => setConfirmarTime(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  />
                </div>

                <Button
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                  size="sm"
                  onClick={handleConfirmar}
                  disabled={confirmarLoading}
                >
                  {confirmarLoading ? (
                    <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Enviando...</>
                  ) : (
                    <><Send className="mr-1 h-4 w-4" /> Enviar Confirmación</>
                  )}
                </Button>
              </CardContent>
            </Card>

          </div>
        </div>

      </div>
    </div>

    {/* ── iGiveTest Report Dialog ──────────────────────────────────────── */}
    <Dialog open={igtReportOpen} onOpenChange={setIgtReportOpen}>
      <DialogContent className="max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
            <BarChart2 className="h-5 w-5" />
            Reporte iGiveTest — {student?.nombre}
          </DialogTitle>
        </DialogHeader>

        {igtReportLoading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="text-sm">Consultando iGiveTest...</p>
            <p className="text-xs text-muted-foreground/60">Puede tomar unos segundos</p>
          </div>
        )}

        {igtReportError && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm">{igtReportError}</p>
          </div>
        )}

        {igtReport && !igtReportLoading && (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Total intentos</p>
                <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">{igtReport.totalAttempts}</p>
              </div>
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1"><Trophy className="h-3 w-3" /> Mejor</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                  {igtReport.bestScore !== null ? `${igtReport.bestScore}%` : "—"}
                </p>
              </div>
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1"><TrendingUp className="h-3 w-3" /> Último</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                  {igtReport.latestScore !== null ? `${igtReport.latestScore}%` : "—"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Key className="h-3 w-3" />
              <span>Usuario: <span className="font-mono font-medium text-foreground">{igtReport.username}</span></span>
            </div>

            {/* Note if no detail */}
            {igtReport.note && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/60 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {igtReport.note}
              </div>
            )}

            {/* Attempts list */}
            {igtReport.attempts.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2 text-foreground">Historial de intentos</p>
                <ScrollArea className="h-72 rounded-md border border-border">
                  <div className="divide-y divide-border">
                    {igtReport.attempts.map((attempt, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors">
                        <span className="text-xs text-muted-foreground w-5 shrink-0 font-mono">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          {attempt.exam && (
                            <p className="text-xs font-medium text-foreground truncate">{attempt.exam}</p>
                          )}
                          {attempt.date && (
                            <p className="text-xs text-muted-foreground">{attempt.date}</p>
                          )}
                          {!attempt.exam && !attempt.date && (
                            <p className="text-xs text-muted-foreground italic">Sin detalle</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-sm font-bold ${
                            attempt.score !== null && attempt.score >= 70
                              ? "text-green-600 dark:text-green-400"
                              : attempt.score !== null && attempt.score >= 50
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-red-600 dark:text-red-400"
                          }`}>
                            {attempt.score !== null ? `${attempt.score}%` : "—"}
                          </span>
                          {attempt.passed === true && (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          )}
                          {attempt.passed === false && (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                {igtReport.attempts.length > 0 && igtReport.attempts.every(a => !a.date && !a.exam) && (
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    iGiveTest no devolvió detalle de fechas/exámenes — solo puntajes.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

