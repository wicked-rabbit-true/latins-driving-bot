import { Router } from "express";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { db, pool, botActionQueueTable, languageCachePruneLogTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
// @ts-ignore — pure JS helper, no type declaration needed
import { enqueuePruneAndWait } from "./language-cache-prune.js";

const router = Router();

pool.query(`
  CREATE TABLE IF NOT EXISTS language_cache_prune_log (
    id        SERIAL PRIMARY KEY,
    pruned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    removed   INTEGER NOT NULL,
    malformed INTEGER NOT NULL
  )
`).catch((e: Error) => {
  console.error("⚠️ Could not ensure language_cache_prune_log table:", e.message);
});

const LANGUAGE_CACHE_FILE = join(
  process.cwd(),
  "src/whatsapp/language_cache.json"
);
const LANGUAGE_CACHE_PRUNE_STATE_FILE = "/tmp/language-cache-prune-state.json";

function getCacheEntries(): [string, string][] {
  if (!existsSync(LANGUAGE_CACHE_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(LANGUAGE_CACHE_FILE, "utf8"));
    let entries: [string, unknown][] = [];
    if (Array.isArray(raw)) entries = raw as [string, unknown][];
    else if (Array.isArray(raw.entries)) entries = raw.entries as [string, unknown][];
    return entries.filter((e): e is [string, string] => typeof e[1] === "string");
  } catch {
    return [];
  }
}

function getCacheStats(): { entryCount: number; uniqueUserCount: number; groupCount: number; byLanguage: Record<string, number>; byLanguageGroups: Record<string, number> } {
  const entries = getCacheEntries();
  // entryCount reflects entries with a valid string language value; malformed
  // entries (non-string values) are excluded from all stats.
  const userLanguage = new Map<string, string>();
  const byLanguageGroups: Record<string, number> = {};
  for (const [key, lang] of entries) {
    const suffix = key.split("@")[1] ?? "";
    const prefix = key.split("@")[0];
    if (suffix === "g.us") {
      // Group chat entries — count separately, not in uniqueUserCount/byLanguage.
      byLanguageGroups[lang] = (byLanguageGroups[lang] ?? 0) + 1;
    } else if (/^\d+$/.test(prefix) && !userLanguage.has(prefix)) {
      // Only count numeric prefixes (phone numbers); skip lids.
      // When the same prefix appears more than once (e.g. @c.us and @lid variants),
      // the first occurrence wins — language values for the same user are expected
      // to be consistent across key suffixes.
      userLanguage.set(prefix, lang);
    }
  }
  const byLanguage: Record<string, number> = {};
  for (const lang of userLanguage.values()) {
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
  }
  const groupCount = Object.values(byLanguageGroups).reduce((s, n) => s + n, 0);
  return { entryCount: entries.length, uniqueUserCount: userLanguage.size, groupCount, byLanguage, byLanguageGroups };
}

function getPruneState(): { lastPruneAt: string | null; lastPruneMalformed: number | null } {
  if (!existsSync(LANGUAGE_CACHE_PRUNE_STATE_FILE)) return { lastPruneAt: null, lastPruneMalformed: null };
  try {
    const raw = JSON.parse(readFileSync(LANGUAGE_CACHE_PRUNE_STATE_FILE, "utf8"));
    return {
      lastPruneAt: raw.lastPruneAt ?? null,
      lastPruneMalformed: typeof raw.lastPruneMalformed === "number" ? raw.lastPruneMalformed : null,
    };
  } catch {
    return { lastPruneAt: null, lastPruneMalformed: null };
  }
}

router.get("/language-cache/stats", (_req, res) => {
  const { entryCount, uniqueUserCount, groupCount, byLanguage, byLanguageGroups } = getCacheStats();
  const { lastPruneAt, lastPruneMalformed } = getPruneState();
  res.json({ entryCount, uniqueUserCount, groupCount, byLanguage, byLanguageGroups, lastPruneAt, lastPruneMalformed });
});

router.post("/language-cache/prune", async (req, res) => {
  const result = await enqueuePruneAndWait(db, botActionQueueTable, eq);

  if (result.status === "done") {
    req.log.info({ removed: result.removed, malformed: result.malformed }, "Language cache pruned by bot");
    res.json({ removed: result.removed, malformed: result.malformed });
    return;
  }
  if (result.status === "failed") {
    req.log.warn("Bot prune action failed");
    res.status(500).json({ error: "Prune action failed in bot" });
    return;
  }
  // Pending — bot not running, action stays queued for next startup.
  req.log.warn("Prune action timed out waiting for bot");
  res.status(202).json({ removed: 0, pending: true });
});

router.get("/language-cache/prune-status", async (_req, res) => {
  const pendingRows = await db
    .select({ id: botActionQueueTable.id })
    .from(botActionQueueTable)
    .where(
      and(
        eq(botActionQueueTable.type, "prune_language_cache"),
        eq(botActionQueueTable.status, "pending")
      )
    )
    .limit(1);

  if (pendingRows.length > 0) {
    res.json({ pending: true, lastStatus: null });
    return;
  }

  const lastRows = await db
    .select({ status: botActionQueueTable.status })
    .from(botActionQueueTable)
    .where(eq(botActionQueueTable.type, "prune_language_cache"))
    .orderBy(desc(botActionQueueTable.id))
    .limit(1);

  const lastStatus = lastRows[0]?.status ?? null;
  res.json({ pending: false, lastStatus });
});

router.get("/language-cache/prune-history", async (_req, res) => {
  const rows = await db
    .select()
    .from(languageCachePruneLogTable)
    .orderBy(desc(languageCachePruneLogTable.prunedAt))
    .limit(50);
  res.json(rows.map(r => ({
    id: r.id,
    prunedAt: r.prunedAt,
    removed: r.removed,
    malformed: r.malformed,
  })));
});

export default router;
