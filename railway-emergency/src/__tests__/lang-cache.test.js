/**
 * Unit tests for lang-cache-utils.js
 *
 * Specifically guards against the double-suffix key bug (@c.us@c.us) that was
 * caused by the `/@\w+$/` → `/@.+$/` regex regression.  These tests would have
 * caught that bug immediately.
 *
 * Run with: node --test src/__tests__/lang-cache.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  setLangAllFormats,
  normalizeLanguageCache,
  removeMalformedKeys,
  pruneLanguageCache,
} from '../whatsapp/lang-cache-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMaps() {
  return { cache: new Map(), tsMap: new Map() };
}

// ---------------------------------------------------------------------------
// setLangAllFormats — @c.us-format chatId
// ---------------------------------------------------------------------------

describe('setLangAllFormats with @c.us chatId', () => {
  it('writes exactly two unique keys when chatId is digits@c.us (chatId and digits@c.us collapse to the same key)', () => {
    const { cache, tsMap } = makeMaps();
    setLangAllFormats(cache, tsMap, '819012345678@c.us', null, 'en');

    // chatId ('819012345678@c.us') and the digits@c.us variant are identical,
    // so the Map ends up with exactly 2 unique keys — not 3.
    const keys = [...cache.keys()].sort();
    assert.deepEqual(keys, [
      '819012345678',
      '819012345678@c.us',
    ].sort());
  });

  it('never writes a double-suffix key (@c.us@c.us)', () => {
    const { cache, tsMap } = makeMaps();
    setLangAllFormats(cache, tsMap, '819012345678@c.us', null, 'en');

    for (const key of cache.keys()) {
      assert.ok(
        !key.includes('@c.us@c.us'),
        `Cache must not contain a double-suffix key, but found: "${key}"`,
      );
      const atCount = (key.match(/@/g) || []).length;
      assert.ok(
        atCount <= 1,
        `Cache key "${key}" contains ${atCount} "@" signs — must be at most 1`,
      );
    }
  });

  it('sets the correct language for every written key', () => {
    const { cache, tsMap } = makeMaps();
    setLangAllFormats(cache, tsMap, '819012345678@c.us', null, 'es');

    for (const [key, lang] of cache) {
      assert.equal(lang, 'es', `Expected lang "es" for key "${key}", got "${lang}"`);
    }
  });

  it('writes timestamps for every cache key', () => {
    const { cache, tsMap } = makeMaps();
    const before = Date.now();
    setLangAllFormats(cache, tsMap, '819012345678@c.us', null, 'en');

    for (const key of cache.keys()) {
      const ts = tsMap.get(key);
      assert.ok(
        ts !== undefined,
        `Missing timestamp for key "${key}"`,
      );
      assert.ok(
        ts >= before,
        `Timestamp for "${key}" is in the past`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// setLangAllFormats — digits-only chatId (no suffix)
// ---------------------------------------------------------------------------

describe('setLangAllFormats with digits-only chatId', () => {
  it('writes exactly the two expected keys (digits and digits@c.us)', () => {
    const { cache, tsMap } = makeMaps();
    setLangAllFormats(cache, tsMap, '819012345678', null, 'ja');

    const keys = [...cache.keys()].sort();
    assert.deepEqual(keys, ['819012345678', '819012345678@c.us'].sort());
  });

  it('never writes a double-suffix key', () => {
    const { cache, tsMap } = makeMaps();
    setLangAllFormats(cache, tsMap, '819012345678', null, 'ja');

    for (const key of cache.keys()) {
      assert.ok(
        !key.includes('@c.us@c.us'),
        `Found double-suffix key: "${key}"`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// setLangAllFormats — with realPhone
// ---------------------------------------------------------------------------

describe('setLangAllFormats with realPhone', () => {
  it('includes realPhone variants without creating double-suffix keys', () => {
    const { cache, tsMap } = makeMaps();
    setLangAllFormats(cache, tsMap, '819012345678@c.us', '81-90-1234-5678', 'zh');

    for (const key of cache.keys()) {
      const atCount = (key.match(/@/g) || []).length;
      assert.ok(
        atCount <= 1,
        `Key "${key}" has ${atCount} "@" characters — should be ≤ 1`,
      );
    }
  });

  it('contains realPhone digits and realPhone@c.us', () => {
    const { cache, tsMap } = makeMaps();
    setLangAllFormats(cache, tsMap, '819012345678@c.us', '819087654321', 'pt');

    assert.ok(cache.has('819087654321'), 'Should contain realPhone digits key');
    assert.ok(cache.has('819087654321@c.us'), 'Should contain realPhone@c.us key');
  });
});

// ---------------------------------------------------------------------------
// normalizeLanguageCache — removes double-suffix keys
// ---------------------------------------------------------------------------

describe('normalizeLanguageCache removes double-suffix keys', () => {
  it('deletes a pre-existing @c.us@c.us key', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678@c.us@c.us', 'en');
    tsMap.set('819012345678@c.us@c.us', Date.now());

    const { malformed } = normalizeLanguageCache(cache, tsMap);

    assert.equal(malformed, 1, 'Should report 1 malformed key removed');
    assert.ok(
      !cache.has('819012345678@c.us@c.us'),
      'Double-suffix key must be deleted from cache',
    );
  });

  it('salvages the language under canonical keys before deleting the bad key', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678@c.us@c.us', 'fr');
    tsMap.set('819012345678@c.us@c.us', Date.now());

    normalizeLanguageCache(cache, tsMap);

    assert.equal(cache.get('819012345678'), 'fr', 'digits key should be salvaged');
    assert.equal(cache.get('819012345678@c.us'), 'fr', 'digits@c.us key should be salvaged');
  });

  it('does not overwrite an existing canonical key when salvaging', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('819012345678', 'es');                  // already exists
    tsMap.set('819012345678', Date.now());
    cache.set('819012345678@c.us@c.us', 'en');        // malformed
    tsMap.set('819012345678@c.us@c.us', Date.now());

    normalizeLanguageCache(cache, tsMap);

    assert.equal(cache.get('819012345678'), 'es', 'Existing canonical key must not be overwritten');
  });

  it('leaves no keys with more than one "@" after normalisation', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('111@c.us@c.us', 'de');
    cache.set('222@c.us@c.us', 'ko');
    cache.set('333@c.us', 'ja');   // well-formed, should survive
    tsMap.set('111@c.us@c.us', Date.now());
    tsMap.set('222@c.us@c.us', Date.now());
    tsMap.set('333@c.us', Date.now());

    normalizeLanguageCache(cache, tsMap);

    for (const key of cache.keys()) {
      const atCount = (key.match(/@/g) || []).length;
      assert.ok(
        atCount <= 1,
        `Key "${key}" still contains multiple "@" after normalisation`,
      );
    }
    assert.ok(cache.has('333@c.us'), 'Well-formed key must survive normalisation');
  });
});

// ---------------------------------------------------------------------------
// removeMalformedKeys — phase-0 only
// ---------------------------------------------------------------------------

describe('removeMalformedKeys', () => {
  it('returns the count of removed keys', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('111@c.us@c.us', 'en');
    cache.set('222@c.us@c.us', 'es');
    tsMap.set('111@c.us@c.us', Date.now());
    tsMap.set('222@c.us@c.us', Date.now());

    const count = removeMalformedKeys(cache, tsMap);
    assert.equal(count, 2);
  });

  it('removes the corresponding timestamp entry', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('111@c.us@c.us', 'en');
    tsMap.set('111@c.us@c.us', Date.now());

    removeMalformedKeys(cache, tsMap);

    assert.ok(!tsMap.has('111@c.us@c.us'), 'Timestamp for bad key must be removed');
  });

  it('does not touch well-formed keys', () => {
    const { cache, tsMap } = makeMaps();
    cache.set('111@c.us', 'en');
    cache.set('222', 'es');
    tsMap.set('111@c.us', Date.now());
    tsMap.set('222', Date.now());

    removeMalformedKeys(cache, tsMap);

    assert.ok(cache.has('111@c.us'), 'Well-formed @c.us key must survive');
    assert.ok(cache.has('222'), 'Digits-only key must survive');
  });
});

// ---------------------------------------------------------------------------
// pruneLanguageCache — helpers
// ---------------------------------------------------------------------------

const TTL = 6; // months — mirrors the production default

/** Return a timestamp that is definitely within the TTL window. */
function recentTs(now) {
  return now - 1 * 24 * 60 * 60 * 1000; // 1 day ago
}

