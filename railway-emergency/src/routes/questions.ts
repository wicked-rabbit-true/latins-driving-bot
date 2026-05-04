import { Router } from "express";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const router = Router();

const QUESTIONS_LOG_FILE = join(__dirname, "../whatsapp/questions_log.json");

function readLog(): any[] {
  if (!existsSync(QUESTIONS_LOG_FILE)) return [];
  try {
    return JSON.parse(readFileSync(QUESTIONS_LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}

router.get("/bot-questions", (_req, res) => {
  const log = readLog();
  res.json(log.slice().reverse());
});

router.get("/bot-questions/export", (_req, res) => {
  const log = readLog();
  const lines: string[] = [
    "=== LOG DE PREGUNTAS AL BOT ===",
    `Generado: ${new Date().toLocaleString("es-JP", { timeZone: "Asia/Tokyo" })}`,
    `Total: ${log.length} preguntas`,
    "",
  ];

  for (const q of log.slice().reverse()) {
    const date = new Date(q.timestamp).toLocaleString("es-JP", { timeZone: "Asia/Tokyo" });
    const answeredDate = q.answeredAt
      ? new Date(q.answeredAt).toLocaleString("es-JP", { timeZone: "Asia/Tokyo" })
      : null;

    lines.push(`────────────────────────────────────`);
    lines.push(`ID: #${q.id}  |  Estado: ${q.status.toUpperCase()}  |  Fecha: ${date}`);
    lines.push(`Cliente: +${q.clientNumber}`);
    lines.push(`Pregunta del alumno:`);
    lines.push(`  ${q.studentQuestion}`);
    lines.push(`Pregunta que el bot envió a Carlos:`);
    lines.push(`  ${q.botQuestion}`);
    if (q.carlosAnswer) {
      lines.push(`Respuesta de Carlos (${answeredDate}):`);
      lines.push(`  ${q.carlosAnswer}`);
    } else {
      lines.push(`Respuesta de Carlos: (pendiente)`);
    }
    lines.push("");
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="preguntas_bot_${new Date().toISOString().slice(0, 10)}.txt"`
  );
  res.send(lines.join("\n"));
});

export default router;
