import { Router } from "express";
import pg from "pg";

const { Pool } = pg;
const router = Router();

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

router.get("/notifications", async (_req, res) => {
  const pool = getPool();
  if (!pool) return res.json([]);
  try {
    const result = await pool.query(
      `SELECT id, type, message, chat_id, student_name, leida, created_at
       FROM bot_notifications
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (e: any) {
    console.error("GET /notifications error:", e.message);
    res.json([]);
  } finally {
    pool.end();
  }
});

router.post("/notifications", async (req, res) => {
  const { type, message, chatId, studentName } = req.body ?? {};
  if (!type || !message) return res.status(400).json({ error: "type and message required" });
  const pool = getPool();
  if (!pool) return res.status(503).json({ error: "DB unavailable" });
  try {
    const result = await pool.query(
      `INSERT INTO bot_notifications (type, message, chat_id, student_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [type, message, chatId ?? null, studentName ?? null]
    );
    res.json(result.rows[0]);
  } catch (e: any) {
    console.error("POST /notifications error:", e.message);
    res.status(500).json({ error: e.message });
  } finally {
    pool.end();
  }
});

router.patch("/notifications/:id/read", async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error: "DB unavailable" });
  try {
    await pool.query(
      `UPDATE bot_notifications SET leida = true WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error("PATCH /notifications/:id/read error:", e.message);
    res.status(500).json({ error: e.message });
  } finally {
    pool.end();
  }
});

router.patch("/notifications/read-all", async (_req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error: "DB unavailable" });
  try {
    await pool.query(`UPDATE bot_notifications SET leida = true WHERE leida = false`);
    res.json({ ok: true });
  } catch (e: any) {
    console.error("PATCH /notifications/read-all error:", e.message);
    res.status(500).json({ error: e.message });
  } finally {
    pool.end();
  }
});

export default router;
