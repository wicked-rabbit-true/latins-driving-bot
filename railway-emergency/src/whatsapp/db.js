import pg from 'pg';
const { Pool } = pg;

let _pool = null;

function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) return null;
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ── Código de alumno ──────────────────────────────────────────────────────────
const CODIGO_PREFIX = 'KM';
const CODIGO_SEED   = 2519;

function isTochigi(codigoPostal, direccion) {
  if (codigoPostal) {
    const digits = String(codigoPostal).replace(/[^0-9]/g, '');
    if (digits.startsWith('32')) return true;
  }
  return !!(direccion && direccion.includes('栃木'));
}

/**
 * Generate the next student code (KMxxxxT for Tochigi, KMxxxx for others).
 * Must be called inside a transaction or with a serialised lock to avoid races.
 */
async function nextCodigoAlumno(pool, codigoPostal, direccion) {
  if (isTochigi(codigoPostal, direccion)) {
    // Tochigi: reuse the same numeric part as the last non-Tochigi code
    const res = await pool.query(
      `SELECT MAX(CAST((REGEXP_MATCH(codigo_alumno, '^KM([0-9]+)$'))[1] AS INTEGER)) AS max_num
       FROM students
       WHERE codigo_alumno ~ '^KM[0-9]+$'`
    );
    const maxNum = res.rows[0]?.max_num ?? null;
    const num = (maxNum !== null && !isNaN(parseInt(String(maxNum), 10)))
      ? parseInt(String(maxNum), 10)
      : CODIGO_SEED;
    return `${CODIGO_PREFIX}${num}T`;
  } else {
    // Non-Tochigi: increment from the max numeric part across ALL codes
    const res = await pool.query(
      `SELECT MAX(CAST((REGEXP_MATCH(codigo_alumno, '^KM([0-9]+)'))[1] AS INTEGER)) AS max_num
       FROM students
       WHERE codigo_alumno ~ '^KM[0-9]+'`
    );
    const maxNum = res.rows[0]?.max_num ?? null;
    let nextNum = CODIGO_SEED;
    if (maxNum !== null && !isNaN(parseInt(String(maxNum), 10))) {
      nextNum = parseInt(String(maxNum), 10) + 1;
    }
    return `${CODIGO_PREFIX}${nextNum}`;
  }
}

/**
 * Save a student to the database.
 * Returns the created row or null if DB is not available.
 */
export async function saveStudent({ nombre, telefono, email = null, notas = null, tipoLicencia = null }) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `INSERT INTO students (nombre, telefono, email, notas, tipo_licencia, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (telefono) DO UPDATE
         SET nombre = EXCLUDED.nombre,
             email  = COALESCE(EXCLUDED.email, students.email),
             notas  = COALESCE(EXCLUDED.notas, students.notas),
             tipo_licencia = COALESCE(EXCLUDED.tipo_licencia, students.tipo_licencia),
             updated_at = NOW()
       RETURNING *`,
      [nombre, telefono, email || null, notas || null, tipoLicencia || null]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    console.error('❌ DB saveStudent error:', e.message);
    return null;
  }
}

/**
 * Update the bookitit_id for a student by phone number.
 */
