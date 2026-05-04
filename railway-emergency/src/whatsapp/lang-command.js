/**
 * Pure, side-effect-free implementation of the WhatsApp lang command handler
 * and manual-mode helpers.
 *
 * All functions accept explicit state (Maps) rather than module-level globals
 * so they can be exercised in unit tests without importing bot.js (which has
 * heavyweight side effects: WhatsApp client, file I/O, DB connections, etc.).
 *
 * bot.js imports handleLangCommand from this module at two call-sites:
 *   1. The early interceptor that runs BEFORE the manual-mode guard (~line 8678).
 *   2. The normal-flow fallback that runs after the manual-mode guard (~line 8700).
 */

import { setLangAllFormats } from './lang-cache-utils.js';

// NOTE: Keep this list in sync with LANG_SUPPORTED_LIST in bot.js and with
// the language arrays referenced in the help command handler (handleHelpCommand).
// Any new language added here must also be added to LANG_CMD_MAP, LANG_NAMES,
// LANG_CONFIRM, LANG_QUERY_REPLIES, and LANG_UNKNOWN_MSGS below.
export const LANG_SUPPORTED_LIST =
  `en · es · ja · ne · pt · ur · tr · hi · ar · zh · fr · ko · bn · id`;

const LANG_NAMES = {
  en: 'English',   es: 'Español',          ja: '日本語',        ne: 'नेपाली',
  pt: 'Português', ur: 'اردو',             tr: 'Türkçe',       hi: 'हिंदी',
  ar: 'العربية',   zh: '中文',              fr: 'Français',     ko: '한국어',
  bn: 'বাংলা',     id: 'Bahasa Indonesia',
};

export const LANG_CMD_MAP = {
  en: 'en', es: 'es', ja: 'ja', ne: 'ne', pt: 'pt', ur: 'ur', tr: 'tr',
  hi: 'hi', ar: 'ar', zh: 'zh', fr: 'fr', ko: 'ko', bn: 'bn', id: 'id',
  english: 'en',    spanish: 'es',    japanese: 'ja', nepali: 'ne',
  portuguese: 'pt', urdu: 'ur',       turkish: 'tr',  hindi: 'hi',
  arabic: 'ar',     chinese: 'zh',    french: 'fr',   korean: 'ko',
  bengali: 'bn',    indonesian: 'id',
  inglés: 'en', ingles: 'en',     español: 'es',    espanol: 'es',
  japonés: 'ja', japones: 'ja',   nepalés: 'ne',    nepales: 'ne',
  portugués: 'pt', portugues: 'pt', turco: 'tr',    árabe: 'ar', arabe: 'ar',
  chino: 'zh',   coreano: 'ko',   francés: 'fr',    frances: 'fr',
  bengalí: 'bn', indonesio: 'id',
  '日本語': 'ja', नेपाली: 'ne', اردو: 'ur', türkçe: 'tr', português: 'pt',
};

const LANG_CONFIRM = {
  en: `✅ Language changed to *English*. I'll respond in English from now on. 😊`,
  es: `✅ Idioma cambiado a *Español*. A partir de ahora te responderé en español. 😊`,
  ja: `✅ 言語を*日本語*に変更しました。これからは日本語でお答えします。😊`,
  ne: `✅ भाषा *नेपाली*मा परिवर्तन गरियो। अबदेखि म नेपालीमा जवाफ दिनेछु। 😊`,
  pt: `✅ Idioma alterado para *Português*. A partir de agora responderei em português. 😊`,
  ur: `✅ زبان *اردو* میں تبدیل کر دی گئی ہے۔ اب سے میں اردو میں جواب دوں گا۔ 😊`,
  tr: `✅ Dil *Türkçe* olarak değiştirildi. Bundan sonra Türkçe yanıt vereceğim. 😊`,
  hi: `✅ भाषा *हिंदी* में बदल दी गई है। अब से मैं हिंदी में जवाब दूंगा। 😊`,
  ar: `✅ تم تغيير اللغة إلى *العربية*. سأرد عليك بالعربية من الآن فصاعداً. 😊`,
  zh: `✅ 语言已更改为*中文*。从现在起我将用中文回复。😊`,
  fr: `✅ Langue changée en *Français*. Je répondrai en français à partir de maintenant. 😊`,
  ko: `✅ 언어가 *한국어*로 변경되었습니다. 이제부터 한국어로 답변하겠습니다. 😊`,
  bn: `✅ ভাষা *বাংলা*তে পরিবর্তন করা হয়েছে। এখন থেকে আমি বাংলায় উত্তর দেব। 😊`,
  id: `✅ Bahasa diubah ke *Bahasa Indonesia*. Mulai sekarang saya akan merespons dalam Bahasa Indonesia. 😊`,
};

