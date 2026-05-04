/**
 * Core prune-action enqueue-and-poll logic extracted from language-cache.ts.
 *
 * Accepting `db` and `botActionQueueTable` as parameters makes this function
 * testable without module mocking: tests pass a stub DB object.
 *
 * language-cache.ts calls this function with the real drizzle db and table.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase<any>} db
 * @param {any} botActionQueueTable  - drizzle table (or stub with same shape)
 * @param {import('drizzle-orm').SQL} eq                 - drizzle eq helper
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<
 *   | { status: 'done',    removed: number; malformed: number }
 *   | { status: 'failed' }
 *   | { status: 'pending' }
 * >}
 */
export async function enqueuePruneAndWait(db, botActionQueueTable, eq, options = {}) {
  const timeout = options.timeout ?? 12_000;

  const [action] = await db
    .insert(botActionQueueTable)
    .values({ type: 'prune_language_cache', payload: {} })
    .returning({ id: botActionQueueTable.id });

  if (!action) return { status: 'failed' };

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const [row] = await db
      .select({
        status: botActionQueueTable.status,
        payload: botActionQueueTable.payload,
      })
      .from(botActionQueueTable)
      .where(eq(botActionQueueTable.id, action.id));

    if (row?.status === 'done') {
      const payload = row.payload ?? {};
      return {
        status: 'done',
        removed:  payload.removed  ?? 0,
        malformed: payload.malformed ?? 0,
      };
    }
    if (row?.status === 'failed') {
      return { status: 'failed' };
    }
  }

  return { status: 'pending' };
}
