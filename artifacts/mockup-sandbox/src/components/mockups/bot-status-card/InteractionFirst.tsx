import { useState, useEffect } from "react";

export function InteractionFirst() {
  const isConnected = true;
  const [secondsAgo, setSecondsAgo] = useState(3);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setSecondsAgo(0);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a1628",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "20px",
          padding: "32px 28px",
          maxWidth: "420px",
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header row: brand + refresh action always visible */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: "20px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "20px",
                fontWeight: 800,
                color: "#0a1628",
                letterSpacing: "-0.4px",
              }}
            >
              Latin's <span style={{ color: "#25d366" }}>Driving</span> Support
            </div>
            <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
              Asistente de WhatsApp
            </div>
          </div>

          {/* Refresh button — always visible affordance */}
          <button
            onClick={handleRefresh}
            title="Verificar estado ahora"
            style={{
              background: isRefreshing ? "#f0fdf4" : "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "8px 12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: "#374151",
              fontWeight: 600,
              transition: "all 0.15s ease",
              flexShrink: 0,
              marginLeft: "12px",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: isRefreshing ? "rotate(360deg)" : "none",
                transition: "transform 0.5s ease",
                color: "#25d366",
              }}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
            Verificar
          </button>
        </div>

        {/* Status — prominent but paired with last-checked */}
        <div
          style={{
            background: isConnected ? "#f0fdf4" : "#fefce8",
            borderRadius: "14px",
            padding: "16px 18px",
            marginBottom: "16px",
            border: isConnected ? "1.5px solid #bbf7d0" : "1.5px solid #fde68a",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "4px",
            }}
          >
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: isConnected ? "#22c55e" : "#eab308",
                boxShadow: isConnected ? "0 0 0 3px rgba(34,197,94,0.2)" : "none",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "15px",
                fontWeight: 700,
                color: isConnected ? "#14532d" : "#713f12",
              }}
            >
              {isConnected ? "WhatsApp vinculado correctamente" : "Esperando escaneo..."}
            </span>
          </div>
          <div style={{ fontSize: "13px", color: "#6b7280", paddingLeft: "20px" }}>
            {isConnected
              ? "El bot está activo y listo para responder mensajes."
              : "Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo"}
          </div>
        </div>

        {/* Last checked — explicit feedback on polling */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            background: "#f9fafb",
            borderRadius: "10px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9ca3af"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span style={{ fontSize: "12px", color: "#6b7280" }}>
              Actualizado hace{" "}
              <strong style={{ color: "#374151" }}>
                {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.floor(secondsAgo / 60)}m`}
              </strong>
            </span>
          </div>
          <span style={{ fontSize: "11px", color: "#d1d5db" }}>
            Auto-verifica cada 4s
          </span>
        </div>

        {/* Copy link — surfaced action, not buried */}
        <button
          onClick={handleCopy}
          style={{
            width: "100%",
            background: copied ? "#f0fdf4" : "transparent",
            border: "1.5px solid #e5e7eb",
            borderRadius: "10px",
            padding: "10px 16px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontSize: "13px",
            color: copied ? "#15803d" : "#6b7280",
            fontWeight: 600,
            transition: "all 0.15s ease",
          }}
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              ¡Enlace copiado!
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              Copiar enlace de estado
            </>
          )}
        </button>
      </div>
    </div>
  );
}
