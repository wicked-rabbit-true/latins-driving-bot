/**
 * igivetest.js
 * Módulo para gestionar accesos de alumnos en lds-support.igivetest.net
 * vía automatización de formularios web (no tiene API pública).
 */

import https from 'https';
import http from 'http';

const BASE_URL = 'http://lds-support.igivetest.net';

// ── Grupos PROHIBIDOS — nunca se asignan a alumnos ──────────────────────────
// Roles de sistema: Administradores, Instructores, Operadores, Users, Guests
const FORBIDDEN_GROUPS = new Set([1, 2, 3, 19, 20]);

// ── Exámenes activos ─────────────────────────────────────────────────────────
// Solo los 5 exámenes que la escuela utiliza actualmente.
// IMPORTANTE: Los IDs de grupo son los IDs internos de iGiveTest (users.php → group[N]).
// Si necesitas añadir o cambiar grupos, usa @acceso-grupos en el bot para ver todos los IDs.
export const IGIVETEST_GROUPS = {
  'tochigi-karimen-1':  [57],    // Karimen Tochigi 1 Practice        — group[57] ✓
  'tochigi-karimen-2':  [52],    // Karimen Tochigi 2 Practice 2024   — group[52] ✓
  'honmen-chiba':       [33],    // Honmen Chiba                      — group[33] ✓
  'tochigi-100':        [50],    // Tochigi 100-1 2022                — group[50] ✓
  'english-100-3':      [30],    // Karimen practica caleta           — group[30] (verificar con Carlos)
  'illustrations-2025': [58],    // Honmen 2025 - 4 last update       — group[58] (group[105] no existe)
};

export const GROUP_LABELS = {
  'tochigi-karimen-1':  'Karimen Tochigi 1 (Practice)',
  'tochigi-karimen-2':  'Karimen Tochigi 2 (Practice 2024)',
  'honmen-chiba':       'Honmen Chiba',
  'tochigi-100':        'Tochigi 100-1 2022',
  'english-100-3':      '100 Questions English Number 3 (4C)',
  'illustrations-2025': 'Illustrations 2025',
};

// Días de acceso para alumnos
export const ACCESS_DAYS = 60;

// ── Helpers HTTP ─────────────────────────────────────────────────────────────

