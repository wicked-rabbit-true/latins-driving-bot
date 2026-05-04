import crypto from 'crypto';

const PUBLIC_KEY = process.env.BOOKITIT_PUBLIC_KEY;
const PRIVATE_KEY = process.env.BOOKITIT_PRIVATE_KEY;
const BASE_URL = 'https://app.bookitit.com/api/11';

/**
 * Returns true when both Bookitit API keys are configured.
 * Use this guard before making any API call so that call sites can detect
 * the missing-key condition without relying on a thrown error.
 */
export function bookkititAvailable() {
  return !!(PUBLIC_KEY && PRIVATE_KEY);
}

/**
 * Exact replica of PHP CRestClient::buildHashValue()
 * hash_hmac("md5", $urlPath, $privateKey)
 */
function buildHash(urlPath) {
  return crypto.createHmac('md5', PRIVATE_KEY).update(urlPath).digest('hex');
}

function getAuthHeader(urlPath) {
  const hash = buildHash(urlPath);
  const credentials = Buffer.from(`${PUBLIC_KEY}:${hash}`).toString('base64');
  return `Basic ${credentials}`;
}

async function apiGet(urlPath) {
  const res = await fetch(`${BASE_URL}/${urlPath}`, {
    headers: {
      'Authorization': getAuthHeader(urlPath),
      'Accept': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ Bookitit GET ${urlPath} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`Bookitit API error ${res.status} on GET ${urlPath}: ${text.slice(0, 120)}`);
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function apiPost(urlPath, params) {
  const res = await fetch(`${BASE_URL}/${urlPath}`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(urlPath),
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ Bookitit POST ${urlPath} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`Bookitit API error ${res.status} on POST ${urlPath}: ${text.slice(0, 120)}`);
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * Test connectivity with Bookitit API
 * PHP: testconnection/$p_sYourString  (GET, no public key in path)
 */
export async function testConnection() {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }
  const urlPath = 'testconnection/hello';
  return apiGet(urlPath);
}

/**
 * Get all agendas (staff members / resources)
 * PHP: getagendas/$publicKey  (GET)
 */
export async function getAgendas() {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }
  const urlPath = `getagendas/${PUBLIC_KEY}`;
  return apiGet(urlPath);
}

/**
 * Get all services
 * PHP: getservices/$publicKey  (GET)
 */
export async function getServices() {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }
  const urlPath = `getservices/${PUBLIC_KEY}`;
  return apiGet(urlPath);
}

/**
 * Get free slots for a service/agenda on a date
 * PHP: getfreeslots/$publicKey/$serviceId/$agendaId/$date  (GET)
 * date format: YYYY-MM-DD
 */
export async function getFreeSlots(serviceId, agendaId, date) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }
  const urlPath = `getfreeslots/${PUBLIC_KEY}/${serviceId}/${agendaId}/${date}`;
  return apiGet(urlPath);
}

/**
 * Create an appointment in Bookitit
 * PHP: addevent/$publicKey  (POST)
 * Param names taken directly from PHP CRestClient::addEvent()
 */
export async function createAppointment({
  agendaId,
  serviceId,
  startDate,
  endDate,
  startTimeMinutes,
  endTimeMinutes,
  title,
  description = '',
  comments = '',
  clientName = '',
  clientPhone = '',
  clientEmail = '',
  userId = '',
  clientId = '',
  eventSynchroId = '',
  agendaSynchroId = '',
  serviceSynchroId = '',
  userPhone = '',
}) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }

  const urlPath = `addevent/${PUBLIC_KEY}`;
  const params = {
    p_sAgendaID: agendaId,
    p_sServiceID: serviceId,
    p_dStartDate: startDate,
    p_dEndDate: endDate || startDate,
    p_iStartTime: String(startTimeMinutes),
    p_iEndTime: String(endTimeMinutes),
    p_sTitle: title || clientName,
    p_sDescription: description,
    p_sComments: comments,
    p_sEventSynchroID: eventSynchroId,
    p_sAgendaSynchroID: agendaSynchroId,
    p_sServiceSynchroID: serviceSynchroId,
    p_sUserID: userId,
    p_sUserPhone: userPhone,
    p_sClientID: clientId,
    p_sClientName: clientName,
    p_sClientPhone: clientPhone,
    p_sClientEmail: clientEmail,
    p_sCheckFreeSlot: 'false', // Permite crear citas aunque el hueco ya esté ocupado (citas simultáneas)
  };

  return apiPost(urlPath, params);
}

