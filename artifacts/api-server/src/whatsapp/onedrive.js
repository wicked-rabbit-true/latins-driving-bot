// Microsoft OneDrive integration via Replit connector (Microsoft Graph API)

async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) throw new Error('X-Replit-Token no disponible');
  if (!hostname) throw new Error('REPLIT_CONNECTORS_HOSTNAME no disponible');

  const data = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=onedrive`,
    {
      headers: {
        Accept: 'application/json',
        'X-Replit-Token': xReplitToken,
      },
    }
  ).then((r) => r.json());

  const settings = data.items?.[0]?.settings;
  const token =
    settings?.access_token || settings?.oauth?.credentials?.access_token;

  if (!token) throw new Error('OneDrive no conectado — revisa la integración');
  return token;
}

/**
 * Sube un archivo a OneDrive dentro de la carpeta:
 *   WhatsApp_Clientes/{phoneNumber}/{filename}
 */
export async function uploadToOneDrive(phoneNumber, filename, buffer, mimeType) {
  const token = await getAccessToken();
  const uploadPath = `WhatsApp_Clientes/${phoneNumber}/${filename}`;
  return _putFile(token, uploadPath, buffer, mimeType || 'application/octet-stream');
}

/**
 * Sube un documento a una ruta arbitraria en OneDrive.
 * @param {string} remotePath  Ruta relativa desde la raíz, ej: "Latin_Driving_Bot/Manual.html"
 * @param {Buffer|string} content  Contenido del archivo
 * @param {string} mimeType    Tipo MIME
 * @returns {Promise<string>}  URL web en OneDrive
 */
export async function uploadDocumentToOneDrive(remotePath, content, mimeType = 'text/html') {
  const token = await getAccessToken();
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return _putFile(token, remotePath, buffer, mimeType);
}

async function _putFile(token, remotePath, buffer, mimeType) {
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(remotePath).replace(/%2F/g, '/')}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
    },
    body: buffer,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Error al subir a OneDrive (${res.status}): ${err}`);
  }
  const item = await res.json();
  return item.webUrl || `https://onedrive.live.com/?id=${item.id}`;
}
