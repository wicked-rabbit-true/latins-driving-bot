import { Router } from "express";
import { readFileSync, existsSync } from "fs";

const router = Router();

const QR_STATE_FILE = "/tmp/whatsapp-qr-state.json";

function readState(): { status: string; qr: string | null } | null {
  if (!existsSync(QR_STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(QR_STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function buildQrHtml(): string {
  const state = readState();
  const isAuthenticated = state?.status === "authenticated";
  const qrDataUrl = state?.qr ?? null;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Latin's Driving Support – Vincular WhatsApp</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a1628;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #ffffff;
      border-radius: 20px;
      padding: 40px 36px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .logo { font-size: 28px; font-weight: 800; color: #0a1628; margin-bottom: 4px; }
    .logo span { color: #25d366; }
    .subtitle { font-size: 13px; color: #888; margin-bottom: 28px; }
    .qr-wrap { background: #f8f9fa; border-radius: 16px; padding: 20px; margin-bottom: 24px; display: inline-block; }
    .qr-wrap img { display: block; border-radius: 8px; }
    .steps { background: #f0fdf4; border-radius: 12px; padding: 16px 20px; text-align: left; margin-bottom: 20px; }
    .steps h3 { font-size: 13px; font-weight: 700; color: #166534; margin-bottom: 10px; }
    .steps ol { padding-left: 18px; }
    .steps li { font-size: 13px; color: #333; margin-bottom: 6px; line-height: 1.4; }
    .steps b { color: #0a1628; }
    .badge { display: inline-flex; align-items: center; gap: 8px; background: #fff3cd; color: #856404; border-radius: 20px; padding: 6px 14px; font-size: 12px; font-weight: 600; }
    .badge-ok { background: #d1fae5; color: #065f46; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #ffc107; animation: blink 1s infinite; }
    .dot-ok { background: #25d366; animation: none; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .waiting { font-size: 14px; color: #555; padding: 20px; }
    .spinner { width: 40px; height: 40px; border: 4px solid #e0e0e0; border-top-color: #25d366; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .refresh-note { font-size: 11px; color: #aaa; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Latin's <span>Driving</span> Support</div>
    <div class="subtitle">Asistente Inteligente de WhatsApp</div>
    <div id="content">
      ${isAuthenticated ? `
        <div class="badge badge-ok"><div class="dot dot-ok"></div>✅ WhatsApp vinculado correctamente</div>
        <p style="margin-top:20px;font-size:14px;color:#333;">El bot está activo y listo para responder mensajes.</p>
      ` : qrDataUrl ? `
        <div class="qr-wrap"><img id="qr-img" src="${qrDataUrl}" width="260" height="260" alt="QR Code" /></div>
        <div class="steps">
          <h3>📱 Cómo escanear:</h3>
          <ol>
            <li>Abre <b>WhatsApp</b> en tu celular</li>
            <li>Toca los <b>3 puntos (⋮)</b> arriba a la derecha</li>
            <li>Selecciona <b>"Dispositivos vinculados"</b></li>
            <li>Toca <b>"Vincular dispositivo"</b></li>
            <li>Apunta la cámara a este código QR</li>
          </ol>
        </div>
        <div class="badge"><div class="dot"></div>Esperando escaneo…</div>
        <p class="refresh-note">El QR se actualiza automáticamente</p>
      ` : `
        <div class="waiting"><div class="spinner"></div>Iniciando bot…<p class="refresh-note">Actualizando en segundos…</p></div>
      `}
    </div>
  </div>
  <script>
    var lastQr = ${JSON.stringify(qrDataUrl)};
    var authenticated = ${JSON.stringify(isAuthenticated)};
    function poll() {
      fetch('/api/qr/state')
        .then(function(r){ return r.json(); })
        .then(function(data) {
          if (data.status === 'authenticated' && !authenticated) {
            authenticated = true;
            document.getElementById('content').innerHTML =
              '<div class="badge badge-ok"><div class="dot dot-ok"></div>✅ WhatsApp vinculado correctamente</div>' +
              '<p style="margin-top:20px;font-size:14px;color:#333;">El bot está activo y listo para responder mensajes.</p>';
          } else if (data.qr && data.qr !== lastQr) {
            lastQr = data.qr;
            var img = document.getElementById('qr-img');
            if (img) {
              img.src = data.qr;
            } else {
              document.getElementById('content').innerHTML =
                '<div class="qr-wrap"><img id="qr-img" src="' + data.qr + '" width="260" height="260" alt="QR Code" /></div>' +
                '<div class="steps"><h3>📱 Cómo escanear:</h3><ol>' +
                '<li>Abre <b>WhatsApp</b> en tu celular</li>' +
                '<li>Toca los <b>3 puntos (⋮)</b> arriba a la derecha</li>' +
                '<li>Selecciona <b>"Dispositivos vinculados"</b></li>' +
                '<li>Toca <b>"Vincular dispositivo"</b></li>' +
                '<li>Apunta la cámara a este código QR</li>' +
                '</ol></div>' +
                '<div class="badge"><div class="dot"></div>Esperando escaneo…</div>' +
                '<p class="refresh-note">El QR se actualiza automáticamente</p>';
            }
          }
        })
        .catch(function(){});
    }
    setInterval(poll, 4000);
  </script>
</body>
</html>`;
}

router.get("/qr/state", (_req, res) => {
  const state = readState();
  res.json({
    status: state?.status ?? "loading",
    qr: state?.qr ?? null,
  });
});

router.get("/qr", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildQrHtml());
});

export default router;