const LANG_QUERY_REPLIES = {
  en: (name, code, _list) =>
    `🌐 Your current language is *${name}* (\`${code}\`).\n\nTo change it, type *lang <code>* — e.g. \`lang es\`.`,
  es: (name, code, _list) =>
    `🌐 Tu idioma actual es *${name}* (\`${code}\`).\n\nPara cambiarlo, escribe *idioma <código>* — p. ej. \`idioma en\`.`,
  ja: (name, code, _list) =>
    `🌐 現在の言語は *${name}* (\`${code}\`) です。\n\n変更するには *lang <コード>* と入力してください。例: \`lang en\``,
  ne: (name, code, _list) =>
    `🌐 तपाईंको हालको भाषा *${name}* (\`${code}\`) हो।\n\nबदल्न *lang <कोड>* टाइप गर्नुहोस् — जस्तै \`lang en\`।`,
  pt: (name, code, _list) =>
    `🌐 O seu idioma atual é *${name}* (\`${code}\`).\n\nPara alterar, digite *lang <código>* — ex.: \`lang en\`.`,
  ur: (name, code, _list) =>
    `🌐 آپ کی موجودہ زبان *${name}* (\`${code}\`) ہے۔\n\nتبدیل کرنے کے لیے *lang <کوڈ>* ٹائپ کریں — مثلاً \`lang en\`۔`,
  tr: (name, code, _list) =>
    `🌐 Mevcut diliniz *${name}* (\`${code}\`).\n\nDeğiştirmek için *lang <kod>* yazın — örn. \`lang en\`.`,
  hi: (name, code, _list) =>
    `🌐 आपकी वर्तमान भाषा *${name}* (\`${code}\`) है।\n\nबदलने के लिए *lang <कोड>* टाइप करें — जैसे \`lang en\`।`,
  ar: (name, code, _list) =>
    `🌐 لغتك الحالية هي *${name}* (\`${code}\`).\n\nللتغيير، اكتب *lang <رمز>* — مثال: \`lang en\`.`,
  zh: (name, code, _list) =>
    `🌐 您当前的语言是 *${name}* (\`${code}\`)。\n\n如需更改，请输入 *lang <代码>* — 例如 \`lang en\`。`,
  fr: (name, code, _list) =>
    `🌐 Votre langue actuelle est *${name}* (\`${code}\`).\n\nPour changer, tapez *lang <code>* — ex. \`lang en\`.`,
  ko: (name, code, _list) =>
    `🌐 현재 언어는 *${name}* (\`${code}\`)입니다.\n\n변경하려면 *lang <코드>* 를 입력하세요 — 예: \`lang en\`.`,
  bn: (name, code, _list) =>
    `🌐 আপনার বর্তমান ভাষা *${name}* (\`${code}\`)।\n\nপরিবর্তন করতে *lang <কোড>* টাইপ করুন — যেমন \`lang en\`।`,
  id: (name, code, _list) =>
    `🌐 Bahasa Anda saat ini adalah *${name}* (\`${code}\`).\n\nUntuk mengubahnya, ketik *lang <kode>* — mis. \`lang en\`.`,
};