/** Return a timestamp that is definitely outside the TTL window. */
function expiredTs(now) {
  return now - (TTL * 30 + 1) * 24 * 60 * 60 * 1000; // ttl + 1 day ago
}

// ---------------------------------------------------------------------------
// pruneLanguageCache — expired keys
// ---------------------------------------------------------------------------

describe('pruneLanguageCache removes expired keys', () => {
  it('removes a key whose timestamp is older than the TTL', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us', 'es');
    tsMap.set('819012345678@c.us', expiredTs(now));

    const { removed } = pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(removed, 1, 'Should report 1 removed entry');
    assert.ok(!cache.has('819012345678@c.us'), 'Expired key must be deleted');
  });

  it('removes the corresponding timestamp entry for an expired key', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678', 'en');
    tsMap.set('819012345678', expiredTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.ok(!tsMap.has('819012345678'), 'Timestamp for expired key must be removed');
  });

  it('removes multiple expired keys', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('111@c.us', 'de');
    cache.set('222@c.us', 'fr');
    tsMap.set('111@c.us', expiredTs(now));
    tsMap.set('222@c.us', expiredTs(now));

    const { removed } = pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(removed, 2, 'Should report 2 removed entries');
    assert.equal(cache.size, 0, 'Cache must be empty');
  });

  it('treats a missing timestamp as expired (defaults to 0)', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us', 'ja');

    const { removed } = pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(removed, 1, 'Entry with no timestamp must be treated as expired');
  });

  it('removes a key whose timestamp is one millisecond before the cutoff boundary', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    const cutoff = now - TTL * 30 * 24 * 60 * 60 * 1000;
    cache.set('819012345678@c.us', 'es');
    tsMap.set('819012345678@c.us', cutoff - 1); // one ms older than the cutoff

    const { removed } = pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(removed, 1, 'Key 1 ms older than cutoff must be removed');
    assert.ok(!cache.has('819012345678@c.us'), 'Key 1 ms older than cutoff must be deleted');
  });

  it('keeps a key whose timestamp is exactly at the cutoff boundary (strict less-than comparison)', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    const cutoff = now - TTL * 30 * 24 * 60 * 60 * 1000;
    cache.set('819012345678@c.us', 'pt');
    tsMap.set('819012345678@c.us', cutoff); // exactly at the cutoff — not strictly less-than

    const { removed } = pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(removed, 0, 'Key at exactly the cutoff must survive (ts < cutoff is false when ts === cutoff)');
    assert.ok(cache.has('819012345678@c.us'), 'Key at exactly the cutoff must not be deleted');
  });
});