export async function updateStudentBookititId(telefono, bookititId) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE students SET bookitit_id = $1, updated_at = NOW() WHERE telefono = $2`,
      [String(bookititId), telefono]
    );
  } catch (e) {
    console.error('❌ DB updateStudentBookititId error:', e.message);
  }
}

/**
 * Find a student by phone number.
 */
export async function findStudentByPhone(telefono) {
  const pool = getPool();
  if (!pool) return null;
  try {
    // Normalise the input and build all plausible variants so we find the
    // student regardless of how their number was stored (international vs
    // Japanese-local format, with or without leading zero, etc.).
    const digits = String(telefono ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (!digits || digits.length < 8) return null;

    const variants = new Set();
    variants.add(digits);                          // e.g. 819012345678

    // Japanese local: 81XXXXXXXXX → 0XXXXXXXXX
    if (digits.startsWith('81') && digits.length >= 11) {
      const local = '0' + digits.slice(2);        // e.g. 09012345678
      variants.add(local);
      variants.add(local.replace(/^0+/, ''));      // without leading zero
    }

    // International without country code prefix (if 10-digit local already)
    if (digits.startsWith('0') && digits.length >= 10) {
      variants.add(digits.replace(/^0+/, ''));     // strip leading zero
      variants.add('81' + digits.replace(/^0+/, ''));
    }

    const params = [...variants];
    const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
    const res = await pool.query(
      `SELECT * FROM students WHERE telefono IN (${placeholders}) LIMIT 1`,
      params
    );
    return res.rows[0] ?? null;
  } catch (e) {
    console.error('❌ DB findStudentByPhone error:', e.message);
    return null;
  }
}

/**
 * Save zairyu card / resident card data for a student identified by phone.
 * Upserts the student record (creates if not found).
 */
export async function saveZairyuData(telefono, {
  nombre = null,
  codigoPostal = null,    // código postal japonés (7 dígitos, sin símbolo 〒)
  direccion = null,
  tipoVisa = null,
  numeroZairyu = null,
  expiracionVisa = null,  // ISO date string YYYY-MM-DD
  nacionalidad = null,
  categoria3045 = null,
  fechaNacimiento = null, // ISO date string YYYY-MM-DD
  duracionVisa = null,
  notas = null,
  sexo = null,            // 'M' | 'F'
  tipoLicencia = null,    // 'AT' | 'MT' | '3ton' | etc.
  valorCurso = null,      // número en yenes
  montoPagado = null,     // número en yenes
} = {}) {
  const pool = getPool();
  if (!pool) return null;
  try {
    // Generate student code for new registrations
    const codigoAlumno = await nextCodigoAlumno(pool, codigoPostal, direccion);

    const res = await pool.query(
      `INSERT INTO students
         (nombre, telefono, codigo_postal, direccion, tipo_visa, numero_zairyu, expiracion_visa,
          nacionalidad, categoria_30_45, fecha_nacimiento, duracion_visa, notas,
          sexo, tipo_licencia, valor_curso, monto_pagado, codigo_alumno,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10::date,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
       ON CONFLICT (telefono) DO UPDATE SET
         nombre           = COALESCE(EXCLUDED.nombre, students.nombre),
         codigo_postal    = COALESCE(EXCLUDED.codigo_postal, students.codigo_postal),
         direccion        = COALESCE(EXCLUDED.direccion, students.direccion),
         tipo_visa        = COALESCE(EXCLUDED.tipo_visa, students.tipo_visa),
         numero_zairyu    = COALESCE(EXCLUDED.numero_zairyu, students.numero_zairyu),
         expiracion_visa  = COALESCE(EXCLUDED.expiracion_visa, students.expiracion_visa),
         nacionalidad     = COALESCE(EXCLUDED.nacionalidad, students.nacionalidad),
         categoria_30_45  = COALESCE(EXCLUDED.categoria_30_45, students.categoria_30_45),
         fecha_nacimiento = COALESCE(EXCLUDED.fecha_nacimiento, students.fecha_nacimiento),
         duracion_visa    = COALESCE(EXCLUDED.duracion_visa, students.duracion_visa),
         notas            = COALESCE(EXCLUDED.notas, students.notas),
         sexo             = COALESCE(EXCLUDED.sexo, students.sexo),
         tipo_licencia    = COALESCE(EXCLUDED.tipo_licencia, students.tipo_licencia),
         valor_curso      = COALESCE(EXCLUDED.valor_curso, students.valor_curso),
         monto_pagado     = COALESCE(EXCLUDED.monto_pagado, students.monto_pagado),
         codigo_alumno    = COALESCE(students.codigo_alumno, EXCLUDED.codigo_alumno),
         updated_at       = NOW()
       RETURNING *`,
      [nombre, telefono, codigoPostal || null, direccion, tipoVisa, numeroZairyu,
       expiracionVisa || null, nacionalidad, categoria3045,
       fechaNacimiento || null, duracionVisa, notas || null,
       sexo, tipoLicencia, valorCurso ?? null, montoPagado ?? null, codigoAlumno]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    console.error('❌ DB saveZairyuData error:', e.message);
    return null;
  }
}

/**
 * Update specific fields of a student identified by phone number.
 * `fields` is a plain object: { columnName: value, ... }
 * Only columns explicitly passed are updated (null values are allowed).
 * Returns the updated row or null.
 */
export async function updateStudentFields(telefono, fields) {
  const pool = getPool();
  if (!pool) return null;

  // Whitelist of updatable columns
  const ALLOWED = new Set([
    'nombre', 'email', 'sexo', 'fecha_nacimiento', 'direccion', 'codigo_postal',
    'tipo_licencia', 'expiracion_visa', 'valor_curso', 'monto_pagado',
    'notas', 'tipo_visa', 'numero_zairyu', 'nacionalidad',
    'categoria_30_45', 'duracion_visa', 'preferred_language',
    'tsuruoka_graduado', 'tsuruoka_fecha_graduacion',
  ]);

  const DATE_COLS = new Set(['fecha_nacimiento', 'expiracion_visa', 'tsuruoka_fecha_graduacion']);
  const INT_COLS  = new Set(['valor_curso', 'monto_pagado']);

  const entries = Object.entries(fields).filter(([col]) => ALLOWED.has(col));
  if (!entries.length) return null;

  const setClauses = entries.map(([col], i) => {
    if (DATE_COLS.has(col)) return `${col} = $${i + 1}::date`;
    return `${col} = $${i + 1}`;
  });

  const values = entries.map(([col, val]) => {
    if (INT_COLS.has(col)) return val === null ? null : parseInt(String(val).replace(/\D/g, ''), 10) || null;
    return val;
  });

  try {
    const res = await pool.query(
      `UPDATE students SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE telefono = $${entries.length + 1}
       RETURNING *`,
      [...values, telefono]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    console.error('❌ DB updateStudentFields error:', e.message);
    return null;
  }
}

/**
 * Create a bot notification (for the admin panel bell).
 * type: 'identity_fail' | 'doubt' | 'attention' | 'info'
 */
export async function createNotification({ type, message, chatId = null, studentName = null }) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `INSERT INTO bot_notifications (type, message, chat_id, student_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [type, message, chatId, studentName]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    console.error('❌ DB createNotification error:', e.message);
    return null;
  }
}

