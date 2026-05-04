/**
 * google-contacts-helper.js
 * Pure-JS helper so bot.js (plain Node ESM) can add students to Google Contacts
 * without importing TypeScript files.
 * Mirrors the logic in routes/google-contacts.ts :: addStudentToGoogleContacts()
 */

import pg from 'pg';
import { google } from 'googleapis';

const { Pool } = pg;

let _pool = null;
function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) return null;
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

function getOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const domain = (process.env.REPLIT_DOMAINS ?? '').split(',')[0]?.trim();
  const redirectUri = domain
    ? `https://${domain}/api/google-contacts/callback`
    : `http://localhost:${process.env.PORT ?? 8080}/api/google-contacts/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getAuthedClient() {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return null;
  const pool = getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token, expires_at
       FROM oauth_tokens
       WHERE provider = 'google-contacts'
       LIMIT 1`
    );
    const row = rows[0];
    if (!row) return null;
    oauth2.setCredentials({
      access_token:  row.access_token,
      refresh_token: row.refresh_token ?? undefined,
      expiry_date:   row.expires_at ? new Date(row.expires_at).getTime() : undefined,
    });
    // Auto-persist refreshed tokens
    oauth2.on('tokens', async (tokens) => {
      try {
        await pool.query(
          `UPDATE oauth_tokens
           SET access_token  = COALESCE($1, access_token),
               refresh_token = COALESCE($2, refresh_token),
               expires_at    = COALESCE($3, expires_at),
               updated_at    = NOW()
           WHERE provider = 'google-contacts'`,
          [
            tokens.access_token  ?? null,
            tokens.refresh_token ?? null,
            tokens.expiry_date   ? new Date(tokens.expiry_date) : null,
          ]
        );
      } catch (_) {}
    });
    return oauth2;
  } catch (_) {
    return null;
  }
}

/**
 * Add a student to Google Contacts.
 * @param {string} nombre
 * @param {string} telefono
 * @param {string|null} [email]
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function addStudentToGoogleContacts(nombre, telefono, email) {
  try {
    const oauth2 = await getAuthedClient();
    if (!oauth2) {
      const msg = 'No hay conexión OAuth con Google Contacts (token no configurado)';
      console.warn(`⚠️ Google Contacts: ${msg}`);
      return { ok: false, error: msg };
    }
    const people = google.people({ version: 'v1', auth: oauth2 });
    const body = {
      names:        [{ displayName: nombre }],
      phoneNumbers: [{ value: String(telefono), type: 'mobile' }],
    };
    if (email) body.emailAddresses = [{ value: email }];
    await people.people.createContact({ requestBody: body });
    console.log(`📒 Google Contacts: contacto creado para ${nombre} (+${telefono})`);
    return { ok: true };
  } catch (err) {
    const msg = err?.message ?? String(err);
    console.warn(`⚠️ Google Contacts: no se pudo crear contacto para ${nombre}: ${msg}`);
    return { ok: false, error: msg };
  }
}
