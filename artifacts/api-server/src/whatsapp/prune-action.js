/**
 * Side-effect-free implementation of the 'prune_language_cache' bot action.
 *
 * Accepting the cache Maps and I/O callbacks as parameters keeps this module
 * fully testable without importing bot.js, which has heavyweight init-time
 * side effects (WhatsApp client init, env-var validation, file reads, etc.).
 *
 * bot.js delegates to these functions; tests import them directly.
 */

/**
 * Prune expired and malformed entries from in-memory language cache Maps.
 *
 * - Expired: timestamp is older than ttlMonths calendar months.
 * - Malformed: key contains more than one '@' (e.g. "123@c.us@c.us").
 *   Malformed-but-fresh keys have their language salvaged under canonical
 *   forms (digits-only and digits@c.us) before the bad key is deleted.
 *
 * This function is a pure transformation of the Maps it receives.
 * It does NOT write to disk or call any DB function.
 *
 * @param {Map<string,string>} cache      - CLIENT_LANGUAGE_CACHE from bot.js
 * @param {Map<string,number>} tsMap      - LANGUAGE_CACHE_TS from bot.js
 * @param {number}             ttlMonths  - LANG_CACHE_TTL_MONTHS from bot.js
 * @returns {{ removed: number, malformed: number }}
 */
export function pruneCache(cache, tsMap, ttlMonths) {
  const cutoff = Date.now() - ttlMonths * 30 * 24 * 60 * 60 * 1000;
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
          if (!cache.has(num))         { cache.set(num, lang);         tsMap.set(num, ts); }
          const cusFmt = `${num}@c.us`;
          if (!cache.has(cusFmt))      { cache.set(cusFmt, lang);      tsMap.set(cusFmt, ts); }
        }
      }

      if (isMalformed) malformed++;
      cache.delete(key);
      tsMap.delete(key);
      removed++;
    }
  }

  for (const [key] of [...tsMap]) {
    if (!cache.has(key)) tsMap.delete(key);
  }

  return { removed, malformed };
}

/**
 * Handle a single 'prune_language_cache' entry from the bot action queue.
 *
 * This mirrors the handler body inside processAdminActionQueue() in bot.js
 * (the `else if (action.type === 'prune_language_cache')` branch).
 *
 * @param {{ id: number|string }}       action    - queue row
 * @param {Map<string,string>}          cache     - CLIENT_LANGUAGE_CACHE
 * @param {Map<string,number>}          tsMap     - LANGUAGE_CACHE_TS
 * @param {number}                      ttlMonths - LANG_CACHE_TTL_MONTHS
 * @param {{
 *   markBotActionDoneWithResult: (id: any, result: object) => Promise<void>,
 *   saveLanguageCache: () => void,
 *   savePruneLog?: (removed: number, malformed: number) => Promise<void>,
 * }} deps  - injected I/O dependencies
 * @returns {Promise<{ removed: number, malformed: number }>}
 */
export async function handlePruneAction(action, cache, tsMap, ttlMonths, deps) {
  const { markBotActionDoneWithResult, saveLanguageCache, savePruneLog } = deps;
  const { removed, malformed } = pruneCache(cache, tsMap, ttlMonths);
  saveLanguageCache();
  if (savePruneLog) {
    await savePruneLog(removed, malformed);
  }
  await markBotActionDoneWithResult(action.id, { removed, malformed });
  return { removed, malformed };
}