// ── Historial de conversaciones ───────────────────────────────────────────────

const DB_HISTORY_LIMIT = 30; // mensajes máximos guardados por chat en DB

/**
 * Creates the conversation_history table if it doesn't exist.
 * Called once at bot startup.
 */
export async function initConversationHistoryTable() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id         SERIAL PRIMARY KEY,
        chat_id    VARCHAR(150) NOT NULL,
        role       VARCHAR(20)  NOT NULL,
        content    TEXT         NOT NULL,
        created_at TIMESTAMP    DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_conv_history_chat_created
        ON conversation_history(chat_id, created_at DESC);
    `);
    console.log('📂 Tabla conversation_history lista');
  } catch (e) {
    console.error('❌ DB initConversationHistoryTable error:', e.message);
  }
}

/**
 * Persist a single message for a chat.
 * Also prunes older messages so each chat keeps at most DB_HISTORY_LIMIT rows.
 * Fire-and-forget: call without await from the bot.
 */
export async function persistMessage(chatId, role, content) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO conversation_history (chat_id, role, content) VALUES ($1, $2, $3)`,
      [chatId, role, String(content).substring(0, 4000)]
    );
    // Prune: delete oldest beyond limit
    await pool.query(
      `DELETE FROM conversation_history
       WHERE chat_id = $1
         AND id NOT IN (
           SELECT id FROM conversation_history
           WHERE chat_id = $1
           ORDER BY created_at DESC
           LIMIT $2
         )`,
      [chatId, DB_HISTORY_LIMIT]
    );
  } catch (e) {
    console.error('❌ DB persistMessage error:', e.message);
  }
}

/**
 * Load the last `limit` messages for a chat from the DB.
 * Returns them in chronological order (oldest first).
 */
export async function loadPersistedHistory(chatId, limit = DB_HISTORY_LIMIT) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT role, content FROM (
         SELECT role, content, created_at
         FROM conversation_history
         WHERE chat_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       ) sub
       ORDER BY created_at ASC`,
      [chatId, limit]
    );
    return res.rows.map(r => ({ role: r.role, content: r.content }));
  } catch (e) {
    console.error('❌ DB loadPersistedHistory error:', e.message);
    return [];
  }
}

// ── Idioma preferido ──────────────────────────────────────────────────────────

/**
 * Adds the preferred_language column to the students table if it doesn't exist.
 * Safe to call on every startup (idempotent).
 */
export async function initStudentsLanguageColumn() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10)
    `);
    console.log('📂 Columna preferred_language lista en students');
  } catch (e) {
    console.error('❌ DB initStudentsLanguageColumn error:', e.message);
  }
}

