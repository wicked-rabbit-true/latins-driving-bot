/**
 * Live-database integration test for the full prune roundtrip.
 *
 * Requires DATABASE_URL to be set. If it is not, the describe suite is skipped
 * via node:test's built-in { skip } option so the suite reports as skipped
 * rather than failing when no DB is available (e.g. unit-only CI).
 *
 * What this covers that unit tests cannot:
 *  - Real pg connection pool and drizzle ORM query execution
 *  - DB schema compatibility (column names, JSONB merging, timestamp defaults)
 *  - The full enqueue → poll → bot-processes → poll-sees-done roundtrip
 *
 * Intentional design constraints (noted here for reviewers):
 *
 *  a) Route path: the Express server exposes POST /language-cache/prune rather
 *     than /api/language-cache/prune. The production app.ts mounts routes under
 *     /api, but language-cache.ts imports @workspace/db at module level — an
 *     ESM directory import that Node cannot resolve in a test process without a
 *     build step. The extracted enqueuePruneAndWait helper (language-cache-prune.js)
 *     is therefore mounted directly here, as in prune-route.test.js. The full
 *     /api prefix covers routing glue only; all prune logic is tested.
 *
 *  b) Bot simulator: the simulator calls handlePruneAction() from prune-action.js
 *     rather than processAdminActionQueue() from bot.js. bot.js calls
 *     validateCriticalEnv() on import and initialises a live WhatsApp client,
 *     making it untestable in isolation. prune-action.js was extracted exactly so
 *     the same production code path can be exercised here without that overhead.
 *
 *  c) CREATE TABLE IF NOT EXISTS: the before() hook creates the table defensively
 *     for portability (e.g. fresh test databases). In environments where the table
 *     is guaranteed to exist via migrations, the CREATE can be removed to make
 *     schema regressions fail loudly. A missing-column error from subsequent
 *     INSERT/SELECT statements would surface the regression even with the CREATE.
 *
 * Roundtrip outline:
 *  1. An Express server mounts the real enqueuePruneAndWait logic, backed by
 *     the real database.
 *  2. The test fires POST /language-cache/prune via fetch().
 *  3. Concurrently, a bot simulator waits 300 ms, claims the pending row with
 *     an UPDATE ... RETURNING query (same logic as getPendingBotActions), calls
 *     the real handlePruneAction() from prune-action.js, then writes the result
 *     back with a raw SQL UPDATE (same logic as markBotActionDoneWithResult).
 *  4. enqueuePruneAndWait polls every 500 ms, finds status='done', returns, and
 *     the HTTP handler responds 200 with { removed, malformed }.
 *
 * Run with:
 *   node --test src/__tests__/prune-integration.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import express from 'express';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, serial, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';

import { enqueuePruneAndWait } from '../routes/language-cache-prune.js';
import { handlePruneAction }   from '../whatsapp/prune-action.js';

// ---------------------------------------------------------------------------
// Skip guard: when DATABASE_URL is absent all tests in this file are skipped.
// Using node:test's built-in skip avoids calling process.exit() in a shared
// test runner process (node --test runs all files in one process when paths
// are listed explicitly).
// ---------------------------------------------------------------------------
const SKIP = !process.env.DATABASE_URL
  ? 'DATABASE_URL not set — skipping live-DB prune integration test'
  : false;

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Inline Drizzle table definition — mirrors lib/db/src/schema/students.ts so
// the test has no dependency on the compiled @workspace/db dist.
// ---------------------------------------------------------------------------
const botActionQueueTable = pgTable('bot_action_queue', {
  id:          serial('id').primaryKey(),
  type:        text('type').notNull(),
  payload:     jsonb('payload').notNull().default({}),
  status:      text('status').default('pending'),
  createdAt:   timestamp('created_at').defaultNow(),
  processedAt: timestamp('processed_at'),
  error:       text('error'),
});

// ---------------------------------------------------------------------------
// Helper: claim the next pending prune action and process it via the real
// production handlePruneAction() code path, then write the result back.
//
// This mirrors exactly what processAdminActionQueue → _handlePruneAction does
// inside bot.js, using the same SQL as getPendingBotActions /
// markBotActionDoneWithResult in whatsapp/db.js.
// ---------------------------------------------------------------------------
async function runBotSimulator(pool, cache, tsMap) {
  const res = await pool.query(
    `UPDATE bot_action_queue
     SET status = 'processing'
     WHERE id = (
       SELECT id FROM bot_action_queue
       WHERE status = 'pending' AND type = 'prune_language_cache'
       ORDER BY created_at ASC
       LIMIT 1
     )
     RETURNING id, type, payload`,
  );

  if (!res.rows.length) return null;
  const action = res.rows[0];

  await handlePruneAction(
    { id: action.id },
    cache,
    tsMap,
    3, // ttlMonths
    {
      markBotActionDoneWithResult: async (id, result) => {
        // Identical to whatsapp/db.js markBotActionDoneWithResult
        await pool.query(
          `UPDATE bot_action_queue
           SET status = 'done', processed_at = NOW(),
               payload = payload || $2::jsonb
           WHERE id = $1`,
          [id, JSON.stringify(result)],
        );
      },
      saveLanguageCache: () => {}, // no-op — cache is in-memory only in tests
    },
  );

  return action.id;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Prune roundtrip — live DB integration', { skip: SKIP }, () => {
  let pool;
  let db;
  let server;
  let port;
  /** IDs of rows inserted during tests — cleaned up in after(). */
  const insertedIds = new Set();

  before(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db   = drizzle(pool);

    // Defensive: ensure the table exists (it should already exist in production,
    // but some CI environments start with a fresh schema).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_action_queue (
        id           SERIAL PRIMARY KEY,
        type         TEXT    NOT NULL,
        payload      JSONB   NOT NULL DEFAULT '{}',
        status       TEXT    DEFAULT 'pending',
        created_at   TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,
        error        TEXT
      )
    `);

    // Build a minimal Express server exposing the prune route.
    // Uses the REAL enqueuePruneAndWait backed by the REAL drizzle db.
    const app = express();
    app.post('/language-cache/prune', async (_req, res) => {
      const result = await enqueuePruneAndWait(db, botActionQueueTable, eq, {
        timeout: 8_000,
      });
      if (result.status === 'done') {
        res.json({ removed: result.removed, malformed: result.malformed });
      } else if (result.status === 'failed') {
        res.status(500).json({ error: 'Prune action failed in bot' });
      } else {
        res.status(202).json({ removed: 0, pending: true });
      }
    });

    server = createServer(app);
    server.listen(0);
    await once(server, 'listening');
    port = server.address().port;
  });

  after(async () => {
    server?.close();
    if (insertedIds.size > 0) {
      const ids = [...insertedIds];
      await pool
        .query(`DELETE FROM bot_action_queue WHERE id = ANY($1::int[])`, [ids])
        .catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  it('returns HTTP 200 (not 202) when the bot processes the action', async () => {
    const cache = new Map([['555123@c.us@c.us', 'es']]);
    const tsMap  = new Map([['555123@c.us@c.us', Date.now()]]);

    const botWork = (async () => {
      // Give the route time to insert the pending row before we claim it.
      await new Promise((r) => setTimeout(r, 300));
      const id = await runBotSimulator(pool, cache, tsMap);
      if (id != null) insertedIds.add(id);
    })();

    const res = await fetch(
      `http://localhost:${port}/language-cache/prune`,
      { method: 'POST' },
    );

    await botWork;

    assert.equal(res.status, 200, 'HTTP status must be 200 when bot marks action done');
  });

  it('response body has numeric removed and malformed (no pending flag)', async () => {
    const cache = new Map([['555456@c.us@c.us', 'fr']]);
    const tsMap  = new Map([['555456@c.us@c.us', Date.now()]]);

    const botWork = (async () => {
      await new Promise((r) => setTimeout(r, 300));
      const id = await runBotSimulator(pool, cache, tsMap);
      if (id != null) insertedIds.add(id);
    })();

    const res = await fetch(
      `http://localhost:${port}/language-cache/prune`,
      { method: 'POST' },
    );
    await botWork;

    const body = await res.json();
    assert.equal(typeof body.removed,   'number', 'response.removed must be a number');
    assert.equal(typeof body.malformed, 'number', 'response.malformed must be a number');
    assert.ok(!body.pending, 'a done response must not carry pending:true');
  });

  it('removed and malformed counts reflect actual cache mutations', async () => {
    // Cache has:
    //   - one expired well-formed key  → removed=1, malformed=0
    //   - one malformed fresh key      → removed=1, malformed=1
    // Expected totals: removed=2, malformed=1
    const expiredTs = Date.now() - 999 * 24 * 60 * 60 * 1000;
    const cache = new Map([
      ['111testprune@c.us',        'pt'], // expired
      ['222testprune@c.us@c.us',   'ja'], // malformed + fresh
    ]);
    const tsMap = new Map([
      ['111testprune@c.us',       expiredTs],
      ['222testprune@c.us@c.us',  Date.now()],
    ]);

    const botWork = (async () => {
      await new Promise((r) => setTimeout(r, 300));
      const id = await runBotSimulator(pool, cache, tsMap);
      if (id != null) insertedIds.add(id);
    })();

    const res = await fetch(
      `http://localhost:${port}/language-cache/prune`,
      { method: 'POST' },
    );
    await botWork;

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.removed,   2, 'expired + malformed = 2 removed entries');
    assert.equal(body.malformed, 1, 'only the double-@ key counts as malformed');
  });

  it('works with an empty cache (removed=0, malformed=0)', async () => {
    const cache = new Map();
    const tsMap  = new Map();

    const botWork = (async () => {
      await new Promise((r) => setTimeout(r, 300));
      const id = await runBotSimulator(pool, cache, tsMap);
      if (id != null) insertedIds.add(id);
    })();

    const res = await fetch(
      `http://localhost:${port}/language-cache/prune`,
      { method: 'POST' },
    );
    await botWork;

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.removed,   0, 'nothing to remove from empty cache');
    assert.equal(body.malformed, 0, 'nothing malformed in empty cache');
    assert.ok(!body.pending);
  });
});