/**
 * Get all events for a given agenda on a specific date
 * date format: YYYY-MM-DD
 */
export async function getEventsForAgenda(agendaId, date) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }
  // Correct format: getevents/{KEY}/{from}/{to}/{agendaId}
  const urlPath = `getevents/${PUBLIC_KEY}/${date}/${date}/${agendaId}`;
  return apiGet(urlPath);
}

/**
 * Get ALL events for a given date across all configured agendas.
 * Returns a flat array of event objects (raw Bookitit data).
 */
export async function getAllEventsForDate(date) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return [];

  const agendas = [
    process.env.BOOKITIT_AGENDA_ID,
    process.env.BOOKITIT_AGENDA_MENKYO_ID,
  ].filter(Boolean);

  const allEvents = [];
  for (const agendaId of agendas) {
    try {
      const result = await getEventsForAgenda(agendaId, date);
      const raw = result?.events ?? result?.event ?? result ?? [];
      const eventList = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
      for (const ev of eventList) {
        if (ev && typeof ev === 'object') allEvents.push({ ...ev, _agendaId: agendaId });
      }
    } catch (e) {
      console.error(`❌ getAllEventsForDate agenda ${agendaId} (${date}):`, e.message);
    }
  }
  return allEvents;
}

/**
 * Search today's agenda across all configured agendas for an upcoming
 * appointment matching the given client phone number.
 * Returns { startTime: "HH:MM", startMins: N } or null.
 */
export async function findUpcomingAppointment(clientPhone) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return null;

  // Current date/time in JST (UTC+9)
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jstNow.getUTCFullYear();
  const m = String(jstNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstNow.getUTCDate()).padStart(2, '0');
  const todayDate = `${y}-${m}-${d}`;
  const currentMinutes = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();

  const agendas = [
    process.env.BOOKITIT_AGENDA_ID,
    process.env.BOOKITIT_AGENDA_MENKYO_ID,
  ].filter(Boolean);

  // Normalize phone: digits only, strip leading zeros
  const norm = (p) => String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  const clientNorm = norm(clientPhone);
  if (!clientNorm) return null;

  for (const agendaId of agendas) {
    try {
      const result = await getEventsForAgenda(agendaId, todayDate);
      // Bookitit may return { events: [...] } or { event: {...} } or an array directly
      const raw = result?.events ?? result?.event ?? result ?? [];
      const eventList = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);

      for (const ev of eventList) {
        if (!ev || typeof ev !== 'object') continue;

        // Try various phone field names Bookitit might use
        const evPhone = norm(
          ev.client_phone ?? ev.clientPhone ?? ev.phone ??
          ev.p_sClientPhone ?? ev.comments ?? ''
        );

        // Match if either phone ends with the other (handles country code variations)
        const matched = evPhone && clientNorm && (
          evPhone.endsWith(clientNorm) || clientNorm.endsWith(evPhone)
        );
        if (!matched) continue;

        // start_time is minutes from midnight in Bookitit
        const startMins = parseInt(ev.start_time ?? ev.startTime ?? ev.p_iStartTime ?? NaN);
        if (isNaN(startMins)) continue;

        // Only intercept if appointment is more than 5 min in the future
        if (startMins > currentMinutes + 5) {
          const hrs = Math.floor(startMins / 60);
          const mins = String(startMins % 60).padStart(2, '0');
          const serviceName = ev.service_name ?? ev.serviceName ?? ev.p_sServiceName ?? ev.title ?? '';
          const eventId = ev.id ?? ev.p_sEventID ?? ev.eventId ?? ev.event_id ?? null;
          console.log(`⏰ Cita encontrada: agenda ${agendaId}, phone ${evPhone}, hora ${hrs}:${mins}, servicio: ${serviceName}, id: ${eventId}`);
          return { startTime: `${hrs}:${mins}`, startMins, agendaId, serviceName, eventId };
        }
      }
    } catch (e) {
      console.error(`❌ Error consultando eventos agenda ${agendaId}:`, e.message);
    }
  }
  return null;
}

