/**
 * process-pdfs.mjs
 * Procesa los PDFs del libro de manejo japonés y preguntas confusas,
 * extrae el contenido con GPT-4o Vision y lo guarda en bot_knowledge.
 *
 * Uso:
 *   node artifacts/api-server/src/whatsapp/process-pdfs.mjs
 *
 * Opciones de entorno:
 *   SKIP_EXISTING=true  → omite páginas ya procesadas (fuente ya en DB)
 *   ONLY_PDF=1          → procesa solo el PDF indicado (1-4)
 *   START_PAGE=N        → empieza desde la página N del PDF actual
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../../');

// ── Configuración ─────────────────────────────────────────────────────────────

const PDFS = [
  {
    id: 1,
    file: 'attached_assets/Adobe_Scan_01_may_2026_(1)_1777633384849.pdf',
    pages: 100,
    fuente_prefix: 'libro_ja_p1',
    categoria: 'gakka_kyohon',
    descripcion: 'Libro Oficial Japonés de Manejo — Parte 1',
  },
  {
    id: 2,
    file: 'attached_assets/Adobe_Scan_01_may_2026_(2)_1777633831067.pdf',
    pages: 100,
    fuente_prefix: 'libro_ja_p2',
    categoria: 'gakka_kyohon',
    descripcion: 'Libro Oficial Japonés de Manejo — Parte 2',
  },
  {
    id: 3,
    file: 'attached_assets/Adobe_Scan_01_may_2026_(3)_1777633885389.pdf',
    pages: 74,
    fuente_prefix: 'libro_ja_p3',
    categoria: 'gakka_kyohon',
    descripcion: 'Libro Oficial Japonés de Manejo — Parte 3',
  },
  {
    id: 4,
    file: 'attached_assets/Adobe_Scan_01_may_2026_(4)_1777633917691.pdf',
    pages: 12,
    fuente_prefix: 'preguntas_confusas',
    categoria: 'preguntas_confusas',
    descripcion: 'Preguntas Confusas: Señales, Semáforos e Indicaciones',
  },
];

const ONLY_PDF = process.env.ONLY_PDF ? parseInt(process.env.ONLY_PDF) : null;
const START_PAGE = process.env.START_PAGE ? parseInt(process.env.START_PAGE) : 1;
const SKIP_EXISTING = process.env.SKIP_EXISTING !== 'false';
const CONCURRENCY = 3; // páginas en paralelo
const TMP_DIR = '/tmp/pdf_processing';

// ── Inicialización ─────────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function getExistingSources() {
  const res = await pool.query(`SELECT DISTINCT fuente FROM bot_knowledge WHERE fuente LIKE 'libro_ja_%' OR fuente LIKE 'preguntas_confusas%'`);
  return new Set(res.rows.map(r => r.fuente));
}

async function extractPageImage(pdfPath, pageNum) {
  const prefix = path.join(TMP_DIR, `page_${pageNum}`);
  const outputFile = `${prefix}-${String(pageNum).padStart(3, '0')}.png`;

  if (fs.existsSync(outputFile)) {
    return outputFile;
  }

  execSync(
    `pdftoppm -r 150 -png -f ${pageNum} -l ${pageNum} "${pdfPath}" "${prefix}"`,
    { stdio: 'pipe' }
  );

  // pdftoppm puede generar el archivo con padding variable
  const files = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(`page_${pageNum}-`) && f.endsWith('.png'));
  if (files.length === 0) throw new Error(`No se generó imagen para página ${pageNum}`);
  return path.join(TMP_DIR, files[0]);
}

function imageToBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

const PROMPT_LIBRO = `Eres un extractor de contenido especializado en libros de reglas de tránsito japoneses.

Analiza esta página del libro oficial de manejo japonés (学科教本) y extrae TODO el contenido.

Responde SOLO en JSON con este formato exacto:
{
  "titulo": "El título o tema principal de esta página (en japonés, máximo 60 caracteres)",
  "contenido": "Todo el texto de la página, incluyendo reglas, explicaciones, ejemplos, notas al pie y cualquier texto visible. Si hay listas numeradas, mantenlas. IMPORTANTE: si la página contiene imágenes de señales de tránsito, semáforos, diagramas de intersecciones u otras ilustraciones educativas, descríbelas en detalle dentro del contenido con el formato [IMAGEN: descripción detallada en español de la señal/semáforo/diagrama, incluyendo forma, color, símbolo o número que muestra, y su significado]. Si la página es principalmente una imagen de capítulo sin texto ni ilustraciones educativas, escribe SOLO: PAGINA_IMAGEN"
}

Notas importantes:
- Extrae TODO el texto visible, no lo resumas
- Mantén los números y medidas exactas (velocidades, distancias, pesos, etc.)
- Si hay términos técnicos, inclúyelos tal como aparecen
- Si la página está girada lateralmente, léela correctamente
- Describe SIEMPRE las imágenes de señales — son esenciales para el aprendizaje
- PAGINA_IMAGEN solo si realmente no hay texto ni contenido educativo ilustrado`;

const PROMPT_PREGUNTAS = `Eres un extractor de preguntas de examen de manejo japonés especializado en señales y semáforos.

Analiza esta página del libro de preguntas confusas (信号・標識標示問題). Cada pregunta muestra UNA imagen de señal/semáforo y varias afirmaciones sobre ella.

Responde SOLO en JSON con este formato:
{
  "titulo": "Título o tema de esta sección (en japonés)",
  "contenido": "Para CADA grupo de preguntas en la página, sigue este formato exacto:\\n\\n[SEÑAL: descripción visual detallada en español de la señal o semáforo de la imagen — forma, color, símbolo, número o texto que muestra, y lo que significa en el tránsito japonés]\\n\\nNúmero X:\\ntexto: (texto completo de la pregunta en japonés, incluyendo items 1 y 2 si es doble)\\nrespuesta: ○ o × con explicación breve si aparece\\n\\nNúmero Y:\\n... (continúa con todas las preguntas del grupo)\\n\\nRepite el bloque [SEÑAL:] cada vez que cambie la imagen de señal en la página. Si la página es portada sin preguntas, escribe SOLO: PAGINA_IMAGEN"
}

CRÍTICO: La descripción [SEÑAL:] es lo más importante. Describe con detalle cada señal/semáforo para que alguien que no vea la imagen pueda identificarla perfectamente.`;


async function processPageWithGPT(base64Image, pdfId) {
  const prompt = pdfId === 4 ? PROMPT_PREGUNTAS : PROMPT_LIBRO;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'high' } },
        ],
      },
    ],
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return { titulo: '', contenido: 'PAGINA_IMAGEN' };
  }

  if (!parsed) return { titulo: '', contenido: 'PAGINA_IMAGEN' };

  // Si no tiene el campo contenido, busca claves alternativas
  if (!('contenido' in parsed)) {
    const keys = Object.keys(parsed);
    const contentKey = keys.find(k => k !== 'titulo' && k !== 'title');
    if (contentKey) {
      parsed.contenido = parsed[contentKey];
    } else {
      parsed.contenido = JSON.stringify(parsed);
    }
  }

  // Normalizar: contenido puede venir como array u objeto anidado
  if (parsed && typeof parsed.contenido !== 'string') {
    if (Array.isArray(parsed.contenido)) {
      parsed.contenido = parsed.contenido
        .map(item => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            return Object.entries(item)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n');
          }
          return String(item);
        })
        .join('\n\n');
    } else if (parsed.contenido && typeof parsed.contenido === 'object') {
      parsed.contenido = JSON.stringify(parsed.contenido, null, 2);
    } else {
      parsed.contenido = 'PAGINA_IMAGEN';
    }
  }

  return parsed;
}

async function saveToDb(situacion, respuesta, fuente, categoria) {
  if (!respuesta || respuesta.trim() === 'PAGINA_IMAGEN') return false;

  await pool.query(
    `INSERT INTO bot_knowledge (situacion, respuesta, tipo_usuario, idioma, fuente, activo, creado_por)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
    [
      situacion.trim().slice(0, 500),
      respuesta.trim(),
      'estudiante',
      'ja',
      fuente,
      'process-pdfs',
    ]
  );
  return true;
}

// ── Procesamiento de un PDF ────────────────────────────────────────────────────

async function processPDF(pdfConfig, existingSources) {
  const pdfPath = path.join(ROOT, pdfConfig.file);
  log(`\n📖 ${pdfConfig.descripcion} (${pdfConfig.pages} páginas)`);
  log(`   Archivo: ${pdfConfig.file}`);

  if (!fs.existsSync(pdfPath)) {
    log(`   ❌ Archivo no encontrado: ${pdfPath}`);
    return { ok: 0, skip: 0, error: 0 };
  }

  let ok = 0, skip = 0, error = 0;
  const startPage = pdfConfig.id === ONLY_PDF ? START_PAGE : 1;

  // Procesar en lotes de CONCURRENCY
  for (let batch = startPage; batch <= pdfConfig.pages; batch += CONCURRENCY) {
    const batchPages = [];
    for (let p = batch; p < batch + CONCURRENCY && p <= pdfConfig.pages; p++) {
      batchPages.push(p);
    }

    const results = await Promise.allSettled(
      batchPages.map(async (pageNum) => {
        const fuente = `${pdfConfig.fuente_prefix}_pg${String(pageNum).padStart(3, '0')}`;

        // Saltar si ya existe en DB
        if (SKIP_EXISTING && existingSources.has(fuente)) {
          skip++;
          process.stdout.write('·');
          return;
        }

        // Extraer imagen
        const imgFile = await extractPageImage(pdfPath, pageNum);
        const b64 = imageToBase64(imgFile);

        // Procesar con GPT-4o
        const result = await processPageWithGPT(b64, pdfConfig.id);

        if (!result.contenido || result.contenido.trim() === 'PAGINA_IMAGEN') {
          skip++;
          process.stdout.write('○');
          return;
        }

        const situacion = result.titulo || `${pdfConfig.descripcion} — Pág. ${pageNum}`;
        const saved = await saveToDb(situacion, result.contenido, fuente, pdfConfig.categoria);

        if (saved) {
          ok++;
          process.stdout.write('✓');
        } else {
          skip++;
          process.stdout.write('○');
        }

        // Limpiar imagen temporal para ahorrar disco
        try { fs.unlinkSync(imgFile); } catch (_) {}
      })
    );

    // Contar errores
    results.forEach(r => {
      if (r.status === 'rejected') {
        error++;
        process.stdout.write('✗');
        if (process.env.VERBOSE) console.error('\n', r.reason?.message);
      }
    });

    // Pequeña pausa entre lotes para no saturar la API
    if (batch + CONCURRENCY <= pdfConfig.pages) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(''); // nueva línea después del progreso
  log(`   ✓ Guardadas: ${ok} | Saltadas: ${skip} | Errores: ${error}`);
  return { ok, skip, error };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log('🚀 Iniciando procesamiento de PDFs del libro de manejo japonés');
  log(`   SKIP_EXISTING: ${SKIP_EXISTING}`);
  if (ONLY_PDF) log(`   Solo PDF #${ONLY_PDF}`);
  if (START_PAGE > 1) log(`   Desde página ${START_PAGE}`);

  // Verificar conexión DB
  try {
    await pool.query('SELECT 1');
    log('✅ DB conectada');
  } catch (e) {
    log(`❌ Error de DB: ${e.message}`);
    process.exit(1);
  }

  // Verificar que la tabla tiene la columna tipo_usuario (por si acaso)
  await pool.query(`
    ALTER TABLE bot_knowledge ADD COLUMN IF NOT EXISTS tipo_entrada TEXT DEFAULT 'respuesta'
  `).catch(() => {});

  // Cargar fuentes ya procesadas
  const existingSources = await getExistingSources();
  log(`📊 Entradas existentes en DB: ${existingSources.size}`);

  const pdfsToProcess = ONLY_PDF
    ? PDFS.filter(p => p.id === ONLY_PDF)
    : PDFS;

  let totalOk = 0, totalSkip = 0, totalError = 0;

  for (const pdfConfig of pdfsToProcess) {
    const { ok, skip, error } = await processPDF(pdfConfig, existingSources);
    totalOk += ok;
    totalSkip += skip;
    totalError += error;
  }

  log(`\n🏁 PROCESAMIENTO COMPLETO`);
  log(`   ✓ Páginas guardadas: ${totalOk}`);
  log(`   ○ Páginas saltadas (imagen/ya existe): ${totalSkip}`);
  log(`   ✗ Errores: ${totalError}`);

  await pool.end();
  log('✅ Listo');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
