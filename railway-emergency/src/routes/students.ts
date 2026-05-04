import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable } from "@workspace/db";
import { eq, ilike, or, sql, max, and, inArray } from "drizzle-orm";
import { addStudentToGoogleContacts } from "./google-contacts.js";
import {
  CreateStudentBody,
  UpdateStudentBody,
  ListStudentsQueryParams,
  GetStudentParams,
  UpdateStudentParams,
  DeleteStudentParams,
  SyncStudentBookititParams,
} from "@workspace/api-zod";

const CODIGO_PREFIX = "KM";
const CODIGO_SEED   = 2519;

function isTochigi(codigoPostal?: string | null, direccion?: string | null): boolean {
  // Tochigi prefecture postal codes start with 32 (320xxxx–329xxxx)
  if (codigoPostal) {
    const digits = codigoPostal.replace(/[^0-9]/g, "");
    if (digits.startsWith("32")) return true;
  }
  // Fallback: address contains 栃木 (Tochigi in kanji)
  if (direccion && direccion.includes("栃木")) return true;
  return false;
}

async function nextCodigoAlumno(
  codigoPostal?: string | null,
  direccion?: string | null,
): Promise<string> {
  const tochigi = isTochigi(codigoPostal, direccion);

  if (tochigi) {
    // Tochigi: inherit the same number as the last non-Tochigi code (no increment).
    // Non-Tochigi codes end in a digit: '^KM[0-9]+$'
    const result = await db.execute(
      sql`SELECT MAX(CAST((REGEXP_MATCH(codigo_alumno, '^KM([0-9]+)$'))[1] AS INTEGER)) AS max_num
          FROM students
          WHERE codigo_alumno ~ '^KM[0-9]+$'`
    ) as any;
    const rows = Array.isArray(result) ? result : (result?.rows ?? []);
    const maxNum = rows[0]?.max_num ?? null;
    const num =
      maxNum !== null && !isNaN(parseInt(String(maxNum), 10))
        ? parseInt(String(maxNum), 10)
        : CODIGO_SEED;
    return `${CODIGO_PREFIX}${num}T`;
  } else {
    // Non-Tochigi: increment from the max numeric part across ALL codes (T and non-T).
    const result = await db.execute(
      sql`SELECT MAX(CAST((REGEXP_MATCH(codigo_alumno, '^KM([0-9]+)'))[1] AS INTEGER)) AS max_num
          FROM students
          WHERE codigo_alumno ~ '^KM[0-9]+'`
    ) as any;
    const rows = Array.isArray(result) ? result : (result?.rows ?? []);
    const maxNum = rows[0]?.max_num ?? null;
    let nextNum = CODIGO_SEED;
    if (maxNum !== null && !isNaN(parseInt(String(maxNum), 10))) {
      nextNum = parseInt(String(maxNum), 10) + 1;
    }
    return `${CODIGO_PREFIX}${nextNum}`;
  }
}

export const studentsRouter = Router();

