import { type ReactNode, useState } from "react";
import { Link } from "wouter";
import { useListProspects } from "@workspace/api-client-react";
import { LanguageBadge } from "@/components/LanguageBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users2, Search, UserPlus } from "lucide-react";

const LANG_OPTIONS = [
  { value: "es", label: "ES" },
  { value: "ur", label: "UR" },
  { value: "en", label: "EN" },
];

function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return phone.slice(0, -4).replace(/./g, "•") + phone.slice(-4);
}

function highlightMaskedPhone(phone: string, search: string): ReactNode {
  const masked = maskPhone(phone);
  if (!search) return masked;

  // The visible window: last min(phone.length, 4) characters of the full phone.
  const visibleCount = Math.min(phone.length, 4);
  const visibleStart = phone.length - visibleCount;

  // Find the last occurrence of the search string that overlaps the visible window.
  // We scan all occurrences and pick the last one that has any overlap.
  let matchIdx = -1;
  let fromIdx = 0;
  while (fromIdx <= phone.length - search.length) {
    const found = phone.indexOf(search, fromIdx);
    if (found === -1) break;
    const matchEnd = found + search.length;
    if (matchEnd > visibleStart) {
      matchIdx = found;
    }
    fromIdx = found + 1;
  }

  if (matchIdx === -1) return masked;

  // Clamp the highlight to the visible portion only.
  const matchEnd = matchIdx + search.length;
  const overlapStart = Math.max(matchIdx, visibleStart);
  const overlapEnd = Math.min(matchEnd, phone.length);

  if (overlapStart >= overlapEnd) return masked;

  const before = masked.slice(0, overlapStart);
  const highlight = masked.slice(overlapStart, overlapEnd);
  const after = masked.slice(overlapEnd);

  return (
    <>
      {before}
      <span className="font-bold text-primary">{highlight}</span>
      {after}
    </>
  );
}

export default function ProspectsPage() {
  const [langFilter, setLangFilter] = useState<string[]>([]);
  const [phoneSearch, setPhoneSearch] = useState("");

  const params = langFilter.length > 0 ? { lang: langFilter } : undefined;
  const { data, isLoading, isError } = useListProspects(params);

  const normalizedSearch = phoneSearch.replace(/\D/g, "");
  const filteredProspects = normalizedSearch
    ? (data?.prospects ?? []).filter(({ phone }) => phone.includes(normalizedSearch))
    : (data?.prospects ?? []);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-6 border-b border-border bg-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Prospectos</h1>
            <p className="text-muted-foreground mt-1">
              Contactos con idioma detectado que aún no son alumnos
            </p>
          </div>
        </div>

        {/* Summary card */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="bg-primary/5 border-primary/10">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <Users2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total prospectos</p>
                {isLoading ? (
                  <Skeleton className="h-6 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-foreground">{data?.total ?? 0}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Language breakdown */}
          <Card className="bg-muted/40 border-border">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-muted-foreground mb-2">Por idioma</p>
              {isLoading ? (
                <Skeleton className="h-5 w-32" />
              ) : data?.byLanguage && Object.keys(data.byLanguage).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.byLanguage)
                    .sort(([, a], [, b]) => b - a)
                    .map(([lang, count]) => (
                      <span
                        key={lang}
                        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                      >
                        <LanguageBadge language={lang} />
                        <span className="text-foreground font-semibold">{count}</span>
                      </span>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sin datos</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Filters row */}
        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          {/* Phone search */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Buscar por teléfono…"
              value={phoneSearch}
              onChange={(e) => setPhoneSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Language filter buttons */}
          <div className="flex gap-2 flex-wrap items-center">
            <button
              onClick={() => setLangFilter([])}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                langFilter.length === 0
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              Todos
            </button>
            {LANG_OPTIONS.map((opt) => {
              const isActive = langFilter.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() =>
                    setLangFilter((prev) =>
                      isActive
                        ? prev.filter((l) => l !== opt.value)
                        : [...prev, opt.value]
                    )
                  }
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Prospects list */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center h-40 text-destructive">
            Error al cargar los prospectos
          </div>
        ) : !data || filteredProspects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Users2 className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {normalizedSearch
                ? "No hay prospectos con ese número"
                : langFilter.length > 0
                  ? `No hay prospectos con idioma "${langFilter.map((l) => l.toUpperCase()).join(", ")}"`
                  : "No hay prospectos registrados"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredProspects.map((prospect) => (
              <Card key={prospect.phone} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground font-mono">
                      {highlightMaskedPhone(prospect.phone, normalizedSearch)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Visto: {formatDateTime(prospect.updatedAt)}
                    </p>
                  </div>
                  <LanguageBadge language={prospect.lang} />
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                    className="shrink-0 gap-1.5"
                  >
                    <Link href={`/students/new?phone=${encodeURIComponent(prospect.phone)}`}>
                      <UserPlus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Registrar como alumno</span>
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