/**
 * Persist the language preference for a student identified by phone.
 * Matches by digits-only or @c.us format.  Fire-and-forget safe.
 */
export async function saveStudentLanguage(telefono, langCode) {
  const pool = getPool();
  if (!pool) return;
  const digits = String(telefono).replace(/\D/g, '');
  if (!digits) return;
  try {
    await pool.query(
      `UPDATE students SET preferred_language = $1, updated_at = NOW()
       WHERE telefono = $2 OR telefono = $3`,
      [langCode, digits, `${digits}@c.us`]
    );
  } catch (e) {
    console.error('❌ DB saveStudentLanguage error:', e.message);
  }
}

/**
 * Back-fill preferred_language ONLY for students whose column is currently NULL.
 * Accepts an iterable of [phone, langCode] pairs (e.g. Map.entries()).
 * Deduplicates by digits-only phone, explicitly skips group IDs (@g.us) and empty values.
 * Returns the total number of DB rows actually updated.
 */
export async function backfillStudentLanguages(entries) {
  const pool = getPool();
  if (!pool) return 0;
  const seen = new Set();
  let totalUpdated = 0;
  for (const [key, lang] of entries) {
    if (!lang) continue;
    const keyStr = String(key);
    // Skip WhatsApp group chat IDs — they are never student phone numbers
    if (keyStr.endsWith('@g.us')) continue;
    const digits = keyStr.replace(/\D/g, '');
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    try {
      const res = await pool.query(
        `UPDATE students SET preferred_language = $1, updated_at = NOW()
         WHERE (telefono = $2 OR telefono = $3) AND preferred_language IS NULL`,
        [lang, digits, `${digits}@c.us`]
      );
      totalUpdated += res.rowCount ?? 0;
    } catch (e) {
      console.error('❌ DB backfillStudentLanguages error:', e.message);
    }
  }
  return totalUpdated;
}

/**
 * Load all students that have a stored language preference.
 * Returns an array of { telefono, lang } objects.
 * Used on startup to reconstruct the language cache after file loss.
 */
export async function loadAllStudentLanguages() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT telefono, preferred_language AS lang
       FROM students
       WHERE preferred_language IS NOT NULL AND preferred_language <> ''`
    );
    return res.rows;
  } catch (e) {
    console.error('❌ DB loadAllStudentLanguages error:', e.message);
    return [];
  }
}

// ── Contact Languages (persists for ALL contacts, not just students) ──────────

/**
 * Create the contact_languages table if it doesn't exist.
 * Safe to call on every startup (idempotent).
 */
export async function initContactLanguagesTable() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_languages (
        phone      VARCHAR(30) PRIMARY KEY,
        lang       VARCHAR(10) NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.error('❌ DB initContactLanguagesTable error:', e.message);
  }
}

/**
 * Persist/update the language for any contact (prospect or student) by phone.
 * Uses UPSERT so it's safe to call repeatedly.
 */
export async function saveContactLanguage(phone, langCode) {
  const pool = getPool();
  if (!pool) return;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits || !langCode) return;
  try {
    await pool.query(
      `INSERT INTO contact_languages (phone, lang, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (phone) DO UPDATE SET lang = EXCLUDED.lang, updated_at = NOW()`,
      [digits, langCode]
    );
  } catch (e) {
    console.error('❌ DB saveContactLanguage error:', e.message);
  }
}

/**
 * Load all contact language preferences from contact_languages table.
 * Returns an array of { phone, lang } objects.
 */
export async function loadAllContactLanguages() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT phone, lang FROM contact_languages WHERE lang IS NOT NULL AND lang <> ''`
    );
    return res.rows;
  } catch (e) {
    console.error('❌ DB loadAllContactLanguages error:', e.message);
    return [];
  }
}

/**
 * Load all contact language preferences including updated_at, ordered newest first.
 * Returns an array of { phone, lang, updated_at } objects.
 */