// ---------------------------------------------------------------------------
// pruneLanguageCache — unexpired well-formed keys survive
// ---------------------------------------------------------------------------

describe('pruneLanguageCache keeps unexpired well-formed keys', () => {
  it('leaves a recently-set key untouched', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us', 'pt');
    tsMap.set('819012345678@c.us', recentTs(now));

    const { removed } = pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(removed, 0, 'No entries should be removed');
    assert.ok(cache.has('819012345678@c.us'), 'Recent key must survive');
  });

  it('keeps a digits-only key that is within TTL', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678', 'ko');
    tsMap.set('819012345678', recentTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.ok(cache.has('819012345678'), 'Digits-only key within TTL must survive');
  });

  it('returns removed=0 and malformed=0 when all entries are fresh and well-formed', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('111@c.us', 'en');
    cache.set('222@c.us', 'es');
    tsMap.set('111@c.us', recentTs(now));
    tsMap.set('222@c.us', recentTs(now));

    const result = pruneLanguageCache(cache, tsMap, TTL, now);

    assert.deepEqual(result, { removed: 0, malformed: 0 });
  });
});

// ---------------------------------------------------------------------------
// pruneLanguageCache — malformed keys are removed regardless of TTL
// ---------------------------------------------------------------------------

describe('pruneLanguageCache removes malformed keys even before TTL expiry', () => {
  it('removes a double-suffix key that is still within the TTL', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us@c.us', 'zh');
    tsMap.set('819012345678@c.us@c.us', recentTs(now));

    const { removed, malformed } = pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(malformed, 1, 'Should count 1 malformed key');
    assert.equal(removed, 1, 'Should count 1 removed entry');
    assert.ok(!cache.has('819012345678@c.us@c.us'), 'Malformed key must be deleted');
  });

  it('removes the malformed key timestamp too', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us@c.us', 'en');
    tsMap.set('819012345678@c.us@c.us', recentTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.ok(!tsMap.has('819012345678@c.us@c.us'), 'Timestamp for malformed key must be removed');
  });
});