const LANG_UNKNOWN_MSGS = {
  en: (list) =>
    `❌ Language not recognized. Try: *lang en* (English), *lang es* (Spanish), *lang ja* (Japanese), *lang ne* (Nepali), *lang pt* (Portuguese), *lang ur* (Urdu), *lang tr* (Turkish), *lang hi* (Hindi), *lang ar* (Arabic), *lang zh* (Chinese), *lang fr* (French), *lang ko* (Korean), *lang bn* (Bengali), *lang id* (Indonesian).`,
  es: (_list) =>
    `❌ Idioma no reconocido. Prueba: *lang en* (Inglés), *lang es* (Español), *lang ja* (Japonés), *lang ne* (Nepalí), *lang pt* (Portugués), *lang ur* (Urdu), *lang tr* (Turco), *lang hi* (Hindi), *lang ar* (Árabe), *lang zh* (Chino), *lang fr* (Francés), *lang ko* (Coreano), *lang bn* (Bengalí), *lang id* (Indonesio).`,
  ja: (_list) =>
    `❌ 言語が認識されませんでした。試してください: *lang en* (英語), *lang es* (スペイン語), *lang ja* (日本語), *lang ne* (ネパール語), *lang pt* (ポルトガル語), *lang ur* (ウルドゥー語), *lang tr* (トルコ語), *lang hi* (ヒンディー語), *lang ar* (アラビア語), *lang zh* (中国語), *lang fr* (フランス語), *lang ko* (韓国語), *lang bn* (ベンガル語), *lang id* (インドネシア語).`,
  ne: (_list) =>
    `❌ भाषा पहिचान भएन। प्रयास गर्नुहोस्: *lang en* (अंग्रेजी), *lang es* (स्पेनिश), *lang ja* (जापानी), *lang ne* (नेपाली), *lang pt* (पोर्तुगाली), *lang ur* (उर्दू), *lang tr* (तुर्की), *lang hi* (हिन्दी), *lang ar* (अरबी), *lang zh* (चिनियाँ), *lang fr* (फ्रान्सेली), *lang ko* (कोरियाली), *lang bn* (बंगाली), *lang id* (इन्डोनेसियाई).`,
  pt: (_list) =>
    `❌ Idioma não reconhecido. Tente: *lang en* (Inglês), *lang es* (Espanhol), *lang ja* (Japonês), *lang ne* (Nepalês), *lang pt* (Português), *lang ur* (Urdu), *lang tr* (Turco), *lang hi* (Hindi), *lang ar* (Árabe), *lang zh* (Chinês), *lang fr* (Francês), *lang ko* (Coreano), *lang bn* (Bengali), *lang id* (Indonésio).`,
  ur: (_list) =>
    `❌ زبان پہچانی نہیں گئی۔ کوشش کریں: *lang en* (انگریزی), *lang es* (ہسپانوی), *lang ja* (جاپانی), *lang ne* (نیپالی), *lang pt* (پرتگالی), *lang ur* (اردو), *lang tr* (ترکی), *lang hi* (ہندی), *lang ar* (عربی), *lang zh* (چینی), *lang fr* (فرانسیسی), *lang ko* (کوریائی), *lang bn* (بنگالی), *lang id* (انڈونیشیائی).`,
  tr: (_list) =>
    `❌ Dil tanınmadı. Deneyin: *lang en* (İngilizce), *lang es* (İspanyolca), *lang ja* (Japonca), *lang ne* (Nepalce), *lang pt* (Portekizce), *lang ur* (Urduca), *lang tr* (Türkçe), *lang hi* (Hintçe), *lang ar* (Arapça), *lang zh* (Çince), *lang fr* (Fransızca), *lang ko* (Korece), *lang bn* (Bengalce), *lang id* (Endonezce).`,
  hi: (_list) =>
    `❌ भाषा पहचानी नहीं गई। कोशिश करें: *lang en* (अंग्रेज़ी), *lang es* (स्पेनिश), *lang ja* (जापानी), *lang ne* (नेपाली), *lang pt* (पुर्तगाली), *lang ur* (उर्दू), *lang tr* (तुर्की), *lang hi* (हिन्दी), *lang ar* (अरबी), *lang zh* (चीनी), *lang fr* (फ्रांसीसी), *lang ko* (कोरियाई), *lang bn* (बांग्ला), *lang id* (इंडोनेशियाई).`,
  ar: (_list) =>
    `❌ اللغة غير معروفة. جرّب: *lang en* (الإنجليزية), *lang es* (الإسبانية), *lang ja* (اليابانية), *lang ne* (النيبالية), *lang pt* (البرتغالية), *lang ur* (الأردية), *lang tr* (التركية), *lang hi* (الهندية), *lang ar* (العربية), *lang zh* (الصينية), *lang fr* (الفرنسية), *lang ko* (الكورية), *lang bn* (البنغالية), *lang id* (الإندونيسية).`,
  zh: (_list) =>
    `❌ 语言未被识别。请尝试: *lang en* (英语), *lang es* (西班牙语), *lang ja* (日语), *lang ne* (尼泊尔语), *lang pt* (葡萄牙语), *lang ur* (乌尔都语), *lang tr* (土耳其语), *lang hi* (印地语), *lang ar* (阿拉伯语), *lang zh* (中文), *lang fr* (法语), *lang ko* (韩语), *lang bn* (孟加拉语), *lang id* (印度尼西亚语).`,
  fr: (_list) =>
    `❌ Langue non reconnue. Essayez: *lang en* (Anglais), *lang es* (Espagnol), *lang ja* (Japonais), *lang ne* (Népalais), *lang pt* (Portugais), *lang ur* (Ourdou), *lang tr* (Turc), *lang hi* (Hindi), *lang ar* (Arabe), *lang zh* (Chinois), *lang fr* (Français), *lang ko* (Coréen), *lang bn* (Bengali), *lang id* (Indonésien).`,
  ko: (_list) =>
    `❌ 언어를 인식할 수 없습니다. 시도해 보세요: *lang en* (영어), *lang es* (스페인어), *lang ja* (일본어), *lang ne* (네팔어), *lang pt* (포르투갈어), *lang ur* (우르두어), *lang tr* (터키어), *lang hi* (힌디어), *lang ar* (아랍어), *lang zh* (중국어), *lang fr* (프랑스어), *lang ko* (한국어), *lang bn* (벵골어), *lang id* (인도네시아어).`,
  bn: (_list) =>
    `❌ ভাষাটি চেনা যায়নি। চেষ্টা করুন: *lang en* (ইংরেজি), *lang es* (স্পেনিশ), *lang ja* (জাপানি), *lang ne* (নেপালি), *lang pt* (পর্তুগিজ), *lang ur* (উর্দু), *lang tr* (তুর্কি), *lang hi* (হিন্দি), *lang ar* (আরবি), *lang zh* (চীনা), *lang fr* (ফরাসি), *lang ko* (কোরিয়ান), *lang bn* (বাংলা), *lang id* (ইন্দোনেশিয়ান).`,
  id: (_list) =>
    `❌ Bahasa tidak dikenali. Coba: *lang en* (Inggris), *lang es* (Spanyol), *lang ja* (Jepang), *lang ne* (Nepal), *lang pt* (Portugis), *lang ur* (Urdu), *lang tr* (Turki), *lang hi* (Hindi), *lang ar* (Arab), *lang zh* (Cina), *lang fr* (Prancis), *lang ko* (Korea), *lang bn* (Bengali), *lang id* (Indonesia).`,
};