export async function loadProspectContacts() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT phone, lang, updated_at FROM contact_languages WHERE lang IS NOT NULL AND lang <> '' ORDER BY updated_at DESC`
    );
    return res.rows;
  } catch (e) {
    console.error('❌ DB loadProspectContacts error:', e.message);
    return [];
  }
}

/**
 * Find the language for a contact by phone suffix (last N digits).
 * More efficient than loading all contacts when looking up a single contact.
 */
export async function findContactLanguageBySuffix(phoneSuffix) {
  const pool = getPool();
  if (!pool || !phoneSuffix) return null;
  try {
    const res = await pool.query(
      `SELECT lang FROM contact_languages WHERE phone LIKE $1 LIMIT 1`,
      [`%${phoneSuffix}`]
    );
    return res.rows[0]?.lang || null;
  } catch (e) {
    return null;
  }
}

// ── Visas / alumnos ───────────────────────────────────────────────────────────

/**
 * Get students whose visa expires within the next `days` days (or already expired).
 * Returns rows sorted: expired first, then soonest expiry.
 */
export async function getStudentsWithExpiringVisas(days = 60) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT id, nombre, telefono, expiracion_visa
       FROM students
       WHERE expiracion_visa IS NOT NULL
         AND expiracion_visa <= (CURRENT_DATE + INTERVAL '${parseInt(days, 10)} days')
       ORDER BY expiracion_visa ASC`
    );
    return res.rows;
  } catch (e) {
    console.error('❌ DB getStudentsWithExpiringVisas error:', e.message);
    return [];
  }
}

/**
 * Devuelve los últimos `limit` mensajes del usuario cuyo chat_id termina en `phoneSuffix`.
 * Usado para detectar el idioma de un cliente cuando el cache no tiene su clave @c.us
 * (p.ej. contactos @lid cuyos mensajes se guardaron con un chatId distinto al número real).
 */
export async function loadRecentUserMessagesBySuffix(phoneSuffix, limit = 3) {
  const pool = getPool();
  if (!pool || !phoneSuffix) return [];
  try {
    const res = await pool.query(
      `SELECT content FROM conversation_history
       WHERE role = 'user' AND chat_id LIKE $1
       ORDER BY created_at DESC LIMIT $2`,
      [`%${phoneSuffix}`, limit]
    );
    return res.rows.map(r => r.content);
  } catch (e) {
    return [];
  }
}

// ── Bot Action Queue ──────────────────────────────────────────────────────────

export async function getPendingBotActions(limit = 5) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `UPDATE bot_action_queue
       SET status = 'processing'
       WHERE id IN (
         SELECT id FROM bot_action_queue
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT $1
       )
       RETURNING id, type, payload`,
      [limit]
    );
    return res.rows;
  } catch (e) {
    console.error('❌ DB getPendingBotActions error:', e.message);
    return [];
  }
}

export async function markBotActionDone(id) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE bot_action_queue SET status = 'done', processed_at = NOW() WHERE id = $1`,
      [id]
    );
  } catch (e) {
    console.error('❌ DB markBotActionDone error:', e.message);
  }
}

export async function markBotActionDoneWithResult(id, result) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE bot_action_queue SET status = 'done', processed_at = NOW(), payload = payload || $2 WHERE id = $1`,
      [id, JSON.stringify(result)]
    );
  } catch (e) {
    console.error('❌ DB markBotActionDoneWithResult error:', e.message);
  }
}

export async function markBotActionFailed(id, error) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE bot_action_queue SET status = 'failed', processed_at = NOW(), error = $2 WHERE id = $1`,
      [id, String(error)]
    );
  } catch (e) {
    console.error('❌ DB markBotActionFailed error:', e.message);
  }
}

// ── Base de Conocimiento del Bot ─────────────────────────────────────────────

export async function initBotKnowledgeTable() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_knowledge (
        id           SERIAL PRIMARY KEY,
        situacion    TEXT NOT NULL,
        respuesta    TEXT NOT NULL,
        tipo_usuario TEXT DEFAULT 'general',
        idioma       TEXT DEFAULT 'es',
        fuente       TEXT DEFAULT 'manual',
        activo       BOOLEAN DEFAULT TRUE,
        vistas       INTEGER DEFAULT 0,
        creado_por   TEXT,
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.error('❌ DB initBotKnowledgeTable error:', e.message);
  }
}

export async function saveKnowledgeEntry({ situacion, respuesta, tipoEntrada = 'respuesta', tipoUsuario = 'general', idioma = 'es', fuente = 'manual', creadoPor = null }) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `INSERT INTO bot_knowledge (situacion, respuesta, tipo_entrada, tipo_usuario, idioma, fuente, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [situacion.trim(), respuesta.trim(), tipoEntrada, tipoUsuario, idioma, fuente, creadoPor]
    );
    return res.rows[0]?.id ?? null;
  } catch (e) {
    console.error('❌ DB saveKnowledgeEntry error:', e.message);
    return null;
  }
}

