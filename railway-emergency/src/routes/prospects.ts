import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable } from "@workspace/db";
import { loadProspectContacts } from "../whatsapp/db.js";

const router = Router();

router.get("/prospects/count", async (req, res) => {
  try {
    const [allContacts, students] = await Promise.all([
      loadProspectContacts(),
      db.select({ telefono: studentsTable.telefono }).from(studentsTable),
    ]);

    const studentPhones = new Set(
      students.map((s) => String(s.telefono).replace(/\D/g, "")).filter(Boolean)
    );

    const total = allContacts.filter(({ phone }) => !studentPhones.has(phone)).length;

    res.json({ total });
  } catch (err) {
    req.log.error(err, "Failed to count prospects");
    res.status(500).json({ error: "Failed to count prospects" });
  }
});

router.get("/prospects", async (req, res) => {
  const rawLang = req.query.lang;
  const langFilters: string[] = Array.isArray(rawLang)
    ? (rawLang as string[]).map((l) => l.toLowerCase()).filter(Boolean)
    : typeof rawLang === "string" && rawLang
      ? [rawLang.toLowerCase()]
      : [];
  const phoneQuery = typeof req.query.q === "string" ? req.query.q.replace(/\D/g, "") : null;

  try {
    const [allContacts, students] = await Promise.all([
      loadProspectContacts(),
      db.select({ telefono: studentsTable.telefono }).from(studentsTable),
    ]);

    // contact_languages always stores phone as digits-only (see saveContactLanguage).
    // Student phone numbers may include formatting characters (dashes, spaces, +81 prefix),
    // so we normalize to digits before comparing to avoid false "prospect" classification.
    const studentPhones = new Set(
      students.map((s) => String(s.telefono).replace(/\D/g, "")).filter(Boolean)
    );

    const nonStudents = allContacts.filter(({ phone }) => !studentPhones.has(phone));

    const byLanguage: Record<string, number> = {};
    for (const { lang } of nonStudents) {
      if (lang) byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
    }

    let prospects = langFilters.length > 0
      ? nonStudents.filter(({ lang }) => lang && langFilters.includes(lang.toLowerCase()))
      : nonStudents;

    if (phoneQuery) {
      prospects = prospects.filter(({ phone }) => phone.includes(phoneQuery));
    }

    res.json({
      total: prospects.length,
      byLanguage,
      prospects: prospects.map(({ phone, lang, updated_at }) => ({
        phone,
        lang,
        updatedAt: updated_at ?? null,
      })),
    });
  } catch (err) {
    req.log.error(err, "Failed to list prospects");
    res.status(500).json({ error: "Failed to list prospects" });
  }
});

export default router;