/**
 * Create a new client/contact in Bookitit
 * PHP: addclient/$publicKey  (POST)
 *
 * Bookitit requires name split into p_sName (first name) and p_sSurname (last name).
 *
 * @param {object} params
 * @param {string} params.name        - Full name (required) — split automatically into name/surname
 * @param {string} params.phone       - Phone number (required)
 * @param {string} [params.email]     - Email address
 * @param {string} [params.obs]       - Observations / notes (e.g. license type)
 * @param {string} [params.address]   - Address
 */
export async function createClient({ name, phone, email = '', obs = '', address = '' }) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }

  // Bookitit API v11: URL includes webaccess flag → /false = client sin acceso web
  // Params from PHP SDK: p_sName (nombre completo), p_sPhone, p_sEmail,
  // p_sCellphone, p_sInternationalCode, p_sDocument, p_sAddress, p_sPassword
  // NOTE: p_sObs is NOT accepted by addclient — must use editclient after creation.
  const urlPath = `addclient/${PUBLIC_KEY}/false`;
  const params = {
    p_sName:              (name ?? '').trim(),
    p_sPhone:             phone,
    p_sEmail:             (email && email.trim()) ? email.trim() : '',
    p_sCellphone:         phone,
    p_sInternationalCode: '',
    p_sDocument:          '',
    p_sAddress:           address,
    p_sPassword:          '',
    p_sObs:               obs,
    p_sDescription:       obs,
  };

  console.log(`📒 Bookitit addclient params:`, JSON.stringify(params));
  const result = await apiPost(urlPath, params);
  console.log(`📒 Bookitit addclient response:`, JSON.stringify(result));

  // After creation, update observations via editclient (addclient ignores p_sObs)
  if (obs) {
    const clientObj = result?.client ?? result;
    const clientId = (clientObj?.status === 'true' || clientObj?.status === true)
      ? (clientObj?.id ?? null)
      : (result?.id ?? result?.client_id ?? result?.clientId ?? null);

    if (clientId) {
      await editClient({ clientId, name, phone, email, address, obs });
    }
  }

  return result;
}

/**
 * Update an existing Bookitit client (editclient endpoint).
 * Used to set observations/comments after client creation.
 */
export async function editClient({ clientId, name = '', phone = '', email = '', address = '', obs = '' }) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }

  // Bookitit returns IDs with 'bkt' prefix (e.g. "bkt169243008").
  // Try both: numeric ID in URL, and full ID as POST param p_sClientID.
  const numericId = String(clientId).replace(/^bkt/i, '');

  // Attempt 1: ID in URL path
  const urlPath1 = `editclient/${PUBLIC_KEY}/${numericId}`;
  const params = {
    p_sName:              (name ?? '').trim(),
    p_sPhone:             phone,
    p_sEmail:             (email && email.trim()) ? email.trim() : '',
    p_sCellphone:         phone,
    p_sInternationalCode: '',
    p_sDocument:          '',
    p_sAddress:           address,
    p_sPassword:          '',
    p_sObs:               obs,
    p_sDescription:       obs,
    p_sClientID:          numericId,
  };

  console.log(`📒 Bookitit editclient params (ID ${numericId}):`, JSON.stringify(params));
  let result = await apiPost(urlPath1, params);
  console.log(`📒 Bookitit editclient response (URL con ID):`, JSON.stringify(result));

  // If first attempt returned 404, try ID only in POST body (no ID in URL)
  if (result?.raw && String(result.raw).includes('404')) {
    const urlPath2 = `editclient/${PUBLIC_KEY}`;
    console.log(`📒 Bookitit editclient reintentando sin ID en URL...`);
    result = await apiPost(urlPath2, params);
    console.log(`📒 Bookitit editclient response (URL sin ID):`, JSON.stringify(result));
  }

  return result;
}

/**
 * Get events for a client across all configured agendas for a date range.
 * Matches by phone and/or name. Returns array sorted most-recent first.
 * daysBack/daysForward are relative to today (JST).
 */