function buildFormData(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function httpRequest(options, body = '') {
  return new Promise((resolve, reject) => {
    const mod = options.protocol === 'https:' ? https : http;
    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Formato de fecha requerido por iGiveTest: "YYYY-MM-DD HH:MM"
function igtDateFormat(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ── Login ─────────────────────────────────────────────────────────────────────

/**
 * Inicia sesión en iGiveTest y devuelve las cookies de sesión.
 * @returns {string} Cookie header string
 */
export async function igtLogin() {
  const username = process.env.IGIVETEST_USERNAME || 'lds';
  const password = process.env.IGIVETEST_PASSWORD;

  if (!password) throw new Error('IGIVETEST_PASSWORD no está configurado como secreto');

  const body = buildFormData({
    username,
    password,
    gotourl: '/users.php',
    bsubmit: ' Sign in ',
  });

  const res = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: '/index.php',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  const setCookies = res.headers['set-cookie'];
  if (!setCookies || setCookies.length === 0) {
    throw new Error('Login fallido — no se recibieron cookies de sesión');
  }

  const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

  const verify = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: '/users.php',
    method: 'GET',
    headers: { Cookie: cookieStr },
  });

  if (verify.body.includes('Sign In') && !verify.body.includes('Sign Out')) {
    throw new Error('Credenciales de iGiveTest incorrectas');
  }

  return cookieStr;
}

// ── Generar credenciales ──────────────────────────────────────────────────────

/**
 * Genera usuario y contraseña para un alumno.
 */
export function generateCredentials(firstName) {
  const base = (firstName || 'alumno')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 10);

  const rand4 = String(Math.floor(1000 + Math.random() * 9000));
  const username = `${base}${rand4}`;

  // Solo letras mayúsculas y números — sin símbolos para evitar problemas
  // con caracteres especiales en iGiveTest o dificultades al copiar/pegar
  const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  let pass = '';
  for (let i = 0; i < 5; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  for (let i = 0; i < 5; i++) pass += digits[Math.floor(Math.random() * digits.length)];

  return { username, password: pass };
}

// ── Crear usuario ─────────────────────────────────────────────────────────────

/**
 * Crea un usuario en iGiveTest con fecha de expiración de ACCESS_DAYS días.
 * @returns {Promise<{success: boolean, userId?: number, expiresAt?: string, error?: string}>}
 */
export async function igtCreateUser({ firstName, lastName, username, password, groupIds, cookieStr }) {
  // ── SEGURIDAD: filtrar grupos prohibidos ──────────────────────────────────
  const safeGroupIds = groupIds.filter(gid => !FORBIDDEN_GROUPS.has(gid));
  if (safeGroupIds.length === 0) {
    return { success: false, error: 'Todos los grupos indicados son de sistema y están prohibidos para alumnos' };
  }
  if (safeGroupIds.length !== groupIds.length) {
    console.warn(`⚠️ iGiveTest: grupos prohibidos filtrados:`, groupIds.filter(g => FORBIDDEN_GROUPS.has(g)));
  }

  // Fecha de expiración: ACCESS_DAYS días a partir de hoy
  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + ACCESS_DAYS);
  const expireDateStr = igtDateFormat(expireDate);

  // ── PASO 1: Crear el usuario ──────────────────────────────────────────────
  const createParams = {
    user_enabled: 'on',
    user_name: username,
    user_password: password,
    user_password_confirm: password,
    user_email: `${username}@lds-students.com`,
    user_firstname: firstName,
    user_lastname: lastName || '',
    user_middlename: '',
    user_expiredate: expireDateStr,
    bsubmit: ' Update ',
  };
  const createBody = buildFormData(createParams);
  const createRes = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: '/users.php?userid=0&action=edit',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(createBody),
      Cookie: cookieStr,
    },
  }, createBody);

  if (createRes.body.includes('already exists') || createRes.body.includes('Username is already')) {
    return { success: false, error: 'El nombre de usuario ya existe — se generará uno nuevo automáticamente' };
  }
  console.log(`📋 iGiveTest CREATE HTTP ${createRes.statusCode} para ${username}`);

  // ── PASO 2: Buscar el userid del usuario recién creado (orden DESC → más nuevo primero) ─
  await new Promise(r => setTimeout(r, 800));
  const searchRes = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: '/users.php?action=&limitto=50&pageno=1&order=0&direction=DESC',
    method: 'GET',
    headers: { Cookie: cookieStr },
  });

  // Cada fila tiene: <input ... value="USERID" onclick="toggleCB..."> ... <td>username</td>
  let userId = null;
  const tdTag = `<td>${username}</td>`;
  const tdIdx = searchRes.body.indexOf(tdTag);
  if (tdIdx !== -1) {
    const before = searchRes.body.slice(Math.max(0, tdIdx - 500), tdIdx);
    const cbMatches = [...before.matchAll(/value="(\d+)"\s+onclick="toggleCB/gi)];
    if (cbMatches.length > 0) {
      userId = parseInt(cbMatches[cbMatches.length - 1][1]);
    }
  }

  if (!userId) {
    console.error(`❌ iGiveTest: usuario "${username}" no encontrado tras creación`);
    return { success: false, error: `El usuario "${username}" no apareció en iGiveTest tras la creación` };
  }
  console.log(`✅ iGiveTest: usuario "${username}" creado con userId=${userId}`);

  // ── PASO 3: Editar el usuario para asignar grupos ─────────────────────────
  // IMPORTANTE: group[0]=on es el campo centinela que indica a iGiveTest que
  // la sección de grupos fue enviada. Sin él, los cambios de grupo se ignoran.
  const editParams = {
    user_enabled: 'on',
    user_name: username,
    user_password: '',
    user_password_confirm: '',
    user_email: `${username}@lds-students.com`,
    user_firstname: firstName,
    user_lastname: lastName || '',
    user_middlename: '',
    user_expiredate: expireDateStr,
    'group[0]': 'on',               // Centinela: indica que se envió la sección de grupos
    bsubmit: ' Update ',
  };
  for (const gid of safeGroupIds) {
    editParams[`group[${gid}]`] = 'on';
  }
  const editBody = buildFormData(editParams);
  const editRes = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: `/users.php?userid=${userId}&action=edit`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(editBody),
      Cookie: cookieStr,
    },
  }, editBody);
  console.log(`📋 iGiveTest EDIT grupos HTTP ${editRes.statusCode} para userId=${userId} grupos=[${safeGroupIds.join(',')}]`);

  return { success: true, userId, expiresAt: expireDateStr };
}

// ── Buscar usuario por nombre de usuario ──────────────────────────────────────

/**
 * Busca un usuario en iGiveTest por su username y devuelve su userId.
 * @returns {Promise<number|null>}
 */
