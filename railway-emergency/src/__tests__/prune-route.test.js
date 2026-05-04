/**
 * HTTP integration tests for the prune route's core enqueue-and-poll logic.
 *
 * These tests import the real production module `language-cache-prune.js`,
 * mount it on a real Express HTTP server with stub DB dependencies, make
 * actual fetch() calls, and assert the HTTP response.
 *
 * This approach is necessary because:
 *  - language-cache.ts imports @workspace/db at module level (directory import
 *    that Node.js ESM cannot resolve in a test context without a build step).
 *  - mock.module() is not available in this Node.js build's node:test.
 *  - The prune polling logic is extracted into the JS helper so it can be
 *    tested without any of those constraints.
 *
 * Run with: node --test src/__tests__/prune-route.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { enqueuePruneAndWait } from '../routes/language-cache-prune.js';

// ---------------------------------------------------------------------------
// Fake drizzle column stub.
// drizzle's eq() calls getSQL on its first argument; this minimal stub is
// sufficient because the mocked where() ignores the resulting SQL object.
// ---------------------------------------------------------------------------
const fakeCol = (name) => ({ name, getSQL: () => name });

// ---------------------------------------------------------------------------
// Stub DB builder helpers
// ---------------------------------------------------------------------------

function makeDb({ selectRows }) {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 99 }],
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => selectRows(),
      }),
    }),
  };
}

const fakeBotActionQueueTable = {
  id:      fakeCol('id'),
  status:  fakeCol('status'),
  type:    fakeCol('type'),
  payload: fakeCol('payload'),
};

// eq must be the real drizzle eq so the SQL expression is constructed properly.
// But because the mocked where() ignores its argument, any eq-like function works.
const fakeEq = (_col, _val) => ({ sql: 'fake eq' });

// ---------------------------------------------------------------------------
// Helper: build a minimal Express app that exposes POST /language-cache/prune
// using the real enqueuePruneAndWait with the given db stub.
// ---------------------------------------------------------------------------

async function buildTestServer({ selectRows }) {
  const app = express();
  const db = makeDb({ selectRows });

  app.post('/language-cache/prune', async (req, res) => {
    const result = await enqueuePruneAndWait(db, fakeBotActionQueueTable, fakeEq);
    if (result.status === 'done') {
      res.json({ removed: result.removed, malformed: result.malformed });
    } else if (result.status === 'failed') {
      res.status(500).json({ error: 'Prune action failed in bot' });
    } else {
      res.status(202).json({ removed: 0, pending: true });
    }
  });

  const server = createServer(app);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  return { server, port };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /language-cache/prune — HTTP integration (real enqueuePruneAndWait)', () => {
  describe('when bot marks the action done', () => {
    let server;
    let port;

    before(async () => {
      ({ server, port } = await buildTestServer({
        selectRows: () => [{ status: 'done', payload: { removed: 2, malformed: 1 } }],
      }));
    });

    after(() => server?.close());

    it('returns HTTP 200 (not 202 pending)', async () => {
      const res = await fetch(
        `http://localhost:${port}/language-cache/prune`,
        { method: 'POST' },
      );
      assert.equal(res.status, 200, 'must return HTTP 200 when action is done');
    });

    it('response body has numeric removed and malformed fields', async () => {
      const res = await fetch(
        `http://localhost:${port}/language-cache/prune`,
        { method: 'POST' },
      );
      const body = await res.json();
      assert.equal(typeof body.removed, 'number', 'response.removed must be a number');
      assert.equal(typeof body.malformed, 'number', 'response.malformed must be a number');
    });

    it('response body does NOT carry pending:true', async () => {
      const res = await fetch(
        `http://localhost:${port}/language-cache/prune`,
        { method: 'POST' },
      );
      const body = await res.json();
      assert.ok(!body.pending, 'done response must not include pending:true');
    });

    it('response body contains the exact values from the bot action payload', async () => {
      const res = await fetch(
        `http://localhost:${port}/language-cache/prune`,
        { method: 'POST' },
      );
      const body = await res.json();
      assert.equal(body.removed, 2, 'removed must match the bot payload');
      assert.equal(body.malformed, 1, 'malformed must match the bot payload');
    });
  });

  describe('when bot does not process in time (pending)', () => {
    let server;
    let port;

    before(async () => {
      // Select always returns a non-done status; combined with a very short
      // timeout so the test runs fast.
      const db = {
        insert: () => ({
          values: () => ({ returning: async () => [{ id: 100 }] }),
        }),
        select: () => ({
          from: () => ({
            where: async () => [{ status: 'pending', payload: {} }],
          }),
        }),
      };

      const app = express();
      app.post('/language-cache/prune', async (_req, res) => {
        // timeout: 600 ms — just long enough for one 500 ms poll, then expires.
        const result = await enqueuePruneAndWait(db, fakeBotActionQueueTable, fakeEq, { timeout: 600 });
        if (result.status === 'done') {
          res.json({ removed: result.removed, malformed: result.malformed });
        } else {
          res.status(202).json({ removed: 0, pending: true });
        }
      });

      server = createServer(app);
      server.listen(0);
      await once(server, 'listening');
      port = server.address().port;
    });

    after(() => server?.close());

    it('returns HTTP 202', async () => {
      const res = await fetch(
        `http://localhost:${port}/language-cache/prune`,
        { method: 'POST' },
      );
      assert.equal(res.status, 202, 'must return HTTP 202 when bot times out');
    });

    it('response body has pending:true and removed:0', async () => {
      const res = await fetch(
        `http://localhost:${port}/language-cache/prune`,
        { method: 'POST' },
      );
      const body = await res.json();
      assert.equal(body.pending, true, 'response must carry pending:true');
      assert.equal(body.removed, 0);
      assert.equal(typeof body.removed, 'number');
    });
  });
});