export async function getClientEvents(clientPhone, clientName = null, daysBack = 180, daysForward = 60) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return [];

  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const fmt = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const fromStr = fmt(new Date(jstNow.getTime() - daysBack * 86400000));
  const toStr   = fmt(new Date(jstNow.getTime() + daysForward * 86400000));

  const norm = (p) => String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  const clientNorm = norm(clientPhone);
  const nameParts  = (clientName || '').toLowerCase().trim().split(/\s+/).filter(p => p.length >= 3);

  const agendas = [
    process.env.BOOKITIT_AGENDA_ID,
    process.env.BOOKITIT_AGENDA_MENKYO_ID,
  ].filter(Boolean);

  const allEvents = [];

  for (const agendaId of agendas) {
    try {
      const result = await apiGet(`getevents/${PUBLIC_KEY}/${fromStr}/${toStr}/${agendaId}`);
      const raw = result?.events ?? result?.event ?? result ?? [];
      const eventList = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);

      for (const ev of eventList) {
        if (!ev || typeof ev !== 'object') continue;

        const evPhone = norm(ev.client_phone ?? ev.clientPhone ?? ev.phone ?? ev.p_sClientPhone ?? ev.comments ?? '');
        const evName  = (ev.client_name ?? ev.clientName ?? ev.p_sClientName ?? ev.title ?? '').toLowerCase();

        const phoneMatch = clientNorm && evPhone && (evPhone.endsWith(clientNorm) || clientNorm.endsWith(evPhone));
        const nameMatch  = nameParts.length > 0 && nameParts.some(p => evName.includes(p));

        if (phoneMatch || nameMatch) {
          allEvents.push({ ...ev, _agendaId: agendaId });
        }
      }
    } catch (e) {
      console.error(`❌ getClientEvents agenda ${agendaId}:`, e.message);
    }
  }

  // Sort by date desc (most recent first)
  allEvents.sort((a, b) => {
    const da = (a.start_date ?? a.startDate ?? a.date ?? '').replace(/\D/g, '');
    const db = (b.start_date ?? b.startDate ?? b.date ?? '').replace(/\D/g, '');
    return db.localeCompare(da);
  });

  return allEvents;
}

/**
 * Cancel (delete) an event in Bookitit by its event ID
 * PHP: deleteevent/$publicKey  (POST with p_sEventID)
 * Returns true on success, throws on error.
 */
export async function cancelBookititEvent(eventId) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }
  if (!eventId) {
    throw new Error('cancelBookititEvent: eventId is required');
  }
  const urlPath = `deleteevent/${PUBLIC_KEY}`;
  const result = await apiPost(urlPath, {
    p_sEventID: eventId,
    p_bSendNotification: false,
  });
  const ev = result?.event ?? result;
  const statusOk = ev?.status === true || ev?.status === 'true' || ev?.status === 1 || ev?.status === '1' || result?.status === 'ok';
  if (!statusOk && result?.error) {
    throw new Error(`Bookitit cancel error: ${result.error}`);
  }
  console.log(`🗑️ Bookitit: evento ${eventId} cancelado →`, JSON.stringify(result).slice(0, 200));
  return true;
}

/**
 * Fetch all unique clients that appear in events from the past N days across
 * all configured agendas.  Used for the "Import from Bookitit" feature.
 *
 * Returns an array of { name, phone, obs } deduplicated by phone (digits only).
 * The most-recent event wins when a phone appears multiple times.
 */
export async function getUniqueClientsFromEvents(daysBack = 730) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }

  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const fmt = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  const fromStr = fmt(new Date(jstNow.getTime() - daysBack * 86400000));
  const toStr   = fmt(jstNow);

  const agendas = [
    process.env.BOOKITIT_AGENDA_ID,
    process.env.BOOKITIT_AGENDA_MENKYO_ID,
  ].filter(Boolean);

  const norm = (p) => String(p || '').replace(/\D/g, '').replace(/^0+/, '');

  // Map of normalizedPhone → { name, phone, obs, date }
  const clientMap = new Map();

  for (const agendaId of agendas) {
    try {
      const result = await apiGet(`getevents/${PUBLIC_KEY}/${fromStr}/${toStr}/${agendaId}`);
      const raw = result?.events ?? result?.event ?? result ?? [];
      const eventList = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);

      for (const ev of eventList) {
        if (!ev || typeof ev !== 'object') continue;

        const rawPhone = ev.client_phone ?? ev.clientPhone ?? ev.phone ?? ev.p_sClientPhone ?? '';
        const rawName  = (ev.client_name ?? ev.clientName ?? ev.p_sClientName ?? ev.title ?? '').trim();
        const rawObs   = (ev.p_sObs ?? ev.obs ?? ev.p_sDescription ?? ev.description ?? ev.p_sComments ?? ev.comments ?? '').trim();
        const rawDate  = ev.start_date ?? ev.startDate ?? ev.date ?? '';

        const phoneNorm = norm(rawPhone);
        if (!phoneNorm || !rawName) continue;

        // Keep the entry from the most recent event for this phone
        const existing = clientMap.get(phoneNorm);
        if (!existing || rawDate > existing.date) {
          clientMap.set(phoneNorm, { name: rawName, phone: rawPhone.trim(), obs: rawObs, date: rawDate });
        }
      }
    } catch (e) {
      console.error(`❌ getUniqueClientsFromEvents agenda ${agendaId}:`, e.message);
    }
  }

  return Array.from(clientMap.values()).map(({ name, phone, obs }) => ({ name, phone, obs }));
}