// GET /students — list with optional search and language filter
studentsRouter.get("/", async (req, res) => {
  try {
    // Normalize lang: Express may parse a single ?lang=es as a string, not array
    const rawLang = req.query.lang;
    const normalizedQuery = {
      ...req.query,
      lang: rawLang === undefined
        ? undefined
        : Array.isArray(rawLang)
          ? rawLang
          : [rawLang],
    };
    const parsed = ListStudentsQueryParams.safeParse(normalizedQuery);
    const q    = parsed.success ? parsed.data.q    : undefined;
    const lang = parsed.success ? parsed.data.lang : undefined;
    // Explicit boolean parse: only treat the literal string "true" as the filter.
    // z.coerce.boolean() treats "false" as truthy, so we bypass it here.
    const tsuruoka = req.query.tsuruoka === "true";

    const searchCondition = q
      ? or(
          ilike(studentsTable.nombre,        `%${q}%`),
          ilike(studentsTable.telefono,      `%${q}%`),
          ilike(studentsTable.codigoAlumno,  `%${q}%`),
        )
      : undefined;
    const langs = lang && lang.length > 0 ? lang : undefined;
    const langCondition = langs
      ? langs.length === 1
        ? ilike(studentsTable.preferredLanguage, langs[0])
        : or(...langs.map(l => ilike(studentsTable.preferredLanguage, l)))
      : undefined;
    const tsuruokaCondition = tsuruoka
      ? eq(studentsTable.tsuruokaGraduado, true)
      : undefined;

    const conditions = [searchCondition, langCondition, tsuruokaCondition].filter(Boolean);
    const whereClause = conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...(conditions as Parameters<typeof and>));

    const rows = whereClause
      ? await db.select().from(studentsTable).where(whereClause).orderBy(studentsTable.nombre)
      : await db.select().from(studentsTable).orderBy(studentsTable.nombre);

    const students = rows.map((s) => ({
      ...s,
      montoRestante: (s.valorCurso ?? 0) - (s.montoPagado ?? 0),
    }));

    res.json(students);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /students/summary — stats
studentsRouter.get("/summary", async (_req, res) => {
  try {
    const rows = await db.select().from(studentsTable);
    const total = rows.length;
    const totalValor = rows.reduce((s, r) => s + (r.valorCurso ?? 0), 0);
    const totalPagado = rows.reduce((s, r) => s + (r.montoPagado ?? 0), 0);
    const totalRestante = totalValor - totalPagado;
    const sinBookitit = rows.filter((r) => !r.bookititId).length;
    res.json({ total, totalValor, totalPagado, totalRestante, sinBookitit });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /students/:id
studentsRouter.get("/:id", async (req, res) => {
  try {
    const { id } = GetStudentParams.parse({ id: Number(req.params.id) });
    const [row] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ...row, montoRestante: (row.valorCurso ?? 0) - (row.montoPagado ?? 0) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /students
studentsRouter.post("/", async (req, res) => {
  try {
    const body = CreateStudentBody.parse(req.body);
    const codigoAlumno = await nextCodigoAlumno(body.codigoPostal, body.direccion);
    const [created] = await db
      .insert(studentsTable)
      .values({
        codigoAlumno,
        nombre:               body.nombre,
        telefono:             body.telefono,
        email:                body.email ?? null,
        sexo:                 body.sexo ?? null,
        fechaNacimiento:      body.fechaNacimiento ?? null,
        direccion:            body.direccion ?? null,
        codigoPostal:         body.codigoPostal ?? null,
        tipoLicencia:         body.tipoLicencia ?? null,
        expiracionVisa:       body.expiracionVisa ?? null,
        valorCurso:           body.valorCurso ?? 0,
        montoPagado:          body.montoPagado ?? 0,
        notas:                body.notas ?? null,
        examen50Estado:       body.examen50Estado ?? 'pendiente',
        fechaInscripcion:     body.fechaInscripcion ? (body.fechaInscripcion instanceof Date ? body.fechaInscripcion.toISOString().split('T')[0] : body.fechaInscripcion) : null,
        prefectura:           body.prefectura ?? null,
        internadoFechaInicio: body.internadoFechaInicio ?? null,
        internadoFechaFin:    body.internadoFechaFin ?? null,
        examen100Estado:      body.examen100Estado ?? 'pendiente',
        examen100Departamento: body.examen100Departamento ?? null,
        pagoEstado:           body.pagoEstado ?? 'pendiente',
      })
      .returning();
    res.status(201).json({ ...created, montoRestante: (created.valorCurso ?? 0) - (created.montoPagado ?? 0) });
    // Auto-add to Google Contacts (non-blocking, best-effort)
    addStudentToGoogleContacts(created.nombre, created.telefono, created.email).catch(() => {});
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Phone number already registered" });
    res.status(400).json({ error: e.message });
  }
});

// PUT /students/:id
studentsRouter.put("/:id", async (req, res) => {
  try {
    const { id } = UpdateStudentParams.parse({ id: Number(req.params.id) });
    const body = UpdateStudentBody.parse(req.body);

    // Fetch previous state to detect exam50 approval (for iGiveTest auto-revoke)
    const [prev] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
    if (!prev) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(studentsTable)
      .set({
        nombre:               body.nombre,
        telefono:             body.telefono,
        email:                body.email ?? null,
        sexo:                 body.sexo ?? null,
        fechaNacimiento:      body.fechaNacimiento ?? null,
        direccion:            body.direccion ?? null,
        codigoPostal:         body.codigoPostal ?? null,
        tipoLicencia:         body.tipoLicencia ?? null,
        expiracionVisa:       body.expiracionVisa ?? null,
        valorCurso:           body.valorCurso ?? 0,
        montoPagado:          body.montoPagado ?? 0,
        notas:                body.notas ?? null,
        examen50Estado:       body.examen50Estado ?? prev.examen50Estado ?? 'pendiente',
        fechaInscripcion:     body.fechaInscripcion ? (body.fechaInscripcion instanceof Date ? body.fechaInscripcion.toISOString().split('T')[0] : body.fechaInscripcion) : null,
        prefectura:           body.prefectura ?? null,
        internadoFechaInicio: body.internadoFechaInicio ?? null,
        internadoFechaFin:    body.internadoFechaFin ?? null,
        examen100Estado:      body.examen100Estado ?? prev.examen100Estado ?? 'pendiente',
        examen100Departamento: body.examen100Departamento ?? prev.examen100Departamento ?? null,
        pagoEstado:           body.pagoEstado ?? prev.pagoEstado ?? 'pendiente',
        preferredLanguage:    body.preferredLanguage ?? null,
        updatedAt:            new Date(),
      })
      .where(eq(studentsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });

    // Auto-revoke iGiveTest when exam50 OR exam100 changes to 'aprobado'
    const exam50JustApproved  = body.examen50Estado  === 'aprobado' && prev.examen50Estado  !== 'aprobado';
    const exam100JustApproved = body.examen100Estado === 'aprobado' && prev.examen100Estado !== 'aprobado';
    if (exam50JustApproved || exam100JustApproved) {
      try {
        const { readFileSync, existsSync } = await import("fs");
        const { join } = await import("path");
        const { fileURLToPath } = await import("url");
        const __dirname = join(fileURLToPath(import.meta.url), "..", "..", "whatsapp");
        const igtFile = join(__dirname, "igivetest_access.json");
        if (existsSync(igtFile)) {
          const igtAccess = JSON.parse(readFileSync(igtFile, "utf8")) as Record<string, any>;
          const phone = updated.telefono.replace(/[^0-9]/g, "");
          const entry = igtAccess[phone];
          if (entry?.username) {
            const { disableIGiveTestAccess } = await import("../whatsapp/igivetest.js") as any;
            await disableIGiveTestAccess(entry.username);
            const reason = exam50JustApproved ? "exam50" : "exam100";
            req.log.info({ phone, username: entry.username, reason }, "iGiveTest auto-revoked after exam approval");
          }
        }
      } catch (igtErr: any) {
        req.log.warn({ err: igtErr.message }, "Could not auto-revoke iGiveTest (non-fatal)");
      }
    }

    res.json({ ...updated, montoRestante: (updated.valorCurso ?? 0) - (updated.montoPagado ?? 0) });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Phone number already registered" });
    res.status(400).json({ error: e.message });
  }
});

// ── KM code matching helpers ───────────────────────────────────────────────
// Loaded once per process from the static JSON generated from Carlos's Excel.
type KmEntry = { code: string; licencia: string | null };
type KmData  = {
  _meta?: { total: number; licencias: Record<string, number> };
  byName: Record<string, KmEntry>;
  byCode: Record<string, { name: string; licencia: string | null }>;
};

let _kmData: KmData | null = null;

async function loadKmCodes(): Promise<KmData> {
  if (_kmData) return _kmData;
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    // process.cwd() is the api-server root when started via pnpm run dev/start
    const raw = readFileSync(join(process.cwd(), "src/data/km-codes.json"), "utf8");
    _kmData = JSON.parse(raw);
  } catch {
    _kmData = { byName: {}, byCode: {} };
  }
  return _kmData!;
}

const KM_NOISE = /\b(tochigi|tokyo|osaka|kanagawa|saitama|junchu|futsu|at|mt|miguel|mujer|livro|classs?|kumagaya|gunma|gifu|verificar|jc|internado|clase)\b/gi;
const KM_DATE  = /\b\d{1,2}\/\d{1,2}\b/g;

function normalizeNameForKm(raw: string): string {
  return raw
    .replace(/[\/\[\]().,\-]/g, " ")
    .replace(KM_DATE, "")
    .replace(KM_NOISE, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter(w => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function findKmEntry(name: string, kmData: KmData): KmEntry | null {
  const normClient = normalizeNameForKm(name);
  if (!normClient) return null;

  // 1. Exact normalized match
  if (kmData.byName[normClient]) return kmData.byName[normClient];

  // 2. Word-set Jaccard similarity (threshold 0.55)
  const clientWords = new Set(normClient.split(" ").filter(w => w.length >= 2));
  if (clientWords.size === 0) return null;

  let bestEntry: KmEntry | null = null;
  let bestScore = 0;

  for (const [excelName, entry] of Object.entries(kmData.byName)) {
    const excelWords = new Set(excelName.split(" ").filter(w => w.length >= 2));
    const score = jaccard(clientWords, excelWords);
    if (score > bestScore && score >= 0.55) {
      bestScore = score;
      bestEntry = entry;
    }
  }
  return bestEntry;
}
// ──────────────────────────────────────────────────────────────────────────────

studentsRouter.post("/import-bookitit", async (req, res) => {
  try {
    const dryRun  = req.query.dryRun === "true";
    const daysBack = Number(req.query.daysBack) || 730;

    const { getUniqueClientsFromEvents } = await import("../whatsapp/bookitit.js") as any;
    const clients: Array<{ name: string; phone: string; obs: string }> = await getUniqueClientsFromEvents(daysBack);

    const kmData = await loadKmCodes();

    // Look up which phones already exist in the students table
    const existingRows = await db.execute(sql`SELECT telefono FROM students`) as any;
    const existingPhones = new Set<string>(
      (Array.isArray(existingRows) ? existingRows : (existingRows?.rows ?? []))
        .map((r: any) => String(r.telefono ?? "").replace(/\D/g, "").replace(/^0+/, ""))
    );

    const normPhone = (p: string) => String(p || "").replace(/\D/g, "").replace(/^0+/, "");

    // Enrich each client with matched KM code + license type
    const enriched = clients.map(c => {
      const entry = findKmEntry(c.name, kmData);
      return { ...c, kmCode: entry?.code ?? null, licencia: entry?.licencia ?? null };
    });

    const toImport = enriched.filter(c => !existingPhones.has(normPhone(c.phone)));
    const toSkip   = enriched.filter(c =>  existingPhones.has(normPhone(c.phone)));

    if (dryRun) {
      return res.json({
        dryRun: true,
        total: clients.length,
        toImport: toImport.length,
        toSkip: toSkip.length,
        kmMatched: toImport.filter(c => c.kmCode).length,
        clients: toImport,
      });
    }

    // Actual import
    let imported = 0;
    const errors: string[] = [];

    for (const client of toImport) {
      try {
        await db.insert(studentsTable).values({
          nombre:        client.name,
          telefono:      client.phone,
          notas:         client.obs || null,
          codigoAlumno:  client.kmCode ?? undefined,
          tipoLicencia:  client.licencia ?? undefined,
        });
        imported++;
      } catch (e: any) {
        errors.push(`${client.name} (${client.phone}): ${e.message}`);
      }
    }

    res.json({
      dryRun: false,
      total: clients.length,
      imported,
      skipped: toSkip.length,
      kmMatched: toImport.filter(c => c.kmCode).length,
      errors,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /students/import-excel
// Import students directly from the pre-parsed km-codes.json (Carlos's Excel).
// Creates one student per KM code, with a placeholder phone (PENDIENTE-KMxxxx)
// and the license type extracted from the Excel.
studentsRouter.post("/import-excel", async (req, res) => {
  try {
    const dryRun = req.query.dryRun === "true";
    const kmData = await loadKmCodes();

    // Get existing codes to deduplicate
    const existingRows = await db.execute(sql`SELECT codigo_alumno FROM students WHERE codigo_alumno IS NOT NULL`) as any;
    const existingCodes = new Set<string>(
      (Array.isArray(existingRows) ? existingRows : (existingRows?.rows ?? []))
        .map((r: any) => String(r.codigo_alumno ?? ""))
    );

    const allEntries = Object.entries(kmData.byCode).map(([code, val]) => ({
      code,
      name: val.name,
      licencia: val.licencia,
    }));

    const toImport = allEntries.filter(e => !existingCodes.has(e.code));
    const toSkip   = allEntries.filter(e =>  existingCodes.has(e.code));

    const byLicencia = {
      AT: toImport.filter(e => e.licencia === 'AT').length,
      MT: toImport.filter(e => e.licencia === 'MT').length,
      JC: toImport.filter(e => e.licencia === 'JC').length,
      sinLicencia: toImport.filter(e => !e.licencia).length,
    };

    if (dryRun) {
      return res.json({
        dryRun: true,
        total: allEntries.length,
        toImport: toImport.length,
        toSkip: toSkip.length,
        byLicencia,
        clients: toImport.slice(0, 100), // preview first 100
      });
    }

    let imported = 0;
    const errors: string[] = [];

    for (const entry of toImport) {
      try {
        await db.insert(studentsTable).values({
          nombre:       entry.name,
          telefono:     `PENDIENTE-${entry.code}`,
          codigoAlumno: entry.code,
          tipoLicencia: entry.licencia ?? undefined,
        });
        imported++;
      } catch (e: any) {
        errors.push(`${entry.code} ${entry.name}: ${e.message}`);
      }
    }

    res.json({
      dryRun: false,
      total: allEntries.length,
      imported,
      skipped: toSkip.length,
      byLicencia,
      errors,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /students/import-csv
// Import students from a Bookitit-exported CSV file.
// Body: raw CSV text (semicolon-delimited Bookitit format).
// Supports ?dryRun=true
studentsRouter.post(
  "/import-csv",
  (req, _res, next) => {
    // Accept raw CSV text body
    const express = require("express");
    express.text({ type: "*/*", limit: "20mb" })(req, _res, next);
  },
  async (req, res) => {
  try {
    const dryRun = req.query.dryRun === "true";

    let csvText: string = "";
    if (typeof req.body === "string") {
      csvText = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      csvText = req.body.toString("utf8");
    } else {
      return res.status(400).json({ error: "El cuerpo debe ser texto CSV" });
    }

    // Strip UTF-8 BOM if present
    csvText = csvText.replace(/^\uFEFF/, "");

    // Parse semicolon-delimited CSV with optional quoting
    function parseCSVRow(line: string): string[] {
      const fields: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ";" && !inQuotes) {
          fields.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
      fields.push(current.trim());
      return fields;
    }

    // Normalize local JP phone to international (digits only)
    function normalizePhone(raw: string): string | null {
      const digits = raw.replace(/\D/g, "");
      if (!digits || digits.length < 8) return null;
      // Local JP format: starts with 0 → remove leading 0, add 81
      if (digits.startsWith("0")) return "81" + digits.slice(1);
      // Already international with 81
      if (digits.startsWith("81")) return digits;
      // Fallback: keep as-is if long enough
      return digits.length >= 10 ? digits : null;
    }

    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: "CSV vacío o sin datos" });

    // Bookitit CSV columns (0-indexed):
    // 0=AccesoWeb, 1=UsuarioBloqueado, 2=Email, 3=País, 4=Móvil, 5=Nombre, 6=Descripción
    const rows = lines.slice(1); // skip header
    const parsed = rows
      .map((line) => {
        const cols = parseCSVRow(line);
        return {
          rawName:  (cols[5] ?? "").trim(),
          rawPhone: (cols[4] ?? "").trim(),
          obs:      (cols[6] ?? "").trim(),
        };
      })
      .filter((r) => r.rawName);

    const kmData = await loadKmCodes();

    // Existing phones in DB (normalized)
    const existingRows = (await db.execute(sql`SELECT telefono FROM students`)) as any;
    const normDb = (p: string) =>
      String(p ?? "")
        .replace(/\D/g, "")
        .replace(/^0+/, "");
    const existingPhones = new Set<string>(
      (Array.isArray(existingRows) ? existingRows : (existingRows?.rows ?? []))
        .map((r: any) => normDb(r.telefono))
        .filter(Boolean),
    );

    // Enrich each row
    const enriched = parsed.map((r) => {
      const phone = normalizePhone(r.rawPhone);
      const kmEntry = findKmEntry(r.rawName, kmData);
      return {
        name:     r.rawName,
        phone,
        obs:      r.obs,
        kmCode:   kmEntry?.code ?? null,
        licencia: kmEntry?.licencia ?? null,
      };
    });

    const withPhone    = enriched.filter((r) => r.phone);
    const withoutPhone = enriched.filter((r) => !r.phone);

    // Deduplicar dentro del propio CSV por teléfono normalizado (y por código KM si lo tiene)
    // para evitar violaciones de restricción UNIQUE en inserts consecutivos
    const seenPhones  = new Set<string>();
    const seenKmCodes = new Set<string>();
    type EnrichedRow = typeof withPhone[number];
    const dedupedWithPhone = withPhone.reduce<EnrichedRow[]>((acc, r) => {
      const normPhone = normDb(r.phone!);
      if (seenPhones.has(normPhone)) return acc; // teléfono duplicado → ignorar fila
      seenPhones.add(normPhone);
      // Si el código KM ya apareció antes, importar el alumno sin código para evitar UNIQUE
      if (r.kmCode && seenKmCodes.has(r.kmCode)) {
        acc.push({ ...r, kmCode: null, licencia: null });
      } else {
        if (r.kmCode) seenKmCodes.add(r.kmCode);
        acc.push(r);
      }
      return acc;
    }, []);

    const toImport     = dedupedWithPhone.filter((r) => !existingPhones.has(normDb(r.phone!)));
    const toSkip       = dedupedWithPhone.filter((r) =>  existingPhones.has(normDb(r.phone!)));

    const duplicatedInCsv = withPhone.length - dedupedWithPhone.length;

    if (dryRun) {
      return res.json({
        dryRun:      true,
        total:       enriched.length,
        withPhone:   withPhone.length,
        withoutPhone: withoutPhone.length,
        duplicated:  duplicatedInCsv,
        toImport:    toImport.length,
        toSkip:      toSkip.length,
        kmMatched:   toImport.filter((r) => r.kmCode).length,
        preview:     toImport.slice(0, 60),
      });
    }

    let imported = 0;
    const errors: string[] = [];
    for (const r of toImport) {
      try {
        await db.insert(studentsTable).values({
          nombre:       r.name,
          telefono:     r.phone!,
          notas:        r.obs || null,
          codigoAlumno: r.kmCode ?? undefined,
          tipoLicencia: r.licencia ?? undefined,
        });
        imported++;
      } catch (e: any) {
        errors.push(`${r.name} (${r.phone}): ${e.message}`);
      }
    }

    res.json({
      dryRun:      false,
      duplicated:  duplicatedInCsv,
      total:       enriched.length,
      imported,
      skipped:     toSkip.length,
      withoutPhone: withoutPhone.length,
      kmMatched:   toImport.filter((r) => r.kmCode).length,
      errors,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /students/:id
studentsRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = DeleteStudentParams.parse({ id: Number(req.params.id) });
    const [deleted] = await db.delete(studentsTable).where(eq(studentsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /students/:id/sync-bookitit
studentsRouter.post("/:id/sync-bookitit", async (req, res) => {
  try {
    const { id } = SyncStudentBookititParams.parse({ id: Number(req.params.id) });
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
    if (!student) return res.status(404).json({ error: "Not found" });

    // Call Bookitit API
    const { createClient } = await import("../whatsapp/bookitit.js");
    const result = await (createClient as any)({
      name:    student.nombre,
      phone:   student.telefono,
      email:   student.email ?? "",
      obs:     [student.tipoLicencia, student.notas].filter(Boolean).join(" | "),
      address: student.direccion ?? "",
    });

    const bookititId =
      result?.client_id ?? result?.id ?? result?.p_sClientID ?? null;

    if (bookititId) {
      await db
        .update(studentsTable)
        .set({ bookititId: String(bookititId), updatedAt: new Date() })
        .where(eq(studentsTable.id, id));
      return res.json({ success: true, bookititId: String(bookititId), message: "Synced to Bookitit" });
    }

    const errMsg = result?.error ?? result?.message ?? "Unknown Bookitit response";
    res.json({ success: false, bookititId: null, message: errMsg });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