// Palabras vacías en español/inglés que no aportan para la búsqueda
const STOP_WORDS = new Set(['para','como','sobre','desde','hasta','entre','esto','este','esta',
  'esos','esas','unos','unas','que','qué','por','los','las','del','con','una','uno',
  'but','the','and','for','this','that','are','was','were','has','have','not','you',
  'can','will','your','from','they','them','been','also','very','just','more','when']);

export async function searchKnowledge(query, { tipoUsuario = null, idioma = null, limit = 3 } = {}) {
  const pool = getPool();
  if (!pool) { console.log('🧠 searchKnowledge: no pool'); return []; }
  try {
    // Extraer palabras sin eliminar caracteres acentuados — split solo en espacios y puntuación
    const rawWords = query.toLowerCase().split(/[\s¿?¡!,.:;'"()\-\/\\]+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
    console.log(`🧠 searchKnowledge: rawWords=[${rawWords.join(',')}] idioma=${idioma}`);
    if (rawWords.length === 0) return [];
    // Usar las primeras 6 palabras más largas/relevantes
    const keywords = rawWords.sort((a, b) => b.length - a.length).slice(0, 6);
    // Generar condiciones OR: cada palabra se busca en situacion, situacion_es O respuesta (case-insensitive via ILIKE)
    const conditions = keywords.map((w, i) =>
      `(unaccent(lower(situacion)) ILIKE unaccent($${i + 1}) OR unaccent(lower(COALESCE(situacion_es,''))) ILIKE unaccent($${i + 1}) OR unaccent(lower(respuesta)) ILIKE unaccent($${i + 1}))`
    );
    const params = keywords.map(w => `%${w}%`);
    let sql = `SELECT *, (`;
    // Score: cuántas palabras coinciden (mayor coincidencia = mejor resultado)
    // situacion_es tiene mayor peso (3) porque es el título traducido al español
    sql += keywords.map((w, i) =>
      `(CASE WHEN unaccent(lower(situacion)) ILIKE unaccent($${i + 1}) THEN 2 ELSE 0 END + ` +
      `CASE WHEN unaccent(lower(COALESCE(situacion_es,''))) ILIKE unaccent($${i + 1}) THEN 3 ELSE 0 END + ` +
      `CASE WHEN unaccent(lower(respuesta)) ILIKE unaccent($${i + 1}) THEN 1 ELSE 0 END)`
    ).join(' + ');
    sql += `) AS _score FROM bot_knowledge WHERE activo = TRUE AND (${conditions.join(' OR ')})`;
    // Incluir siempre contenido en japonés (fuente oficial) junto con el idioma del usuario y español
    if (idioma)      { sql += ` AND (idioma = $${params.length + 1} OR idioma = 'es' OR idioma = 'ja')`; params.push(idioma); }
    sql += ` ORDER BY _score DESC, vistas DESC, created_at DESC LIMIT ${limit}`;
    console.log(`🧠 searchKnowledge SQL keywords: [${keywords.join(',')}] params_total=${params.length}`);
    const res = await pool.query(sql, params);
    const filtered = res.rows.filter(r => r._score > 0);
    console.log(`🧠 searchKnowledge: ${res.rows.length} filas raw, ${filtered.length} con score>0`);
    return filtered;
  } catch (e) {
    console.error(`🧠 searchKnowledge ERROR (principal): ${e.message}`);
    // Si unaccent no está disponible, caer a búsqueda simple sin acentos
    try {
      const rawWords2 = query.replace(/[áéíóúüñ]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u',ü:'u',ñ:'n'}[c]||c))
        .toLowerCase().split(/[\s?!,.:;'"()\-\/\\]+/)
        .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
      if (rawWords2.length === 0) return [];
      const kw2 = rawWords2.sort((a, b) => b.length - a.length).slice(0, 6);
      const conds2 = kw2.map((w, i) => `(lower(situacion) ILIKE $${i + 1} OR lower(COALESCE(situacion_es,'')) ILIKE $${i + 1} OR lower(respuesta) ILIKE $${i + 1})`);
      const params2 = kw2.map(w => `%${w}%`);
      let sql2 = `SELECT * FROM bot_knowledge WHERE activo = TRUE AND (${conds2.join(' OR ')})`;
      if (idioma)      { sql2 += ` AND (idioma = $${params2.length + 1} OR idioma = 'es' OR idioma = 'ja')`; params2.push(idioma); }
      sql2 += ` ORDER BY vistas DESC, created_at DESC LIMIT ${limit}`;
      const res2 = await pool.query(sql2, params2);
      return res2.rows;
    } catch (e2) {
      console.error('❌ DB searchKnowledge error:', e2.message);
      return [];
    }
  }
}

export async function incrementKnowledgeViews(id) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`UPDATE bot_knowledge SET vistas = vistas + 1 WHERE id = $1`, [id]);
  } catch (e) {}
}

export async function listKnowledgeEntries({ limit = 10, offset = 0, soloActivos = true } = {}) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const where = soloActivos ? 'WHERE activo = TRUE' : '';
    const res = await pool.query(
      `SELECT id, situacion, respuesta, tipo_entrada, tipo_usuario, idioma, fuente, vistas, activo, created_at
       FROM bot_knowledge ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.rows;
  } catch (e) {
    console.error('❌ DB listKnowledgeEntries error:', e.message);
    return [];
  }
}

export async function updateKnowledgeEntry(id, { situacion, respuesta, tipoEntrada, tipoUsuario, idioma } = {}) {
  const pool = getPool();
  if (!pool) return false;
  try {
    const setClauses = [];
    const params = [];
    if (situacion   !== undefined) { params.push(situacion.trim());   setClauses.push(`situacion=$${params.length}`); }
    if (respuesta   !== undefined) { params.push(respuesta.trim());   setClauses.push(`respuesta=$${params.length}`); }
    if (tipoEntrada !== undefined) { params.push(tipoEntrada);        setClauses.push(`tipo_entrada=$${params.length}`); }
    if (tipoUsuario !== undefined) { params.push(tipoUsuario);        setClauses.push(`tipo_usuario=$${params.length}`); }
    if (idioma      !== undefined) { params.push(idioma);             setClauses.push(`idioma=$${params.length}`); }
    if (setClauses.length === 0) return false;
    params.push(id);
    const res = await pool.query(
      `UPDATE bot_knowledge SET ${setClauses.join(', ')} WHERE id=$${params.length} RETURNING id`,
      params
    );
    return (res.rowCount ?? 0) > 0;
  } catch (e) {
    console.error('❌ DB updateKnowledgeEntry error:', e.message);
    return false;
  }
}

export async function deleteKnowledgeEntry(id) {
  const pool = getPool();
  if (!pool) return false;
  try {
    const res = await pool.query(`DELETE FROM bot_knowledge WHERE id = $1 RETURNING id`, [id]);
    return res.rowCount > 0;
  } catch (e) {
    console.error('❌ DB deleteKnowledgeEntry error:', e.message);
    return false;
  }
}

export async function toggleKnowledgeEntry(id) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `UPDATE bot_knowledge SET activo = NOT activo, updated_at = NOW() WHERE id = $1 RETURNING activo`,
      [id]
    );
    return res.rows[0]?.activo ?? null;
  } catch (e) {
    console.error('❌ DB toggleKnowledgeEntry error:', e.message);
    return null;
  }
}

// ── Citas pendientes de confirmación ─────────────────────────────────────────

/**
 * Crea la tabla pending_appointments si no existe.
 * Llamar una vez al arranque del bot.
 */
export async function initPendingAppointmentsTable() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_appointments (
        chat_id        VARCHAR(150) PRIMARY KEY,
        nombre         TEXT         NOT NULL,
        tramite        TEXT         NOT NULL,
        hora           TEXT         NOT NULL,
        client_number  VARCHAR(60)  NOT NULL,
        service_id     VARCHAR(100),
        agenda_id      VARCHAR(100),
        duration_mins  INTEGER      DEFAULT 60,
        service_name   TEXT,
        created_at     TIMESTAMP    DEFAULT NOW()
      );
    `);
    console.log('📂 Tabla pending_appointments lista');
  } catch (e) {
    console.error('❌ DB initPendingAppointmentsTable error:', e.message);
  }
}

