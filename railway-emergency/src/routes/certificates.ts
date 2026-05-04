import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import PizZip from "pizzip";
import { readFileSync } from "fs";
import { join } from "path";
// @ts-ignore — JS module without types
import { uploadDocumentToOneDrive } from "../whatsapp/onedrive.js";

const certificatesRouter = Router();

const TEMPLATE_PATH = join(process.cwd(), "src/templates/certificado_template_original.docx");
const ONEDRIVE_FOLDER = "Latin_Driving_Bot/Certificados";
const CODIGO_SEED = 2519;

// ── Auto-assign next KM code if student has none ────────────────────────────
function isTochigi(codigoPostal: string | null, direccion: string | null): boolean {
  if (codigoPostal && codigoPostal.replace(/[^0-9]/g, "").startsWith("32")) return true;
  if (direccion && direccion.includes("栃木")) return true;
  return false;
}

async function assignCodigoAlumno(
  studentId: number,
  codigoPostal: string | null,
  direccion: string | null,
): Promise<string> {
  let code: string;

  if (isTochigi(codigoPostal, direccion)) {
    const result = await db.execute(
      sql`SELECT MAX(CAST((REGEXP_MATCH(codigo_alumno, '^KM([0-9]+)$'))[1] AS INTEGER)) AS max_num
          FROM students WHERE codigo_alumno ~ '^KM[0-9]+$'`
    ) as any;
    const rows = Array.isArray(result) ? result : (result?.rows ?? []);
    const maxNum = rows[0]?.max_num ?? null;
    const num =
      maxNum !== null && !isNaN(parseInt(String(maxNum), 10))
        ? parseInt(String(maxNum), 10)
        : CODIGO_SEED;
    code = `KM${num}T`;
  } else {
    const result = await db.execute(
      sql`SELECT MAX(CAST((REGEXP_MATCH(codigo_alumno, '^KM([0-9]+)'))[1] AS INTEGER)) AS max_num
          FROM students WHERE codigo_alumno ~ '^KM[0-9]+'`
    ) as any;
    const rows = Array.isArray(result) ? result : (result?.rows ?? []);
    const maxNum = rows[0]?.max_num ?? null;
    const nextNum =
      maxNum !== null && !isNaN(parseInt(String(maxNum), 10))
        ? parseInt(String(maxNum), 10) + 1
        : CODIGO_SEED + 1;
    code = `KM${nextNum}`;
  }

  await db.update(studentsTable).set({ codigoAlumno: code }).where(eq(studentsTable.id, studentId));
  console.log(`🔢 Código KM asignado automáticamente: ${code} → alumno ID ${studentId}`);
  return code;
}

// ── School addresses per prefecture ────────────────────────────────────────
const SCHOOL_ADDRESSES: Record<string, string> = {
  tochigi:  "                        所     在    地    栃木県小山市城北６－１－１松本ビル１０１号",
  saitama:  "                        所     在    地    埼玉県鴻巣市本町７-６-２小川ビル２Ｆ",
  kanagawa: "                        所     在    地    神奈川県厚木市妻田東２丁目１４－１０　ハイツエリ１Ｆ事務所",
  tokyo:    "                        所     在    地    東京都品川区東大井３－２８－８神谷店舗１階１号室",
};
const DEFAULT_PREFECTURE = "tochigi";

// ── Helpers ────────────────────────────────────────────────────────────────

function toFullWidth(str: string): string {
  return str.replace(/[A-Za-z0-9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return String.fromCharCode(code + 0xff10 - 48);
    if (code >= 65 && code <= 90) return String.fromCharCode(code + 0xff21 - 65);
    if (code >= 97 && code <= 122) return String.fromCharCode(code + 0xff41 - 97);
    return ch;
  });
}

