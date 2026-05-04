import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  FileText, 
  Wand2, 
  ArrowLeft,
  BookOpen,
  Zap,
  FileUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/admin", label: "Banco de Preguntas", icon: FileText },
    { href: "/admin/analizar", label: "Analizar con IA", icon: Wand2 },
    { href: "/admin/importar", label: "Importar del Libro", icon: BookOpen },
    { href: "/admin/revision", label: "Revisión Rápida", icon: Zap },
    { href: "/admin/docx", label: "Importar Word (.docx)", icon: FileUp },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background font-sans">
      <header className="border-b border-border/40 bg-card">
        <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center justify-center w-8 h-8 rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <span className="font-semibold text-lg tracking-tight">Admin | Latin's Driving</span>
          </div>
        </div>
      </header>
      <div className="flex-1 flex flex-col md:flex-row container max-w-7xl mx-auto px-4 py-8 gap-8">
        <aside className="w-full md:w-64 shrink-0">
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const active = location === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    active 
                      ? "bg-primary text-primary-foreground" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