/**
 * Guarda o actualiza una cita pendiente para un chat.
 */
export async function savePendingAppointment(chatId, data) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO pending_appointments
         (chat_id, nombre, tramite, hora, client_number, service_id, agenda_id, duration_mins, service_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (chat_id) DO UPDATE SET
         nombre=$2, tramite=$3, hora=$4, client_number=$5,
         service_id=$6, agenda_id=$7, duration_mins=$8,
         service_name=$9, created_at=NOW()`,
      [
        chatId,
        data.nombre        || '',
        data.tramite       || '',
        data.hora          || '',
        data.clientNumber  || '',
        data.serviceId     || null,
        data.agendaId      || null,
        data.durationMins  || 60,
        data.serviceName   || null,
      ]
    );
  } catch (e) {
    console.error('❌ DB savePendingAppointment error:', e.message);
  }
}

/**
 * Recupera la cita pendiente para un chat, o null si no hay.
 */
export async function getPendingAppointment(chatId) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT nombre, tramite, hora, client_number, service_id, agenda_id, duration_mins, service_name
       FROM pending_appointments WHERE chat_id = $1`,
      [chatId]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      nombre:       r.nombre,
      tramite:      r.tramite,
      hora:         r.hora,
      clientNumber: r.client_number,
      serviceId:    r.service_id,
      agendaId:     r.agenda_id,
      durationMins: r.duration_mins,
      serviceName:  r.service_name,
    };
  } catch (e) {
    console.error('❌ DB getPendingAppointment error:', e.message);
    return null;
  }
}