/**
 * Process a WhatsApp lang/idioma command.
 *
 * @param {Map<string,string>} cache      - Language cache (CLIENT_LANGUAGE_CACHE in bot.js)
 * @param {Map<string,number>} tsMap      - Timestamp map (LANGUAGE_CACHE_TS in bot.js)
 * @param {string}             chatId     - WhatsApp chat ID (e.g. "819012345678@c.us")
 * @param {string|null}        realPhone  - Verified phone number, or null
 * @param {string}             userMessage
 * @param {{ reply: (text: string) => Promise<void> }} msg  - WhatsApp message object
 * @param {{ afterSet?: (chatId: string, realPhone: string|null, langCode: string) => void }} [opts]
 *   - Optional callback invoked after the cache is updated so callers can trigger
 *     file persistence and DB writes without this module having side effects.
 * @returns {Promise<boolean>} true if the message was a lang command (already handled)
 */
export async function handleLangCommand(
  cache, tsMap, chatId, realPhone, userMessage, msg, opts = {},
) {
  const LANG_CMD_REGEX = /^(?:\/)?(?:idioma|lang(?:uage)?)(?:\s+(\S+))?$/i;
  const langCmdMatch = userMessage.trim().match(LANG_CMD_REGEX);
  if (!langCmdMatch) return false;

  const currentLang = cache.get(chatId) || 'en';

  if (!langCmdMatch[1]) {
    const currentLangName = LANG_NAMES[currentLang] || currentLang;
    const buildReply =
      LANG_QUERY_REPLIES[currentLang] ?? LANG_QUERY_REPLIES.en;
    await msg.reply(buildReply(currentLangName, currentLang, LANG_SUPPORTED_LIST));
    return true;
  }

  const raw = langCmdMatch[1].toLowerCase();
  const newLang = LANG_CMD_MAP[raw];
  if (newLang) {
    setLangAllFormats(cache, tsMap, chatId, realPhone, newLang);
    opts.afterSet?.(chatId, realPhone, newLang);
    await msg.reply(LANG_CONFIRM[newLang] ?? LANG_CONFIRM.en);
  } else {
    const buildErr = LANG_UNKNOWN_MSGS[currentLang] ?? LANG_UNKNOWN_MSGS.en;
    await msg.reply(buildErr(LANG_SUPPORTED_LIST));
  }
  return true;
}

