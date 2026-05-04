import { Router } from "express";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const router = Router();

const PENDIENTES_STATE_FILE = join(__dirname, "../whatsapp/pendientes_state.json");
const QUESTIONS_LOG_FILE    = join(__dirname, "../whatsapp/questions_log.json");

function readJson(path: string): any {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

router.get("/bot-pendientes", (_req, res) => {
  const state     = readJson(PENDIENTES_STATE_FILE);
  const questions = readJson(QUESTIONS_LOG_FILE) as any[] | null;

  const pendingQuestions = (questions ?? []).filter((q: any) => q.status === "pendiente");

  if (!state) {
    return res.json({
      updatedAt: null,
      consultarCount: pendingQuestions.length,
      manualModeCount: 0,
      pendingNameCount: 0,
      total: pendingQuestions.length,
      consultarPendientes: pendingQuestions.map((q: any) => ({
        id: q.id,
        phone: q.clientNumber,
        ts: new Date(q.timestamp).getTime(),
        question: (q.botQuestion ?? q.studentQuestion ?? "").substring(0, 200),
      })),
      manualModeChats: [],
      pendingNameAppts: [],
    });
  }

  const consultarCount = state.consultarPendientes?.length ?? 0;
  const manualModeCount = state.manualModeChats?.length ?? 0;
  const pendingNameCount = state.pendingNameAppts?.length ?? 0;

  res.json({
    updatedAt: state.updatedAt ?? null,
    consultarCount,
    manualModeCount,
    pendingNameCount,
    total: consultarCount + manualModeCount + pendingNameCount,
    consultarPendientes: state.consultarPendientes ?? [],
    manualModeChats: state.manualModeChats ?? [],
    pendingNameAppts: state.pendingNameAppts ?? [],
  });
});

export default router;
