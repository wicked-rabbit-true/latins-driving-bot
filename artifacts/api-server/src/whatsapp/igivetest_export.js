/**
 * igivetest_export.js
 * Exporta todas las preguntas de lds-support.igivetest.net a un archivo Excel.
 * Las preguntas se extraen visitando la página de edición de cada una.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

import http from 'http';
import { igtLogin } from './igivetest.js';

const BASE_HOST = 'lds-support.igivetest.net';

function httpGet(path, cookieStr) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { protocol: 'http:', hostname: BASE_HOST, path, method: 'GET', headers: { Cookie: cookieStr } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Detectar página principal de preguntas ────────────────────────────────────
// iGiveTest puede llamarla questions.php, question.php, etc.
async function findQuestionsUrl(cookieStr) {
  const candidates = [
    '/questions.php',
    '/question.php',
    '/quiz.php',
    '/quizzes.php',
    '/exams.php',
    '/exam.php',
    '/tests.php',
    '/test.php',
  ];
  for (const path of candidates) {
    const res = await httpGet(path + '?limit=9999', cookieStr);
    // Si la página tiene links de edición de pregunta, es la correcta
    if (res.statusCode === 200 && /questionid=\d+|quizid=\d+|examid=\d+/i.test(res.body)) {
      return { path, html: res.body };
    }
  }
  return null;
}

// ── Extraer todos los IDs de pregunta del listado ─────────────────────────────
function extractQuestionIds(html) {
  const matches = [
    ...html.matchAll(/[?&](?:questionid|question_id|qid)=(\d+)[^"']*/gi),
  ];
  const ids = matches.map(m => parseInt(m[1]));
  return [...new Set(ids)];
}

// ── Extraer el nombre de usuario administrador del formulario (para grupos) ───
function extractGroups(html) {
  // Busca checkboxes marcados: <input ... name="group[N]" checked>
  const checked = [];
  const re = /name=["']?group\[(\d+)\]["']?[^>]*checked|checked[^>]*name=["']?group\[(\d+)\]["']?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    checked.push(parseInt(m[1] || m[2]));
  }
  return checked;
}

