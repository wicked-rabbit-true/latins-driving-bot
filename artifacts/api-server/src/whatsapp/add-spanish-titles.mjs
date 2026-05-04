/**
 * add-spanish-titles.mjs
 * Agrega traducción al español del título de cada entrada de bot_knowledge
 * proveniente del libro japonés, para que la búsqueda por palabras clave funcione
 * cuando los alumnos preguntan en español/portugués/inglés.
 *
 * Uso: node artifacts/api-server/src/whatsapp/add-spanish-titles.mjs
 */

import OpenAI from 'openai';
import pg from 'pg';

const { Pool } = pg;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function log(msg) {
  process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

async function translateTitle(japonesTitle, japContent) {
  // Enviamos el título + primeros 300 chars del contenido para contexto
  const preview = japContent.slice(0, 300);
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `Eres un traductor especializado en normas de tránsito japonesas para hispanohablantes.

Dado el siguiente título en japonés de un libro de texto de autoescuela (学科教本), y un fragmento del contenido, genera:
1. Una traducción concisa al español del tema (máx 80 chars)
2. 5-8 palabras clave en español/portugués que un alumno hispano usaría para preguntar sobre este tema

Título japonés: ${japonesTitle}
Contenido (fragmento): ${preview}

Responde SOLO en JSON:
{"titulo_es": "...", "keywords_es": ["...", "..."]}`,
      },
    ],
    max_tokens: 200,
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  const titulo = parsed.titulo_es || '';
  const kw = Array.isArray(parsed.keywords_es) ? parsed.keywords_es.join(' ') : '';
  return `${titulo} | ${kw}`;
}

async function main() {
  log('🌐 Agregando títulos en español a entradas del libro japonés...');

  await pool.query('SELECT 1');
  log('✅ DB conectada');

  // Agregar columna situacion_es si no existe
  await pool.query(`ALTER TABLE bot_knowledge ADD COLUMN IF NOT EXISTS situacion_es TEXT`).catch(() => {});

  // Buscar entradas que aún no tienen traducción
  const { rows } = await pool.query(`
    SELECT id, situacion, respuesta
    FROM bot_knowledge
    WHERE (fuente LIKE 'libro_ja_%' OR fuente LIKE 'preguntas_confusas%')
      AND (situacion_es IS NULL OR situacion_es = '')
    ORDER BY id
  `);

  log(`📝 ${rows.length} entradas sin traducción`);
  if (rows.length === 0) {
    log('✅ Todas las entradas ya tienen traducción');
    await pool.end();
    return;
  }

  let ok = 0, error = 0;
  const BATCH = 5;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const translated = await translateTitle(row.situacion, row.respuesta);
        await pool.query(
          `UPDATE bot_knowledge SET situacion_es = $1, updated_at = NOW() WHERE id = $2`,
          [translated, row.id]
        );
        process.stdout.write('✓');
        ok++;
      })
    );

    results.forEach(r => {
      if (r.status === 'rejected') {
        process.stdout.write('✗');
        error++;
      }
    });

    // Pausa breve entre lotes
    if (i + BATCH < rows.length) await new Promise(r => setTimeout(r, 300));
  }

  process.stdout.write('\n');
  log(`🏁 Completado: ${ok} OK, ${error} errores`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
