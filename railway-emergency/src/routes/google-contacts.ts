import { Router } from "express";
import express from "express";
import { db } from "@workspace/db";
import { studentsTable, oauthTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { google } from "googleapis";

const googleContactsRouter = Router();

// ── OAuth2 client ────────────────────────────────────────────────────────────

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const domain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
  const redirectUri = domain
    ? `https://${domain}/api/google-contacts/callback`
    : `http://localhost:${process.env.PORT ?? 8080}/api/google-contacts/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getAuthedClient() {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return null;
  const [row] = await db.select().from(oauthTokensTable)
    .where(eq(oauthTokensTable.provider, "google-contacts"));
  if (!row) return null;
  oauth2.setCredentials({
    access_token: row.accessToken,
    refresh_token: row.refreshToken ?? undefined,
    expiry_date: row.expiresAt ? row.expiresAt.getTime() : undefined,
  });
  // Auto-refresh if expiring soon
  oauth2.on("tokens", async (tokens) => {
    try {
      await db.update(oauthTokensTable)
        .set({
          accessToken: tokens.access_token ?? row.accessToken,
          refreshToken: tokens.refresh_token ?? row.refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : row.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(oauthTokensTable.provider, "google-contacts"));
    } catch (_) {}
  });
  return oauth2;
}

// ── CSV Parsing ──────────────────────────────────────────────────────────────

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

interface GoogleContact {
  name: string;
  phones: string[];
}

function parseGoogleContactsCsv(text: string): GoogleContact[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]);
  const ht = headers.map(h => h.trim());

  // Strategy A: single combined name column (Google CSV en/es)
  let nameIdx = ht.findIndex(h =>
    h === "Name" || h === "Nombre" || h === "Full Name" || h === "Nombre completo"
  );

  // Strategy B: split name columns (Outlook CSV / some Google exports)
  // Build full name from: First Name + Middle Name + Last Name (or Spanish equivalents)
  const firstIdx  = ht.findIndex(h => /^(First\s*Name|Nombre\s*de\s*pila|Given\s*Name)$/i.test(h));
  const middleIdx = ht.findIndex(h => /^(Middle\s*Name|Segundo\s*nombre|Additional\s*Name)$/i.test(h));
  const lastIdx   = ht.findIndex(h => /^(Last\s*Name|Apellidos?|Family\s*Name|Surname)$/i.test(h));

  const useSplitName = nameIdx === -1 && (firstIdx !== -1 || lastIdx !== -1);

  if (nameIdx === -1 && !useSplitName) {
    const sample = ht.slice(0, 6).join(", ");
    throw new Error(`Formato de CSV no reconocido. Columnas encontradas: ${sample}. Asegúrate de exportar desde contacts.google.com en formato "Google CSV".`);
  }

  // Find all phone value columns — English or Spanish
  const phoneIdxsFinal = ht
    .map((h, i) => ({ h, i }))
    .filter(({ h }) =>
      /^Phone\s+\d+\s*-\s*Value$/i.test(h) ||
      /^Tel[eé]fono\s+\d+\s*-\s*Valor$/i.test(h) ||
      /^Phone\s*Value$/i.test(h)
    )
    .map(({ i }) => i);

  const contacts: GoogleContact[] = [];
  for (let l = 1; l < lines.length; l++) {
    const line = lines[l].trim();
    if (!line) continue;
    const cols = parseCSVRow(lines[l]);

    let name: string;
    if (useSplitName) {
      const parts = [
        firstIdx  !== -1 ? (cols[firstIdx]  ?? "").trim() : "",
        middleIdx !== -1 ? (cols[middleIdx] ?? "").trim() : "",
        lastIdx   !== -1 ? (cols[lastIdx]   ?? "").trim() : "",
      ].filter(p => p.length > 0);
      name = parts.join(" ");
    } else {
      name = cols[nameIdx]?.trim() ?? "";
    }

    if (!name) continue;
    const phones = phoneIdxsFinal
      .map(i => (cols[i] ?? "").trim().replace(/\s/g, ""))
      .filter(p => p.length >= 7);
    contacts.push({ name, phones });
  }
  return contacts;
}

// ── Name Matching ────────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchScore(studentName: string, contactName: string): number {
  const sn = normalizeName(studentName);
  const cn = normalizeName(contactName);
  if (sn === cn) return 100;
  const sWords = sn.split(" ").filter(w => w.length > 1);
  const cWords = cn.split(" ").filter(w => w.length > 1);
  if (sWords.length === 0 || cWords.length === 0) return 0;
  const sInC = sWords.filter(w => cWords.includes(w)).length;
  const cInS = cWords.filter(w => sWords.includes(w)).length;
  const overlap = Math.max(sInC, cInS);
  if (overlap === 0) return 0;
  return Math.round((overlap / Math.max(sWords.length, cWords.length)) * 100);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /google-contacts/status
googleContactsRouter.get("/status", async (_req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const configured = Boolean(clientId && clientSecret);
  try {
    const [row] = await db.select().from(oauthTokensTable)
      .where(eq(oauthTokensTable.provider, "google-contacts"));
    res.json({
      configured,
      connected: Boolean(row),
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (e: any) {
    res.json({ configured, connected: false, updatedAt: null });
  }
});

// GET /google-contacts/auth — start OAuth flow
googleContactsRouter.get("/auth", (_req, res) => {
  const oauth2 = getOAuth2Client();
  if (!oauth2) {
    return res.status(503).json({
      error: "Google credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    });
  }
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/contacts"],
  });
  res.redirect(url);
});

// GET /google-contacts/callback — OAuth callback
googleContactsRouter.get("/callback", async (req, res) => {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return res.status(503).send("Google not configured");
  const { code, error } = req.query as { code?: string; error?: string };
  if (error || !code) {
    return res.status(400).send(`OAuth error: ${error ?? "no code"}`);
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    await db
      .insert(oauthTokensTable)
      .values({
        provider: "google-contacts",
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope ?? null,
      })
      .onConflictDoUpdate({
        target: oauthTokensTable.provider,
        set: {
          accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          scope: tokens.scope ?? null,
          updatedAt: new Date(),
        },
      });
    // Redirect back to admin panel
    const domain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
    const adminUrl = domain
      ? `https://${domain}/admin/students?google=connected`
      : `/admin/students?google=connected`;
    res.redirect(adminUrl);
  } catch (e: any) {
    res.status(500).send(`Error storing token: ${e.message}`);
  }
});

