import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Car, Users, MessageCircleQuestion, ClipboardList, Users2, Settings } from "lucide-react";
import { NotificationBell } from "./NotificationBell";
import { useQuery } from "@tanstack/react-query";

function usePendientesCount() {
  const { data } = useQuery<{ total: number }>({
    queryKey: ["bot-pendientes"],
    queryFn: () => fetch("/api/bot-pendientes").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
  return data?.total ?? 0;
}

function useProspectsCount() {
  const { data } = useQuery<{ total: number }>({
    queryKey: ["prospects-count"],
    queryFn: () => fetch("/api/prospects/count").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
  return data?.total ?? 0;
}

function NavBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const pendientesCount = usePendientesCount();
  const prospectsCount = useProspectsCount();

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Sidebar - desktop */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card">
        <div className="p-6">
          <Link href="/" className="flex items-center gap-3 font-semibold text-xl text-primary">
            <Car className="h-6 w-6" />
            <span>Latin's Driving</span>
          </Link>
        </div>
        
        <nav className="flex-1 px-4 py-2 space-y-1">
          <Link 
            href="/students" 
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
              location.startsWith("/students") 
                ? "bg-primary/10 text-primary font-medium" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Users className="h-5 w-5" />
            <span>Students</span>
          </Link>
          <Link 
            href="/questions" 
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
              location.startsWith("/questions") 
                ? "bg-primary/10 text-primary font-medium" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <MessageCircleQuestion className="h-5 w-5" />
            <span>Preguntas al Bot</span>
          </Link>
          <Link 
            href="/pendientes" 
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
              location.startsWith("/pendientes") 
                ? "bg-primary/10 text-primary font-medium" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <ClipboardList className="h-5 w-5" />
            <span>Pendientes</span>
            <NavBadge count={pendientesCount} />
          </Link>
          <Link 
            href="/prospects" 
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
              location.startsWith("/prospects") 
                ? "bg-primary/10 text-primary font-medium" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Users2 className="h-5 w-5" />
            <span>Prospectos</span>
            <NavBadge count={prospectsCount} />
          </Link>
          <Link 
            href="/bot-settings" 
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
              location.startsWith("/bot-settings") 
                ? "bg-primary/10 text-primary font-medium" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Settings className="h-5 w-5" />
            <span>Bot Settings</span>
          </Link>
        </nav>
        
        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium">
                C
              </div>
              <span>Carlos</span>
            </div>
            <NotificationBell />
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <Link href="/" className="flex items-center gap-2 font-semibold text-lg text-primary">
          <Car className="h-5 w-5" />
          <span>Latin's Driving</span>
        </Link>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium text-sm">
            C
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card flex justify-around p-2 pb-safe">
        <Link 
          href="/students" 
          className={`flex flex-col items-center p-2 rounded-lg min-w-[64px] ${
            location.startsWith("/students") ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <Users className="h-6 w-6" />
          <span className="text-[10px] mt-1 font-medium">Students</span>
        </Link>
        <Link 
          href="/questions" 
          className={`flex flex-col items-center p-2 rounded-lg min-w-[64px] ${
            location.startsWith("/questions") ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <MessageCircleQuestion className="h-6 w-6" />
          <span className="text-[10px] mt-1 font-medium">Preguntas</span>
        </Link>
        <Link 
          href="/pendientes" 
          className={`relative flex flex-col items-center p-2 rounded-lg min-w-[64px] ${
            location.startsWith("/pendientes") ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <div className="relative">
            <ClipboardList className="h-6 w-6" />
            {pendientesCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white leading-none">
                {pendientesCount > 99 ? "99+" : pendientesCount}
              </span>
            )}
          </div>
          <span className="text-[10px] mt-1 font-medium">Pendientes</span>
        </Link>
        <Link 
          href="/prospects" 
          className={`relative flex flex-col items-center p-2 rounded-lg min-w-[64px] ${
            location.startsWith("/prospects") ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <div className="relative">
            <Users2 className="h-6 w-6" />
            {prospectsCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white leading-none">
                {prospectsCount > 99 ? "99+" : prospectsCount}
              </span>
            )}
          </div>
          <span className="text-[10px] mt-1 font-medium">Prospectos</span>
        </Link>
        <Link 
          href="/bot-settings" 
          className={`flex flex-col items-center p-2 rounded-lg min-w-[64px] ${
            location.startsWith("/bot-settings") ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <Settings className="h-6 w-6" />
          <span className="text-[10px] mt-1 font-medium">Settings</span>
        </Link>
      </nav>
    </div>
  );
}
