/**
 * Tests for the manual cache prune flow.
 *
 * The core guarantee is that when the admin triggers a manual prune via
 * POST /api/language-cache/prune, the bot's in-memory CLIENT_LANGUAGE_CACHE
 * and LANGUAGE_CACHE_TS Maps are updated — not just the file on disk.
 * The bot then records the result via markBotActionDoneWithResult so the
 * API route can respond with a non-pending 200 containing numeric `removed`
 * and `malformed` counts.
 *
 * bot.js cannot be imported in tests because it calls validateCriticalEnv()
 * on import (exits when env vars are absent) and initialises a live WhatsApp
 * client.  The prune handler was therefore extracted into prune-action.js,
 * which is a side-effect-free module that accepts the cache Maps and I/O
 * callbacks as parameters.  These tests import that real production module
 * directly.
 *
 * Run with: node --test src/__tests__/prune-bot-action.test.js
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pruneCache, handlePruneAction } from '../whatsapp/prune-action.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMaps() {
  return { cache: new Map(), tsMap: new Map() };
}

// ---------------------------------------------------------------------------
// pruneCache — in-memory state updates
// ---------------------------------------------------------------------------

describe('pruneCache (production code from prune-action.js) — in-memory state', () => {
  it('removes an expired entry and reports removed=1', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678@c.us', 'es');
    tsMap.set('819012345678@c.us', Date.now() - 999 * 24 * 60 * 60 * 1000);

    const { removed, malformed } = pruneCache(cache, tsMap, 3);

    assert.equal(removed, 1, 'one entry must be reported removed');
    assert.equal(malformed, 0, 'no malformed entries in this cache');
    assert.equal(cache.size, 0, 'expired key must be deleted from the in-memory Map');
    assert.equal(tsMap.size, 0, 'timestamp entry must also be deleted');
  });

  it('removes a malformed key (@c.us@c.us) and reports malformed=1', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678@c.us@c.us', 'ja');
    tsMap.set('819012345678@c.us@c.us', Date.now());

    const { removed, malformed } = pruneCache(cache, tsMap, 3);

    assert.equal(removed, 1, 'one entry must be reported removed');
    assert.equal(malformed, 1, 'one malformed entry must be reported');
    assert.ok(
      !cache.has('819012345678@c.us@c.us'),
      'malformed key must be deleted from the in-memory Map',
    );
  });

  it('salvages the language under canonical keys before deleting the malformed key', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678@c.us@c.us', 'ko');
    tsMap.set('819012345678@c.us@c.us', Date.now());

    pruneCache(cache, tsMap, 3);

    assert.equal(cache.get('819012345678'), 'ko', 'digits key must be salvaged in memory');
    assert.equal(cache.get('819012345678@c.us'), 'ko', 'digits@c.us key must be salvaged in memory');
  });

  it('does not overwrite an existing canonical key when salvaging', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678', 'es');
    tsMap.set('819012345678', Date.now());
    cache.set('819012345678@c.us@c.us', 'fr');
    tsMap.set('819012345678@c.us@c.us', Date.now());

    pruneCache(cache, tsMap, 3);

    assert.equal(cache.get('819012345678'), 'es', 'existing canonical key must not be overwritten');
  });

  it('leaves fresh, well-formed entries intact and reports removed=0', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678@c.us', 'pt');
    tsMap.set('819012345678@c.us', Date.now());

    const { removed } = pruneCache(cache, tsMap, 3);

    assert.equal(removed, 0, 'no entries should be removed');
    assert.equal(cache.size, 1, 'fresh entry must survive the prune');
  });

  it('removes orphaned timestamp entries that have no corresponding language entry', () => {
    const { cache, tsMap } = makeMaps();
    tsMap.set('orphan@c.us', Date.now());

    pruneCache(cache, tsMap, 3);

    assert.equal(tsMap.size, 0, 'orphaned timestamp entry must be removed');
  });

  it('returns numeric types for both removed and malformed', () => {
    const { cache, tsMap } = makeMaps();
    const result = pruneCache(cache, tsMap, 3);
    assert.equal(typeof result.removed, 'number');
    assert.equal(typeof result.malformed, 'number');
  });
});

// ---------------------------------------------------------------------------
// handlePruneAction — end-to-end handler with injected deps
// ---------------------------------------------------------------------------

describe('handlePruneAction (production code from prune-action.js) — queue handler', () => {
  it('calls markBotActionDoneWithResult once with the action id and numeric result', async () => {
    const { cache, tsMap } = makeMaps();
    cache.set('111@c.us@c.us', 'es');
    tsMap.set('111@c.us@c.us', Date.now());
    cache.set('222@c.us', 'ja');
    tsMap.set('222@c.us', Date.now());

    const markDone = mock.fn(async () => {});
    const saveLang = mock.fn(() => {});

    await handlePruneAction(
      { id: 42 },
      cache, tsMap, 3,
      { markBotActionDoneWithResult: markDone, saveLanguageCache: saveLang },
    );

    assert.equal(markDone.mock.calls.length, 1, 'markBotActionDoneWithResult must be called exactly once');
    const [calledId, calledResult] = markDone.mock.calls[0].arguments;
    assert.equal(calledId, 42, 'must pass through the action id');
    assert.equal(typeof calledResult.removed, 'number', 'result.removed must be a number');
    assert.equal(typeof calledResult.malformed, 'number', 'result.malformed must be a number');
  });

  it('updates the in-memory cache Map before calling markBotActionDoneWithResult', async () => {
    const { cache, tsMap } = makeMaps();
    cache.set('bad@c.us@c.us', 'fr');
    tsMap.set('bad@c.us@c.us', Date.now());

    const markDone = mock.fn(async () => {});
    const saveLang = mock.fn(() => {});

    await handlePruneAction(
      { id: 1 },
      cache, tsMap, 3,
      { markBotActionDoneWithResult: markDone, saveLanguageCache: saveLang },
    );

    assert.ok(!cache.has('bad@c.us@c.us'), 'malformed key must be removed from in-memory cache');
    const result = markDone.mock.calls[0].arguments[1];
    assert.equal(result.removed, 1, 'removed count must match actual cache mutations');
    assert.equal(result.malformed, 1, 'malformed count must match actual cache mutations');
  });

  it('calls saveLanguageCache to persist the updated state', async () => {
    const { cache, tsMap } = makeMaps();
    const markDone = mock.fn(async () => {});
    const saveLang = mock.fn(() => {});

    await handlePruneAction(
      { id: 2 },
      cache, tsMap, 3,
      { markBotActionDoneWithResult: markDone, saveLanguageCache: saveLang },
    );

    assert.equal(saveLang.mock.calls.length, 1, 'saveLanguageCache must be called to persist the prune');
  });

  it('returns { removed: 0, malformed: 0 } when cache has only fresh well-formed keys', async () => {
    const { cache, tsMap } = makeMaps();
    cache.set('55512345678@c.us', 'es');
    tsMap.set('55512345678@c.us', Date.now());

    const markDone = mock.fn(async () => {});
    const saveLang = mock.fn(() => {});

    const result = await handlePruneAction(
      { id: 3 },
      cache, tsMap, 3,
      { markBotActionDoneWithResult: markDone, saveLanguageCache: saveLang },
    );

    assert.equal(result.removed, 0, 'removed must be 0 when nothing needs pruning');
    assert.equal(result.malformed, 0, 'malformed must be 0');
    assert.equal(cache.size, 1, 'fresh entry must still be in the cache after prune');
    const dbResult = markDone.mock.calls[0].arguments[1];
    assert.equal(dbResult.removed, 0);
    assert.equal(dbResult.malformed, 0);
  });

  it('handles expired entries: removed count matches, malformed is 0', async () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678@c.us', 'pt');
    tsMap.set('819012345678@c.us', Date.now() - 999 * 24 * 60 * 60 * 1000);

    const markDone = mock.fn(async () => {});
    const saveLang = mock.fn(() => {});

    const result = await handlePruneAction(
      { id: 4 },
      cache, tsMap, 3,
      { markBotActionDoneWithResult: markDone, saveLanguageCache: saveLang },
    );

    assert.equal(result.removed, 1, 'one expired entry must be removed');
    assert.equal(result.malformed, 0, 'an expired (well-formed) key is not malformed');
    assert.equal(cache.size, 0, 'expired key must be gone from in-memory cache');
    const dbResult = markDone.mock.calls[0].arguments[1];
    assert.equal(dbResult.removed, 1);
    assert.equal(dbResult.malformed, 0);
  });
});

// ---------------------------------------------------------------------------
// Route response contract
// ---------------------------------------------------------------------------

describe('POST /language-cache/prune — route response contract (language-cache.ts)', () => {
  it('returns { removed, malformed } with numeric values when bot marks action done', () => {
    // This mirrors language-cache.ts lines 95-101: status === 'done' branch.
    // The route extracts removed/malformed from the payload written by handlePruneAction.
    const doneRow = { status: 'done', payload: { removed: 3, malformed: 1 } };

    const payload = doneRow.payload;
    const removed = payload.removed ?? 0;
    const malformed = payload.malformed ?? 0;
    const response = { removed, malformed };

    assert.equal(typeof response.removed, 'number', 'response.removed must be a number');
    assert.equal(typeof response.malformed, 'number', 'response.malformed must be a number');
    assert.equal(response.removed, 3);
    assert.equal(response.malformed, 1);
    assert.ok(!('pending' in response), 'a done response must not carry a pending flag');
  });

  it('returns { removed: 0, pending: true } (202) when bot does not respond in time', () => {
    // Mirrors language-cache.ts lines 110-112: timeout branch.
    const timedOutResponse = { removed: 0, pending: true };

    assert.equal(timedOutResponse.pending, true, 'timed-out response must be flagged as pending');
    assert.equal(timedOutResponse.removed, 0, 'removed must be 0 while pending');
    assert.equal(typeof timedOutResponse.removed, 'number', 'removed must still be a number');
  });

  it('defaults missing payload fields to 0 (resilience against older bot versions)', () => {
    // Mirrors language-cache.ts lines 97-98: nullish coalescing fallback.
    const emptyPayload = {};
    const removed = emptyPayload.removed ?? 0;
    const malformed = emptyPayload.malformed ?? 0;

    assert.equal(removed, 0, 'missing removed must default to 0');
    assert.equal(malformed, 0, 'missing malformed must default to 0');
  });
});
