import { useState, useEffect, useCallback } from "react";
import { LanguageBadge, LANG_BADGE_COLORS } from "@/components/LanguageBadge";
import { Link } from "wouter";
import { Search, Plus, User, CreditCard, CalendarDays, Wallet, AlertTriangle, ShieldAlert, Database, Download, CheckCircle2, XCircle, Loader2, FileText, Upload, Phone, RefreshCw, Unlink, Link2, Clock } from "lucide-react";
import { useListStudents, useGetStudentsSummary, useGetLanguageCacheStats, usePruneLanguageCache, useGetLanguageCachePruneHistory, useGetLanguageCachePruneStatus } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


function formatYen(amount: number | null | undefined) {
  if (amount == null) return "¥0";
  return `¥${amount.toLocaleString()}`;
}

function formatDate(dateString: string | null | undefined) {
  if (!dateString) return "N/A";
  return new Date(dateString).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).replace(/\//g, '/');
}

type VisaStatus = "expired" | "critical" | "warning" | "ok" | "unknown";

function getVisaStatus(dateString: string | null | undefined): { status: VisaStatus; daysLeft: number | null } {
  if (!dateString) return { status: "unknown", daysLeft: null };
  const exp = new Date(dateString);
  exp.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { status: "expired", daysLeft: diffDays };
  if (diffDays <= 30) return { status: "critical", daysLeft: diffDays };
  if (diffDays <= 60) return { status: "warning", daysLeft: diffDays };
  return { status: "ok", daysLeft: diffDays };
}

function VisaBadge({ dateString }: { dateString: string | null | undefined }) {
  const { status, daysLeft } = getVisaStatus(dateString);
  if (status === "unknown") return <span className="text-muted-foreground text-sm">N/A</span>;

  const dateFormatted = formatDate(dateString);

  if (status === "expired") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <Badge className="bg-red-600 hover:bg-red-700 text-white text-xs">🚨 VENCIDA</Badge>
        <span className="text-xs text-red-600 font-medium">{dateFormatted}</span>
      </div>
    );
  }
  if (status === "critical") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <Badge className="bg-orange-500 hover:bg-orange-600 text-white text-xs">
          ⚠️ {daysLeft === 0 ? "HOY" : `${daysLeft}d`}
        </Badge>
        <span className="text-xs text-orange-500 font-medium">{dateFormatted}</span>
      </div>
    );
  }
  if (status === "warning") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <Badge variant="outline" className="border-yellow-500 text-yellow-600 text-xs">⏳ {daysLeft}d</Badge>
        <span className="text-xs text-muted-foreground">{dateFormatted}</span>
      </div>
    );
  }
  return <span className="text-sm font-medium">{dateFormatted}</span>;
}