// ---------------------------------------------------------------------------
// pruneLanguageCache — language salvage for malformed-but-live keys
// ---------------------------------------------------------------------------

describe('pruneLanguageCache salvages language before removing a malformed-but-live key', () => {
  it('creates the digits-only canonical key with the same language', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us@c.us', 'fr');
    tsMap.set('819012345678@c.us@c.us', recentTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(cache.get('819012345678'), 'fr', 'digits-only key should be salvaged with correct lang');
  });

  it('creates the digits@c.us canonical key with the same language', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us@c.us', 'fr');
    tsMap.set('819012345678@c.us@c.us', recentTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(cache.get('819012345678@c.us'), 'fr', 'digits@c.us key should be salvaged with correct lang');
  });

  it('preserves the original timestamp on the salvaged canonical keys', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    const originalTs = recentTs(now);
    cache.set('819012345678@c.us@c.us', 'de');
    tsMap.set('819012345678@c.us@c.us', originalTs);

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(tsMap.get('819012345678'), originalTs, 'digits-only key should inherit original timestamp');
    assert.equal(tsMap.get('819012345678@c.us'), originalTs, 'digits@c.us key should inherit original timestamp');
  });

  it('does not overwrite an existing canonical key when salvaging', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678', 'es');
    tsMap.set('819012345678', recentTs(now));
    cache.set('819012345678@c.us@c.us', 'en');
    tsMap.set('819012345678@c.us@c.us', recentTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.equal(cache.get('819012345678'), 'es', 'Existing canonical key must not be overwritten');
  });

  it('does not salvage when a malformed key is also expired', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us@c.us', 'ja');
    tsMap.set('819012345678@c.us@c.us', expiredTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.ok(!cache.has('819012345678'), 'Expired malformed key must not be salvaged');
    assert.ok(!cache.has('819012345678@c.us'), 'Expired malformed key must not be salvaged to @c.us');
  });
});

// ---------------------------------------------------------------------------
// pruneLanguageCache — orphaned timestamps
// ---------------------------------------------------------------------------

describe('pruneLanguageCache cleans up orphaned timestamps', () => {
  it('removes a timestamp whose cache key no longer exists', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    tsMap.set('orphan@c.us', recentTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.ok(!tsMap.has('orphan@c.us'), 'Orphaned timestamp must be removed');
  });

  it('keeps timestamps for keys that still exist in the cache', () => {
    const { cache, tsMap } = makeMaps();
    const now = Date.now();
    cache.set('819012345678@c.us', 'pt');
    tsMap.set('819012345678@c.us', recentTs(now));
    tsMap.set('ghost', recentTs(now));

    pruneLanguageCache(cache, tsMap, TTL, now);

    assert.ok(tsMap.has('819012345678@c.us'), 'Valid timestamp must survive');
    assert.ok(!tsMap.has('ghost'), 'Orphaned ghost timestamp must be removed');
  });
});