/**
 * Search clients in Bookitit by name or phone
 * PHP: getclients/$publicKey/$search  (GET)
 *
 * NOTE: Bookitit returns HTTP 500 (empty body) when no client matches the query,
 * instead of returning an empty list. We treat 500 as "not found" and return {clients:[]}
 * to avoid error spam in the logs and allow callers to continue normally.
 */
export async function searchClients(query) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('Bookitit API keys not configured');
  }
  const urlPath = `getclients/${PUBLIC_KEY}/${encodeURIComponent(query)}`;
  const res = await fetch(`${BASE_URL}/${urlPath}`, {
    headers: {
      'Authorization': getAuthHeader(urlPath),
      'Accept': 'application/json',
    },
  });
  if (res.status === 500) {
    // Bookitit returns 500 when the search yields no results — treat as empty
    return { clients: [] };
  }
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ Bookitit GET ${urlPath} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`Bookitit API error ${res.status} on GET ${urlPath}: ${text.slice(0, 120)}`);
  }
  try { return JSON.parse(text); } catch { return { clients: [] }; }
}

/**
 * Parse a time string to minutes from midnight
 * Accepts: "10:30", "10:30am", "2pm", "14:00"
 */
export function parseTimeToMinutes(timeStr) {
  const clean = timeStr.trim().toLowerCase();
  const match12 = clean.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (match12) {
    let hours = parseInt(match12[1]);
    const mins = parseInt(match12[2]);
    const period = match12[3];
    if (period === 'pm' && hours !== 12 && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    return hours * 60 + mins;
  }
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) return parseInt(match24[1]) * 60 + parseInt(match24[2]);
  const matchHour = clean.match(/^(\d{1,2})(am|pm)?$/);
  if (matchHour) {
    let hours = parseInt(matchHour[1]);
    if (matchHour[2] === 'pm' && hours !== 12 && hours < 12) hours += 12;
    if (matchHour[2] === 'am' && hours === 12) hours = 0;
    return hours * 60;
  }
  return null;
}

/**
 * Format a date string to YYYY-MM-DD for Bookitit
 * Accepts: "15/6/2025", "15-6-2025", "15 junio 2025", "15 june",
 *          "mañana", "hoy", "tomorrow", "today"
 */
export function formatDateForBookitit(dateStr) {
  const now = new Date();

  // Resolve relative day keywords before pattern matching
  const trimmed = dateStr.trim().toLowerCase();
  if (/^(?:hoy|today)$/.test(trimmed)) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  if (/^(?:ma[nñ]ana|tomorrow)$/.test(trimmed)) {
    const tomorrow = new Date(now.getTime() + 86400 * 1000);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  }

  const months = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };

  const matchDDMMYYYY = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (matchDDMMYYYY) {
    const [, d, m, y] = matchDDMMYYYY;
    const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const matchWordMonth = dateStr.match(/(\d{1,2})\s+(\w+)\s*(\d{4})?/i);
  if (matchWordMonth) {
    const day = parseInt(matchWordMonth[1]);
    const monthName = matchWordMonth[2].toLowerCase();
    const year = matchWordMonth[3] ? parseInt(matchWordMonth[3]) : now.getFullYear();
    const month = months[monthName];
    if (month !== undefined) {
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}
