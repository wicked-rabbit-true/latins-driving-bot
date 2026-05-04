import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";

interface BotNotification {
  id: number;
  type: string;
  message: string;
  chat_id: string | null;
  student_name: string | null;
  leida: boolean;
  created_at: string;
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const times = [0, 0.18, 0.36];
    times.forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.5, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.15);
    });
  } catch (_) {}
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showBrowserNotification(msg: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Latin's Driving — Bot", {
      body: msg,
      icon: "/admin/favicon.ico",
    });
  }
}

const TYPE_LABEL: Record<string, { emoji: string; label: string; color: string }> = {
  identity_fail: { emoji: "❓", label: "Identidad fallida", color: "text-red-600" },
  doubt:         { emoji: "🤔", label: "Necesito tu ayuda", color: "text-amber-600" },
  attention:     { emoji: "⚠️", label: "Atención requerida", color: "text-orange-600" },
  info:          { emoji: "ℹ️", label: "Información", color: "text-blue-600" },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<BotNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const seenIds = useRef<Set<number>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data: BotNotification[] = await res.json();
      setNotifications(data);

      const newUnread = data.filter((n) => !n.leida && !seenIds.current.has(n.id));
      if (newUnread.length > 0) {
        playAlertSound();
        newUnread.forEach((n) => {
          const meta = TYPE_LABEL[n.type] ?? { emoji: "🔔", label: n.type };
          showBrowserNotification(`${meta.emoji} ${n.message}`);
          seenIds.current.add(n.id);
        });
      }
      data.filter((n) => n.leida).forEach((n) => seenIds.current.add(n.id));
    } catch (_) {}
  }, []);

  useEffect(() => {
    requestNotificationPermission();
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.leida).length;

  async function markRead(id: number) {
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    seenIds.current.add(id);
  }

  async function markAllRead() {
    setLoading(true);
    await fetch("/api/notifications/read-all", { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => ({ ...n, leida: true })));
    setLoading(false);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-full hover:bg-muted transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 max-h-[420px] overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm">Notificaciones del bot</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                Marcar todo leído
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Sin notificaciones
            </div>
          ) : (
            <ul>
              {notifications.map((n) => {
                const meta = TYPE_LABEL[n.type] ?? { emoji: "🔔", label: n.type, color: "text-foreground" };
                return (
                  <li
                    key={n.id}
                    className={`px-4 py-3 border-b border-border last:border-0 cursor-pointer transition-colors ${
                      n.leida ? "opacity-60" : "bg-primary/5 hover:bg-primary/10"
                    }`}
                    onClick={() => !n.leida && markRead(n.id)}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base">{meta.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold ${meta.color}`}>{meta.label}</div>
                        {n.student_name && (
                          <div className="text-xs font-medium text-foreground truncate">{n.student_name}</div>
                        )}
                        <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.message}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">{fmt(n.created_at)}</div>
                      </div>
                      {!n.leida && (
                        <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0 mt-1" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
