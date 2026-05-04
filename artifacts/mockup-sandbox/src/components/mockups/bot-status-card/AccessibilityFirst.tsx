export function AccessibilityFirst() {
  const isConnected = true;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d1f3c",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          padding: "40px 36px",
          maxWidth: "460px",
          width: "100%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        }}
      >
        {/* Brand — clear, high-contrast (7:1 ratio) */}
        <div
          style={{
            marginBottom: "6px",
          }}
        >
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 800,
              color: "#111827",
              margin: 0,
              letterSpacing: "-0.3px",
              lineHeight: 1.2,
            }}
          >
            Latin's{" "}
            <span
              style={{
                color: "#15803d",
              }}
            >
              Driving
            </span>{" "}
            Support
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "#4b5563",
              margin: "6px 0 0 0",
              lineHeight: 1.5,
            }}
          >
            Asistente Inteligente de WhatsApp
          </p>
        </div>

        {/* Divider */}
        <div
          style={{
            height: "1px",
            background: "#e5e7eb",
            margin: "24px 0",
          }}
        />

        {/* Status block — role="status" equivalent, color + icon + text (never color alone) */}
        <div
          role="status"
          aria-live="polite"
          aria-label={
            isConnected
              ? "Estado: WhatsApp conectado y activo"
              : "Estado: Esperando conexión"
          }
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "14px",
            padding: "18px 20px",
            borderRadius: "12px",
            background: isConnected ? "#f0fdf4" : "#fefce8",
            border: isConnected
              ? "2px solid #16a34a"
              : "2px solid #ca8a04",
            marginBottom: "20px",
          }}
        >
          {/* Icon — redundant with text, not the sole indicator */}
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              background: isConnected ? "#16a34a" : "#ca8a04",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginTop: "1px",
            }}
          >
            {isConnected ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            )}
          </div>

          <div>
            {/* Status label — large, bold, not ambiguous */}
            <div
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: isConnected ? "#14532d" : "#713f12",
                lineHeight: 1.3,
                marginBottom: "6px",
              }}
            >
              {isConnected ? "Conectado — Bot activo" : "Desconectado — Escanear QR"}
            </div>

            {/* Description — generous line-height, readable size */}
            <p
              style={{
                fontSize: "15px",
                color: isConnected ? "#166534" : "#854d0e",
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              {isConnected
                ? "WhatsApp vinculado correctamente. El bot está listo para responder mensajes."
                : "Abre WhatsApp en tu teléfono y escanea el código QR para vincular el bot."}
            </p>
          </div>
        </div>

        {/* Secondary info — high contrast, adequate size */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 16px",
            background: "#f9fafb",
            borderRadius: "10px",
            border: "1px solid #e5e7eb",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#374151"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span
            style={{
              fontSize: "13px",
              color: "#374151",
              lineHeight: 1.5,
              fontWeight: 500,
            }}
          >
            Estado verificado automáticamente cada 4 segundos
          </span>
        </div>
      </div>
    </div>
  );
}