/**
 * Elimina la cita pendiente para un chat (después de agendar o cancelar).
 */
export async function deletePendingAppointment(chatId) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM pending_appointments WHERE chat_id = $1`, [chatId]);
  } catch (e) {
    console.error('❌ DB deletePendingAppointment error:', e.message);
  }
}

// ── Historial de podas de caché de idiomas ────────────────────────────────────

/**
 * Crea la tabla language_cache_prune_log si no existe.
 * Se llama una vez al inicio del bot.
 */
export async function initPruneLogTable() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS language_cache_prune_log (
        id        SERIAL PRIMARY KEY,
        pruned_at TIMESTAMP NOT NULL DEFAULT NOW(),
        removed   INTEGER NOT NULL,
        malformed INTEGER NOT NULL
      )
    `);
  } catch (e) {
    console.error('❌ DB initPruneLogTable error:', e.message);
  }
}

/**
 * Busca preguntas de examen por similitud de texto usando pg_trgm.
 * Retorna las mejores coincidencias con su respuesta correcta (boolean ○/✕).
 *
 * @param {string} query       - texto del mensaje del alumno
 * @param {object} opts
 * @param {number} opts.limit      - máximo de resultados (default 3)
 * @param {number} opts.threshold  - similitud mínima 0-1 (default 0.25)
 * @returns {Promise<Array<{id, pregunta, respuesta, explicacion, ciudad, fuente, sim_score}>>}
 */
export async function searchExamQuestion(query, { limit = 3, threshold = 0.25 } = {}) {
  const pool = getPool();
  if (!pool || !query || query.trim().length < 10) return [];
  try {
    const sql = `
      SELECT id, pregunta, respuesta, explicacion, ciudad, fuente,
             similarity(lower(pregunta), lower($1)) AS sim_score
      FROM exam_questions
      WHERE similarity(lower(pregunta), lower($1)) >= $2
      ORDER BY sim_score DESC
      LIMIT $3
    `;
    const res = await pool.query(sql, [query.trim(), threshold, limit]);
    return res.rows;
  } catch (e) {
    console.error('❌ searchExamQuestion error:', e.message);
    return [];
  }
}

/**
 * Inserta una entrada en el historial de podas del caché de idiomas.
 * @param {number} removed  - número total de entradas eliminadas
 * @param {number} malformed - número de claves malformadas eliminadas
 */
export async function savePruneLogEntry(removed, malformed) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO language_cache_prune_log (removed, malformed) VALUES ($1, $2)`,
      [removed, malformed]
    );
  } catch (e) {
    console.error('❌ DB savePruneLogEntry error:', e.message);
  }
}