function toJpEra(date: Date): { era: string; year: number; month: number; day: number } {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (y > 2019 || (y === 2019 && m >= 5)) return { era: "令和", year: y - 2018, month: m, day: d };
  if (y > 1989 || (y === 1989 && (m > 1 || d >= 8))) return { era: "平成", year: y - 1988, month: m, day: d };
  return { era: "昭和", year: y - 1925, month: m, day: d };
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function makeRun(text: string): string {
  return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
}

/**
 * Returns the full-width string for n, left-padded with ideographic spaces so
 * that (spaces + digits) always occupies exactly `slots` full-width characters.
 * This keeps date columns aligned regardless of 1- vs 2-digit numbers.
 */
function padNum(n: number, slots: number): string {
  const s = toFullWidth(String(n));
  return "\u3000".repeat(Math.max(0, slots - s.length)) + s;
}

/** Replace all runs in a paragraph while keeping its <w:pPr> intact */
function replaceParagraphContent(paraXml: string, newText: string): string {
  const pTagMatch = paraXml.match(/^<w:p[^>]*>/);
  const pTag = pTagMatch ? pTagMatch[0] : "<w:p>";
  const pPrMatch = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : "";
  return `${pTag}${pPr}${makeRun(newText)}</w:p>`;
}

/** Get all <w:t> text concatenated from a paragraph */
function paraText(paraXml: string): string {
  return [...paraXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => m[1])
    .join("");
}

// ── License type → full certificate line ──────────────────────────────────

function licenseLine(tipo: string | null): string {
  const t = (tipo ?? "").toUpperCase();
  // 準中型 / 3-ton / JC / "3 Toneladas"
  if (
    t.includes("JC") ||
    t.includes("3TON") ||
    t.includes("TONELADA") ||
    t.includes("3 T") ||
    t.includes("JUNCHU") ||
    t.includes("準中型") ||
    t.includes("SEMI") ||
    t.includes("仮免") ||
    t.startsWith("3")
  ) {
    return `\u3000\u3000準中型車\u3000仮免許 に 係る教習 の 課程 の 教習 を 受けているものであ`;
  }
  // MT / manual
  if (t.includes("MT") || t.includes("マニュアル")) {
    return `\u3000\u3000普 通 一 種 MT免許 に 係る教習 の 課程 の 教習 を 受けているものであ`;
  }
  // AT (default)
  return `\u3000\u3000普 通 一 種 AT免許 に 係る教習 の 課程 の 教習 を 受けているものであ`;
}

// ── Main certificate generator ────────────────────────────────────────────

export async function generateCertificateDocx(studentId: number): Promise<{
  buffer: Buffer;
  fileName: string;
  oneDriveUrl: string | null;
}> {
  // 1. Load student data
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId));
  if (!student) throw new Error(`Alumno ID ${studentId} no encontrado`);

  // Auto-assign KM code if the student doesn't have one (ensures uniqueness + sequence)
  if (!student.codigoAlumno) {
    student.codigoAlumno = await assignCodigoAlumno(
      student.id,
      student.codigoPostal ?? null,
      student.direccion ?? null,
    );
  }

  // 2. Read template
  const templateBuf = readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(templateBuf);
  let xml = zip.file("word/document.xml")!.asText();

  // 3. Parse all paragraphs and build a modified version
  const paras: string[] = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let match: RegExpExecArray | null;
  while ((match = paraRegex.exec(xml)) !== null) {
    paras.push(match[0]);
  }

  // Date calculations
  const today = new Date();
  const issueDate = toJpEra(today);
  // Use fechaInscripcion for the start date in the certificate; fall back to today
  const startDate = student.fechaInscripcion
    ? toJpEra(new Date(student.fechaInscripcion as unknown as string))
    : student.internadoFechaInicio
    ? toJpEra(new Date(student.internadoFechaInicio as unknown as string))
    : issueDate;
  const birthDate = student.fechaNacimiento
    ? toJpEra(new Date(student.fechaNacimiento as unknown as string))
    : null;

  // KM code → full-width
  const kmCode = student.codigoAlumno
    ? toFullWidth(student.codigoAlumno.replace(/^KM/i, "ＫＭ").replace(/\d+/, (n) => toFullWidth(n)))
    : "ＫＭ？？？？";

  // License line text (full replacement)
  const licLine = licenseLine(student.tipoLicencia ?? null);

  const newParas = paras.map((para) => {
    const txt = paraText(para);

    // P0: KM number  → 第　ＫＭ????　号
    if (/第.{0,4}ＫＭ/.test(txt) || /第.{0,4}KM/.test(txt)) {
      return replaceParagraphContent(para, `第\u3000${kmCode}\u3000号   `);
    }

    // P5: Address → 住所　　<address>
    // Convert ASCII digits to full-width Japanese numerals (e.g. 13 → １３)
    if (/住.{0,6}所/.test(txt) && /[都道府県]/.test(txt)) {
      const rawAddr = student.direccion ?? "（住所未登録）";
      const addr = rawAddr.replace(/[0-9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xFF10 - 48));
      return replaceParagraphContent(para, `      住      所\u3000\u3000${addr}`);
    }

    // P8: Name → 氏名　　<NAME>
    if (/氏.{0,6}名/.test(txt) && txt.length > 10) {
      const nombre = (student.nombre ?? "").toUpperCase();
      return replaceParagraphContent(para, `      氏      名        ${nombre}`);
    }

    // P11: Birth date → 平成/昭和/令和　X年　Y月　Z日生
    // Slot sizes keep total width fixed: year=6, month=7, day=7 full-width chars
    if (/日生/.test(txt)) {
      if (!birthDate) {
        return replaceParagraphContent(para, "\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000（生年月日未登録）");
      }
      const { era, year, month, day } = birthDate;
      return replaceParagraphContent(
        para,
        `\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000${era}${padNum(year, 6)}年${padNum(month, 7)}月${padNum(day, 7)}日生`
      );
    }

    // P14: Start date line → 上記の者は　令和X年Y月Z日から 当所において
    // Slot sizes: year=3, month=4, day=3
    if (/上記の者は/.test(txt)) {
      const { era, year, month, day } = startDate;
      return replaceParagraphContent(
        para,
        `\u3000\u3000上記の者は\u3000\u3000\u3000\u3000${era}${padNum(year, 3)}年${padNum(month, 4)}月${padNum(day, 3)}日から 当所において`
      );
    }

    // License line: 普通一種 AT/MT免許 OR 準中型車　仮免許
    if (/普\s*通\s*一\s*種|準中型/.test(txt)) {
      return replaceParagraphContent(para, licLine);
    }

    // P19: Issue date → 令和X年Y月Z日
    // Slot sizes: year=4, month=5, day=3
    if (/令和|平成|昭和/.test(txt) && /年.{0,8}月.{0,8}日$/.test(txt.trim()) && !/から/.test(txt)) {
      const { era, year, month, day } = issueDate;
      return replaceParagraphContent(
        para,
        `\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000${era}${padNum(year, 4)}年${padNum(month, 5)}月${padNum(day, 3)}日`
      );
    }

    // School address → 所在地 (varies by prefecture)
    if (/所\s*在\s*地/.test(txt)) {
      const pref = (student.prefectura ?? DEFAULT_PREFECTURE).toLowerCase();
      const addr = SCHOOL_ADDRESSES[pref] ?? SCHOOL_ADDRESSES[DEFAULT_PREFECTURE];
      return replaceParagraphContent(para, addr);
    }

    return para;
  });

  // 4. Rebuild XML: replace all paragraphs in-order
  let i = 0;
  const modifiedXml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, () => newParas[i++] ?? "");

  zip.file("word/document.xml", modifiedXml);
  const buffer = Buffer.from(zip.generate({ type: "uint8array" }));

  // 5. Build filename
  const safeName = (student.nombre ?? "alumno").replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_").toUpperCase();
  const km = (student.codigoAlumno ?? "KM0000").replace(/\s/g, "");
  const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
  const fileName = `${km}_${safeName}_${dateStr}.docx`;

  // Prefecture subfolder: e.g. "tochigi" → "Tochigi"
  const rawPref = (student.prefectura ?? DEFAULT_PREFECTURE).trim().toLowerCase();
  const prefFolder = rawPref.charAt(0).toUpperCase() + rawPref.slice(1);

  // 6. Upload to OneDrive inside the prefecture subfolder
  let oneDriveUrl: string | null = null;
  try {
    oneDriveUrl = await uploadDocumentToOneDrive(
      `${ONEDRIVE_FOLDER}/${prefFolder}/${fileName}`,
      buffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  } catch (e: any) {
    console.error("Error uploading certificate to OneDrive:", e.message);
  }

  return { buffer, fileName, oneDriveUrl };
}

// ── Routes ────────────────────────────────────────────────────────────────

// POST /api/certificates/student/:id — generate and upload certificate
certificatesRouter.post("/student/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const { buffer, fileName, oneDriveUrl } = await generateCertificateDocx(id);

    res.json({
      ok: true,
      fileName,
      oneDriveUrl,
      size: buffer.length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/certificates/student/:id/download — download directly
certificatesRouter.get("/student/:id/download", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

    const { buffer, fileName } = await generateCertificateDocx(id);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default certificatesRouter;
