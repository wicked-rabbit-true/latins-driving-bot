export function HierarchyFirst() {
  const isConnected = true;

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
          padding: "36px",
          maxWidth: "440px",
          width: "100%",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        {/* Tier 1: STATUS — dominant, immediately scannable */}
        <div
          style={{
            background: isConnected ? "#dcfce7" : "#fef9c3",
            borderRadius: "16px",
            padding: "20px 24px",
            marginBottom: "28px",
            border: isConnected ? "2px solid #86efac" : "2px solid #fde047",
          }}
        >
          <div
            style={{
              fontSize: "40px",
              lineHeight: 1,
              marginBottom: "8px",
            }}
          >
            {isConnected ? "✅" : "⏳"}
          </div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 800,
              color: isConnected ? "#14532d" : "#713f12",
              letterSpacing: "-0.3px",
              lineHeight: 1.2,
            }}
          >
            {isConnected ? "WhatsApp Conectado" : "Esperando conexión"}
          </div>
          <div
            style={{
              fontSize: "13px",
              color: isConnected ? "#166534" : "#854d0e",
              marginTop: "6px",
              fontWeight: 500,
            }}
          >
            {isConnected
              ? "El bot está activo y respondiendo mensajes"
              : "Escanea el código QR para continuar"}
          </div>
        </div>

        {/* Tier 2: Brand — clear but subordinate to status */}
        <div
          style={{
            borderTop: "1px solid #f0f0f0",
            paddingTop: "24px",
          }}
        >
          <div
            style={{
              fontSize: "22px",
              fontWeight: 800,
              color: "#0a1628",
              letterSpacing: "-0.5px",
            }}
          >
            Latin's{" "}
            <span style={{ color: "#25d366" }}>Driving</span>{" "}
            Support
          </div>

          {/* Tier 3: Role descriptor — smallest, supporting context */}
          <div
            style={{
              fontSize: "12px",
              color: "#9ca3af",
              marginTop: "4px",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.8px",
            }}
          >
            Asistente Inteligente de WhatsApp
          </div>
        </div>

        {/* Visual divider between tiers */}
        {isConnected && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "6px",
              marginTop: "20px",
            }}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: i === 1 ? "#25d366" : "#d1d5db",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