// ── Limpiar HTML básico ───────────────────────────────────────────────────────
function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Extraer una pregunta de su página de edición ──────────────────────────────
async function fetchQuestion(questionId, basePath, cookieStr) {
  const res = await httpGet(`${basePath}?questionid=${questionId}&action=edit`, cookieStr);
  const html = res.body;

  // ── Texto de la pregunta ──────────────────────────────────────────────────
  // Patrones comunes: textarea name="question_text", input/textarea name="question", etc.
  let questionText = '';
  const textPatterns = [
    /name=["']?question_text["']?[^>]*>([^<]*(?:<(?!\/textarea)[^>]*>[^<]*)*?)<\/textarea>/is,
    /name=["']?question["']?[^>]*>([^<]*(?:<(?!\/textarea)[^>]*>[^<]*)*?)<\/textarea>/is,
    /name=["']?q_text["']?[^>]*>([^<]*(?:<(?!\/textarea)[^>]*>[^<]*)*?)<\/textarea>/is,
    /name=["']?question_text["']?[^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']{10,})["'][^>]*name=["']?question_text["']?/i,
  ];
  for (const p of textPatterns) {
    const m = html.match(p);
    if (m && m[1].trim()) { questionText = stripHtml(m[1]); break; }
  }

  // ── Opciones de respuesta ─────────────────────────────────────────────────
  // Busca inputs/textareas con name que contenga "answer", "option", "choice", "alt"
  const options = {};
  const optPatterns = [
    /name=["']?(?:answer|option|choice|alt|ans)[\[_]?([a-d0-4])[\]_]?["']?[^>]*value=["']([^"']*)["']/gi,
    /name=["']?(?:answer|option|choice|alt|ans)[\[_]?([a-d0-4])[\]_]?["']?[^>]*>([^<]*)<\/(?:textarea|input)/gi,
  ];
  for (const p of optPatterns) {
    let m;
    while ((m = p.exec(html)) !== null) {
      const key = m[1].toUpperCase().replace('0','A').replace('1','B').replace('2','C').replace('3','D').replace('4','E');
      if (m[2] && m[2].trim()) options[key] = stripHtml(m[2]);
    }
  }

  // Fallback: busca textareas que tengan "answer" en name
  if (Object.keys(options).length === 0) {
    const re2 = /name=["']?([^"']*(?:answer|option|choice|alt)[^"']*)["']?[^>]*>([\s\S]*?)<\/textarea>/gi;
    let m2; let idx = 0;
    const letters = ['A','B','C','D','E'];
    while ((m2 = re2.exec(html)) !== null && idx < 5) {
      if (m2[2].trim()) { options[letters[idx]] = stripHtml(m2[2]); idx++; }
    }
  }

  // ── Respuesta correcta ────────────────────────────────────────────────────
  let correctAnswer = '';
  // Busca radio/select con name "correct", "correct_answer", etc. con checked/selected
  const correctPatterns = [
    /name=["']?correct(?:_answer)?["']?[^>]*value=["']([^"']*)["'][^>]*(?:checked|selected)/i,
    /(?:checked|selected)[^>]*name=["']?correct(?:_answer)?["']?[^>]*value=["']([^"']*)["']/i,
    /name=["']?answer_correct["']?[^>]*value=["']([^"']*)["'][^>]*checked/i,
    /checked[^>]*name=["']?answer_correct["']?[^>]*value=["']([^"']*)["']/i,
  ];
  for (const p of correctPatterns) {
    const m = html.match(p);
    if (m && m[1].trim()) {
      correctAnswer = m[1].trim().toUpperCase()
        .replace('0','A').replace('1','B').replace('2','C').replace('3','D');
      break;
    }
  }

  // ── Categoría / grupo ─────────────────────────────────────────────────────
  let category = '';
  const catPatterns = [
    /name=["']?category(?:_id)?["']?[^>]*>([\s\S]*?)<\/select>/i,
    /name=["']?cat(?:_id)?["']?[^>]*>([\s\S]*?)<\/select>/i,
  ];
  for (const p of catPatterns) {
    const sel = html.match(p);
    if (sel) {
      const selMatch = sel[1].match(/selected[^>]*>([^<]+)<|>([^<]+)<\/option>\s*(?:<\/select>|$)/i);
      if (selMatch) { category = stripHtml(selMatch[1] || selMatch[2]); break; }
    }
  }

  // ── Tiene imagen? ─────────────────────────────────────────────────────────
  const hasImage = /type=["']?file["']?|<img[^>]+question/i.test(html);

  return { id: questionId, questionText, options, correctAnswer, category, hasImage };
}

// ── Mapa de grupos (IDs → nombre legible) ────────────────────────────────────
const GROUP_NAMES = {
  23: 'Karimen practica Saitama',
  27: 'Karimen inglés / Chiba',
  36: 'Karimen 19 pref. Saitama',
  48: 'Karimen practica 2024 Saitama',
  35: 'Karimen Tochigi',
  54: 'Karimen English 2024 Tochigi',
  52: 'Karimen Practice 2024 Tochigi',
  57: 'Karimen Practice 1 Tochigi',
  25: 'Honmen inglés Saitama',
  28: 'Honmen practica Saitama',
  44: 'Honmen 4-2023 Saitama',
  58: 'Honmen 2025 Saitama',
  37: 'Honmen Tochigi',
  50: 'Tochigi 100-1 2022',
  33: 'Honmen Chiba',
};

// ── Flujo principal de exportación ───────────────────────────────────────────

/**
 * Exporta todas las preguntas de iGiveTest a un buffer Excel (.xlsx).
 * Llama onProgress(done, total) durante el proceso.
 * @returns {Promise<{buffer: Buffer, totalQuestions: number}>}
 */
export async function exportIGiveTestToExcel(onProgress = null) {
  const cookieStr = await igtLogin();

  // 1. Encontrar la URL de preguntas
  const found = await findQuestionsUrl(cookieStr);
  if (!found) {
    throw new Error(
      'No se encontró la página de preguntas en iGiveTest.\n' +
      'El sistema puede tener una URL no estándar. Contacta al soporte de iGiveTest.'
    );
  }
  const basePath = found.path.replace('?limit=9999', '');

  // 2. Extraer todos los IDs
  const ids = extractQuestionIds(found.html);
  if (ids.length === 0) {
    throw new Error('Se encontró la página de preguntas pero no hay preguntas registradas.');
  }

  // 3. Obtener cada pregunta (con delay de 150 ms para no saturar el servidor)
  const questions = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      const q = await fetchQuestion(ids[i], basePath, cookieStr);
      if (q.questionText) questions.push(q);  // omitir entradas vacías
    } catch (_) {}
    if (onProgress) onProgress(i + 1, ids.length);
    await new Promise(r => setTimeout(r, 150));
  }

  if (questions.length === 0) {
    throw new Error('Se encontraron IDs de preguntas pero no se pudo extraer su contenido.');
  }

  // 4. Construir el workbook Excel
  const wb = XLSX.utils.book_new();

  // Hoja 1: todas las preguntas
  const allRows = [
    ['ID', 'Pregunta', 'Opción A', 'Opción B', 'Opción C', 'Opción D', 'Respuesta correcta', 'Categoría', 'Tiene imagen']
  ];
  for (const q of questions) {
    allRows.push([
      q.id,
      q.questionText,
      q.options['A'] || '',
      q.options['B'] || '',
      q.options['C'] || '',
      q.options['D'] || '',
      q.correctAnswer,
      q.category,
      q.hasImage ? 'Sí' : 'No',
    ]);
  }

  const wsAll = XLSX.utils.aoa_to_sheet(allRows);
  // Ancho de columnas
  wsAll['!cols'] = [
    { wch: 6 }, { wch: 80 }, { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 },
    { wch: 18 }, { wch: 28 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAll, 'Todas las preguntas');

  // Hojas por categoría (si hay info de categoría)
  const byCategory = {};
  for (const q of questions) {
    const cat = q.category || 'Sin categoría';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(q);
  }

  for (const [cat, qs] of Object.entries(byCategory)) {
    if (qs.length === 0) continue;
    const rows = [
      ['ID', 'Pregunta', 'Opción A', 'Opción B', 'Opción C', 'Opción D', 'Respuesta correcta', 'Tiene imagen']
    ];
    for (const q of qs) {
      rows.push([
        q.id, q.questionText,
        q.options['A'] || '', q.options['B'] || '',
        q.options['C'] || '', q.options['D'] || '',
        q.correctAnswer, q.hasImage ? 'Sí' : 'No',
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6 }, { wch: 80 }, { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 18 }, { wch: 14 },
    ];
    // Nombre de hoja: máximo 31 caracteres, sin caracteres especiales
    const sheetName = cat.replace(/[:\\/?*\[\]]/g, '').substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Cat.');
  }

  // 5. Generar buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buffer, totalQuestions: questions.length };
}