export async function igtFindUserId(username, cookieStr) {
  // El GET users.php?search=X no filtra — devuelve todos los usuarios.
  // Hay que paginar con orden DESC y buscar <td>username</td> en cada fila.
  const tdTag = `<td>${username}</td>`;
  for (let page = 1; page <= 30; page++) {
    const res = await httpRequest({
      protocol: 'http:',
      hostname: 'lds-support.igivetest.net',
      path: `/users.php?action=&limitto=50&pageno=${page}&order=0&direction=DESC`,
      method: 'GET',
      headers: { Cookie: cookieStr },
    });
    const tdIdx = res.body.indexOf(tdTag);
    if (tdIdx !== -1) {
      const before = res.body.slice(Math.max(0, tdIdx - 500), tdIdx);
      const cbMatches = [...before.matchAll(/value="(\d+)"\s+onclick="toggleCB/gi)];
      if (cbMatches.length > 0) return parseInt(cbMatches[cbMatches.length - 1][1]);
    }
    // Si no hay enlace a la página siguiente, terminamos
    if (!res.body.includes(`pageno=${page + 1}`)) break;
  }
  return null;
}

// ── Desactivar usuario ────────────────────────────────────────────────────────

/**
 * Desactiva (deshabilita) una cuenta de alumno en iGiveTest.
 * Mantiene la cuenta pero la deja inaccesible.
 * @param {number} userId
 * @param {string} username  — necesario para rellenar los campos del formulario
 * @param {string} cookieStr
 */
export async function igtDisableUser(userId, username, cookieStr) {
  // El formulario de edición requiere todos los campos; user_enabled se omite para desactivar
  const formParams = {
    user_name: username,
    user_password: '',
    user_password_confirm: '',
    'group[0]': 'on',
    bsubmit: ' Update ',
  };

  const body = buildFormData(formParams);

  const res = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: `/users.php?userid=${userId}&action=edit`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      Cookie: cookieStr,
    },
  }, body);

  const isSuccess = res.statusCode === 302
    || (res.body.includes('Users') && !res.body.toLowerCase().includes('error'));
  if (!isSuccess) {
    throw new Error(`No se pudo desactivar el usuario (HTTP ${res.statusCode})`);
  }
}

// ── Extender expiración de usuario ───────────────────────────────────────────

/**
 * Actualiza la fecha de expiración de un usuario en iGiveTest y reactiva la cuenta.
 * @param {number} userId
 * @param {string} username
 * @param {string} newExpireDateStr  — formato "YYYY-MM-DD HH:MM"
 * @param {string} cookieStr
 */
export async function igtExtendUser(userId, username, newExpireDateStr, cookieStr) {
  const formParams = {
    user_enabled: 'on',
    user_name: username,
    user_password: '',
    user_password_confirm: '',
    user_expiredate: newExpireDateStr,
    'group[0]': 'on',
    bsubmit: ' Update ',
  };

  const body = buildFormData(formParams);

  const res = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: `/users.php?userid=${userId}&action=edit`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      Cookie: cookieStr,
    },
  }, body);

  const isSuccess = res.statusCode === 302
    || (res.body.includes('Users') && !res.body.toLowerCase().includes('error'));
  if (!isSuccess) {
    throw new Error(`No se pudo actualizar la fecha de expiración (HTTP ${res.statusCode})`);
  }
}

// ── Eliminar usuario ──────────────────────────────────────────────────────────

/**
 * Elimina permanentemente una cuenta de alumno en iGiveTest.
 * @param {number} userId
 * @param {string} cookieStr
 */
export async function igtDeleteUser(userId, cookieStr) {
  const res = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: `/users.php?userid=${userId}&action=delete`,
    method: 'GET',
    headers: { Cookie: cookieStr },
  });

  const isSuccess = res.statusCode === 302
    || (res.body.includes('Users') && !res.body.toLowerCase().includes('error'));
  if (!isSuccess) {
    throw new Error(`No se pudo eliminar el usuario (HTTP ${res.statusCode})`);
  }
}

// ── Listar todos los grupos disponibles en iGiveTest ─────────────────────────

