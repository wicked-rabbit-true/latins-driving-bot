/**
 * Pure, side-effect-free cache utilities for the WhatsApp language cache.
 *
 * All functions accept the cache Map and timestamp Map as explicit arguments so
 * that they can be exercised in unit tests without importing the full bot module
 * (which has heavyweight side effects: WhatsApp client, file I/O, DB, etc.).
 */

/**
 * Set or refresh the timestamp for a cache key.
 *
 * @param {Map<string,number>} tsMap
 * @param {string} key
 * @param {number|undefined} ts  Defaults to Date.now().
 */
export function touchLangTs(tsMap, key, ts) {
  tsMap.set(key, ts !== undefined ? ts : Date.now());
}

/**
 * Write a language code under every key format that can identify the user:
 *   - chatId as-is (LID or @c.us form)
 *   - digits-only
 *   - digits@c.us
 *   - realPhone digits-only        (if provided)
 *   - realPhone digits@c.us        (if provided)
 *
 * Returns the set of keys that were written so callers can assert on it.
 *
 * @param {Map<string,string>} cache
 * @param {Map<string,number>} tsMap
 * @param {string} chatId
 * @param {string|null|undefined} realPhone
 * @param {string} langCode
 * @returns {Set<string>} The keys that were written.
 */
export function setLangAllFormats(cache, tsMap, chatId, realPhone, langCode) {
  const now = Date.now();
  const written = new Set();

  const num = chatId.replace(/@.+$/, '');

  cache.set(chatId, langCode);        touchLangTs(tsMap, chatId, now);        written.add(chatId);
  cache.set(num, langCode);           touchLangTs(tsMap, num, now);           written.add(num);
  cache.set(`${num}@c.us`, langCode); touchLangTs(tsMap, `${num}@c.us`, now); written.add(`${num}@c.us`);

  if (realPhone) {
    const realNorm = String(realPhone).replace(/\D/g, '');
    if (realNorm) {
      cache.set(realNorm, langCode);           touchLangTs(tsMap, realNorm, now);           written.add(realNorm);
      cache.set(`${realNorm}@c.us`, langCode); touchLangTs(tsMap, `${realNorm}@c.us`, now); written.add(`${realNorm}@c.us`);
    }
  }

  return written;
}

/**
 * Phase-0 normalisation: remove any cache key that contains more than one '@'
 * (e.g. "819012345678@c.us@c.us") and salvage the user's language under the
 * correct canonical keys before deleting the bad key.
 *
 * @param {Map<string,string>} cache
 * @param {Map<string,number>} tsMap
 * @returns {number} Count of malformed keys removed.
 */
export function removeMalformedKeys(cache, tsMap) {
  let malformed = 0;
  for (const [key, lang] of [...cache]) {
    if ((key.match(/@/g) || []).length <= 1) continue;

    const srcTs = tsMap.get(key);
    const num = key.replace(/@.+$/, '');
    if (num && /^\d+$/.test(num)) {
      if (!cache.has(num)) {
        cache.set(num, lang);
        touchLangTs(tsMap, num, srcTs);
      }
      const cusFmt = `${num}@c.us`;
      if (!cache.has(cusFmt)) {
        cache.set(cusFmt, lang);
        touchLangTs(tsMap, cusFmt, srcTs);
      }
    }
    cache.delete(key);
    tsMap.delete(key);
    malformed++;
  }
  return malformed;
}

/**
 * Phase-1 normalisation: for every valid cache entry ensure the digits-only
 * and digits@c.us variants also exist.
 *
 * @param {Map<string,string>} cache
 * @param {Map<string,number>} tsMap
 * @returns {number} Count of new entries added.
 */
export function ensureVariants(cache, tsMap) {
  const entries = [...cache.entries()];
  let added = 0;
  for (const [key, lang] of entries) {
    const srcTs = tsMap.get(key);
    const num = key.replace(/@.+$/, '');
    if (!cache.has(num)) {
      cache.set(num, lang);
      touchLangTs(tsMap, num, srcTs);
      added++;
    }
    const cusFmt = `${num}@c.us`;
    if (!cache.has(cusFmt)) {
      cache.set(cusFmt, lang);
      touchLangTs(tsMap, cusFmt, srcTs);
      added++;
    }
  }
  return added;
}

/**
 * Full normalisation pass (Phase 0 + Phase 1).
 *
 * @param {Map<string,string>} cache
 * @param {Map<string,number>} tsMap
 * @returns {{ malformed: number, added: number }}
 */
export function normalizeLanguageCache(cache, tsMap) {
  const malformed = removeMalformedKeys(cache, tsMap);
  const added = ensureVariants(cache, tsMap);
  return { malformed, added };
}

/**
 * Remove expired and malformed entries from the language cache.
 *
 * Expired  = timestamp older than ttlMonths months ago.
 * Malformed = key contains more than one '@' character.
 *
 * For a malformed key that has NOT yet expired, the user's language is
 * salvaged into the canonical forms (digits-only and digits@c.us) before the
 * bad key is deleted, so no preference is silently lost.
 *
 * Orphaned timestamp entries (keys in tsMap that no longer exist in cache)
 * are also removed.
 *
 * @param {Map<string,string>} cache    Language cache Map.
 * @param {Map<string,number>} tsMap    Timestamp Map (key → ms since epoch).
 * @param {number}             ttlMonths  How many months until an entry expires.
 * @param {number}             [now]    Override for the current time (ms). Defaults to Date.now().
 * @returns {{ removed: number, malformed: number }}
 */
export function pruneLanguageCache(cache, tsMap, ttlMonths, now = Date.now()) {
  const cutoff = now - ttlMonths * 30 * 24 * 60 * 60 * 1000;
  let removed = 0;
  let malformed = 0;

  for (const [key, lang] of [...cache]) {
    const ts = tsMap.get(key) ?? 0;
    const isMalformed = (key.match(/@/g) || []).length > 1;
    const isExpired = ts < cutoff;

    if (isExpired || isMalformed) {
      if (isMalformed && !isExpired) {
        const num = key.replace(/@.+$/, '');
        if (num && /^\d+$/.test(num)) {
          if (!cache.has(num)) {
            cache.set(num, lang);
            touchLangTs(tsMap, num, ts);
          }
          const cusFmt = `${num}@c.us`;
          if (!cache.has(cusFmt)) {
            cache.set(cusFmt, lang);
            touchLangTs(tsMap, cusFmt, ts);
          }
        }
      }
      if (isMalformed) malformed++;
      cache.delete(key);
      tsMap.delete(key);
      removed++;
    }
  }

  for (const key of [...tsMap.keys()]) {
    if (!cache.has(key)) tsMap.delete(key);
  }

  return { removed, malformed };
}
