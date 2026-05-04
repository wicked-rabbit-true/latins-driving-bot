import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable, botActionQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// ── iGiveTest exam types (must match igivetest.js) ───────────────────────────
export const IGT_GROUPS: Record<string, string> = {
  'tochigi-karimen-1':  'Karimen Tochigi 1 (Practice)',
  'tochigi-karimen-2':  'Karimen Tochigi 2 (Practice 2024)',
  'honmen-chiba':       'Honmen Chiba',
  'tochigi-100':        'Tochigi 100-1 2022',
  'english-100-3':      '100 Questions English Number 3 (4C)',
  'illustrations-2025': 'Illustrations 2025',
};

// ── POST /students/:id/igivetest/create ─────────────────────────────────────
router.post("/:id/igivetest/create", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { examType, examType2 } = req.body as { examType: string; examType2?: string };

  if (!examType || !IGT_GROUPS[examType]) {
    res.status(400).json({ error: "examType inválido" });
    return;
  }

  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  if (!student) {
    res.status(404).json({ error: "Alumno no encontrado" });
    return;
  }

  try {
    // Dynamic import to avoid TypeScript issues with the JS module
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const igivetest: any = await import('../whatsapp/igivetest.js');

    const nameParts = student.nombre.trim().split(/\s+/);
    const firstName = nameParts[0] ?? student.nombre;
    const lastName  = nameParts.slice(1).join(' ') || firstName;

    const creds = await igivetest.createIGiveTestAccess({
      firstName,
      lastName,
      examType,
      examType2: examType2 || null,
    });

    // Store credentials in student record
    await db.update(studentsTable).set({
      igtUsername:  creds.username,
      igtPassword:  creds.password,
      igtExpiresAt: creds.expiresAt ? new Date(creds.expiresAt) : null,
      igtExamType:  examType,
      igtExamType2: examType2 || null,
      updatedAt:    new Date(),
    }).where(eq(studentsTable.id, id));

    // Queue WhatsApp message with credentials
    const phone = student.telefono.replace(/\D/g, '');
    await db.insert(botActionQueueTable).values({
      type: 'send_igivetest_creds',
      payload: {
        phone,
        username:          creds.username,
        password:          creds.password,
        examType,
        examType2:         examType2 || null,
        expiresAt:         creds.expiresAt,
        examLabel:         IGT_GROUPS[examType] + (examType2 ? ` + ${IGT_GROUPS[examType2]}` : ''),
        studentName:       student.nombre,
        preferredLanguage: student.preferredLanguage ?? null,
      },
    });

    const updatedStudent = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
    res.json({ success: true, student: updatedStudent[0], creds });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error({ err: e }, "Error creando acceso iGiveTest");
    res.status(500).json({ error: msg });
  }
});

// ── GET /students/:id/igivetest/report ──────────────────────────────────────
router.get("/:id/igivetest/report", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  if (!student) {
    res.status(404).json({ error: "Alumno no encontrado" });
    return;
  }
  if (!student.igtUsername) {
    res.status(400).json({ error: "Este alumno no tiene cuenta iGiveTest registrada" });
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const igivetest: any = await import('../whatsapp/igivetest.js');
    const report = await igivetest.igtGetUserReport(student.igtUsername);
    res.json(report);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error({ err: e }, "Error consultando reporte iGiveTest");
    res.status(500).json({ error: msg });
  }
});

// ── POST /students/:id/igivetest/disable ────────────────────────────────────
router.post("/:id/igivetest/disable", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  if (!student) {
    res.status(404).json({ error: "Alumno no encontrado" });
    return;
  }
  if (!student.igtUsername) {
    res.status(400).json({ error: "Este alumno no tiene acceso iGiveTest registrado" });
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const igivetest: any = await import('../whatsapp/igivetest.js');
    await igivetest.disableIGiveTestAccess(student.igtUsername);

    await db.update(studentsTable).set({
      igtUsername:  null,
      igtPassword:  null,
      igtExpiresAt: null,
      igtExamType:  null,
      igtExamType2: null,
      updatedAt:    new Date(),
    }).where(eq(studentsTable.id, id));

    const updatedStudent = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
    res.json({ success: true, student: updatedStudent[0] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error({ err: e }, "Error desactivando acceso iGiveTest");
    res.status(500).json({ error: msg });
  }
});

// ── POST /students/:id/send-material ────────────────────────────────────────
router.post("/:id/send-material", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { type } = req.body as { type: 'chiba' | 'tochigi' | 'saitama' };

  if (!['chiba', 'tochigi', 'saitama'].includes(type)) {
    res.status(400).json({ error: "type debe ser chiba, tochigi o saitama" });
    return;
  }

  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  if (!student) {
    res.status(404).json({ error: "Alumno no encontrado" });
    return;
  }

  const phone = student.telefono.replace(/\D/g, '');
  await db.insert(botActionQueueTable).values({
    type: 'send_material',
    payload: { phone, materialType: type, studentName: student.nombre, preferredLanguage: student.preferredLanguage ?? null },
  });

  res.json({ success: true, message: `Material ${type} en cola para ${student.nombre}` });
});

// ── POST /students/:id/confirmar ─────────────────────────────────────────────
router.post("/:id/confirmar", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { type, date, time } = req.body as { type: string; date: string; time: string };

  const validTypes = ['yamagata', '50konosu', '50tochigi', '100tochigi', '100konosu', '100chiba', 'kumagaya'];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `type inválido. Opciones: ${validTypes.join(', ')}` });
    return;
  }
  if (!date || !time) {
    res.status(400).json({ error: "date y time son requeridos" });
    return;
  }

  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, id));
  if (!student) {
    res.status(404).json({ error: "Alumno no encontrado" });
    return;
  }

  const phone = student.telefono.replace(/\D/g, '');
  await db.insert(botActionQueueTable).values({
    type: 'send_confirmar',
    payload: { phone, confirmarType: type, date, time, studentName: student.nombre, preferredLanguage: student.preferredLanguage ?? null },
  });

  res.json({ success: true, message: `Confirmación ${type} en cola para ${student.nombre} (${date} ${time})` });
});

export { router as botActionsRouter };