/**
 * Fast in-memory language resolution — mirrors the first lookup that
 * getTargetLang() in bot.js performs before attempting async DB/LID fallbacks.
 *
 * Returns the language code for chatId if it is already in the cache,
 * or 'en' as a safe default. This is sufficient to confirm that a language
 * preference set via handleLangCommand is immediately available to the bot
 * for its next reply when the chat is back in normal mode.
 *
 * @param {Map<string,string>} cache - CLIENT_LANGUAGE_CACHE
 * @param {string} chatId
 * @returns {string} BCP-47 language code
 */
export function resolveTargetLangFromCache(cache, chatId) {
  return cache.get(chatId) ?? 'en';
}

/**
 * Create a set of manual-mode helpers that operate on a shared Map.
 *
 * Mirrors the setManualMode / clearManualMode / isInManualMode functions
 * in bot.js so they can be tested independently.
 *
 * @param {Map<string, number>} manualModeChats  Expiry timestamps keyed by chatId.
 */
export function makeManualModeHelpers(manualModeChats) {
  return {
    /**
     * Mark a chatId as being handled manually by Carlos for `durationMs` ms.
     * @param {string} chatId
     * @param {number} [durationMs]  Defaults to 30 minutes.
     */
    setManualMode(chatId, durationMs = 30 * 60 * 1000) {
      manualModeChats.set(chatId, Date.now() + durationMs);
    },

    /** Remove the manual-mode flag immediately. */
    clearManualMode(chatId) {
      manualModeChats.delete(chatId);
    },

    /**
     * Return true if chatId is currently in manual mode (and the entry has not expired).
     * Expired entries are cleaned up automatically on read.
     */
    isInManualMode(chatId) {
      const expiry = manualModeChats.get(chatId);
      if (!expiry) return false;
      if (Date.now() > expiry) {
        manualModeChats.delete(chatId);
        return false;
      }
      return true;
    },
  };
}