// DELETE /google-contacts/disconnect
googleContactsRouter.delete("/disconnect", async (_req, res) => {
  try {
    await db.delete(oauthTokensTable)
      .where(eq(oauthTokensTable.provider, "google-contacts"));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /google-contacts/parse-csv — preview matches from Google Contacts CSV
googleContactsRouter.post(
  "/parse-csv",
  (req, _res, next) => express.text({ type: "*/*", limit: "20mb" })(req, _res, next),
  async (req, res) => {
  try {
    const raw = req.body;
    const csvText: string = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
    const contacts = parseGoogleContactsCsv(csvText);
    const students = await db.select().from(studentsTable);

    const results: Array<{
      contactName: string;
      phone: string;
      studentId: number | null;
      studentName: string | null;
      studentCode: string | null;
      currentPhone: string | null;
      isPendiente: boolean;
      score: number;
    }> = [];

    for (const contact of contacts) {
      if (!contact.phones.length) continue;
      const phone = normalizePhone(contact.phones[0]);
      if (phone.length < 7) continue;

      let bestStudent = null;
      let bestScore = 0;
      for (const s of students) {
        const score = matchScore(s.nombre, contact.name);
        if (score > bestScore && score >= 60) {
          bestScore = score;
          bestStudent = s;
        }
      }

      results.push({
        contactName: contact.name,
        phone,
        studentId: bestStudent?.id ?? null,
        studentName: bestStudent?.nombre ?? null,
        studentCode: bestStudent?.codigoAlumno ?? null,
        currentPhone: bestStudent?.telefono ?? null,
        isPendiente: (bestStudent?.telefono ?? "").startsWith("PENDIENTE-"),
        score: bestScore,
      });
    }

    const matched = results.filter(r => r.studentId !== null);
    res.json({
      totalContacts: contacts.length,
      withPhone: results.length,
      matched: matched.length,
      unmatched: results.filter(r => r.studentId === null).length,
      results,
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /google-contacts/apply-csv — apply phone updates
googleContactsRouter.post("/apply-csv", async (req, res) => {
  try {
    const { matches }: { matches: Array<{ studentId: number; phone: string }> } = req.body;
    if (!Array.isArray(matches)) return res.status(400).json({ error: "matches must be an array" });

    let updated = 0;
    const errors: string[] = [];
    for (const m of matches) {
      try {
        await db.update(studentsTable)
          .set({ telefono: m.phone })
          .where(eq(studentsTable.id, m.studentId));
        updated++;
      } catch (e: any) {
        errors.push(`ID ${m.studentId}: ${e.message}`);
      }
    }
    res.json({ updated, errors });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ── Exported helper: add a student to Google Contacts ────────────────────────

export async function addStudentToGoogleContacts(
  nombre: string,
  telefono: string,
  email?: string | null,
): Promise<void> {
  const oauth2 = await getAuthedClient();
  if (!oauth2) return;
  try {
    const people = google.people({ version: "v1", auth: oauth2 });
    const body: any = {
      names: [{ displayName: nombre }],
      phoneNumbers: [{ value: telefono, type: "mobile" }],
    };
    if (email) body.emailAddresses = [{ value: email }];
    await people.people.createContact({ requestBody: body });
  } catch (_) {}
}

export default googleContactsRouter;