/**
 * Obtiene todos los grupos del sistema (IDs y nombres) para poder identificar
 * qué ID corresponde a un examen concreto.
 * Útil para configurar nuevos tipos de examen.
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function igtGetAllGroups(cookieStr) {
  if (!cookieStr) cookieStr = await igtLogin();

  // La fuente más fiable: formulario de edición de un usuario conocido muestra
  // todos los grupos disponibles con checkboxes name="group[N]"
  const sources = [
    '/users.php?action=new',
    '/users.php?limit=9999',
  ];
  let html = '';
  for (const path of sources) {
    const res = await httpRequest({
      protocol: 'http:', hostname: 'lds-support.igivetest.net',
      path, method: 'GET', headers: { Cookie: cookieStr },
    });
    if (res.statusCode === 200 && res.body.length > 500 && !res.body.includes('Sign In')) {
      html = res.body;
      break;
    }
  }
  if (!html) throw new Error('No se pudo obtener la página de grupos de iGiveTest');

  const groups = [];
  const seen = new Set();

  const addGroup = (id, name) => {
    id = parseInt(id);
    name = name.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
    if (id && name && name.length > 1 && !FORBIDDEN_GROUPS.has(id) && !seen.has(id)) {
      seen.add(id);
      groups.push({ id, name });
    }
  };

  // Patrón 1: <input ... name="group[N]" ...> texto directo después del tag
  const re1 = /name=["']?group\[(\d+)\]["']?[^>]*>\s*([^<\n\r]{2,80})/gi;
  for (const m of html.matchAll(re1)) addGroup(m[1], m[2]);

  // Patrón 2: <input ... name="group[N]"> seguido de una etiqueta y luego texto
  const re2 = /name=["']?group\[(\d+)\]["']?[^>]*>[^<]*<[^>]+>([^<]{2,80})/gi;
  for (const m of html.matchAll(re2)) addGroup(m[1], m[2]);

  // Patrón 3: <label for="groupN">Nombre</label>
  const re3 = /for=["']group(\d+)["'][^>]*>([^<]{2,80})<\/label>/gi;
  for (const m of html.matchAll(re3)) addGroup(m[1], m[2]);

  // Patrón 4: tabla con columnas ID / Nombre
  const re4 = /<tr[^>]*>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*>([^<]{2,80})<\/td>/gi;
  for (const m of html.matchAll(re4)) addGroup(m[1], m[2]);

  // Si aún no hay resultados, devolver snippet del HTML para diagnóstico
  if (groups.length === 0) {
    const snippet = html.replace(/<style[\s\S]*?<\/style>/gi, '')
                        .replace(/<script[\s\S]*?<\/script>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s{2,}/g, ' ')
                        .substring(0, 1500);
    throw new Error(`No se encontraron grupos. Fragmento HTML:\n\n${snippet}`);
  }

  return groups.sort((a, b) => a.id - b.id);
}

// ── Obtener todos los usuarios del sistema ────────────────────────────────────

/**
 * Obtiene todos los userId presentes en el listado de usuarios.
 * Maneja paginación si el sistema la utiliza (limit=9999 para traer todo).
 * @returns {Promise<number[]>}
 */
export async function igtGetAllUserIds(cookieStr) {
  const allIds = new Set();
  for (let page = 1; page <= 50; page++) {
    const res = await httpRequest({
      protocol: 'http:',
      hostname: 'lds-support.igivetest.net',
      path: `/users.php?action=&limitto=50&pageno=${page}&order=0&direction=`,
      method: 'GET',
      headers: { Cookie: cookieStr },
    });
    const matches = [...res.body.matchAll(/userid=(\d+)&action=edit/g)];
    matches.forEach(m => allIds.add(parseInt(m[1])));
    if (!res.body.includes(`pageno=${page + 1}`)) break;
    await new Promise(r => setTimeout(r, 200));
  }
  return [...allIds];
}

/**
 * Obtiene el estado (habilitado/deshabilitado) y username de un usuario
 * consultando su formulario de edición.
 * @returns {Promise<{enabled: boolean, username: string|null}>}
 */