function formatPruneDate(dateString: string | null | undefined): string {
  if (!dateString) return "Nunca";
  return new Date(dateString).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── License badge ─────────────────────────────────────────────────────────
const JC_STYLE = "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-700";
const LICENSE_STYLES: Record<string, string> = {
  AT:           "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-700",
  MT:           "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700",
  JC:           JC_STYLE,
  "3 Toneladas": JC_STYLE,
  "3ton":        JC_STYLE,
};
const LICENSE_LABELS: Record<string, string> = {
  AT: "Automática", MT: "Manual", JC: "3 Ton",
  "3 Toneladas": "3 Ton", "3ton": "3 Ton",
};

function LicenciaBadge({ tipo }: { tipo: string | null | undefined }) {
  if (!tipo) return null;
  const style = LICENSE_STYLES[tipo] ?? "bg-muted text-muted-foreground border-border";
  const code  = tipo === "3 Toneladas" || tipo === "3ton" ? "JC" : tipo;
  const label = LICENSE_LABELS[tipo] ?? tipo;
  const showLabel = label !== code;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${style}`}>
      {code}{showLabel && <span className="hidden sm:inline font-normal opacity-80">{label}</span>}
    </span>
  );
}

// ── Import from Excel (km-codes.json) types ───────────────────────────────
type ExcelClient = { code: string; name: string; licencia: string | null };
type ByLicencia  = { AT: number; MT: number; JC: number; sinLicencia: number };
type ExcelPreview = { total: number; toImport: number; toSkip: number; byLicencia: ByLicencia; clients: ExcelClient[] };
type ExcelResult  = { total: number; imported: number; skipped: number; byLicencia: ByLicencia; errors: string[] };

// ── Import from Bookitit CSV types ────────────────────────────────────────
type CsvClient   = { name: string; phone: string | null; kmCode: string | null; licencia: string | null };
type CsvPreview  = { total: number; withPhone: number; withoutPhone: number; duplicated: number; toImport: number; toSkip: number; kmMatched: number; preview: CsvClient[] };
type CsvResult   = { total: number; imported: number; skipped: number; withoutPhone: number; duplicated: number; kmMatched: number; errors: string[] };

// ── Google Contacts types ─────────────────────────────────────────────────
type GcMatch = {
  contactName: string;
  phone: string;
  studentId: number | null;
  studentName: string | null;
  studentCode: string | null;
  currentPhone: string | null;
  isPendiente: boolean;
  score: number;
};
type GcPreview = {
  totalContacts: number;
  withPhone: number;
  matched: number;
  unmatched: number;
  results: GcMatch[];
};
type GcStatus = { configured: boolean; connected: boolean; updatedAt: string | null };

const LANG_OPTIONS = [
  { value: "es", label: "ES" },
  { value: "ur", label: "UR" },
  { value: "en", label: "EN" },
];

function TsuruokaBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700">
      🎓 Tsuruoka
    </span>
  );
}

export default function StudentsPage() {
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState<string[]>([]);
  const [tsuruokaFilter, setTsuruokaFilter] = useState(false);

  // Import from Excel dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"idle" | "previewing" | "preview" | "importing" | "done" | "error">("idle");
  const [importPreview, setImportPreview] = useState<ExcelPreview | null>(null);
  const [importResult, setImportResult] = useState<ExcelResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Import from Bookitit CSV dialog state
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvStep, setCsvStep] = useState<"idle" | "previewing" | "preview" | "importing" | "done" | "error">("idle");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [csvResult, setCsvResult] = useState<CsvResult | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Google Contacts dialog state
  const [gcOpen, setGcOpen] = useState(false);
  const [gcFile, setGcFile] = useState<File | null>(null);
  const [gcStep, setGcStep] = useState<"idle" | "parsing" | "preview" | "applying" | "done" | "error">("idle");
  const [gcPreview, setGcPreview] = useState<GcPreview | null>(null);
  const [gcResult, setGcResult] = useState<{ updated: number; errors: string[] } | null>(null);
  const [gcError, setGcError] = useState<string | null>(null);
  const [gcSelected, setGcSelected] = useState<Set<number>>(new Set());
  const [gcStatus, setGcStatus] = useState<GcStatus | null>(null);
  const [gcDisconnecting, setGcDisconnecting] = useState(false);

  const listStudentsParams = (search || langFilter.length > 0 || tsuruokaFilter)
    ? {
        ...(search ? { q: search } : {}),
        ...(langFilter.length > 0 ? { lang: langFilter } : {}),
        ...(tsuruokaFilter ? { tsuruoka: true } : {}),
      }
    : undefined;
  const { refetch: refetchStudents } = useListStudents(listStudentsParams);

  const fetchGcStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/google-contacts/status");
      if (r.ok) setGcStatus(await r.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    // Check if redirected back from Google OAuth
    if (window.location.search.includes("google=connected")) {
      setGcOpen(true);
      fetchGcStatus();
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [fetchGcStatus]);

  async function handlePreview() {
    setImportStep("previewing");
    setImportError(null);
    try {
      const res = await fetch(`/api/students/import-excel?dryRun=true`, { method: "POST" });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setImportPreview(data);
      setImportStep("preview");
    } catch (e: any) {
      setImportError(e.message);
      setImportStep("error");
    }
  }

  async function handleImport() {
    setImportStep("importing");
    setImportError(null);
    try {
      const res = await fetch(`/api/students/import-excel`, { method: "POST" });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setImportResult(data);
      setImportStep("done");
      refetchStudents();
    } catch (e: any) {
      setImportError(e.message);
      setImportStep("error");
    }
  }

  function openImportDialog() {
    setImportStep("idle");
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportOpen(true);
  }

  function openCsvDialog() {
    setCsvStep("idle");
    setCsvFile(null);
    setCsvPreview(null);
    setCsvResult(null);
    setCsvError(null);
    setCsvOpen(true);
  }

  function openGcDialog() {
    setGcStep("idle");
    setGcFile(null);
    setGcPreview(null);
    setGcResult(null);
    setGcError(null);
    setGcSelected(new Set());
    setGcOpen(true);
    fetchGcStatus();
  }

  async function handleGcParse() {
    if (!gcFile) return;
    setGcStep("parsing");
    setGcError(null);
    try {
      const text = await gcFile.text();
      const res = await fetch("/api/google-contacts/parse-csv", {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: text,
      });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
      const data: GcPreview = await res.json();
      setGcPreview(data);
      // Pre-select all matched contacts whose student has a PENDIENTE phone
      const sel = new Set<number>();
      data.results.forEach((r, i) => {
        if (r.studentId !== null) sel.add(i);
      });
      setGcSelected(sel);
      setGcStep("preview");
    } catch (e: any) {
      setGcError(e.message);
      setGcStep("error");
    }
  }

  async function handleGcApply() {
    if (!gcPreview) return;
    setGcStep("applying");
    setGcError(null);
    const matches = gcPreview.results
      .filter((r, i) => gcSelected.has(i) && r.studentId !== null)
      .map(r => ({ studentId: r.studentId!, phone: r.phone }));
    try {
      const res = await fetch("/api/google-contacts/apply-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setGcResult(data);
      setGcStep("done");
      refetchStudents();
    } catch (e: any) {
      setGcError(e.message);
      setGcStep("error");
    }
  }

  async function handleGcDisconnect() {
    setGcDisconnecting(true);
    try {
      await fetch("/api/google-contacts/disconnect", { method: "DELETE" });
      await fetchGcStatus();
    } finally {
      setGcDisconnecting(false);
    }
  }

  async function handleCsvPreview() {
    if (!csvFile) return;
    setCsvStep("previewing");
    setCsvError(null);
    try {
      const text = await csvFile.text();
      const res = await fetch(`/api/students/import-csv?dryRun=true`, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: text,
      });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setCsvPreview(data);
      setCsvStep("preview");
    } catch (e: any) {
      setCsvError(e.message);
      setCsvStep("error");
    }
  }

  async function handleCsvImport() {
    if (!csvFile) return;
    setCsvStep("importing");
    setCsvError(null);
    try {
      const text = await csvFile.text();
      const res = await fetch(`/api/students/import-csv`, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: text,
      });
      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setCsvResult(data);
      setCsvStep("done");
      refetchStudents();
    } catch (e: any) {
      setCsvError(e.message);
      setCsvStep("error");
    }
  }

  const { data: summary, isLoading: isLoadingSummary } = useGetStudentsSummary();
  const { data: students, isLoading: isLoadingStudents } = useListStudents(listStudentsParams);
  const { data: cacheStats, isLoading: isLoadingCacheStats, isError: isCacheStatsError, refetch: refetchCacheStats } = useGetLanguageCacheStats({
    queryKey: ["languageCacheStats"],
    query: { refetchInterval: 60_000 },
  });
  const { data: pruneHistory, refetch: refetchPruneHistory } = useGetLanguageCachePruneHistory({
    queryKey: ["languageCachePruneHistory"],
  });

  const { toast } = useToast();

  const [prunePending, setPrunePending] = useState(false);

  const { data: pruneStatusData } = useGetLanguageCachePruneStatus({
    queryKey: ["languageCachePruneStatus"],
    query: {
      enabled: prunePending,
      refetchInterval: 5_000,
    },
  });

  useEffect(() => {
    if (prunePending && pruneStatusData && !pruneStatusData.pending) {
      setPrunePending(false);
      refetchCacheStats();
      refetchPruneHistory();
      if (pruneStatusData.lastStatus === "failed") {
        toast({
          title: "Error en la poda",
          description: "El bot intentó ejecutar la poda pendiente pero encontró un error.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Poda completada",
          description: "El bot procesó la poda pendiente automáticamente.",
        });
      }
    }
  }, [pruneStatusData, prunePending]);

  const { mutate: pruneCache, isPending: isPruning } = usePruneLanguageCache({
    mutation: {
      onSuccess: (data) => {
        refetchCacheStats();
        refetchPruneHistory();
        if (data.pending) {
          setPrunePending(true);
          toast({
            title: "Poda encolada",
            description: "El bot está desconectado. La poda se ejecutará automáticamente cuando vuelva a estar disponible.",
            variant: "default",
          });
        } else {
          setPrunePending(false);
          if (data.removed === 0) {
            toast({
              title: "Sin cambios",
              description: "No había entradas para podar.",
            });
          } else {
            const malformed = data.malformed ?? 0;
            const malformedNote = malformed > 0
              ? ` (${malformed} clave${malformed === 1 ? "" : "s"} malformada${malformed === 1 ? "" : "s"})`
              : "";
            toast({
              title: "Caché podado",
              description: `Se eliminaron ${data.removed} entrada${data.removed === 1 ? "" : "s"}${malformedNote}.`,
            });
          }
        }
      },
      onError: (error) => {
        toast({
          title: "Error al podar el caché",
          description: error instanceof Error ? error.message : "Ocurrió un error inesperado.",
          variant: "destructive",
        });
      },
    },
  });

  const expiredStudents = students?.filter(s => getVisaStatus(s.expiracionVisa).status === "expired") ?? [];
  const criticalStudents = students?.filter(s => getVisaStatus(s.expiracionVisa).status === "critical") ?? [];
  const atRiskCount = expiredStudents.length + criticalStudents.length;

  // Sort: students with internado end date first (soonest first), then those without
  const sortedStudents = students
    ? [...students].sort((a, b) => {
        const aDate = a.internadoFechaFin ? new Date(a.internadoFechaFin as any).getTime() : null;
        const bDate = b.internadoFechaFin ? new Date(b.internadoFechaFin as any).getTime() : null;
        if (aDate !== null && bDate !== null) return aDate - bDate;
        if (aDate !== null) return -1;
        if (bDate !== null) return 1;
        return 0;
      })
    : undefined;

  return (
    <>
    <div className="flex flex-col h-full bg-background">
      <div className="p-6 border-b border-border bg-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Estudiantes</h1>
            <p className="text-muted-foreground mt-1">Gestión de alumnos de Latin's Driving Support</p>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <Button variant="outline" onClick={openCsvDialog}>
              <FileText className="mr-2 h-4 w-4" /> Importar CSV Bookitit
            </Button>
            <Button variant="outline" onClick={openImportDialog}>
              <Download className="mr-2 h-4 w-4" /> Importar Excel
            </Button>
            <Button variant="outline" onClick={openGcDialog} className="border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30">
              <Phone className="mr-2 h-4 w-4" /> Google Contacts
            </Button>
            <Button asChild>
              <Link href="/students/new">
                <Plus className="mr-2 h-4 w-4" /> Agregar Estudiante
              </Link>
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-primary/5 border-primary/10">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total</p>
                {isLoadingSummary ? (
                  <Skeleton className="h-6 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-foreground">{summary?.total || 0}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Valor Total</p>
                {isLoadingSummary ? (
                  <Skeleton className="h-6 w-24 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-foreground">{formatYen(summary?.totalValor)}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-green-500/5 border-green-500/10 dark:bg-green-500/10 dark:border-green-500/20">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Cobrado</p>
                {isLoadingSummary ? (
                  <Skeleton className="h-6 w-24 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatYen(summary?.totalPagado)}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-destructive/5 border-destructive/10 dark:bg-destructive/10 dark:border-destructive/20">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-destructive/20 flex items-center justify-center text-destructive">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pendiente</p>
                {isLoadingSummary ? (
                  <Skeleton className="h-6 w-24 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-destructive">{formatYen(summary?.totalRestante)}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Language Cache Status */}
        <div className="mt-4">
          <Card className={isCacheStatsError ? "bg-destructive/5 border-destructive/20" : "bg-muted/40 border-border"}>
            <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${isCacheStatsError ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"}`}>
                <Database className="h-5 w-5" />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:gap-6 gap-1 flex-1 min-w-0">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Caché de idiomas</p>
                  {isLoadingCacheStats ? (
                    <Skeleton className="h-5 w-20 mt-1" />
                  ) : isCacheStatsError ? (
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-sm font-medium text-destructive">Error al cargar</p>
                      <button
                        onClick={() => refetchCacheStats()}
                        className="text-xs font-medium text-destructive underline underline-offset-2 hover:text-destructive/80 transition-colors"
                      >
                        Reintentar
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-lg font-bold text-foreground">
                        {cacheStats?.uniqueUserCount ?? 0}{" "}
                        <span className="text-sm font-normal text-muted-foreground">
                          usuarios únicos
                        </span>
                        {(cacheStats?.groupCount ?? 0) > 0 && (
                          <span className="ml-2 text-xs text-muted-foreground/70">
                            · {cacheStats!.groupCount} grupo{cacheStats!.groupCount === 1 ? "" : "s"}
                          </span>
                        )}
                        <span className="ml-2 text-xs text-muted-foreground/60">
                          ({cacheStats?.entryCount ?? 0} entradas)
                        </span>
                      </p>
                      {cacheStats?.byLanguage && Object.keys(cacheStats.byLanguage).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {Object.entries(cacheStats.byLanguage)
                            .sort(([, a], [, b]) => b - a)
                            .map(([lang, count]) => {
                              const colorClass = LANG_BADGE_COLORS[lang.toLowerCase()] ?? "bg-muted text-muted-foreground";
                              return (
                                <span
                                  key={lang}
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
                                >
                                  <span className="uppercase font-semibold">{lang}</span>
                                  <span>{count}</span>
                                </span>
                              );
                            })}
                        </div>
                      )}
                      {cacheStats?.byLanguageGroups && Object.keys(cacheStats.byLanguageGroups).length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="text-xs text-muted-foreground/70">Grupos:</span>
                          {Object.entries(cacheStats.byLanguageGroups)
                            .sort(([, a], [, b]) => b - a)
                            .map(([lang, count]) => {
                              const colorClass = LANG_BADGE_COLORS[lang.toLowerCase()] ?? "bg-muted text-muted-foreground";
                              return (
                                <span
                                  key={lang}
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium opacity-80 ${colorClass}`}
                                >
                                  <span className="uppercase font-semibold">{lang}</span>
                                  <span>{count}</span>
                                </span>
                              );
                            })}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {!isCacheStatsError && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Última poda</p>
                    {isLoadingCacheStats ? (
                      <Skeleton className="h-5 w-36 mt-1" />
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground">{formatPruneDate(cacheStats?.lastPruneAt)}</p>
                        {(cacheStats?.lastPruneMalformed ?? 0) > 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                            {cacheStats!.lastPruneMalformed} clave{cacheStats!.lastPruneMalformed === 1 ? "" : "s"} malformada{cacheStats!.lastPruneMalformed === 1 ? "" : "s"} eliminada{cacheStats!.lastPruneMalformed === 1 ? "" : "s"}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              {!isCacheStatsError && (
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {prunePending && (
                    <div className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-400">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>Poda en espera — el bot está desconectado</span>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isLoadingCacheStats || isPruning}
                    onClick={() => pruneCache()}
                  >
                    {isPruning ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    )}
                    Podar ahora
                  </Button>
                </div>
              )}
            </div>
            {pruneHistory && pruneHistory.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Historial de podas</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left pb-1 font-medium pr-4">Fecha</th>
                        <th className="text-right pb-1 font-medium pr-4">Eliminadas</th>
                        <th className="text-right pb-1 font-medium">Malformadas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pruneHistory.slice(0, 10).map((entry) => (
                        <tr key={entry.id} className="border-b border-border/50 last:border-0">
                          <td className="py-1 pr-4 text-foreground">{formatPruneDate(entry.prunedAt)}</td>
                          <td className="py-1 pr-4 text-right text-foreground">{entry.removed}</td>
                          <td className={`py-1 text-right font-medium ${entry.malformed > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {entry.malformed}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="p-6 flex-1 flex flex-col min-h-0 bg-muted/30">

        {/* Visa Alert Banner */}
        {!isLoadingStudents && atRiskCount > 0 && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-red-700 dark:text-red-400">
                  Alerta de visa — {atRiskCount} alumno{atRiskCount > 1 ? "s" : ""} en riesgo
                </p>
                <p className="text-sm text-red-600 dark:text-red-400/80 mt-1">
                  {expiredStudents.length > 0 && (
                    <span className="font-medium">🚨 {expiredStudents.length} visa{expiredStudents.length > 1 ? "s" : ""} vencida{expiredStudents.length > 1 ? "s" : ""}: {expiredStudents.map(s => s.nombre).join(", ")}. </span>
                  )}
                  {criticalStudents.length > 0 && (
                    <span>⚠️ {criticalStudents.length} vence{criticalStudents.length > 1 ? "n" : ""} en menos de 30 días: {criticalStudents.map(s => s.nombre).join(", ")}.</span>
                  )}
                </p>
                <p className="text-xs text-red-500 dark:text-red-400/60 mt-1">
                  Usa <code className="bg-red-100 dark:bg-red-900/50 px-1 rounded">@visas</code> en WhatsApp para ver el reporte o{" "}
                  <code className="bg-red-100 dark:bg-red-900/50 px-1 rounded">@avisarvisas</code> para notificarlos automáticamente.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, teléfono o código KM..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-72 bg-card"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setLangFilter([]); setTsuruokaFilter(false); }}
              className={[
                "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                langFilter.length === 0 && !tsuruokaFilter
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:bg-muted",
              ].join(" ")}
            >
              Todos
            </button>
            {LANG_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLangFilter(prev =>
                  prev.includes(opt.value)
                    ? prev.filter(l => l !== opt.value)
                    : [...prev, opt.value]
                )}
                className={[
                  "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                  langFilter.includes(opt.value)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:bg-muted",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => setTsuruokaFilter(prev => !prev)}
              className={[
                "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                tsuruokaFilter
                  ? "bg-emerald-600 text-white border-emerald-700"
                  : "bg-card text-muted-foreground border-border hover:bg-muted",
              ].join(" ")}
            >
              🎓 Tsuruoka
            </button>
          </div>
          {!isLoadingStudents && (
            <span className="text-sm text-muted-foreground">
              {(() => {
                const count = students?.length ?? 0;
                const plural = count !== 1 ? "s" : "";
                const countEl = <span className="font-semibold text-foreground">{count}</span>;
                if (langFilter.length > 0 && search) {
                  const langLabel = langFilter.map(l => l.toUpperCase()).join("+");
                  return <>{countEl} estudiante{plural} ({langLabel})</>;
                }
                if (langFilter.length > 0) {
                  const langLabel = langFilter.map(l => l.toUpperCase()).join("+");
                  return <>{countEl} estudiante{plural} en {langLabel}</>;
                }
                if (search) {
                  return <>{countEl} estudiante{plural} encontrado{plural}</>;
                }
                const total = summary?.total ?? count;
                const totalPlural = total !== 1 ? "s" : "";
                return <><span className="font-semibold text-foreground">{total}</span> estudiante{totalPlural} en total</>;
              })()}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto rounded-md border border-border bg-card">
          {isLoadingStudents ? (
            <div className="p-4 space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b border-border/50 pb-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-4 w-1/4" />
                  </div>
                  <Skeleton className="h-8 w-24 rounded-full" />
                </div>
              ))}
            </div>
          ) : students?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">No se encontraron estudiantes</h3>
              <p className="text-muted-foreground max-w-sm mt-1">
                {search ? "Ningún estudiante coincide con la búsqueda." : "Comienza agregando un nuevo estudiante."}
              </p>
              {!search && (
                <Button asChild className="mt-4" variant="outline">
                  <Link href="/students/new">Agregar Primer Estudiante</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sortedStudents?.map((student) => {
                const isPaid = (student.montoRestante || 0) <= 0;
                const isPartial = (student.montoPagado || 0) > 0 && (student.montoRestante || 0) > 0;
                const { status: visaStatus } = getVisaStatus(student.expiracionVisa);

                const rowBg =
                  visaStatus === "expired" ? "bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/60 dark:hover:bg-red-950/30" :
                  visaStatus === "critical" ? "bg-orange-50/60 dark:bg-orange-950/20 hover:bg-orange-100/60 dark:hover:bg-orange-950/30" :
                  "hover:bg-muted/50";

                return (
                  <Link
                    key={student.id}
                    href={`/students/${student.id}`}
                    className={`flex flex-col sm:flex-row sm:items-center gap-4 p-4 transition-colors block ${rowBg}`}
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${
                        visaStatus === "expired" ? "bg-red-200 dark:bg-red-900" :
                        visaStatus === "critical" ? "bg-orange-200 dark:bg-orange-900" :
                        "bg-primary/10"
                      }`}>
                        {visaStatus === "expired" || visaStatus === "critical" ? (
                          <AlertTriangle className={`h-5 w-5 ${visaStatus === "expired" ? "text-red-600" : "text-orange-500"}`} />
                        ) : (
                          <span className="text-lg font-medium text-primary uppercase">
                            {student.nombre.charAt(0)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-semibold truncate">{student.nombre}</h4>
                          {student.codigoAlumno && (
                            <span className="text-xs font-mono font-bold text-primary shrink-0">
                              {student.codigoAlumno}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5 flex-wrap">
                          {student.telefono?.startsWith("PENDIENTE-") ? (
                            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium italic">sin teléfono</span>
                          ) : (
                            <span className="truncate">{student.telefono}</span>
                          )}
                          <LicenciaBadge tipo={student.tipoLicencia} />
                          <LanguageBadge language={student.preferredLanguage} />
                          {student.tsuruokaGraduado && <TsuruokaBadge />}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-6 justify-between sm:justify-end pl-16 sm:pl-0">
                      <div className="text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          <span className="text-xs uppercase tracking-wider font-medium">Visa</span>
                        </div>
                        <VisaBadge dateString={student.expiracionVisa} />
                      </div>

                      <div className="flex flex-col items-end gap-1.5 min-w-[100px]">
                        <Badge
                          variant={isPaid ? "default" : isPartial ? "secondary" : "destructive"}
                          className={
                            isPaid ? "bg-green-500 hover:bg-green-600 text-white" :
                            isPartial ? "bg-amber-500 hover:bg-amber-600 text-white" : ""
                          }
                        >
                          {isPaid ? "Pagado" : isPartial ? "Parcial" : "Pendiente"}
                        </Badge>
                        <span className="text-sm font-bold text-foreground">
                          {formatYen(student.montoRestante)}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Import from Bookitit CSV Dialog */}
    <Dialog open={csvOpen} onOpenChange={(open) => { if (!open && csvStep !== "importing") setCsvOpen(false); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Importar clientes desde CSV de Bookitit
          </DialogTitle>
          <DialogDescription>
            Exporta desde Bookitit → Clientes → Exportar, sube el CSV aquí.
            Se asignan automáticamente los códigos KM por nombre y se guarda el teléfono real.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {/* Idle: file picker */}
          {(csvStep === "idle" || csvStep === "error") && (
            <div className="space-y-4">
              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">{csvFile ? csvFile.name : "Selecciona el archivo CSV"}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {csvFile ? `${(csvFile.size / 1024).toFixed(1)} KB` : "Exportado desde Bookitit → Clientes → Exportar"}
                  </p>
                </div>
                <input
                  type="file"
                  accept=".csv,text/plain,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setCsvFile(f);
                    setCsvStep("idle");
                    setCsvError(null);
                  }}
                />
              </label>
              {csvStep === "error" && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  <p className="text-sm text-destructive">{csvError}</p>
                </div>
              )}
            </div>
          )}

          {/* Previewing */}
          {csvStep === "previewing" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Analizando CSV…</p>
            </div>
          )}

          {/* Preview results */}
          {csvStep === "preview" && csvPreview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border bg-card p-3 text-center">
                  <p className="text-2xl font-bold">{csvPreview.total}</p>
                  <p className="text-xs text-muted-foreground mt-1">en CSV</p>
                </div>
                <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{csvPreview.toImport}</p>
                  <p className="text-xs text-muted-foreground mt-1">nuevos a importar</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{csvPreview.toSkip}</p>
                  <p className="text-xs text-muted-foreground mt-1">ya existen</p>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                  <p className="text-lg font-bold text-amber-600">{csvPreview.withoutPhone}</p>
                  <p className="text-xs text-muted-foreground mt-1">sin teléfono (omitidos)</p>
                </div>
                <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{csvPreview.kmMatched}</p>
                  <p className="text-xs text-muted-foreground mt-1">con código KM</p>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{csvPreview.toImport - csvPreview.kmMatched}</p>
                  <p className="text-xs text-muted-foreground mt-1">sin KM (nuevos)</p>
                </div>
              </div>

              {csvPreview.preview.length > 0 ? (
                <div>
                  <p className="text-sm font-medium mb-2">
                    Muestra ({Math.min(csvPreview.preview.length, 60)} de {csvPreview.toImport}):
                  </p>
                  <ScrollArea className="h-52 rounded-md border">
                    <div className="divide-y">
                      {csvPreview.preview.map((c, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-primary">{(c.name || "?").charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium truncate">{c.name}</p>
                              {c.kmCode && <span className="text-xs font-mono font-bold text-primary shrink-0">{c.kmCode}</span>}
                              <LicenciaBadge tipo={c.licencia} />
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{c.phone ?? "sin teléfono"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  <p>Todos los clientes del CSV ya están en el panel o no tienen teléfono.</p>
                </div>
              )}
            </div>
          )}

          {/* Importing */}
          {csvStep === "importing" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Importando clientes…</p>
            </div>
          )}

          {/* Done */}
          {csvStep === "done" && csvResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{csvResult.imported}</p>
                  <p className="text-xs text-muted-foreground mt-1">importados</p>
                </div>
                <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{csvResult.kmMatched}</p>
                  <p className="text-xs text-muted-foreground mt-1">con KM asignado</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{csvResult.skipped}</p>
                  <p className="text-xs text-muted-foreground mt-1">ya existían</p>
                </div>
                <div className={`rounded-lg border p-3 text-center ${csvResult.errors.length > 0 ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" : "bg-muted/40"}`}>
                  <p className={`text-2xl font-bold ${csvResult.errors.length > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{csvResult.errors.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">errores</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  ¡Importación completada! {csvResult.imported} clientes nuevos añadidos.
                  {csvResult.withoutPhone > 0 && ` (${csvResult.withoutPhone} omitidos por no tener teléfono)`}
                  {csvResult.duplicated > 0 && ` (${csvResult.duplicated} duplicados en el CSV ignorados)`}
                </p>
              </div>
              {csvResult.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-red-600 mb-1">Errores:</p>
                  <ScrollArea className="h-32 rounded-md border bg-red-50 dark:bg-red-950/20">
                    <div className="p-3 space-y-1">
                      {csvResult.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-700 dark:text-red-400">{err}</p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {(csvStep === "idle" || csvStep === "error") && (
            <>
              <Button variant="outline" onClick={() => setCsvOpen(false)}>Cancelar</Button>
              <Button onClick={handleCsvPreview} disabled={!csvFile}>
                <FileText className="mr-2 h-4 w-4" /> Vista previa
              </Button>
            </>
          )}
          {csvStep === "preview" && (
            <>
              <Button variant="outline" onClick={() => setCsvStep("idle")}>Volver</Button>
              <Button disabled={csvPreview?.toImport === 0} onClick={handleCsvImport}>
                <Upload className="mr-2 h-4 w-4" />
                Importar {csvPreview?.toImport ?? 0} clientes
              </Button>
            </>
          )}
          {csvStep === "done" && (
            <Button onClick={() => setCsvOpen(false)}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Import from Excel Dialog */}
    <Dialog open={importOpen} onOpenChange={(open) => { if (!open && importStep !== "importing") setImportOpen(false); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Importar alumnos desde Excel
          </DialogTitle>
          <DialogDescription>
            Carga los 849 alumnos del Excel de Carlos (KM1655–KM2519) con su nombre, código KM y tipo de licencia.
            El teléfono queda vacío hasta que el alumno escriba por WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {/* Idle */}
          {importStep === "idle" && (
            <div className="text-center py-6 text-muted-foreground">
              <Download className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Haz clic en "Vista previa" para ver qué alumnos se importarían.</p>
              <p className="text-xs mt-2">Los ya existentes (por código KM) se omiten automáticamente.</p>
            </div>
          )}

          {/* Previewing */}
          {importStep === "previewing" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Preparando vista previa…</p>
            </div>
          )}

          {/* Preview results */}
          {importStep === "preview" && importPreview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-card p-3 text-center">
                  <p className="text-2xl font-bold">{importPreview.total}</p>
                  <p className="text-xs text-muted-foreground mt-1">en Excel</p>
                </div>
                <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{importPreview.toImport}</p>
                  <p className="text-xs text-muted-foreground mt-1">a importar</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{importPreview.toSkip}</p>
                  <p className="text-xs text-muted-foreground mt-1">ya existen</p>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                  <div className="flex justify-center gap-1 flex-wrap">
                    <span className="text-[11px] font-bold text-blue-600">{importPreview.byLicencia.AT}AT</span>
                    <span className="text-[11px] font-bold text-emerald-600">{importPreview.byLicencia.MT}MT</span>
                    <span className="text-[11px] font-bold text-amber-600">{importPreview.byLicencia.JC}JC</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">licencias</p>
                </div>
              </div>

              {importPreview.clients.length > 0 ? (
                <div>
                  <p className="text-sm font-medium mb-2">
                    Muestra ({Math.min(importPreview.clients.length, 100)} de {importPreview.toImport}):
                  </p>
                  <ScrollArea className="h-56 rounded-md border">
                    <div className="divide-y">
                      {importPreview.clients.map((c, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-primary">{c.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{c.name}</p>
                              <span className="text-xs font-mono font-bold text-primary shrink-0">{c.code}</span>
                              <LicenciaBadge tipo={c.licencia} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  <p>Todos los alumnos del Excel ya están en el panel.</p>
                </div>
              )}
            </div>
          )}

          {/* Importing */}
          {importStep === "importing" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Importando alumnos…</p>
              <p className="text-xs text-muted-foreground">Esto puede tardar unos segundos</p>
            </div>
          )}

          {/* Done */}
          {importStep === "done" && importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{importResult.imported}</p>
                  <p className="text-xs text-muted-foreground mt-1">importados</p>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                  <div className="flex justify-center gap-1 flex-wrap mt-1">
                    <span className="text-sm font-bold text-blue-600">{importResult.byLicencia?.AT ?? 0}AT</span>
                    <span className="text-sm font-bold text-emerald-600">{importResult.byLicencia?.MT ?? 0}MT</span>
                    <span className="text-sm font-bold text-amber-600">{importResult.byLicencia?.JC ?? 0}JC</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">licencias</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{importResult.skipped}</p>
                  <p className="text-xs text-muted-foreground mt-1">omitidos</p>
                </div>
                <div className={`rounded-lg border p-3 text-center ${importResult.errors.length > 0 ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" : "bg-muted/40"}`}>
                  <p className={`text-2xl font-bold ${importResult.errors.length > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{importResult.errors.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">errores</p>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  ¡Importación completada! {importResult.imported} alumnos nuevos añadidos al panel.
                </p>
              </div>

              {importResult.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-red-600 mb-1">Errores:</p>
                  <ScrollArea className="h-32 rounded-md border bg-red-50 dark:bg-red-950/20">
                    <div className="p-3 space-y-1">
                      {importResult.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-700 dark:text-red-400">{err}</p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {importStep === "error" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="font-medium">Error al cargar los datos</p>
              <p className="text-sm text-muted-foreground max-w-sm">{importError}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {(importStep === "idle" || importStep === "error") && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
              <Button onClick={handlePreview}>
                <Download className="mr-2 h-4 w-4" /> Vista previa
              </Button>
            </>
          )}
          {importStep === "preview" && (
            <>
              <Button variant="outline" onClick={() => setImportStep("idle")}>Volver</Button>
              <Button
                disabled={importPreview?.toImport === 0}
                onClick={handleImport}
              >
                <Download className="mr-2 h-4 w-4" />
                Importar {importPreview?.toImport ?? 0} alumnos
              </Button>
            </>
          )}
          {importStep === "done" && (
            <Button onClick={() => setImportOpen(false)}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {/* Google Contacts Dialog */}
    <Dialog open={gcOpen} onOpenChange={(open) => { if (!open && gcStep !== "applying" && gcStep !== "parsing") setGcOpen(false); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-blue-600" />
            Google Contacts
          </DialogTitle>
          <DialogDescription>
            Importa teléfonos desde tus contactos de Google o conecta tu cuenta para sincronización automática.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="csv" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="mb-4 shrink-0">
            <TabsTrigger value="csv">
              <Upload className="mr-2 h-4 w-4" /> Importar CSV
            </TabsTrigger>
            <TabsTrigger value="api" onClick={fetchGcStatus}>
              <Link2 className="mr-2 h-4 w-4" /> Conexión API
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: CSV Import ─────────────────────────────────────── */}
          <TabsContent value="csv" className="flex-1 overflow-hidden flex flex-col gap-4">
            <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-3 text-sm text-blue-800 dark:text-blue-300 shrink-0">
              <p className="font-medium mb-1">Cómo exportar tus contactos de Google:</p>
              <ol className="list-decimal ml-4 space-y-0.5 text-xs">
                <li>Ve a <strong>contacts.google.com</strong></li>
                <li>Haz clic en <strong>"Exportar"</strong> en el menú izquierdo</li>
                <li>Selecciona <strong>"Google CSV"</strong> y descarga el archivo</li>
                <li>Súbelo aquí abajo</li>
              </ol>
            </div>

            {gcStep === "idle" && (
              <div className="space-y-3">
                <label className="block">
                  <div className="flex items-center justify-center border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:border-blue-400 transition-colors" onClick={() => document.getElementById("gc-file-input")?.click()}>
                    <div className="text-center">
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium">{gcFile ? gcFile.name : "Haz clic para seleccionar el CSV de Google Contacts"}</p>
                      {gcFile && <p className="text-xs text-muted-foreground mt-1">{(gcFile.size / 1024).toFixed(1)} KB</p>}
                    </div>
                  </div>
                  <input id="gc-file-input" type="file" accept=".csv,text/csv" className="hidden" onChange={e => setGcFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            )}

            {gcStep === "error" && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <XCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium">Error al procesar el CSV</p>
                <p className="text-sm text-muted-foreground">{gcError}</p>
                <Button variant="outline" size="sm" onClick={() => { setGcStep("idle"); setGcFile(null); }}>Intentar de nuevo</Button>
              </div>
            )}

            {gcStep === "parsing" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Analizando contactos y buscando coincidencias…</p>
              </div>
            )}

            {gcStep === "preview" && gcPreview && (
              <div className="flex-1 overflow-hidden flex flex-col gap-3">
                <div className="grid grid-cols-4 gap-2 shrink-0">
                  <div className="rounded-lg border bg-card p-2 text-center">
                    <p className="text-xl font-bold">{gcPreview.totalContacts}</p>
                    <p className="text-xs text-muted-foreground">contactos</p>
                  </div>
                  <div className="rounded-lg border bg-card p-2 text-center">
                    <p className="text-xl font-bold">{gcPreview.withPhone}</p>
                    <p className="text-xs text-muted-foreground">con teléfono</p>
                  </div>
                  <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-2 text-center">
                    <p className="text-xl font-bold text-green-600 dark:text-green-400">{gcPreview.matched}</p>
                    <p className="text-xs text-muted-foreground">coincidencias</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-2 text-center">
                    <p className="text-xl font-bold text-muted-foreground">{gcPreview.unmatched}</p>
                    <p className="text-xs text-muted-foreground">sin coincidencia</p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground shrink-0">
                  Selecciona las filas que quieres actualizar. Las marcadas en verde tienen teléfono pendiente (seguro). Las amarillas ya tienen un teléfono real.
                </p>

                <ScrollArea className="flex-1 rounded-md border">
                  <div className="divide-y">
                    {gcPreview.results.filter(r => r.studentId !== null).map((r, i) => {
                      const isSelected = gcSelected.has(i);
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${isSelected ? (r.isPendiente ? "bg-green-50 dark:bg-green-950/20" : "bg-yellow-50 dark:bg-yellow-950/20") : "opacity-50"}`}
                          onClick={() => {
                            const s = new Set(gcSelected);
                            if (s.has(i)) s.delete(i); else s.add(i);
                            setGcSelected(s);
                          }}
                        >
                          <input type="checkbox" checked={isSelected} readOnly className="h-4 w-4 accent-blue-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">{r.contactName}</span>
                              <span className="text-xs text-muted-foreground">→</span>
                              <span className="text-sm truncate">{r.studentName}</span>
                              {r.studentCode && <span className="text-xs font-mono text-primary">{r.studentCode}</span>}
                              {r.isPendiente
                                ? <Badge variant="outline" className="text-[10px] border-green-400 text-green-600 shrink-0">pendiente</Badge>
                                : <Badge variant="outline" className="text-[10px] border-yellow-400 text-yellow-600 shrink-0">ya tiene tel.</Badge>
                              }
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              {!r.isPendiente && <span className="line-through">{r.currentPhone}</span>}
                              <span className="font-medium text-foreground">{r.phone}</span>
                              <span className="text-muted-foreground/60">({r.score}% match)</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}

            {gcStep === "applying" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Actualizando teléfonos…</p>
              </div>
            )}

            {gcStep === "done" && gcResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-4">
                  <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0" />
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">
                      ¡Listo! {gcResult.updated} teléfonos actualizados.
                    </p>
                    {gcResult.errors.length > 0 && (
                      <p className="text-xs text-red-600 mt-1">{gcResult.errors.length} errores — algunos teléfonos ya estaban registrados con otro alumno.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="shrink-0 pt-2">
              {gcStep === "idle" && (
                <>
                  <Button variant="outline" onClick={() => setGcOpen(false)}>Cancelar</Button>
                  <Button onClick={handleGcParse} disabled={!gcFile}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Buscar coincidencias
                  </Button>
                </>
              )}
              {gcStep === "preview" && gcPreview && (
                <>
                  <Button variant="outline" onClick={() => { setGcStep("idle"); setGcFile(null); }}>Volver</Button>
                  <Button onClick={handleGcApply} disabled={gcSelected.size === 0}>
                    <Upload className="mr-2 h-4 w-4" /> Actualizar {gcSelected.size} teléfonos
                  </Button>
                </>
              )}
              {gcStep === "done" && (
                <Button onClick={() => setGcOpen(false)}>Cerrar</Button>
              )}
            </DialogFooter>
          </TabsContent>

          {/* ── Tab 2: API Connection ─────────────────────────────────── */}
          <TabsContent value="api" className="flex-1 flex flex-col gap-4">
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Estado de conexión</p>
                  <p className="text-sm text-muted-foreground">
                    Cuando está conectado, los nuevos alumnos se agregan automáticamente a Google Contacts.
                  </p>
                </div>
                {gcStatus === null ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : gcStatus.connected ? (
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-300">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Conectado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    <XCircle className="mr-1 h-3 w-3" /> Desconectado
                  </Badge>
                )}
              </div>

              {gcStatus?.connected && gcStatus.updatedAt && (
                <p className="text-xs text-muted-foreground">
                  Última autorización: {new Date(gcStatus.updatedAt).toLocaleString("es-JP", { timeZone: "Asia/Tokyo" })}
                </p>
              )}

              {!gcStatus?.configured && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-300 mb-2">Configuración requerida</p>
                  <p className="text-amber-700 dark:text-amber-400 text-xs space-y-1">
                    Para habilitar la sincronización automática, necesitas crear credenciales OAuth en Google Cloud Console:
                  </p>
                  <ol className="list-decimal ml-4 mt-2 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                    <li>Ve a <strong>console.cloud.google.com</strong> → Crea un proyecto</li>
                    <li>Habilita <strong>People API</strong></li>
                    <li>Ve a <strong>Credenciales</strong> → Crear credencial → OAuth 2.0</li>
                    <li>Tipo: <strong>Aplicación web</strong></li>
                    <li>URI de redireccionamiento autorizado:<br/>
                      <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded text-[10px] break-all">
                        {window.location.origin}/api/google-contacts/callback
                      </code>
                    </li>
                    <li>Copia el <strong>Client ID</strong> y <strong>Client Secret</strong></li>
                    <li>Agrégalos como secretos <strong>GOOGLE_CLIENT_ID</strong> y <strong>GOOGLE_CLIENT_SECRET</strong> en este proyecto</li>
                  </ol>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {gcStatus?.connected ? (
                  <Button variant="destructive" size="sm" onClick={handleGcDisconnect} disabled={gcDisconnecting}>
                    {gcDisconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlink className="mr-2 h-4 w-4" />}
                    Desconectar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!gcStatus?.configured}
                    onClick={() => { window.location.href = "/api/google-contacts/auth"; }}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Conectar con Google
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={fetchGcStatus}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
    </>
  );
}
