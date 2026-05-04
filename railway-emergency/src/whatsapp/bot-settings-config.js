/**
 * Resolved bot configuration constants shared between bot.js and the API route.
 * Both the bot process and the /api/bot/settings endpoint import from here so
 * there is a single source of truth for every configurable numeric setting.
 */

function resolveIntSetting(envVar, defaultValue, { min, max } = {}) {
  const raw = process.env[envVar];
  const num = raw !== undefined ? Number(raw) : NaN;
  const valid = Number.isInteger(num) && num > 0;
  if (raw !== undefined && !valid) {
    console.warn(`⚠️ ${envVar} env var is invalid ("${raw}"), using default of ${defaultValue}`);
  }
  const value = valid ? num : defaultValue;
  if (valid) {
    if (min !== undefined && value < min) {
      console.warn(
        `⚠️ ${envVar} is set to ${value}, which is unusually small (expected ≥ ${min}). ` +
        `The supplied value will still be used — verify this is intentional.`
      );
    }
    if (max !== undefined && value > max) {
      console.warn(
        `⚠️ ${envVar} is set to ${value}, which is unusually large (expected ≤ ${max}). ` +
        `The supplied value will still be used — verify this is intentional.`
      );
    }
  }
  return { value, source: valid ? "env" : "default" };
}

const _manualTimeout = resolveIntSetting("MANUAL_MODE_TIMEOUT_MINS", 30, { min: 1, max: 1440 });
const _wizardTimeout = resolveIntSetting("WIZARD_TIMEOUT_MINS",       30, { min: 1, max: 1440 });
const _maxHistory    = resolveIntSetting("BOT_MAX_HISTORY",            20, { min: 1, max: 500  });
const _langCacheTtl  = resolveIntSetting("LANG_CACHE_TTL_MONTHS",      12, { min: 1, max: 120  });

/** Active bot settings with resolved values and their sources. */
export const BOT_SETTINGS_CONFIG = [
  {
    name: "Manual Mode Timeout",
    envVar: "MANUAL_MODE_TIMEOUT_MINS",
    value: _manualTimeout.value,
    source: _manualTimeout.source,
    unit: "minutes",
    description: "How long the bot stays paused after being silenced manually.",
  },
  {
    name: "Wizard Timeout",
    envVar: "WIZARD_TIMEOUT_MINS",
    value: _wizardTimeout.value,
    source: _wizardTimeout.source,
    unit: "minutes",
    description:
      "How long an interactive wizard session waits for a response before expiring.",
  },
  {
    name: "Max History",
    envVar: "BOT_MAX_HISTORY",
    value: _maxHistory.value,
    source: _maxHistory.source,
    unit: "messages",
    description:
      "Number of message pairs kept in memory per chat for AI context.",
  },
  {
    name: "Language Cache TTL",
    envVar: "LANG_CACHE_TTL_MONTHS",
    value: _langCacheTtl.value,
    source: _langCacheTtl.source,
    unit: "months",
    description:
      "Maximum age of a language cache entry before it is pruned.",
  },
];

/** Resolved timeout in milliseconds for manual mode. */
export const MANUAL_MODE_TIMEOUT_MS = _manualTimeout.value * 60 * 1000;

/** Resolved timeout in milliseconds for the interactive wizard. */
export const WIZARD_TIMEOUT_MS = _wizardTimeout.value * 60 * 1000;

/** Resolved maximum number of individual messages kept per chat. */
export const MAX_HISTORY = _maxHistory.value;

/** Resolved maximum age (months) for language cache entries. */
export const LANG_CACHE_TTL_MONTHS = _langCacheTtl.value;