export async function igtGetUserStatus(userId, cookieStr) {
  const res = await httpRequest({
    protocol: 'http:',
    hostname: 'lds-support.igivetest.net',
    path: `/users.php?userid=${userId}&action=edit`,
    method: 'GET',
    headers: { Cookie: cookieStr },
  });

  // El checkbox "user_enabled" aparece con el atributo checked si está activo
  const enabled = /name=["']?user_enabled["']?[^>]*checked|checked[^>]*name=["']?user_enabled["']?/i.test(res.body);

  // Extraer el username del campo de texto
  const usernameMatch = res.body.match(/name=["']?user_name["']?[^>]*value=["']([^"']+)["']/i)
    || res.body.match(/value=["']([^"']+)["'][^>]*name=["']?user_name["']?/i);
  const username = usernameMatch ? usernameMatch[1].trim() : null;

  return { enabled, username };
}

// ── Limpieza: eliminar usuarios desactivados ──────────────────────────────────

/**
 * Obtiene la lista de todos los usuarios y devuelve los que están desactivados.
 * Incluye un delay entre peticiones para no saturar el servidor.
 * @returns {Promise<Array<{userId: number, username: string|null}>>}
 */
export async function igtFindInactiveUsers(cookieStr, onProgress = null) {
  const allIds = await igtGetAllUserIds(cookieStr);
  const inactive = [];

  for (let i = 0; i < allIds.length; i++) {
    const userId = allIds[i];
    try {
      const { enabled, username } = await igtGetUserStatus(userId, cookieStr);
      if (!enabled) {
        inactive.push({ userId, username: username || `id:${userId}` });
      }
      if (onProgress) onProgress(i + 1, allIds.length, username);
    } catch (_) {
      // Si no se puede leer un usuario, se omite
    }
    // Pausa breve entre peticiones (200 ms)
    await new Promise(r => setTimeout(r, 200));
  }

  return inactive;
}

/**
 * Flujo completo: login → detectar inactivos → eliminarlos.
 * Llama a onProgress(scanned, total, username) durante el escaneo.
 * @returns {Promise<{scanned: number, deleted: Array<{userId, username}>}>}
 */
export async function cleanupInactiveIGiveTestUsers(onProgress = null) {
  const cookieStr = await igtLogin();
  const allIds = await igtGetAllUserIds(cookieStr);
  const inactive = [];

  for (let i = 0; i < allIds.length; i++) {
    const userId = allIds[i];
    try {
      const { enabled, username } = await igtGetUserStatus(userId, cookieStr);
      if (!enabled) inactive.push({ userId, username: username || `id:${userId}` });
      if (onProgress) onProgress(i + 1, allIds.length, username || `#${userId}`);
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }

  const deleted = [];
  for (const user of inactive) {
    try {
      await igtDeleteUser(user.userId, cookieStr);
      deleted.push(user);
    } catch (e) {
      console.warn(`⚠️ No se pudo eliminar iGiveTest userId=${user.userId} (${user.username}): ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return { scanned: allIds.length, deleted };
}

// ── Flujo principal: crear acceso ─────────────────────────────────────────────

/**
 * @param {string} examType   — clave principal del examen (ej. 'tochigi-karimen-1')
 * @param {string|null} examType2 — clave opcional de un segundo examen a combinar
 */
export async function createIGiveTestAccess({ firstName, lastName, examType, examType2 = null }) {
  const g1 = IGIVETEST_GROUPS[examType];
  if (!g1) throw new Error(`Tipo de examen desconocido: ${examType}`);

  // Combinar grupos si se especifica un segundo examen
  let groupIds = [...g1];
  if (examType2) {
    const g2 = IGIVETEST_GROUPS[examType2];
    if (!g2) throw new Error(`Tipo de examen desconocido: ${examType2}`);
    groupIds = [...new Set([...g1, ...g2])];
  }

  const { username, password } = generateCredentials(firstName);
  const cookieStr = await igtLogin();

  let result = await igtCreateUser({ firstName, lastName, username, password, groupIds, cookieStr });

  if (!result.success && result.error?.includes('ya existe')) {
    const creds2 = generateCredentials(firstName);
    result = await igtCreateUser({
      firstName, lastName,
      username: creds2.username,
      password: creds2.password,
      groupIds, cookieStr,
    });
    if (result.success) {
      return { username: creds2.username, password: creds2.password, examType, examType2, expiresAt: result.expiresAt };
    }
  }

  if (!result.success) throw new Error(result.error || 'No se pudo crear el usuario en iGiveTest');

  return { username, password, examType, examType2, expiresAt: result.expiresAt };
}

// ── Flujo principal: desactivar acceso ───────────────────────────────────────

/**
 * Login → buscar usuario por username → desactivarlo.
 * @param {string} username
 */
export async function disableIGiveTestAccess(username) {
  const cookieStr = await igtLogin();
  const userId = await igtFindUserId(username, cookieStr);
  if (!userId) throw new Error(`No se encontró el usuario "${username}" en iGiveTest`);
  await igtDisableUser(userId, username, cookieStr);
}

// ── Flujo principal: eliminar acceso ─────────────────────────────────────────

/**
 * Login → buscar usuario por username → eliminarlo permanentemente.
 * @param {string} username
 */
export async function deleteIGiveTestAccess(username) {
  const cookieStr = await igtLogin();
  const userId = await igtFindUserId(username, cookieStr);
  if (!userId) throw new Error(`No se encontró el usuario "${username}" en iGiveTest`);
  await igtDeleteUser(userId, cookieStr);
}

// ── Flujo principal: extender acceso ─────────────────────────────────────────

/**
 * Login → buscar usuario → extender/actualizar fecha de expiración.
 * La nueva fecha parte desde HOY (no desde la fecha actual de vencimiento),
 * salvo que se indique currentExpiresAt para extender desde ahí.
 *
 * @param {string} username
 * @param {number} days           — días a añadir (por defecto ACCESS_DAYS)
 * @param {string|null} currentExpiresAt — si se indica, suma desde esa fecha;
 *                                          si no, suma desde hoy
 * @returns {Promise<{newExpiresAt: string}>}
 */
export async function extendIGiveTestAccess(username, days = ACCESS_DAYS, currentExpiresAt = null) {
  const cookieStr = await igtLogin();
  const userId = await igtFindUserId(username, cookieStr);
  if (!userId) throw new Error(`No se encontró el usuario "${username}" en iGiveTest`);

  // Base: si la cuenta ya venció o no hay fecha, partir desde hoy.
  // Si aún no venció, sumar desde la fecha actual de expiración.
  let base = new Date();
  if (currentExpiresAt) {
    const parsed = new Date(currentExpiresAt.replace(' ', 'T'));
    if (!isNaN(parsed.getTime()) && parsed > base) {
      base = parsed;  // todavía vigente → extender desde la fecha actual
    }
    // Si ya expiró → base sigue siendo hoy (no se pierde tiempo)
  }

  const newExpire = new Date(base);
  newExpire.setDate(newExpire.getDate() + days);
  const newExpireDateStr = igtDateFormat(newExpire);

  await igtExtendUser(userId, username, newExpireDateStr, cookieStr);
  return { newExpiresAt: newExpireDateStr };
}

// ── Helpers internos para parsear reportes ────────────────────────────────────

/**
 * Quita tags HTML y decodifica entidades básicas.
 */
function _stripTags(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/\s{2,}/g, ' ').trim();
}

/**
 * Intenta obtener el HTML de la página de reportes de un usuario.
 * Primero prueba las URLs filtradas por userid; si todas fallan,
 * cae al listado global /reports.php.
 *
 * Condición de aceptación: HTTP 200, contenido suficiente, no es la
 * página de login Y contiene al menos una celda <td> con datos.
 */
async function _fetchReportsHtml(userId, cookieStr) {
  const isValidPage = (res) =>
    res.statusCode === 200 &&
    res.body.length > 500 &&
    !res.body.includes('Sign In') &&
    !res.body.includes('bsubmit') &&   // formulario de login
    res.body.includes('<td');           // tiene filas de tabla

  // La página correcta en esta instalación de iGiveTest es reports-manager.php
  // Estructura confirmada: /reports-manager.php?userid=ID&limitto=50&order=0&direction=
  const perUser = [
    `/reports-manager.php?userid=${userId}&limitto=50&order=0&direction=`,
    `/reports-manager.php?userid=${userId}&limitto=100&order=0&direction=`,
  ];

  for (const path of perUser) {
    const res = await httpRequest({
      protocol: 'http:', hostname: 'lds-support.igivetest.net',
      path, method: 'GET', headers: { Cookie: cookieStr },
    });
    console.log(`[IGT] ${path} → ${res.statusCode} len=${res.body.length} hasTd=${res.body.includes('<td')}`);
    if (isValidPage(res)) return { html: res.body, global: false };
  }

  // Último recurso: listado global (filtraremos por username en las filas)
  const globalRes = await httpRequest({
    protocol: 'http:', hostname: 'lds-support.igivetest.net',
    path: '/reports-manager.php', method: 'GET', headers: { Cookie: cookieStr },
  });
  console.log(`[IGT] /reports-manager.php (global) → ${globalRes.statusCode} len=${globalRes.body.length} hasTd=${globalRes.body.includes('<td')}`);
  if (isValidPage(globalRes)) return { html: globalRes.body, global: true };

  return null;
}

/**
 * Extrae el puntaje porcentual de una fila de la tabla de reportes de iGiveTest.
 *
 * Estructura confirmada (reports-manager.php):
 *   ID | Fecha | Usuario | Examen | Tiempo | PointsScored | PointsPossible | Score% | Grado
 *
 * Escanea desde el final buscando la primera celda con formato de porcentaje
 * o entero 0-100 que no sea tiempo.
 */
function _parseScoreFromCells(cells) {
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i].trim();
    if (/^\d+:\d{2}(:\d{2})?$/.test(cell)) continue;
    const pct = cell.match(/^(\d{1,3}(?:[.,]\d+)?)\s*%$/);
    if (pct) {
      const v = parseFloat(pct[1].replace(',', '.'));
      if (v >= 0 && v <= 100) return v;
    }
    if (/^\d{1,3}$/.test(cell)) {
      const v = parseInt(cell, 10);
      if (v >= 0 && v <= 100) return v;
    }
  }
  return null;
}

/**
 * Extrae Points Scored y Points Possible de una fila.
 *
 * La estructura observada ubica el porcentaje de score (ej. "2.00%") después
 * de dos enteros: [PointsScored, PointsPossible, Score%].
 * Localiza la celda del porcentaje y lee las dos anteriores.
 */
function _parsePointsFromCells(cells) {
  // Escanear desde el final buscando la celda de porcentaje (ej: "2.00%").
  // Ignorar celdas de texto no numérico (ej: "DESAPROBADO-NOT PASSED") con continue,
  // ya que aparecen DESPUÉS del porcentaje cuando se escanea desde el final.
  for (let i = cells.length - 1; i >= 2; i--) {
    const cell = cells[i].trim();
    // Ignorar tiempos: "0:08:11"
    if (/^\d+:\d{2}(:\d{2})?$/.test(cell)) continue;
    // Ignorar celdas de texto puro (notas de aprobación/reprobación)
    if (!/[\d%]/.test(cell)) continue;
    // Celda de porcentaje encontrada: "2.00%"
    if (/^(\d{1,3}(?:[.,]\d+)?)\s*%$/.test(cell)) {
      const possible = parseInt(cells[i - 1], 10);
      const scored   = parseInt(cells[i - 2], 10);
      if (!isNaN(possible) && !isNaN(scored) && possible > 0) {
        return { scored, possible };
      }
      break;
    }
  }
  return { scored: null, possible: null };
}

/**
 * Extrae la fecha de una celda de texto libre.
 * Formatos conocidos de iGiveTest: "05/03/26 03:20 AM" (MM/DD/YY HH:MM AM)
 */
function _parseDateFromCells(cells) {
  const patterns = [
    // MM/DD/YY HH:MM AM/PM  (formato observado en la foto)
    /(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)/i,
    // YYYY-MM-DD HH:MM
    /(\d{4}[-\/]\d{2}[-\/]\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/,
    // DD-MM-YYYY
    /(\d{2}-\d{2}-\d{4}(?:\s+\d{2}:\d{2})?)/,
    // YYYY.MM.DD
    /(\d{4}\.\d{2}\.\d{2})/,
  ];
  for (const cell of cells) {
    for (const pat of patterns) {
      const m = cell.match(pat);
      if (m) return m[1];
    }
  }
  return '';
}

/**
 * Extrae el nombre del examen de las celdas de una fila.
 * El examen suele ser la celda con texto largo que no es ID/fecha/usuario/número.
 * Patrón de usuario: "gul5715 [1345] Gul Rohil" — contiene "[NNN]"
 */
function _parseExamFromCells(cells) {
  for (const cell of cells) {
    // Saltar IDs numéricos puros
    if (/^\d+$/.test(cell)) continue;
    // Saltar fechas
    if (/\d{1,2}\/\d{1,2}\/\d{2}/.test(cell)) continue;
    // Saltar tiempos
    if (/^\d+:\d{2}(:\d{2})?$/.test(cell)) continue;
    // Saltar celdas de usuario (contienen "[NNN]")
    if (/\[\d+\]/.test(cell)) continue;
    // Saltar celdas muy cortas o que sean solo puntaje
    if (cell.length < 4) continue;
    // La primera celda que pase todos los filtros es el nombre del examen
    return cell.substring(0, 100);
  }
  return '';
}

// ── Reporte detallado de exámenes por alumno ──────────────────────────────────

/**
 * Obtiene el historial completo de intentos de examen de un alumno.
 *
 * Estructura de tabla iGiveTest (observada):
 *   ID | Fecha (MM/DD/YY HH:MM AM) | usuario[ID]/Nombre | Examen | check | check | Duración | Puntaje
 *
 * Los puntajes son enteros 0-100 (sin %) en la última columna numérica.
 *
 * @param {string} username
 */
export async function igtGetUserReport(username) {
  try {
    const cookieStr = await igtLogin();

    const userId = await igtFindUserId(username, cookieStr);
    if (!userId) {
      return { found: false, username, attempts: [], bestScore: null, latestScore: null, totalAttempts: 0,
               error: `Usuario "${username}" no encontrado en iGiveTest` };
    }

    const fetched = await _fetchReportsHtml(userId, cookieStr);
    if (!fetched) {
      return { found: true, username, attempts: [], bestScore: null, latestScore: null, totalAttempts: 0,
               note: 'Sin reportes disponibles en iGiveTest para este usuario' };
    }

    const { html, global: isGlobal } = fetched;

    // Limpiar estilos y scripts
    const clean = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '');

    // Extraer filas de tabla
    const rows = [...clean.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);

    const attempts = [];

    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => _stripTags(m[1]))
        .filter(c => c.length > 0);

      if (cells.length < 3) continue;

      // Si usamos el listado global, filtrar solo las filas del usuario actual
      if (isGlobal) {
        const rowText = cells.join(' ').toLowerCase();
        if (!rowText.includes(username.toLowerCase())) continue;
      }

      // Extraer puntaje porcentual y puntos directos
      const score = _parseScoreFromCells(cells);
      if (score === null) continue; // fila sin puntaje → encabezado u otro

      const { scored: pointsScored, possible: pointsPossible } = _parsePointsFromCells(cells);
      const date = _parseDateFromCells(cells);
      const exam = _parseExamFromCells(cells);

      // Estado aprobado/reprobado — chequear FAIL primero para evitar falso positivo
      // en "NOT PASSED" (contiene "PASSED" que dispararía el chequeo de pass).
      // "DESAPROBADO" contiene "APROBADO" así que también necesita prioridad.
      const rowText = cells.join(' ');
      let passed = null;
      if (/\bdesaprobad[oa]\b|\bnot\s+pass(?:ed)?\b|\bfail(?:ed)?\b|不合格/i.test(rowText)) {
        passed = false;
      } else if (/\baprobad[oa]\b|\bpass(?:ed)?\b|合格/i.test(rowText)) {
        passed = true;
      }

      attempts.push({ date, exam, score, pointsScored, pointsPossible, passed, raw: cells.join(' | ') });
    }

    if (attempts.length === 0) {
      return { found: true, username, attempts: [], bestScore: null, latestScore: null, totalAttempts: 0,
               note: 'Se encontró la página de reportes pero no se pudieron extraer puntajes. ' +
                     'Es posible que el alumno aún no haya completado ningún examen.' };
    }

    const scores = attempts.map(a => a.score).filter(s => s !== null);
    const bestScore = scores.length > 0 ? Math.max(...scores) : null;
    // La tabla viene en orden ascendente (más antigua primero) — el último elemento es el más reciente
    const latestScore = scores.length > 0 ? scores[scores.length - 1] : null;

    return { found: true, username, attempts, bestScore, latestScore, totalAttempts: attempts.length };
  } catch (err) {
    return { found: false, username, attempts: [], bestScore: null, latestScore: null, totalAttempts: 0,
             error: err.message };
  }
}

// ── Consultar puntaje del alumno en iGiveTest ─────────────────────────────────

/**
 * Obtiene el mejor puntaje registrado de un alumno en iGiveTest.
 * Hace scraping de la página de reportes del sistema.
 *
 * @param {string} username - nombre de usuario del alumno en iGiveTest
 * @returns {Promise<{
 *   found: boolean,
 *   bestScore: number|null,
 *   latestScore: number|null,
 *   attempts: number,
 *   note?: string,
 *   error?: string
 * }>}
 */
export async function igtGetUserBestScore(username) {
  try {
    const cookieStr = await igtLogin();

    // 1. Encontrar el userId del alumno
    const userId = await igtFindUserId(username, cookieStr);
    if (!userId) {
      return { found: false, error: `Usuario "${username}" no encontrado en iGiveTest` };
    }

    // 2. Obtener HTML de reportes (reutiliza el mismo helper que igtGetUserReport)
    const fetched = await _fetchReportsHtml(userId, cookieStr);
    if (!fetched) {
      return { found: true, bestScore: null, latestScore: null, attempts: 0,
               note: 'Sin reportes disponibles en iGiveTest para este usuario' };
    }

    const { html, global: isGlobal } = fetched;

    // 3. Extraer puntajes de cada fila de la tabla
    const cleanHtml = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '');

    const rows = [...cleanHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
    const scores = [];

    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => _stripTags(m[1]))
        .filter(c => c.length > 0);
      if (cells.length < 3) continue;

      if (isGlobal) {
        const rowText = cells.join(' ').toLowerCase();
        if (!rowText.includes(username.toLowerCase())) continue;
      }

      const score = _parseScoreFromCells(cells);
      if (score !== null) scores.push(score);
    }

    if (scores.length === 0) {
      return { found: true, bestScore: null, latestScore: null, attempts: 0,
               note: 'No se encontraron puntajes numéricos en los reportes' };
    }

    const bestScore = Math.max(...scores);
    const latestScore = scores[0];
    const attempts = scores.length;

    return { found: true, bestScore, latestScore, attempts };
  } catch (err) {
    return { found: false, error: err.message };
  }
}
