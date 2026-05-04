import { Router } from "express";
import multer from "multer";
import mammoth from "mammoth";
import { z as _z } from "zod";
import { db } from "@workspace/db";
import {
  examQuestionsTable,
  examSessionsTable,
  examSessionQuestionsTable,
} from "@workspace/db";
import { eq, ilike, and, sql, desc, asc } from "drizzle-orm";
import OpenAI from "openai";
import pg from "pg";
import { ObjectStorageService } from "../lib/objectStorage.js";

import {
  ListExamQuestionsQueryParams,
  CreateExamQuestionBody,
  AnalyzeExamQuestionBody,
  AnalyzeBatchExamQuestionsBody,
  GetExamQuestionParams,
  UpdateExamQuestionBody,
  UpdateExamQuestionParams,
  DeleteExamQuestionParams,
  CreateExamSessionBody,
  GetExamSessionParams,
  AnswerExamQuestionBody,
  AnswerExamQuestionParams,
} from "@workspace/api-zod";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();
const openai = new OpenAI();
const objectStorage = new ObjectStorageService();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── helpers ─────────────────────────────────────────────────────────────────

// ── Generar embedding semántico de una pregunta (text-embedding-3-small) ──────
// Modelo muy barato (~$0.02/1M tokens). Para 520 preguntas ≈ $0.001 total.
// Retorna null si falla para no bloquear el flujo normal.
async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const clean = text.replace(/^\s*\d+[.\-)]+\s*/g, "").trim();
    const resp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: clean,
    });
    return resp.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// Guardar embedding en BD de forma asíncrona (no bloquea la respuesta)
function saveEmbeddingAsync(id: number, text: string): void {
  getEmbedding(text).then(emb => {
    if (!emb) return;
    pool.query(
      `UPDATE exam_questions SET embedding = $1 WHERE id = $2`,
      [JSON.stringify(emb), id]
    ).catch(() => { /* silently ignore */ });
  }).catch(() => { /* silently ignore */ });
}

// ── Mapeo de temas (inglés/español) → palabras clave de capítulos japoneses ──
// Permite buscar primero en la sección relevante del libro antes de buscar en general.
const TOPIC_SECTIONS: Array<{ keywords: string[]; jaKeywords: string[] }> = [
  {
    keywords: ["signal","traffic light","semaphor","semaforo","red light","green light","yellow light","flashing","arrow signal","点滅","矢印"],
    jaKeywords: ["信号"],
  },
  {
    keywords: ["police officer","police signal","lamp signal","officer signal","hand signal","officer directing","policeman","guardia","policia","灯火","手信号","警察官"],
    jaKeywords: ["手信号","灯火による信号","警察官"],
  },
  {
    keywords: ["sign","road sign","señal de tráfico","prohibit","restrict","warning sign","標識","標示","indicate","road mark"],
    jaKeywords: ["標識","標示"],
  },
  {
    keywords: ["route bus","bus priority","bus lane","bus approaches","carril de bus","carril prioritario","路線バス","バス専用","優先通行帯"],
    jaKeywords: ["路線バス","バス専用","優先通行帯"],
  },
  {
    keywords: ["overtake","passing","overtaking","adelantar","adelantamiento","pass another","追越"],
    jaKeywords: ["追越し","追い越"],
  },
  {
    keywords: ["park","parking","stop","stopping","estacionar","estacionamiento","駐車","停車"],
    jaKeywords: ["駐車","停車","駐停車"],
  },
  {
    keywords: ["intersection","cruce","junction","crossroads","交差点","roundabout"],
    jaKeywords: ["交差点"],
  },
  {
    keywords: ["speed","velocidad","km/h","kph","limit","reduce speed","slow down","maximum speed"],
    jaKeywords: ["速度"],
  },
  {
    keywords: ["pedestrian","peatone","crosswalk","zebra cross","横断歩道","caminante"],
    jaKeywords: ["歩行者","横断歩道"],
  },
  {
    keywords: ["alcohol","drunk","drinking","bebida","alcool","飲酒"],
    jaKeywords: ["飲酒"],
  },
  {
    keywords: ["highway","autopista","expressway","freeway","motorway","高速道路"],
    jaKeywords: ["高速道路"],
  },
  {
    keywords: ["emergency","ambulance","fire engine","police car","emergencia","救急"],
    jaKeywords: ["緊急"],
  },
  {
    keywords: ["lane change","carril","cambio de carril","lane","merging","進路変更"],
    jaKeywords: ["進路変更","車線"],
  },
  {
    keywords: ["night","nighttime","dark","headlight","noche","nocturno","夜間"],
    jaKeywords: ["夜間","灯火"],
  },
  {
    keywords: ["tow","towing","broken down","remolcar","arrastrar","けん引"],
    jaKeywords: ["けん引"],
  },
  {
    keywords: ["passenger","load","cargo","pasajero","carga","weight","積載"],
    jaKeywords: ["乗車","積載"],
  },
  {
    keywords: ["following distance","braking distance","stopping distance","reaction distance","空走距離","制動距離","停止距離","distancia de detención","distancia de frenado","distancia segura"],
    jaKeywords: ["車間距離","制動距離","停止距離","空走距離"],
  },
  {
    keywords: ["railroad","train crossing","level crossing","ferrocarril","踏切"],
    jaKeywords: ["踏切"],
  },
  {
    keywords: ["motorcycle","motorbike","moto","二輪車","motocicleta"],
    jaKeywords: ["二輪車"],
  },
  {
    keywords: ["license","licencia","permit","permiso","免許"],
    jaKeywords: ["免許"],
  },
  {
    keywords: ["horn","klaxon","corneta","警音器","buzina","beep"],
    jaKeywords: ["警音器"],
  },
  {
    keywords: ["seatbelt","seat belt","cinturon","安全带","child seat","チャイルド"],
    jaKeywords: ["シートベルト","チャイルド"],
  },
];

type KnowledgeRow = { situacion: string; respuesta: string; fuente: string };

/**
 * BÚSQUEDA EN DOS FASES:
 * 1) Detecta el tema de la pregunta → busca primero en el capítulo relevante del libro
 * 2) Si no hay suficientes resultados, busca en todo el libro
 *
 * Esto imita cómo un instructor buscaría: primero va al capítulo correcto.
 */
async function searchKnowledge(preguntaCompleta: string): Promise<KnowledgeRow[]> {
  const lowerQ = preguntaCompleta.toLowerCase();

  // ── Fase 1: Búsqueda por capítulo según tema detectado ───────────────────
  const matchedJaKeywords: string[] = [];
  for (const topic of TOPIC_SECTIONS) {
    if (topic.keywords.some(kw => lowerQ.includes(kw))) {
      for (const ja of topic.jaKeywords) {
        if (!matchedJaKeywords.includes(ja)) matchedJaKeywords.push(ja);
      }
    }
  }

  if (matchedJaKeywords.length > 0) {
    const sectionConds = matchedJaKeywords.map((_, i) => `situacion ILIKE $${i + 1}`).join(" OR ");
    const sectionParams = matchedJaKeywords.map(kw => `%${kw}%`);
    try {
      const sectionResult = await pool.query(
        `SELECT situacion, respuesta, fuente
         FROM bot_knowledge
         WHERE activo = true AND (${sectionConds})
         ORDER BY vistas DESC, created_at DESC
         LIMIT 8`,
        sectionParams
      );
      if (sectionResult.rows.length >= 2) {
        // Encontró contenido en el capítulo correcto → usarlo como fuente primaria
        return sectionResult.rows;
      }
    } catch (_) { /* continuar con búsqueda general */ }
  }

  // ── Fase 2: Búsqueda general en todo el libro (fallback) ─────────────────
  const stopwords = new Set([
    "with","that","this","from","have","when","they","there","which","your","will",
    "what","into","been","more","also","than","then","were","like","their","about",
    "must","should","cannot","would","could","shall","does","hacer","estar","tener",
  ]);
  const words = preguntaCompleta
    .toLowerCase()
    .split(/[\s¿?¡!,.:;'"()\-\/\\]+/)
    .filter(w => w.length >= 5 && !stopwords.has(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);

  if (words.length === 0) return [];

  const conditions = words.map((_, i) =>
    `(situacion_es ILIKE $${i + 1} OR situacion ILIKE $${i + 1} OR respuesta ILIKE $${i + 1})`
  ).join(" OR ");
  const params = words.map(w => `%${w}%`);

  const result = await pool.query(
    `SELECT situacion, respuesta, fuente,
            (${words.map((_, i) =>
              `(CASE WHEN COALESCE(situacion_es,'') ILIKE $${i+1} THEN 3 ELSE 0 END +
               CASE WHEN COALESCE(situacion,'') ILIKE $${i+1} THEN 2 ELSE 0 END +
               CASE WHEN COALESCE(respuesta,'') ILIKE $${i+1} THEN 1 ELSE 0 END)`
            ).join(" + ")}) AS score
     FROM bot_knowledge
     WHERE activo = true AND (${conditions})
     ORDER BY score DESC, vistas DESC
     LIMIT 8`,
    params
  );
  return result.rows;
}

// ─── Search menkyo-online verified Japanese exam Q&A ─────────────────────────
async function searchMenkyoJA(preguntaCompleta: string): Promise<
  { pregunta_ja: string; pregunta_en: string | null; respuesta: boolean; explicacion_ja: string | null; imagen_url: string | null; page_number: number }[]
> {
  const lowerQ = preguntaCompleta.toLowerCase();

  // 1. English keyword search against translated questions (when available)
  const enWords = preguntaCompleta
    .replace(/\d+\.\-?\s*/g, "")
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z]/g, "").toLowerCase())
    .filter(w => w.length > 4);

  // 2. Japanese topic keyword detection from English question
  const matchedJaKeywords: string[] = [];
  for (const topic of TOPIC_SECTIONS) {
    if (topic.keywords.some(kw => lowerQ.includes(kw))) {
      for (const ja of topic.jaKeywords) {
        if (!matchedJaKeywords.includes(ja)) matchedJaKeywords.push(ja);
      }
    }
  }

  if (matchedJaKeywords.length === 0 && enWords.length === 0) return [];

  try {
    const conditions: string[] = [];
    const params: string[] = [];

    // English word search on translated column (high recall)
    for (const w of enWords.slice(0, 6)) {
      params.push(`%${w}%`);
      conditions.push(`pregunta_en ILIKE $${params.length}`);
    }
    // Japanese keyword search as fallback
    for (const ja of matchedJaKeywords) {
      params.push(`%${ja}%`);
      conditions.push(`pregunta_ja ILIKE $${params.length}`);
    }

    if (conditions.length === 0) return [];

    // Score by number of matching conditions — most relevant first
    const scoreExpr = conditions
      .map((cond, i) => `(CASE WHEN ${cond} THEN 1 ELSE 0 END)`)
      .join(" + ");

    const result = await pool.query(
      `SELECT page_number, pregunta_ja, pregunta_en, respuesta, explicacion_ja, imagen_url,
              (${scoreExpr}) AS match_score
       FROM menkyo_questions_ja
       WHERE (${conditions.join(" OR ")})
       ORDER BY (${scoreExpr}) DESC, page_number
       LIMIT 15`,
      params
    );
    return result.rows;
  } catch (_) {
    return [];
  }
}

// ─── Search verified exam questions ──────────────────────────────────────────
type VerifiedQuestion = {
  pregunta: string;
  respuesta: boolean;
  explicacion: string | null;
  imagenUrl: string | null;
  byImage: boolean;
  hasExplicacion: boolean;
  cosineSim: number | null; // 1 - cosine_distance, null si no hay embedding
};

async function searchVerifiedQuestions(
  pregunta: string,
  nivel: number,
  imagenUrl?: string | null,
  excludeId?: number | null
): Promise<VerifiedQuestion[]> {
  const results: VerifiedQuestion[] = [];
  const seen = new Set<string>();

  const excludeClause = excludeId ? `AND id != ${Number(excludeId)}` : "";

  const addRow = (row: any, byImage: boolean, cosineSim: number | null = null) => {
    if (seen.has(row.pregunta)) return;
    seen.add(row.pregunta);
    results.push({ ...row, byImage, hasExplicacion: !!row.explicacion, cosineSim });
  };

  // ── 0. Búsqueda semántica por vector (mayor recall, detecta parafraseo) ─────
  // Se computa el embedding de la pregunta entrante y se compara con los
  // embeddings almacenados usando distancia coseno. Funciona aunque los textos
  // usen palabras completamente distintas para el mismo concepto.
  const embeddingVec = await getEmbedding(pregunta);
  if (embeddingVec) {
    const vecResult = await pool.query(
      `SELECT pregunta, respuesta, explicacion, imagen_url AS "imagenUrl",
              1 - (embedding <=> $1::vector) AS cosine_sim
       FROM exam_questions
       WHERE revisado = true
         AND embedding IS NOT NULL
         AND nivel = $2
         ${excludeClause}
       ORDER BY (CASE WHEN explicacion IS NOT NULL THEN 1 ELSE 0 END) DESC,
                embedding <=> $1::vector
       LIMIT 10`,
      [JSON.stringify(embeddingVec), nivel]
    );
    for (const row of vecResult.rows) {
      addRow(row, false, parseFloat(row.cosine_sim));
    }
  }

  // ── 1. Misma imagen (prioridad cuando hay figura) ─────────────────────────
  if (imagenUrl) {
    const imgResult = await pool.query(
      `SELECT pregunta, respuesta, explicacion, imagen_url AS "imagenUrl"
       FROM exam_questions
       WHERE revisado = true
         AND imagen_url = $1
         ${excludeClause}
       ORDER BY (CASE WHEN explicacion IS NOT NULL THEN 0 ELSE 1 END), id DESC
       LIMIT 3`,
      [imagenUrl]
    );
    for (const row of imgResult.rows) {
      // byImage=true → override el registro existente si ya estaba (sin imagen info)
      seen.delete(row.pregunta);
      addRow(row, true, null);
    }
  }

  // ── 2. Búsqueda léxica por keywords (fallback para preguntas sin embedding) ─
  const words = pregunta
    .replace(/\d+\.\-?\s*/g, "")
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑa-zA-Z0-9]/g, "").toLowerCase())
    .filter(w => w.length > 3)
    .slice(0, 15);

  if (words.length > 0) {
    const conditions = words.map((_, i) => `pregunta ILIKE $${i + 1}`).join(" OR ");
    const params = words.map(w => `%${w}%`);
    const scoreExpr = words
      .map((_, i) => `(CASE WHEN pregunta ILIKE $${i + 1} THEN 1 ELSE 0 END)`)
      .join(" + ");
    const textResult = await pool.query(
      `SELECT pregunta, respuesta, explicacion, imagen_url AS "imagenUrl"
       FROM exam_questions
       WHERE revisado = true
         AND nivel = $${params.length + 1}
         AND (${conditions})
         ${excludeClause}
       ORDER BY (CASE WHEN explicacion IS NOT NULL THEN 1 ELSE 0 END) DESC,
                (${scoreExpr}) DESC,
                id DESC
       LIMIT 10`,
      [...params, nivel]
    );
    for (const row of textResult.rows) {
      addRow(row, false, null);
    }
  }

  return results;
}

async function analyzeWithGPT(pregunta: string, nivel: number, imagenUrl?: string | null, excludeId?: number | null, imagenDescripcion?: string | null, skipVerified?: boolean, useMini?: boolean): Promise<{
  respuesta: boolean;
  explicacion: string;
  referencia: string | null;
  confianza: "alta" | "media" | "baja";
  advertencia: string | null;
  fuentes: string[];
}> {
  // 0. Si se excluye una pregunta específica (modo "Consultar IA" del admin), recuperar
  //    su explicación guardada para pasarla a GPT como contexto verificado.
  //    Así GPT conoce el razonamiento del instructor aunque no use el match directo.
  //    EXCEPCIÓN: si skipVerified=true (botón "Re-analizar desde cero") se omite todo
  //    el banco verificado para que la IA analice sin influencia de respuestas previas.
  let excludedQuestionNota = "";
  let verifiedOverride: { respuesta: boolean; explicacion: string } | null = null;
  // verifiedAnswerOnly: instructor marcó revisado=true pero no escribió explicación.
  // Sabemos la respuesta correcta; GPT debe generar la explicación pero NO cambiar la respuesta.
  let verifiedAnswerOnly: boolean | null = null;
  if (!skipVerified && excludeId) {
    try {
      const excResult = await pool.query(
        `SELECT pregunta, respuesta, explicacion, revisado FROM exam_questions WHERE id = $1 LIMIT 1`,
        [excludeId]
      );
      const exc = excResult.rows[0];
      if (exc && exc.explicacion) {
        // CASO 1: respuesta verificada + explicación guardada → override completo
        const explicacionGuardada = String(exc.explicacion);
        verifiedOverride = { respuesta: Boolean(exc.respuesta), explicacion: explicacionGuardada };
        excludedQuestionNota =
          `\n\n[⚠️ NOTA CRÍTICA — RAZONAMIENTO VERIFICADO POR INSTRUCTOR]\n` +
          `La siguiente pregunta ya fue analizada y verificada manualmente. ` +
          `Si la pregunta actual es la misma o muy similar, esta explicación tiene PRIORIDAD ABSOLUTA sobre cualquier otra fuente:\n` +
          `• Pregunta: "${exc.pregunta}"\n` +
          `• Respuesta verificada: ${exc.respuesta ? "○ VERDADERO" : "× FALSO"}\n` +
          `• Razonamiento del instructor: ${exc.explicacion}\n` +
          `INSTRUCCIÓN: Si tu análisis contradice esta nota, debes adoptar la respuesta verificada y explicar ` +
          `por qué el razonamiento del instructor es correcto.`;
      } else if (exc && exc.revisado) {
        // CASO 2: revisado=true pero sin explicación → la respuesta en BD es correcta,
        // el instructor la verificó aunque no escribió razonamiento.
        // Instruir a GPT para que genere la explicación correcta sin contradecir la respuesta.
        verifiedAnswerOnly = Boolean(exc.respuesta);
        excludedQuestionNota =
          `\n\n[⚠️ NOTA CRÍTICA — RESPUESTA VERIFICADA POR INSTRUCTOR (sin explicación guardada)]\n` +
          `Esta pregunta fue revisada manualmente. La respuesta correcta es: ${exc.respuesta ? "○ VERDADERO" : "× FALSO"}.\n` +
          `• Pregunta: "${exc.pregunta}"\n` +
          `INSTRUCCIÓN OBLIGATORIA: Tu campo "respuesta" DEBE ser ${exc.respuesta ? "true" : "false"}. ` +
          `Explica el razonamiento que justifica esta respuesta según el reglamento de tráfico japonés. ` +
          `NO contradigas esta respuesta verificada bajo ninguna circunstancia.`;
      }
    } catch (_) { /* no bloquear si falla */ }
  }

  // 1. Search verified exam questions (human-corrected) — highest priority
  //    Omitir completamente cuando skipVerified=true para análisis desde cero
  const verifiedQuestions = skipVerified ? [] : await searchVerifiedQuestions(pregunta, nivel, imagenUrl, excludeId);

  // Check for near-exact match by text (75%+ word overlap) OR by same image → return directly
  const preguntaNorm = pregunta.toLowerCase().replace(/\d+\.\-?\s*/g, "").trim();

  // Helper: normalize a word for comparison (remove plural -s/-es, lowercase)
  const stemWord = (w: string): string => {
    if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
    if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
    if (w.endsWith("s") && w.length > 4) return w.slice(0, -1);
    return w;
  };

  // Helper: calculate word overlap ratio between two normalized strings (with stemming).
  // IMPORTANT: numeric tokens (e.g. "30", "50", "10") are always included even if short,
  // because distances/speeds are the most precise discriminators in traffic rule questions.
  // "Passing is prohibited within 30 meters" vs "within 50 meters" are DIFFERENT questions.
  // NEGATION words ("not", "no", "nor") are also always included — they flip the entire
  // meaning of a sentence and must not be dropped just because they're ≤3 chars.
  const isNumeric = (w: string): boolean => /^\d+$/.test(w);
  const isNegation = (w: string): boolean => ["not", "no", "nor"].includes(w);
  const wordOverlap = (a: string, b: string): number => {
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3 || isNumeric(w) || isNegation(w)).map(stemWord));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3 || isNumeric(w) || isNegation(w)).map(stemWord));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  };

  const exactMatch = verifiedQuestions.find(vq => {
    const vqNorm = vq.pregunta.toLowerCase().replace(/\d+\.\-?\s*/g, "").trim();
    if (vq.byImage) {
      // Same image match: text must also overlap 50%+
      return wordOverlap(preguntaNorm, vqNorm) >= 0.5;
    }
    // Current has image but verified has none → different context, block match
    if (imagenUrl && !vq.imagenUrl) return false;
    // Both have images → very high lexical threshold
    if (imagenUrl && vq.imagenUrl) return wordOverlap(preguntaNorm, vqNorm) >= 0.85;

    // ── Texto sin imagen: tres vías para detectar similitud ──────────────────
    //
    // VÍA 1 — Semántica (embedding coseno ≥ 0.82):
    //   Captura parafraseo total aunque no haya palabras en común.
    //   Solo aplica si la pregunta verificada tiene explicación (instructor la corrigió).
    //   Umbral 0.82 = preguntas muy similares en significado.
    if (vq.cosineSim !== null && vq.cosineSim >= 0.82 && vq.hasExplicacion) return true;

    // VÍA 2 — Léxica con umbral reducido para preguntas con explicación (60%):
    //   Misma pregunta con palabras ligeramente distintas entre ediciones del examen.
    // VÍA 3 — Léxica estándar para preguntas sin explicación (70%):
    const threshold = vq.hasExplicacion ? 0.60 : 0.70;
    return wordOverlap(preguntaNorm, vqNorm) >= threshold;
  });

  if (exactMatch) {
    const sourceLabel = exactMatch.byImage
      ? "✅ Banco de preguntas verificadas — misma figura del libro oficial, respuesta confirmada manualmente"
      : "✅ Banco de preguntas verificadas — respuesta confirmada manualmente";
    return {
      respuesta: exactMatch.respuesta,
      explicacion: exactMatch.explicacion ?? "Pregunta verificada en banco de preguntas del libro oficial.",
      referencia: sourceLabel,
      confianza: "alta",
      advertencia: null,
      fuentes: ["banco_preguntas_verificadas"],
    };
  }

  const verifiedContext = verifiedQuestions.length > 0
    ? `\n\n[PREGUNTAS CLAVE VERIFICADAS — BANCO OFICIAL (respuestas 100% confirmadas por instructor)]\n` +
      verifiedQuestions.map(vq => {
        const source = vq.byImage ? "📷 misma figura" : "📝 texto similar";
        const imageWarning = (!vq.byImage && imagenUrl)
          ? `\n  ⚠️ ATENCIÓN: Esta pregunta verificada tiene texto similar PERO la figura actual es DIFERENTE.\n  La imagen mostrada puede cambiar completamente la respuesta. Analiza la figura actual con cuidado\n  y NO asumas que la respuesta es igual a esta pregunta verificada.`
          : `\n  → Respuesta confirmada manualmente por instructor.`;
        return `• [${source}] Pregunta: "${vq.pregunta}" → Respuesta: ${vq.respuesta ? "VERDADERO" : "FALSO"}${vq.explicacion ? ` (${vq.explicacion})` : ""}${imageWarning}`;
      }).join("\n")
    : "";

  // 2. Buscar en paralelo: libro oficial + banco menkyo-online (preguntas verificadas JA)
  const [knowledgeResults, menkyoResults] = await Promise.all([
    searchKnowledge(pregunta),
    searchMenkyoJA(pregunta),
  ]);

  // ── SEGUNDA PRIORIDAD: match directo menkyo (65%+ overlap en traducción inglesa) ──
  // pregunta_en es SOLO un índice de búsqueda — no se muestra al alumno ni a GPT.
  // La fuente de verdad es siempre la pregunta japonesa original.
  // Preguntas con imagen requieren análisis visual → no se hace bypass.
  if (!imagenUrl) {
    // Palabras discriminadoras: si aparecen en el menkyo pero NO en la pregunta del alumno,
    // cambian el significado de la regla y no deben usarse como match directo.
    // Ejemplo: "before and after" (前後) vs "before only" (手前) — trampa clásica del examen.
    const DISCRIMINATING_WORDS = ["after", "前後", "also", "only"];
    const menkyoDirectMatch = menkyoResults.find(m => {
      if (!m.pregunta_en) return false;
      const mNorm = m.pregunta_en.toLowerCase().replace(/\d+\.\-?\s*/g, "").trim();
      if (wordOverlap(preguntaNorm, mNorm) < 0.65) return false;
      // Extra guard: if the menkyo has a discriminating word that the user question does NOT,
      // it's likely a different trap question — reject the direct match.
      const mWords = mNorm.split(/\s+/);
      const qWords = preguntaNorm.split(/\s+/);
      for (const dw of DISCRIMINATING_WORDS) {
        if (mWords.includes(dw) && !qWords.includes(dw)) return false;
      }
      // Negation asymmetry guard: "not allowed" vs "allowed" are OPPOSITE questions.
      // If one has negation ("not","no","nor") and the other doesn't → reject match.
      const NEGATIONS = ["not", "no", "nor"];
      const qHasNeg = NEGATIONS.some(n => qWords.includes(n));
      const mHasNeg = NEGATIONS.some(n => mWords.includes(n));
      if (qHasNeg !== mHasNeg) return false;
      return true;
    });

    if (menkyoDirectMatch) {
      const overlap = (() => {
        const mNorm = (menkyoDirectMatch.pregunta_en ?? "").toLowerCase().replace(/\d+\.\-?\s*/g, "").trim();
        return Math.round(wordOverlap(preguntaNorm, mNorm) * 100);
      })();

      // PRIORIDAD 1A: verifiedOverride (modo "Consultar IA" con excludeId)
      // El instructor verificó esta pregunta específica — su respuesta gana siempre.
      if (verifiedOverride !== null && menkyoDirectMatch.respuesta !== verifiedOverride.respuesta) {
        return {
          respuesta: verifiedOverride.respuesta,
          explicacion: verifiedOverride.explicacion,
          referencia: `⚠️ Banco menkyo-online [p${menkyoDirectMatch.page_number}] difiere — se aplica respuesta verificada por instructor (prioridad máxima)`,
          confianza: "alta" as const,
          advertencia: null,
          fuentes: ["banco_preguntas_verificadas"],
        };
      }
      // PRIORIDAD 1A bis: verifiedAnswerOnly — revisado=true sin explicación guardada.
      // No tenemos explicación propia; dejar que GPT la genere, pero si menkyo contradice
      // la respuesta verificada, salir temprano con la respuesta correcta y pedir explicación a GPT.
      if (verifiedAnswerOnly !== null && menkyoDirectMatch.respuesta !== verifiedAnswerOnly) {
        // Continuar al flujo GPT (no retornar aquí) — GPT ya lleva la nota obligatoria en el prompt.
        // El override final en la sección de post-GPT manejará la corrección si hace falta.
      }

      // PRIORIDAD 1B: near-verified match (modo bot/alumno sin excludeId)
      // Si alguna pregunta verificada tiene 60%+ de overlap con la consulta actual
      // y contradice el banco menkyo, el instructor gana (el menkyo tiene reglas generales;
      // el instructor conoce la excepción específica verificada en examen real).
      const nearVerifiedMatch = verifiedQuestions.find(vq => {
        const vqNorm = vq.pregunta.toLowerCase().replace(/\d+\.\-?\s*/g, "").trim();
        return wordOverlap(preguntaNorm, vqNorm) >= 0.60;
      });
      if (nearVerifiedMatch && nearVerifiedMatch.respuesta !== menkyoDirectMatch.respuesta) {
        return {
          respuesta: nearVerifiedMatch.respuesta,
          explicacion: nearVerifiedMatch.explicacion ?? "Respuesta verificada manualmente por instructor.",
          referencia: `⚠️ Banco menkyo-online [p${menkyoDirectMatch.page_number}] difiere — se aplica respuesta verificada por instructor (prioridad máxima)`,
          confianza: "alta" as const,
          advertencia: null,
          fuentes: ["banco_preguntas_verificadas"],
        };
      }

      // GPT-4o traduce la explicación japonesa al español en el momento.
      // La respuesta (true/false) viene directamente de la fuente japonesa verificada.
      let explicacionEs = "";
      try {
        const miniResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 250,
          messages: [{
            role: "user",
            content:
              `Eres un asistente de examen de manejo japonés. Traduce y explica en español claro y conciso (2-3 oraciones):\n\n` +
              `Pregunta original (japonés): 「${menkyoDirectMatch.pregunta_ja}」\n` +
              `Respuesta verificada: ${menkyoDirectMatch.respuesta ? "○ VERDADERO" : "× FALSO"}\n` +
              `Razón (japonés): ${menkyoDirectMatch.explicacion_ja ?? "問題文の通り (como dice la pregunta)"}\n\n` +
              `Explica por qué la respuesta es ${menkyoDirectMatch.respuesta ? "VERDADERO" : "FALSO"} según el reglamento japonés.`
          }],
        });
        explicacionEs = miniResp.choices[0]?.message?.content?.trim() ?? "";
      } catch (_) {
        explicacionEs = `Razón (JP): ${menkyoDirectMatch.explicacion_ja ?? "問題文の通り"}`;
      }

      return {
        respuesta: menkyoDirectMatch.respuesta,
        explicacion: explicacionEs,
        referencia: `✅ Banco menkyo-online [p${menkyoDirectMatch.page_number}] — 問題: 「${menkyoDirectMatch.pregunta_ja}」 → ${menkyoDirectMatch.respuesta ? "○ VERDADERO" : "× FALSO"}`,
        confianza: "alta" as const,
        advertencia: null,
        fuentes: [`menkyo_online_p${menkyoDirectMatch.page_number}`],
      };
    }
  }

  const menkyoContext = menkyoResults.length > 0
    ? `\n\n[BANCO MENKYO-ONLINE — PREGUNTAS VERIFICADAS DEL EXAMEN JAPONÉS]\n` +
      `⭐ SEGUNDA PRIORIDAD: estas son preguntas reales del examen japonés con respuestas verificadas.\n` +
      `Si la pregunta actual es muy similar a alguna de estas, su respuesta tiene prioridad sobre el libro.\n` +
      menkyoResults.map(m =>
        `• [p${m.page_number}] 問題: 「${m.pregunta_ja}」\n` +
        `  → Respuesta correcta: ${m.respuesta ? "○ VERDADERO" : "× FALSO"}\n` +
        `  → Razón: ${m.explicacion_ja ?? "問題文の通り"}` +
        (m.imagen_url ? `\n  → [Con imagen: ${m.imagen_url}]` : "")
      ).join("\n\n")
    : "";

  const knowledgeContext = knowledgeResults.length > 0
    ? `\n\n[REFERENCIA — PÁGINAS DEL LIBRO OFICIAL JAPONÉS]\n` +
      `⚠️ Este contenido proviene de los PDFs oficiales del manual 教則. Úsalo como fuente primaria.\n` +
      knowledgeResults.map((k: any) =>
        `• [${k.fuente ?? "libro"}] ${k.situacion}${k.respuesta ? `\n  → ${k.respuesta.substring(0, 600)}` : ""}`
      ).join("\n\n")
    : "";

  const figureStep = imagenUrl
    ? `
PASO 0 — ANÁLISIS VISUAL PRECISO DE LA FIGURA (OBLIGATORIO — no saltar):
⚠️ ADVERTENCIA CRÍTICA: El examen japonés usa imágenes que se parecen visualmente
pero representan situaciones COMPLETAMENTE DIFERENTES. Un error al leer la imagen
= respuesta incorrecta. Lee cada detalle visual con máxima precisión.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A) TRANSCRIPCIÓN LITERAL — lo primero antes de cualquier análisis:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   • Todo texto japonés visible (kanji, hiragana, katakana) — cópialo EXACTAMENTE
   • Todos los números (velocidades, distancias, horarios, porcentajes)
   • Palabras en cualquier idioma dentro de señales, carteles o recuadros

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
B) IDENTIFICACIÓN PRECISA DE PARES CONFUNDIBLES — verifica CUÁL de cada par muestra la imagen:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚦 SEMÁFOROS — diferencia CRÍTICA entre sólido y parpadeante:
   • 赤の点灯 (rojo SÓLIDO encendido) → parar obligatorio en línea de parada
   • 赤の点滅 (rojo PARPADEANTE) → parar, luego avanzar con precaución (equivale a 一時停止)
   • 黄の点灯 (amarillo SÓLIDO) → parar si es posible, avanzar con cuidado si ya cruzaste
   • 黄の点滅 (amarillo PARPADEANTE) → avanzar con precaución, no parar obligatorio
   • 青の点灯 (verde SÓLIDO) → avanzar permitido
   • 青の矢印 (flecha verde) → avanzar SOLO en dirección de la flecha
   ⚠️ REGLA CRÍTICA — FLECHA DERECHA Y U-TURN:
      Una flecha verde hacia la DERECHA (右向き矢印) permite TANTO girar a la derecha
      COMO hacer U-turn (転回), porque el U-turn se inicia girando hacia la derecha.
      → Si la pregunta dice que con flecha derecha se puede hacer U-turn → VERDADERO
        (a menos que haya señal 転回禁止 en ese cruce, que prohíbe el U-turn explícitamente)
      ERROR FRECUENTE DE LA IA: Decir FALSO porque "la flecha solo permite ir a la derecha".
      Esto es incorrecto — en Japón, la flecha derecha sí incluye el U-turn.
   ⚠️ CLAVE VISUAL: El parpadeo se indica con líneas discontinuas, vibración, o "点滅" escrito.
      Un círculo relleno = sólido. Un círculo con guiones = parpadeante. ¡NO los confundas!

🚔 SEÑALES DE POLICÍA / GUARDIA DE TRÁFICO — posición del brazo es TODO:

   ⚠️ PERSPECTIVA CRÍTICA: En los dibujos del libro japonés, el oficial se muestra
   SIEMPRE DE PERFIL (vista lateral). Las flechas que apuntan IZQUIERDA y DERECHA
   en la imagen representan el tráfico de FRENTE y ESPALDA del oficial en la vida real,
   NO el tráfico lateral. El tráfico lateral (los lados del oficial) entra/sale de la
   imagen perpendicularmente y no tiene flechas visibles en el dibujo.
   NUNCA confundas "flechas a los lados en la imagen" con "tráfico lateral del oficial".

   SIN lámpara (手信号) — reglas exactas:
   • Brazo UNO extendido HORIZONTAL (腕を水平に横に上げる):
     → Tráfico de FRENTE y ESPALDA del oficial = 🟢 VERDE (puede avanzar)
     → Tráfico LATERAL del oficial (perpendicular) = 🔴 ROJO (parar)
     → En el dibujo de perfil: las flechas izquierda/derecha = VERDE

   • Brazo UNO levantado VERTICAL (腕を垂直に上げる):
     → Tráfico de FRENTE y ESPALDA del oficial = 🟡 AMARILLO (准备停车)
     → Tráfico LATERAL del oficial (perpendicular) = 🔴 ROJO (parar)
     → En el dibujo de perfil: las flechas izquierda/derecha = AMARILLO ← VERDADERO

   • AMBOS brazos extendidos HORIZONTAL (両手を水平に横に上げる):
     → Igual que un brazo horizontal: frente/espalda = VERDE, lados = ROJO

   CON lámpara/linterna (灯火による信号):
   • Lámpara oscilada HORIZONTAL → dirección de oscilación = 🟢 VERDE
   • Lámpara levantada SOBRE LA CABEZA (頭上に上げる) → TODOS = 🛑 一時停止 (parada temporal)
     ⚠️ NO es amarillo — es parada temporal para TODOS sin excepción

   ⚠️ PROCESO OBLIGATORIO para señales de policía:
   1. ¿Tiene lámpara? (灯火) → aplica regla CON lámpara
   2. ¿Brazo horizontal o vertical? (cuenta los brazos y su posición exacta)
   3. ¿Cuál es la perspectiva del dibujo? (de perfil = flechas laterales = tráfico de frente/espalda)
   4. ¿Las flechas de la pregunta indican cuál tráfico? → identifica si es frente/espalda o lateral

🔰 MARCAS DE VEHÍCULOS — formas y colores específicos:
   • 初心者マーク (conductor novato): forma de HOJA / gota de agua verde y amarilla (hoja de árbol)
     → conductor con licencia de menos de 1 año → debe ir al frente Y atrás del auto
   • 高齢者マーク (conductor mayor): TRÉBOL de 4 colores (naranja, amarillo, verde, azul) — versión vieja
     O forma de ÁRBOL naranja y amarillo — versión nueva (desde 2011)
     → conductor de 70 años o más → se recomienda pero no siempre obligatorio
   • 身体障害者マーク (discapacidad física): MARIPOSA de 4 colores
   • 聴覚障害者マーク (discapacidad auditiva): MARIPOSA con forma de auricular, cuatro colores
   • 危険物マーク (materiales peligrosos): señal especial para camiones de carga peligrosa
   ⚠️ CLAVE: 初心者 = HOJA verde/amarilla. 高齢者 = TRÉBOL multicolor. Son TOTALMENTE DISTINTAS.
      Si la imagen muestra el trébol multicolor y la pregunta dice "beginner mark" → FALSO.
      Si la imagen muestra la hoja verde/amarilla y dice "elderly mark" → FALSO.

🔚 SEÑAL DE FIN DE ZONA (終わり) — CRÍTICO cuando hay múltiples imágenes:
   • La señal 終わり es un círculo con una barra diagonal inclinada (azul/gris, sin rojo)
   • Significa que la restricción anterior TERMINA en ese punto
   • SIEMPRE aparece JUNTO A la señal de la restricción que termina
   • Ejemplos:
     転回禁止 + 終わり = fin de zona de prohibición de giro en U → VERDADERO si la pregunta dice "no U-turn area ends here"
     駐停車禁止 + 終わり = fin de zona de no estacionamiento/parada
     追越禁止 + 終わり = fin de zona de no adelantamiento
   ⚠️ ERROR FRECUENTE DE LA IA: analizar solo la primera imagen e ignorar la segunda.
      Si la pregunta dice "this set of signs" o "these signs" → hay MÚLTIPLES señales y
      debes leer TODAS las imágenes juntas para entender el significado combinado.
      Una sola señal de prohibición + señal 終わり = esa prohibición TERMINA ahí.

🛑 SEÑALES DE TRÁFICO — forma + color + contenido interno:
   • Círculo rojo con borde = señal de regulación (規制標識)
   • Triángulo = señal de advertencia (警戒標識)
   • Rectángulo azul = señal de indicación (指示標識)
   • Cuadrado azul con texto = señal informativa
   ⚠️ Lee el símbolo DENTRO de la señal — no basta con el color del borde.
      例: círculo rojo con "30" = límite de velocidad 30 km/h.
          círculo rojo con diagonal = prohibición de paso.

🅿️ SEÑALES DE ESTACIONAMIENTO/PARADA — letras específicas:
   • 駐車禁止 (禁止 = prohibición de estacionar, pero SÍ se puede parar brevemente)
   • 駐停車禁止 (prohibición de estacionar Y de parar — ninguno permitido)
   ⚠️ 駐車 ≠ 駐停車. Si dice solo 駐車禁止, detenerse brevemente puede estar permitido.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
C) DESCRIPCIÓN FÍSICA COMPLETA antes de interpretar:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Describe: forma geométrica exacta, colores específicos, posición de elementos,
   qué está encendido vs apagado, qué está en movimiento vs estático.
   Si hay MÚLTIPLES subfiguras en la imagen, identifica a cuál se refiere la pregunta.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
D) INTERPRETACIÓN — solo después de describir con precisión:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Con la descripción precisa del paso C, identifica la regla exacta del libro
   (教則) que aplica a ESA figura específica.

Ejemplo CORRECTO de análisis (marca):
  "La imagen muestra una señal circular roja con borde blanco y la hoja 初心者マーク
   (verde arriba, amarilla abajo, forma de gota/hoja). No muestra el trébol 高齢者マーク.
   Por lo tanto la pregunta sobre 'beginner driver mark' corresponde exactamente a
   esta figura. Según 教則, conductores con menos de 1 año de licencia ordinaria
   deben colocarla adelante Y atrás del auto durante 1 año."

Ejemplo CORRECTO de análisis (oficial de policía — perspectiva de perfil):
  "La imagen muestra al oficial de policía VISTO DE PERFIL (側面図). El dibujo muestra
   la figura humana con UN brazo levantado hacia arriba (posición vertical, 垂直). Las
   flechas apuntan hacia la IZQUIERDA y DERECHA de la imagen, pero como el oficial está
   de perfil, estas representan el tráfico que viene de FRENTE y de ESPALDA al oficial
   en la realidad — NO el tráfico lateral. Un brazo vertical = 黄信号と同じ (equivale a
   amarillo) para ese tráfico de frente/espalda. Si la pregunta dice 'yellow light for
   those in the direction of the arrows' → VERDADERO."

Ejemplo INCORRECTO (NO hagas esto):
  "La imagen muestra a un oficial con brazos levantados" ← no especifica: ¿uno o dos brazos?
  ¿horizontal o vertical? ¿con o sin lámpara? ¿perspectiva frontal o de perfil?
` : "";

  // ── Prompt: DB content (real PDFs) is the PRIMARY source, GPT knowledge is fallback ──
  const systemPrompt = `Eres un sistema de análisis de preguntas del examen de manejo japonés.
Tu función es determinar si cada pregunta es VERDADERA (○) o FALSA (✕) con el menor error posible.

JERARQUÍA DE FUENTES (del mayor al menor peso):
1. 🥇 [PREGUNTAS VERIFICADAS] — respuestas confirmadas manualmente por instructor humano.
   Prioridad ABSOLUTA. Si hay coincidencia clara con la pregunta actual, esa respuesta es definitiva.
2. 🥈 [BANCO MENKYO-ONLINE] — preguntas reales del examen japonés con respuestas verificadas.
   Si la pregunta actual es muy similar a una de estas, su respuesta tiene prioridad sobre el libro.
   Estas preguntas usan exactamente el mismo esquema de trampas que el examen real.
3. 🥉 [PÁGINAS DEL LIBRO OFICIAL] — contenido extraído de los PDFs del manual 教則.
   Números, distancias y excepciones del libro deben tomarse EXACTAMENTE de allí.
4. Tu conocimiento general del reglamento japonés — solo como respaldo. Indica confianza "media" o "baja".

═══════════════════════════════════════════════════════════════
PROCESO para CADA pregunta:
═══════════════════════════════════════════════════════════════
${figureStep}
PASO 1 — BANCO VERIFICADO (máxima prioridad):
Si aparece [PREGUNTAS VERIFICADAS] con coincidencia clara, esa respuesta es definitiva. FIN.

PASO 1B — BANCO MENKYO-ONLINE (segunda prioridad):
Si aparece [BANCO MENKYO-ONLINE] y hay una pregunta muy similar a la actual (misma trampa,
mismo tema, misma estructura), usa esa respuesta con alta confianza antes de recurrir al libro.
Las traducciones inglesas en el bloque (→ EN: "...") facilitan la comparación directa.

PASO 2 — CITAR DEL LIBRO (tu conocimiento del 教則):
Usando tu conocimiento del manual 教則 y de la 道路交通法, localiza la sección y frase que responde la pregunta.
SIEMPRE debes poder producir una cita en japonés — el libro cubre exhaustivamente:
  • Semáforos (信号機): 信号の意味、矢印信号、点滅信号
  • Señales (標識): 規制標識、指示標識、警戒標識
  • Velocidades (速度): 最高速度、最低速度、速度超過
  • Distancias: 車間距離、停止距離、制動距離
  • Adelantamiento (追い越し): 禁止場所、方法
  • Prioridad de paso (優先): 交差点、緊急車両
  • Estacionamiento (駐停車): 禁止場所、方法、時間
  • Autopistas (高速道路): 本線車道、入口、出口
  • Emergencias: 救急車、消防車
  • Alcohol (飲酒運転): 禁止、罰則

PASO 2B — VERIFICAR EXCEPCIONES DE LA REGLA CITADA (MUY CRÍTICO):
Después de encontrar la regla general, SIEMPRE pregúntate:
¿El libro menciona excepciones a esta regla? ¿La pregunta describe precisamente uno de esos casos de excepción?

Ejemplos de excepciones que el examen pone como respuesta VERDADERO:
  • "Prohibido adelantar dentro de 30m de intersección" → EXCEPTO en 優先道路 (vía prioritaria)
  • "Prohibido estacionar" → puede tener excepciones por señal o permiso
  • "Velocidad máxima X" → autopistas y zonas especiales tienen velocidades distintas
  • Señales de prohibición general → muchas tienen excepciones para ciertos vehículos

Si la pregunta describe el caso que ES la excepción del libro → la respuesta es VERDADERO.
Si la pregunta dice que la excepción NO existe cuando sí existe → la respuesta es FALSO.

══════════════════════════════════════════════════════════════
PASO 2B-EXTRA — CONCEPTOS QUE EL EXAMEN JAPONÉS CONFUNDE INTENCIONALMENTE:
══════════════════════════════════════════════════════════════
Estos pares de conceptos son CASI IGUALES pero con reglas OPUESTAS. El examen los mezcla a propósito.
Antes de responder cualquier pregunta con estos temas, identifica CUÁL de los dos se está describiendo:

┌─────────────────────────────────────────────────────────────────────────────┐
│ 0. SEÑALES DE POLICÍA / GUARDIA DE TRÁFICO (差异CRÍTICA — examen japones)   │
│                                                                             │
│  A) SEÑAL CON EL BRAZO (手信号) — SIN LÁMPARA                              │
│     • Brazo extendido HORIZONTAL (腕を横に水平に上げる):                    │
│       → Tráfico de frente/espalda del oficial = 🟢 VERDE (puede avanzar)  │
│       → Tráfico a izquierda/derecha del oficial = 🔴 ROJO (parar)         │
│     • Brazo levantado VERTICAL (腕を垂直に上げる):                         │
│       → Tráfico de frente/espalda del oficial = 🟡 AMARILLO               │
│       → Tráfico a izquierda/derecha del oficial = 🔴 ROJO                 │
│                                                                             │
│  B) SEÑAL CON LÁMPARA (灯火による信号) — CON LÁMPARA/LINTERNA              │
│     • Lámpara OSCILADA HORIZONTAL (灯火を横に振る):                        │
│       → Tráfico EN la dirección que oscila = 🟢 VERDE                     │
│       → Tráfico CRUZANDO esa dirección = 🔴 ROJO                          │
│     • Lámpara LEVANTADA SOBRE LA CABEZA (灯火を頭上に上げる):              │
│       → TODOS los vehículos = 🛑 PARADA TEMPORAL (一時停止)               │
│       → ⚠ NO es amarillo — es parada temporal para TODOS                  │
│       → Si la pregunta dice "same as yellow" con lámpara en alto → FALSO  │
│                                                                             │
│  CONFUSIÓN TÍPICA DEL EXAMEN:                                               │
│  "Brazo en alto = amarillo para tráfico de frente" ← VERDADERO (手信号)   │
│  "Lámpara en alto = amarillo para algún tráfico" ← FALSO (灯火は一時停止) │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. MARCAS DE PAVIMENTO — ZONAS PROHIBIDAS (diferencia CRÍTICA)              │
│                                                                             │
│  停止禁止部分 (ZONA DE PROHIBICIÓN DE PARADA — rayas diagonales amarillas)  │
│  → Los vehículos SÍ PUEDEN entrar y CIRCULAR por esta zona                  │
│  → Lo que NO PUEDEN hacer es DETENERSE dentro de ella                       │
│  → Solo no debes entrar si hay riesgo de quedar parado dentro               │
│    (前方の状況によって停止するおそれのあるとき = si el tráfico delante      │
│     te haría parar dentro, entonces no entres)                              │
│  → La pregunta "vehicles may NOT ENTER zone with this marking" → FALSO ✕   │
│    (sí pueden ENTRAR — no pueden PARARSE)                                   │
│                                                                             │
│  立入り禁止部分 (ZONA DE NO-ENTRADA — líneas cruzadas, recuadro con X)      │
│  → Los vehículos NO PUEDEN entrar bajo ninguna circunstancia                │
│  → Es una zona de exclusión total                                           │
│  → La pregunta "vehicles may NOT ENTER zone with this marking" → VERDADERO │
│                                                                             │
│  CLAVE PARA DISTINGUIRLAS EN UNA PREGUNTA:                                  │
│  • Si la pregunta dice "may not enter" o "cannot enter" con la marca de     │
│    rayas diagonales amarillas (停止禁止) → FALSO (sí pueden entrar)         │
│  • Si la pregunta dice "may not stop" o "cannot stop" con esa marca → VERDADERO │
│  • TRAMPA CLÁSICA: el examen dice "no entry" cuando la regla real es "no stop"  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 1c. SEÑALES Y MARCAS DE GIRO EN U (転回) — PROHIBICIÓN vs OBLIGACIÓN       │
│                                                                             │
│  転回禁止 (GIRO EN U PROHIBIDO):                                            │
│  → Símbolo: flecha en forma de U + X debajo (o círculo rojo con barra)     │
│  → La X ES EL SÍMBOLO DE PROHIBICIÓN — no es decorativa                   │
│  → Pregunta "this sign indicates you are NOT allowed to make a U-turn"     │
│    → VERDADERO ○ (la X bajo la flecha U = prohibición)                     │
│                                                                             │
│  転回指定場所 (GIRO EN U OBLIGATORIO/PERMITIDO):                            │
│  → Símbolo: flecha en forma de U SIN X, sobre fondo azul                   │
│  → Pregunta "this sign indicates you MUST make a U-turn" → VERDADERO ○     │
│                                                                             │
│  ERROR COMÚN DE LA IA: ver "flecha U + X" e interpretar que la señal       │
│  indica que el giro en U es obligatorio, ignorando que la X = prohibición. │
│  REGLA: En señales japonesas, X o barra diagonal siempre = PROHIBICIÓN.    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 1b. CARRILES DE AUTOBÚS (diferencia crítica)                               │
│                                                                             │
│  バス専用通行帯 (CARRIL EXCLUSIVO de autobús)                               │
│  → Solo pueden usarlo autobuses y vehículos permitidos                      │
│  → Otros vehículos no pueden ingresar salvo para girar o estacionar         │
│  → Si estás dentro, NO se dice "debes salir cuando llegue el bus"           │
│    porque directamente no deberías estar ahí                                │
│                                                                             │
│  路線バス等優先通行帯 (CARRIL PRIORITARIO de bus de ruta)                   │
│  → Todos los vehículos PUEDEN usarlo normalmente                            │
│  → Cuando un bus de ruta (路線バス) se aproxima, otros vehículos            │
│    DEBEN abandonar el carril INMEDIATAMENTE ← VERDADERO en el examen       │
│  → La pregunta que dice "must leave the lane immediately when a route       │
│    bus approaches" → VERDADERO ○                                            │
│                                                                             │
│  SEÑAL VISUAL: La señal azul con ícono de autobús y flecha abajo/lateral   │
│  que aparece en figuras del examen es 路線バス等優先通行帯 (PRIORITARIO)    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 1d. VELOCIDAD EN AUTOPISTAS — TRAMPA CRÍTICA (diferencia ABSOLUTA)          │
│                                                                             │
│  REGLA GENERAL (autopista DIVIDIDA — barrera física central):               │
│  → Automóviles de pasajeros: 100 km/h                                      │
│  → Las autopistas tienen límites DIFERENTES a las carreteras ordinarias.   │
│                                                                             │
│  EXCEPCIÓN ESPECÍFICA DEL EXAMEN — "not divided for each direction":        │
│  → Cuando la autopista (expressway/国道本線) NO tiene separación física     │
│    entre los carriles de sentido contrario (sin barrera central, solo       │
│    postes flexibles o línea pintada) = "not divided for each direction"    │
│  → En ese tramo, se aplica el límite de carretera ORDINARIA = 60 km/h     │
│  → La pregunta: "speed limit for ordinary roads is applied" → VERDADERO ○  │
│                                                                             │
│  TRAMPA CLÁSICA: Decir FALSO porque "las autopistas siempre tienen         │
│  límites distintos a carreteras ordinarias". ← INCORRECTO para autopistas  │
│  NO DIVIDIDAS. La excepción existe EXACTAMENTE para ese caso.              │
│                                                                             │
│  CLAVE PARA DETECTAR: Las palabras "not divided for each direction" en     │
│  una pregunta sobre expressway/高速道路 = autopista sin barrera central    │
│  = límite de carretera ordinaria aplica = VERDADERO.                       │
│                                                                             │
│  Verificado: Examen de Konosu — pregunta #381, instructor confirmó VERDADERO│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 1e. 一方通行 vs SEÑALES DE DIRECCIÓN — TRAMPA VISUAL CRÍTICA                │
│                                                                             │
│  SEÑAL A — 一方通行 (ONE WAY / UN SOLO SENTIDO):                           │
│  → Fondo AZUL SÓLIDO + flecha BLANCA (en la dirección de circulación)      │
│  → Significa: la vía es de un solo sentido en la dirección de la flecha    │
│  → Pregunta "this sign means One Way" con esta señal → VERDADERO ○         │
│                                                                             │
│  SEÑAL B — 左折可 / señal de dirección permitida (GIRO/DIRECCIÓN):         │
│  → Marco/borde AZUL + fondo BLANCO + flecha AZUL (o solo flecha azul)      │
│  → Puede ser flecha izquierda (←), derecha (→), o frente (↑)              │
│  → Significa: dirección de giro o avance PERMITIDA (no one way)            │
│  → Pregunta "this sign means One Way" con esta señal → FALSO ✕             │
│                                                                             │
│  CLAVE VISUAL PARA DISTINGUIRLAS:                                           │
│  • ¿El FONDO es AZUL sólido? → 一方通行 (One Way) → dice la dirección      │
│    de toda la vía                                                           │
│  • ¿El FONDO es BLANCO con borde o flecha azul? → señal de dirección       │
│    permitida (left turn, right turn, etc.) → NO es One Way                 │
│                                                                             │
│  TRAMPA: Ambas tienen flecha azul apuntando en alguna dirección.           │
│  La diferencia es el FONDO. Fondo azul = One Way. Fondo blanco = No.      │
│                                                                             │
│  ERROR FRECUENTE DE LA IA: Ver "flecha izquierda azul" y citar el libro   │
│  sobre 一方通行 como si fueran la misma señal. Son señales distintas.      │
│  SIEMPRE verificar el COLOR DEL FONDO antes de identificar la señal.       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. CARRILES EN INTERSECCIONES                                               │
│  優先道路 (vía prioritaria): los vehículos de vía SECUNDARIA ceden          │
│  → Si tu vía ES 優先道路: NO cedes el paso, continúas                       │
│  → Si tu vía NO ES 優先道路: cedes a la vía prioritaria                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. ADELANTAMIENTO vs SOBREPASO (追越し vs 追い抜き)                         │
│  追越し: cambias de carril para pasar → sujeto a todas las restricciones    │
│  追い抜き: pasas por el mismo carril sin cambiar → menos restricciones      │
│  El examen usa estas palabras para crear trampas                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. DETENCIÓN OBLIGATORIA vs REDUCIR VELOCIDAD                               │
│  一時停止 (parada obligatoria): debes DETENERTE completamente               │
│  徐行 (reducir velocidad): debes reducir a velocidad donde puedes parar     │
│     inmediatamente (≈10 km/h) pero no es detención completa                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 5b. TRAMPA DE CONDICIONAL NEGATIVA (error lógico muy frecuente)             │
│                                                                             │
│  PATRÓN DEL LIBRO: "Si NO puedes hacer A → entonces debes hacer B"         │
│  LECTURA INCORRECTA: "Siempre debes hacer B cerca de [situación]"          │
│  LECTURA CORRECTA:   "Si SÍ puedes hacer A → NO necesitas hacer B"         │
│                                                                             │
│  EJEMPLOS DIRECTOS DEL LIBRO (教則 p1_pg076):                               │
│                                                                             │
│  A) Peatones/bicicletas:                                                    │
│     Libro: 「安全な間隔をあけることができないときは、徐行しなければならない」│
│     = "Solo cuando NO puedes mantener distancia segura → debes 徐行"       │
│     PREGUNTA: "If you can give a safe wide berth, you do NOT need to slow  │
│               down" → ○ VERDADERO ← el libro dice exactamente esto         │
│                                                                             │
│  B) Zona de seguridad (安全地帯):                                            │
│     Libro: 「安全地帯に歩行者がいないときは、徐行する必要はありません」     │
│     = "Si la zona de seguridad está vacía → NO necesitas 徐行"             │
│     PREGUNTA: "No need to slow down at safety zone if no pedestrians" → ○  │
│                                                                             │
│  REGLA GENERAL: Si el libro dice "cuando NO puedes X → haz Y", entonces   │
│  "cuando SÍ puedes X → Y no es obligatorio" = VERDADERO en el examen.     │
│  NO leas condiciones parciales como reglas absolutas.                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. DISTANCIAS DE DETENCIÓN OFICIALES DEL LIBRO (教則 第1部 p1_pg071)        │
│                                                                             │
│  FÓRMULA OFICIAL del libro para distancia segura de seguimiento:            │
│  → Entre 30 y 60 km/h: (velocidad en km/h) − 15 = distancia en metros     │
│    Ejemplos: 30km/h → 15m  /  50km/h → 35m  /  60km/h → 45m               │
│  → Más de 60 km/h: la velocidad en números = distancia en metros           │
│    Ejemplo: 80km/h → 80m                                                   │
│                                                                             │
│  VALORES CLAVE (distancia de detención en asfalto seco):                   │
│  • 60 km/h → aprox. 45 metros  ← valor del libro (60 − 15 = 45)           │
│  • 80 km/h → aprox. 80 metros                                              │
│                                                                             │
│  ⚠ Si la pregunta dice "approximately 45 meters at 60 km/h" → VERDADERO   │
│  La IA NO debe usar su propia estimación (44m, 43m, etc.) para refutar    │
│  un número del libro. El libro dice 45m → 45m es correcto.                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. TRAMPA DEL MOMENTO / TIMING (trampa frecuente — una palabra lo cambia)  │
│                                                                             │
│  El examen reemplaza el momento CORRECTO por uno INCORRECTO en la pregunta.│
│  Las palabras "right before", "just before", "immediately before",         │
│  "at the intersection", "when turning" suelen ser la trampa.               │
│                                                                             │
│  REGLA DE ORO JAPONESA — GIROS (道路交通法):                                │
│  • Señal de giro: dar 30 METROS ANTES de la intersección (→ 3秒前 en vías  │
│    de alta velocidad). NUNCA "just before turning".                         │
│  • Posición para girar: empezar a pegarse al lado correspondiente           │
│    PROGRESIVAMENTE desde ~30m antes. NUNCA moverse "right before" girar.   │
│                                                                             │
│  EJEMPLO REAL DEL EXAMEN (pregunta #49 verificada por instructor):          │
│  "When making a left turn at an intersection (excluding roundabouts)        │
│   you should move to the left side of the road RIGHT BEFORE you make a     │
│   left turn." → ✕ FALSO                                                    │
│  Razón: debes pegarte al borde izquierdo desde ~30m antes de la            │
│  intersección (junto con la señal), no en el último momento.               │
│                                                                             │
│  "The signal for turning should be given JUST BEFORE performing the         │
│   action." → ✕ FALSO (correcto: 30 metros antes)                           │
│                                                                             │
│  DETECTAR ESTA TRAMPA:                                                      │
│  Si la pregunta habla de señales o posición para girar, verifica el        │
│  MOMENTO descrito:                                                          │
│  • "right before / just before / immediately" → probablemente FALSO         │
│  • "30 meters before / 30m ahead" → probablemente VERDADERO                │
│  • "progressively / in advance / approaching" → probablemente VERDADERO    │
│                                                                             │
│  OTROS MOMENTOS CLAVE QUE EL EXAMEN MEZCLA:                                │
│  • Señal de cambio de carril: 3 SEGUNDOS antes de cambiar                  │
│  • Señal para detenerse/estacionarse: 30m antes en ciudad / vías normales  │
│  • Señal de U-turn (転回): 30 METROS antes                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 6b. TRAMPA DEL PROCEDIMIENTO (el método importa tanto como el resultado)    │
│                                                                             │
│  PATRÓN: La pregunta describe un RESULTADO correcto y deseable, pero el     │
│  MÉTODO descrito viola el procedimiento exacto que exige el manual.         │
│  El bot falla porque ve el resultado correcto e ignora que el "cómo"        │
│  también está regulado paso a paso.                                         │
│                                                                             │
│  PALABRAS CLAVE DE ALERTA: "all at once", "in one motion", "forcefully",   │
│  "without stopping", "de un solo golpe", "con fuerza de una vez",          │
│  "without pausing", "directly", "immediately", "sin detenerse".            │
│  Si la pregunta describe hacer algo "de golpe/todo junto" donde el manual  │
│  exige un procedimiento de varios pasos → sospecha TRAMPA.                 │
│                                                                             │
│  EJEMPLO REAL — CERRAR LA PUERTA DEL VEHÍCULO (trampa clásica):            │
│  PREGUNTA: "When closing the door after getting in the vehicle, to prevent  │
│  the door from being ajar, do not stop part-way, and force fully close the  │
│  door all at once."                                                         │
│  → Parece lógico: "cerrar con fuerza = no queda abierta" ← ANZUELO         │
│  → PERO el manual exige procedimiento de 3 pasos:                          │
│     1. Jalar la puerta hasta que falten ~10 cm para cerrar                 │
│     2. Detener un instante (verificar que no haya ropa, dedos, objetos)    │
│     3. Empujar firmemente para cerrar del todo                             │
│  → "Cerrar de un solo golpe sin detenerse" viola el paso 2 → FALSO        │
│                                                                             │
│  OTROS PROCEDIMIENTOS DEL MANUAL QUE EL EXAMEN DISTORSIONA:               │
│  • Arrancar el vehículo: hay un orden específico (ajustar asiento → espejos │
│    → cinturón → arrancar). "All at once" o saltarse pasos → sospecha.      │
│  • Arrancar en pendiente: freno de mano → soltar embrague → acelerar →     │
│    soltar freno. El orden exacto importa.                                   │
│  • Cambiar de carril: señal → verificar espejo → verificar punto ciego →   │
│    cambiar. Saltarse la verificación del punto ciego → FALSO.              │
│                                                                             │
│  REGLA: Si la pregunta dice que un procedimiento multi-paso puede hacerse  │
│  "todo junto" o "directamente" → verificar si el manual exige pasos        │
│  intermedios. Si los exige → FALSO aunque el resultado final parezca ok.   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 7. TRAMPA DE AFIRMACIÓN PARCIAL (error de lógica frecuente en la IA)        │
│                                                                             │
│  PATRÓN: El examen afirma una CONDICIÓN SUFICIENTE válida de una regla,     │
│  y la IA la rechaza porque no es la ÚNICA condición.                        │
│                                                                             │
│  REGLA LÓGICA: "Cuando A → debes hacer B" es VERDADERO                     │
│  aunque B también se aplique en otras situaciones.                          │
│  El enunciado no dice "SOLO cuando A → B". Solo dice "cuando A → B".       │
│                                                                             │
│  EJEMPLO DIRECTO (pregunta #29, verificada por instructor):                 │
│  "If lanes are not designated by signs or markings, you should drive in the │
│   left lanes when driving below the speed limit."                           │
│  → La IA dice: FALSO porque "siempre debes ir a la izquierda, no solo      │
│    cuando vas lento" ← ERROR LÓGICO                                         │
│  → La respuesta correcta: ○ VERDADERO                                       │
│  → Razón: "cuando vas lento → carril izquierdo" ES UNA AFIRMACIÓN VÁLIDA.  │
│    No dice "SOLO cuando vas lento". Es una condición suficiente verdadera.  │
│                                                                             │
│  CÓMO DETECTAR ESTA TRAMPA:                                                 │
│  Si tu análisis dice "FALSO porque la regla aplica siempre, no solo        │
│  cuando [condición]" → DETENTE. Eso no hace la afirmación falsa.           │
│  "Cuando llueve, debes encender los faros" es VERDADERO aunque también      │
│  debas encenderlos de noche. La condición es suficiente, no exclusiva.      │
│                                                                             │
│  REGLA: Solo es FALSO si la condición descrita es INCORRECTA o PROHIBIDA.  │
│  NO es FALSO porque la regla tiene casos adicionales no mencionados.        │
└─────────────────────────────────────────────────────────────────────────────┘

PASO 2D — PROTOCOLO ANTI-TRAMPA (ejecutar SIEMPRE antes de responder):
════════════════════════════════════════════════════════════════════
Este protocolo descompone la pregunta en partes para detectar los 4 patrones de engaño más comunes del examen japonés.

──────────────────────────────────────────────────────────────────
PASO 2D-1 — DESGLOSE OBLIGATORIO: Premisa + Conclusión
──────────────────────────────────────────────────────────────────
Antes de analizar, divide mentalmente la oración en:
  • PREMISA (inicio): la situación o acción descrita al principio.
  • CONCLUSIÓN (final): lo que la pregunta afirma que debe pasar o que está permitido.
Evalúa CADA parte por separado. Solo es VERDADERO si AMBAS partes son correctas.

──────────────────────────────────────────────────────────────────
PASO 2D-2 — FILTRO DE ABSOLUTOS (⚠ PALABRA CLAVE)
──────────────────────────────────────────────────────────────────
Si la pregunta contiene: "Siempre", "Nunca", "Solamente", "En cualquier caso",
"Always", "Never", "Only", "Under any circumstances", "Sin excepción", "必ず", "絶対に":
→ MARCAR COMO SOSPECHOSA y verificar: ¿existe alguna excepción legal a esta regla?

REGLA DE ORO: En Japón casi todas las leyes tienen excepciones (vehículos de emergencia,
vías prioritarias, condiciones climáticas, señales especiales, permisos temporales).
Si la pregunta usa un absoluto pero la ley tiene excepciones → la respuesta es FALSO.
EXCEPCIÓN A LA REGLA: Solo una regla SÍ es absoluta sin excepciones → conducir bajo
los efectos del alcohol (飲酒運転). Si la pregunta dice "Nunca debes conducir ebrio" → VERDADERO.

──────────────────────────────────────────────────────────────────
PASO 2D-3 — VALIDACIÓN DE POLARIDAD (final de la frase)
──────────────────────────────────────────────────────────────────
Revisa el FINAL de la pregunta:
  1. ¿Termina en una negación? ("no debe", "no se permite", "cannot", "must not", "はいけない", "できない")
  2. ¿La parte INICIAL de la frase era verdadera?
  3. ¿Esa negación INVIERTE el sentido de la parte inicial que era correcta?
Si la respuesta a los tres puntos es SÍ → la respuesta es FALSO aunque la premisa sea correcta.

EJEMPLO:
  "Al acercarse a un paso a nivel, debes mirar a ambos lados [PREMISA VERDADERA]
   y NO es necesario reducir la velocidad si las barreras están abiertas [NEGACIÓN FINAL]"
  → La negación del final contradice la norma → FALSO

──────────────────────────────────────────────────────────────────
PASO 2D-4 — TRAMPA DE SUJETO Y OBJETO (¿quién hace qué?)
──────────────────────────────────────────────────────────────────
Identifica EXPLÍCITAMENTE: ¿quién debe realizar la acción? ¿quién tiene la prioridad? ¿en qué lugar?
El examen describe una maniobra CORRECTA pero asignada al vehículo EQUIVOCADO o en el lugar EQUIVOCADO.

EJEMPLOS CLÁSICOS DEL EXAMEN JAPONÉS:
  ✗ "En cuesta arriba estrecha, el vehículo que BAJA debe dar el paso"
    → FALSO: es el que BAJA quien tiene prioridad; el que SUBE debe ceder (buscar refugio si hay uno)
    → ¿Hay refugio? → el que SUBE debe entrar en él, NO el que baja.

  ✗ "En intersección con señal de ceda el paso, el vehículo con la señal tiene prioridad"
    → FALSO: la señal 一時停止/徐行 obliga a CEDER, no a tener prioridad.

  ✗ "En rotonda, los vehículos que entran tienen prioridad sobre los que circulan dentro"
    → FALSO: los que YA circulan dentro tienen prioridad.

VERIFICACIÓN: Antes de responder preguntas de prioridad o ceda el paso, confirma:
  • ¿Cuál es el sujeto de la acción (quien DEBE ceder / quien DEBE esperar)?
  • ¿La pregunta lo invirtió respecto a la ley?
  • ¿La maniobra está en el lugar o momento correcto?

──────────────────────────────────────────────────────────────────
PASO 2D-5 — TRAMPA DE PRIORIDAD DEL PEATÓN (横断歩道・歩行者優先)
──────────────────────────────────────────────────────────────────
PRINCIPIO JAPONÉS ABSOLUTO: En Japón, la duda siempre se resuelve a FAVOR del peatón.
Un conductor DEBE detenerse ante un paso de peatones si hay un peatón presente — incluso
si el peatón se detuvo, está dudando o parece que no va a cruzar.

TRAMPA MÁS COMÚN: La pregunta dice que el peatón "se detuvo" o "ya no cruzaba", y concluye
que el conductor "puede continuar". Esto es FALSO.

ANÁLISIS OBLIGATORIO si la pregunta menciona peatón + cruce/paso de peatones:
  1. Identifica el sujeto: ¿el peatón está en o cerca del cruce? → SI → el conductor DEBE ceder.
  2. Identifica la acción del peatón: "se detuvo", "espera", "retrocedió" → IRRELEVANTE para la ley.
     La presencia del peatón en el cruce ya activa la obligación de ceder.
  3. Identifica la acción del conductor: "puede continuar", "no necesita detenerse" → CASI SIEMPRE FALSO.

REGLA DE ORO — LEE ESTO ANTES DE RESPONDER CUALQUIER PREGUNTA CON PEATÓN EN CRUCE:
  → Si el peatón está en o cerca del paso de peatones Y la conclusión es que el conductor
    puede continuar sin detenerse → la respuesta es FALSO.
  → La ÚNICA excepción legítima: "横断する歩行者がいないことが明らかな場合" = cuando es
    EVIDENTE que NO hay ningún peatón cruzando (cruce completamente despejado, sin nadie cerca).
    Si el peatón está presente aunque sea parado → NO es "evidente que no hay peatones" → FALSO.

PALABRAS CLAVE DE ALERTA en este tipo de trampa:
  "stopped / se detuvo", "waiting / esperando", "hesitating / dudando",
  "backed away / retrocedió", "not crossing / no estaba cruzando",
  "may continue / puede continuar", "no need to stop / no necesita detenerse"

EJEMPLO (pregunta #82 Kanagawa):
  "Hay un peatón en el cruce pero se detuvo cuando el vehículo se acercó, por lo que puede continuar."
  → Sujeto: peatón PRESENTE en el cruce.
  → Acción del peatón: "se detuvo" = IRRELEVANTE.
  → Conclusión del conductor: "puede continuar" = ILEGAL.
  → RESULTADO: FALSO ✗

──────────────────────────────────────────────────────────────────
PASO 2D-6 — TRAMPA DE PARADA OBLIGATORIA AL CRUZAR ACERA / FRANJA LATERAL (歩道・路側帯横断)
──────────────────────────────────────────────────────────────────
PRINCIPIO JAPONÉS ABSOLUTO (道路交通法第17条): Cuando un vehículo motorizado o ciclomotor
cruza una acera (歩道) o franja lateral (路側帯) para entrar o salir de un local comercial,
garaje, gasolinera o cualquier lugar junto a la vía, SIEMPRE debe:
  1. Detenerse por completo (一時停止) JUSTO ANTES de la acera/franja lateral.
  2. Ceder el paso a los peatones.
Esta parada completa es INCONDICIONAL — no depende de si hay peatones presentes o visibles.

TRAMPA MÁS COMÚN: La pregunta añade una condición de visibilidad o ausencia de peatones
y concluye que NO es necesaria la parada completa. Esto es SIEMPRE FALSO.

Variantes de la trampa que debes detectar:
  ✗ "…if there are clearly no pedestrians nearby, it is not necessary to come to a complete stop"
  ✗ "…si no hay peatones visibles, puede pasar despacio sin detenerse por completo"
  ✗ "…歩行者がいないことが明らかな場合は、一時停止する必要はありません"

⚠️ NOTA CRÍTICA — ERROR FRECUENTE DE LA IA:
  El texto "歩行者がいないことが明らかな場合は、一時停止する必要はありません" aparece en
  algunos materiales de estudio como excepción para PASOS DE PEATONES en vía pública (横断歩道),
  pero NUNCA aplica al cruce de aceras o franjas laterales para entrar/salir de locales.
  Son contextos distintos. No confundirlos.

ANÁLISIS OBLIGATORIO si la pregunta menciona cruce de acera / franja lateral:
  1. ¿El vehículo cruza una acera (sidewalk/歩道) o franja lateral (side strip/路側帯)? → SÍ
  2. ¿La conclusión condiciona la parada a "si hay peatones" o "si los veo"? → SÍ → FALSO.
  3. La parada completa antes de la acera es obligatoria SIEMPRE, incluso si no hay nadie.

PALABRAS CLAVE DE ALERTA:
  "sidewalk / acera / 歩道", "side strip / franja lateral / 路側帯",
  "if no pedestrians / si no hay peatones / 歩行者がいない場合",
  "not necessary to stop / no necesita detenerse / 一時停止する必要はない",
  "proceed slowly / pasar despacio / 徐行でよい"

EJEMPLO (pregunta #140 Tochigi):
  "When a vehicle or moped proceeds over a sidewalk or side strip to go in or out of a
   roadside location, if there are clearly no pedestrians nearby, it is not necessary to
   come to a complete stop just before."
  → Cruce de acera: SÍ.
  → Condición: "if clearly no pedestrians" = condición que la ley NO permite.
  → Conclusión: "not necessary to come to a complete stop" = ILEGAL.
  → RESULTADO: FALSO ✗

──────────────────────────────────────────────────────────────────
PASO 2D-7 — TRAMPA DE ACCIÓN INSUFICIENTE CON VEHÍCULO DE EMERGENCIA EN/CERCA DE INTERSECCIÓN
──────────────────────────────────────────────────────────────────
REGLA JAPONESA — DOS ESCENARIOS DISTINTOS (道路交通法第40条):

  A) DENTRO O CERCA DE UNA INTERSECCIÓN (交差点またはその付近):
     ⟹ El conductor DEBE: (1) salir/dejar libre la intersección, Y (2) DETENERSE POR COMPLETO.
     ⟹ Conducir despacio, ceder el paso sin detener, o moverse a la izquierda sin parar = INSUFICIENTE → FALSO.

  B) EN CUALQUIER OTRO LUGAR (それ以外の場所):
     ⟹ El conductor DEBE: hacerse a la izquierda y ceder el paso.
     ⟹ No es obligatorio detenerse por completo a menos que sea necesario para que el vehículo pase.

TRAMPA MÁS COMÚN: La pregunta describe el escenario A (intersección) pero la acción
del conductor es solo "conducir despacio" o "hacerse a la izquierda" sin detenerse completamente.
Eso es insuficiente para el escenario A → FALSO.

Variantes de la trampa que debes detectar:
  ✗ "…I freed the intersection and drove slowly along the left side"
  ✗ "…me hice a la izquierda y reduje la velocidad" (sin detenerse)
  ✗ "…交差点付近で左側に寄って徐行した" (solo徐行, sin一時停止)

ANÁLISIS OBLIGATORIO si hay vehículo de emergencia en la pregunta:
  1. ¿El conductor está en o cerca de una intersección (near/at intersection)? → Paso A aplica.
  2. ¿La acción descrita es solo "slowly / despacio / 徐行" o "moved aside / se hizo a un lado"
     sin mencionar parada completa (stopped / 一時停止)? → INSUFICIENTE → FALSO.
  3. Si en vía abierta (no intersección) y el conductor cede el paso → puede ser VERDADERO.

PALABRAS CLAVE DE ALERTA:
  "emergency vehicle / vehículo de emergencia / 緊急自動車",
  "intersection / intersección / 交差点", "near / cerca / 付近",
  "drove slowly / condujo despacio / 徐行", "freed / liberé / 避けた",
  "along the left side / por el lado izquierdo / 左側に寄って"

EJEMPLO (pregunta #118 Tochigi):
  "When passing near an intersection, an emergency vehicle was approaching, so I freed
   the intersection and drove slowly along the left side of the road."
  → Escenario: cerca de intersección = Escenario A.
  → Acciones: "freed the intersection" (✓ correcto) + "drove slowly" (✗ insuficiente, falta parada).
  → Falta: detenerse por completo (一時停止).
  → RESULTADO: FALSO ✗

──────────────────────────────────────────────────────────────────
PASO 2D-8 — TRAMPA DEL CARRIL "RÁPIDOS A LA DERECHA" EN VÍA DE DOS CARRILES (片側2車線)
──────────────────────────────────────────────────────────────────
REGLA JAPONESA ABSOLUTA (道路交通法第20条): En una vía con DOS carriles en la misma dirección:
  ⟹ TODOS los vehículos deben circular por el carril IZQUIERDO (左側の車両通行帯を通行しなければならない).
  ⟹ El carril DERECHO se reserva EXCLUSIVAMENTE para adelantar (追い越し) y uso temporal.
     No es un carril de circulación normal para vehículos rápidos.

TRAMPA MÁS COMÚN: La pregunta divide los vehículos en "lentos → carril izquierdo / rápidos → carril derecho"
como si el carril derecho fuera el carril estándar para vehículos rápidos. Esto es FALSO.

La lógica errónea que suena razonable pero viola la ley:
  ✗ "slow moving vehicles must use the left lane and faster vehicles must proceed in the right lane"
  ✗ "los vehículos lentos van por la izquierda y los rápidos por la derecha"
  ✗ "遅い車は左側、速い車は右側の車両通行帯を通行する"

Por qué es FALSO:
  1. La regla no distingue por velocidad — aplica a TODOS: todos al carril izquierdo.
  2. El carril derecho NO es el carril de los vehículos rápidos — es el carril de adelantamiento
     (se usa temporalmente y luego se regresa al carril izquierdo).
  3. Un vehículo rápido que circula continuamente por el derecho sin adelantar viola la ley.

ANÁLISIS OBLIGATORIO si la pregunta menciona "dos carriles en la misma dirección":
  1. ¿La pregunta implica que vehículos rápidos deben/pueden usar el carril derecho
     como carril de circulación normal? → FALSO.
  2. ¿La pregunta dice que TODOS los vehículos usan el izquierdo y el derecho es solo para
     adelantar? → VERDADERO.

PALABRAS CLAVE DE ALERTA:
  "two lanes / dos carriles / 2車線", "same direction / misma dirección / 同一方向",
  "right lane / carril derecho / 右側の車両通行帯",
  "faster vehicles / vehículos más rápidos / 速い車",
  "must proceed in the right / deben ir por la derecha"

EJEMPLO (pregunta #167 Tochigi Examen 3):
  "On roads with two vehicular lanes in the same direction, slow moving vehicles must use
   the left lane and faster vehicles must proceed in the right lane."
  → Dos carriles misma dirección: SÍ.
  → Afirma: rápidos → carril derecho como carril normal.
  → Ley: TODOS al izquierdo; derecho solo para adelantar.
  → RESULTADO: FALSO ✗

──────────────────────────────────────────────────────────────────
PASO 2D-9 — TRAMPA DE DURACIÓN DE LA SEÑAL DE GIRO (右左折の合図タイミング)
──────────────────────────────────────────────────────────────────
REGLA JAPONESA (道路交通法第53条 + 施行令第21条): La señal de giro (izquierda/derecha)
en una INTERSECCIÓN tiene la siguiente duración OBLIGATORIA:
  → INICIO: 30 metros ANTES de la intersección donde girarás.
  → DURANTE: Toda la maniobra de giro (incluyendo mientras el volante está girado).
  → FIN: La señal debe mantenerse hasta que la acción esté COMPLETADA.
     (Según el banco Menkyo-online: "行為が終わって３秒間の間は合図を続けなければならない"
      → la señal se mantiene incluso hasta 3 segundos DESPUÉS de completar la maniobra.)

DIFERENCIA CLAVE CON CAMBIO DE CARRIL (追い越し / 進路変更):
  → Cambio de carril: señal 3 segundos ANTES de cambiar, se apaga al completar el cambio.
  → Giro en intersección: señal 30m antes + DURANTE todo el giro + hasta completarlo.

TRAMPA MÁS COMÚN: La IA confunde la regla de cambio de carril ("apagar la señal al
completar") con la regla de giro en intersección, y dice FALSO cuando la pregunta
afirma que debes mantener la señal durante todo el giro.

La afirmación "you must continue to signal until you have completed the action" (al girar)
es VERDADERO — de hecho la ley exige más: mantenerla hasta 3 segundos después.

Variantes de la trampa que debes detectar:
  ✓ "continue to signal until completed" → VERDADERO (la afirmación es correcta)
  ✓ "mantener la señal durante todo el giro" → VERDADERO
  ✓ "右左折が終わるまで合図を続ける" → VERDADERO
  ✗ "puedes apagar la señal antes de terminar de girar" → FALSO
  ✗ "la señal se puede apagar al iniciar el giro" → FALSO

ANÁLISIS OBLIGATORIO si la pregunta menciona señal de giro + intersección:
  1. ¿La pregunta dice que la señal debe mantenerse durante / hasta completar el giro? → VERDADERO.
  2. ¿La pregunta implica que la señal puede apagarse antes o durante el giro? → FALSO.
  3. No confundir con cambio de carril (diferente regla de duración).

PALABRAS CLAVE DE ALERTA:
  "turn left / right / girar / 右左折",
  "continue to signal / mantener la señal / 合図を続ける",
  "until completed / hasta completar / 行為が終わるまで",
  "signal timing / 合図のタイミング"

EJEMPLO (pregunta #300):
  "When turning left or right, you must continue to signal until you have completed the action."
  → Contexto: giro en intersección.
  → Afirmación: señal durante todo el giro = lo que exige la ley.
  → Confusión de la IA: usa regla de cambio de carril (error).
  → RESULTADO: VERDADERO ✓

──────────────────────────────────────────────────────────────────
PASO 2D-10 — TRAMPA DE CONFUSIÓN DE SEÑALES DE PROHIBICIÓN (通行止 vs 車両通行止め vs 進入禁止)
──────────────────────────────────────────────────────────────────
JAPÓN TIENE TRES SEÑALES DE PROHIBICIÓN DISTINTAS — el examen las confunde deliberadamente:

  SEÑAL 1 — 通行止 (Tsūkōdome) = "CERRADO PARA TODOS" 🔴
  ▸ Apariencia: círculo blanco con borde rojo + X roja grande en el interior (como un aspa).
  ▸ Efecto: PROHÍBE el paso a TODOS — vehículos, tranvías Y PEATONES.
  ▸ Se usa cuando el camino es físicamente intransitable para cualquier persona
    (derrumbe, obra peligrosa, zona de riesgo inminente).
  ▸ Los peatones NO pueden pasar. NADIE puede pasar.

  SEÑAL 2 — 車両通行止め (Sharyō tsūkō-dome) = "CERRADO PARA VEHÍCULOS"
  ▸ Apariencia: círculo blanco con borde rojo (sin X, solo el borde).
  ▸ Efecto: prohíbe vehículos y tranvías. Los PEATONES SÍ pueden pasar.
  ▸ Típica en zonas peatonales, mercados o áreas escolares.

  SEÑAL 3 — 進入禁止 (Shinnyū kinshi) = "NO ENTRAR"
  ▸ Apariencia: fondo rojo con barra blanca horizontal (como señal europea de prohibido).
  ▸ Efecto: prohíbe entrar desde esa dirección (vía de sentido único). No es universal.

TRAMPA MÁS COMÚN: La pregunta describe la señal 通行止 (X roja / ×) pero la fuente del libro
dice "esta señal indica que los vehículos no pueden pasar, los peatones sí" — eso describe
la señal 2 (車両通行止め), NO la señal 1. La IA usa esa fuente y responde VERDADERO cuando la
respuesta correcta es FALSO.

⚠️ ERROR FRECUENTE DE LA IA:
  El texto "この標識は車両通行止めを示しており、歩行者は通行できる。"
  (Esta señal indica 車両通行止め, los peatones pueden pasar)
  describe la SEÑAL 2, pero si la imagen/pregunta muestra la señal con X (通行止),
  esa fuente NO aplica. Son señales distintas con efectos distintos.

ANÁLISIS OBLIGATORIO si la pregunta menciona la señal con "X" o 通行止:
  1. ¿La señal tiene una X / aspa dentro del círculo rojo? → Es 通行止 → NADIE puede pasar.
  2. ¿La pregunta dice que peatones SÍ pueden pasar? → FALSO.
  3. ¿La pregunta dice que vehículos y tranvías NO pueden, pero peatones SÍ? → FALSO.
  4. Solo si la señal es un círculo rojo SIN X → 車両通行止め → peatones SÍ pueden pasar.

PALABRAS CLAVE DE ALERTA:
  "通行止 / road closed / cerrado para todos / X roja",
  "pedestrians may pass / peatones pueden pasar / 歩行者は通行できる",
  "vehicles and trams only / solo vehículos y tranvías"

EJEMPLO (Tochigi Examen 2, señal con X):
  Imagen: señal circular con borde rojo y X roja (通行止).
  Pregunta: "Indica que la vía está cerrada para vehículos y tranvías, pero los peatones pueden pasar."
  → La señal tiene X → es 通行止 → prohíbe a TODOS incluyendo peatones.
  → La fuente del libro describe 車両通行止め (señal distinta) → no aplica aquí.
  → RESULTADO: FALSO ✗

──────────────────────────────────────────────────────────────────
PASO 2D-11 — TRAMPA DE SEÑALES DE LÁMPARA DEL OFICIAL DE POLICÍA (灯火信号の方向別意味)
──────────────────────────────────────────────────────────────────
REGLA JAPONESA — EL SIGNIFICADO DE LA LÁMPARA DEPENDE DE LA DIRECCIÓN Y MOVIMIENTO:

Las señales de lámpara tienen 3 posiciones, cada una con efecto DIFERENTE por dirección:

  POSICIÓN A — Lámpara arriba de la cabeza (頭上に上げる):
    ⟹ TODAS las direcciones: 一時停止 (parada completa = equivale a rojo para todos).
    ⟹ Ninguna dirección obtiene "verde" ni "amarillo" — TODOS paran.

  POSICIÓN B — Lámpara balanceada de LADO A LADO / horizontalmente (横や斜め下へ振る):
    ⟹ El tráfico en la dirección hacia donde apunta la lámpara: 青 (verde = puede pasar).
    ⟹ El tráfico perpendicular: no aplica directamente.

  POSICIÓN C — Lámpara balanceada de FRENTE A ATRÁS / hacia adelante y atrás (前後に振る):
    ⟹ El tráfico en ESA dirección (la del movimiento de la lámpara): 黄 (AMARILLO = precaución).
    ⟹ Esta es la posición que equivale a luz AMARILLA para el tráfico indicado.

TRAMPA MÁS COMÚN: La IA encuentra la fuente "灯火を頭上に上げた場合、すべての交通は
一時停止と同じ意味" (POSICIÓN A = todos paran) y la aplica incluso cuando la imagen
muestra la POSICIÓN C (lámpara frente-atrás = amarillo para esa dirección).

⚠️ ERROR FRECUENTE DE LA IA:
  Si la imagen muestra la lámpara moviéndose FRENTE A ATRÁS (en la dirección de las
  flechas del tráfico), el significado para ese tráfico es AMARILLO, no rojo.
  La IA confunde la posición C con la posición A.

ANÁLISIS OBLIGATORIO si la pregunta dice "same meaning as yellow light" + oficial con lámpara:
  1. ¿La pregunta dice que la señal equivale a AMARILLO para el tráfico de las flechas? → Posición C.
  2. ¿La imagen/descripción muestra la lámpara oscilando hacia las flechas (frente-atrás)? → VERDADERO.
  3. ¿La imagen muestra la lámpara EN LA CABEZA (arriba, sin movimiento)? → Posición A → TODOS paran → FALSO.
  4. La clave es el MOVIMIENTO de la lámpara, no solo su posición.

PALABRAS CLAVE DE ALERTA:
  "lamp signal / señal de lámpara / 灯火",
  "same as yellow / mismo que amarillo / 黄信号と同じ",
  "direction of the arrows / dirección de las flechas / その方向",
  "police officer / oficial / 警察官"

EJEMPLO (Tochigi Examen 2):
  Imagen: oficial en intersección, lámpara moviéndose hacia el tráfico de izquierda y derecha.
  Pregunta: "The lamp signal has the same meaning as a yellow light for traffic in the direction of the arrows."
  → La lámpara oscila hacia las flechas (frente-atrás) = POSICIÓN C.
  → Para ese tráfico: 黄信号 (AMARILLO).
  → RESULTADO: VERDADERO ✓
  Trampa: La IA encuentra "cabeza arriba = todos paran" y dice FALSO — incorrecto.

──────────────────────────────────────────────────────────────────
PASO 2D-12 — TRAMPA DE LA SEÑAL 自動車専用 (MOTORWAY) Y CILINDRADA DE MOTOCICLETAS
──────────────────────────────────────────────────────────────────
SEÑAL: Círculo azul con silueta blanca de automóvil de frente = 自動車専用 (Solo para automóviles / Motorway).

REGLA JAPONESA — QUIÉN PUEDE Y QUIÉN NO PUEDE ENTRAR:

  PERMITIDOS:
    ✓ Automóviles estándar (普通自動車)
    ✓ Camiones y vehículos de carga
    ✓ Motocicletas con cilindrada MAYOR A 125cc (126cc en adelante)

  PROHIBIDOS (cerrado para ellos):
    ✗ Peatones y bicicletas
    ✗ Ciclomotores / mopeds (原付 = 50cc o menos)
    ✗ Motocicletas de 125cc O MENOS (小型二輪 / Kogata Nigun)
    ✗ Maquinaria agrícola y vehículos especiales ligeros

TRAMPA MÁS COMÚN: La IA encuentra la fuente
"自動車専用の標識は、車両の通行を制限し、自動車専用道路であることを示します"
(la señal indica que la vía es exclusiva para automóviles)
y concluye: "la señal no prohíbe específicamente motocicletas de menos de 125cc."
→ ESO ES INCORRECTO. La restricción por cilindrada está implícita en la definición de 自動車.

⚠️ ERROR FRECUENTE DE LA IA:
  La IA interpreta "automóvil = cualquier vehículo motorizado" cuando en Japón
  la ley define que las motocicletas ≤125cc NO son 自動車 para esta señal.
  Las motocicletas de exactamente 125cc TAMPOCO pueden entrar — se necesita ESTRICTAMENTE
  más de 125cc (es decir, 126cc o más).

ANÁLISIS OBLIGATORIO si la pregunta menciona 自動車専用 + motocicleta + cc:
  1. ¿La afirmación dice que la vía está CERRADA a motocicletas de menos de 125cc? → VERDADERO.
  2. ¿La afirmación dice que motocicletas de 125cc (exacto) pueden entrar? → FALSO.
  3. ¿La afirmación dice que motocicletas de 126cc o más pueden entrar? → VERDADERO.
  4. La clave: el límite es ESTRICTAMENTE MAYOR QUE 125cc, no "de 125cc o más".

PALABRAS CLAVE DE ALERTA:
  "motorway sign / 自動車専用",
  "regular motorcycle / 小型二輪 / kogata",
  "125cc / displacement / cilindrada",
  "closed to / prohibido / cerrado"

EJEMPLO (Tochigi Examen 2, pregunta #271):
  Imagen: señal azul con silueta de automóvil (自動車専用).
  Pregunta: "Roads with this sign are closed to regular motorcycles whose total displacement is under 125cc."
  → La señal 自動車専用 prohíbe motocicletas ≤125cc.
  → La afirmación es legalmente correcta.
  → RESULTADO: VERDADERO ✓
  Trampa: La IA dice "la señal no prohíbe específicamente motocicletas" — incorrecto.

──────────────────────────────────────────────────────────────────
PASO 2D-13 — TRAMPA DE COLISIÓN FRONTAL INMINENTE (正面衝突の危険・回避方法)
──────────────────────────────────────────────────────────────────
SITUACIÓN: Peligro inminente de colisión frontal con un vehículo que viene en sentido contrario.

PROTOCOLO OFICIAL JAPONÉS (道路交通法 / 教則):
  En Japón se circula por la IZQUIERDA. Ante una colisión frontal inminente, la acción
  correcta es SIEMPRE:
    1. Frenar a fondo (full brake) para reducir la energía cinética al máximo.
    2. Girar hacia la IZQUIERDA (hacia el arcén o fuera de la calzada si es necesario).
    3. NO rendirse ni soltar el control del vehículo — mantener la maniobra evasiva
       hasta el último momento ("do not give up hope" es terminología oficial del currículo).

REGLA DE ORO JAPONESA: Frenar + girar a la IZQUIERDA.
  Girar a la DERECHA sería meterse directamente en la trayectoria del tráfico contrario
  o en el carril opuesto — agravando la colisión.

TRAMPAS COMUNES:
  ✗ "Steer to the right" / "girar a la derecha" en colisión frontal → FALSO
  ✓ "Steer to the left" / "girar a la izquierda" en colisión frontal → VERDADERO
  ✓ "Apply the brakes fully" / "frenar a fondo" en colisión frontal → VERDADERO
  ✓ "Do not give up hope" / "no rendirse hasta el último momento" → VERDADERO
    (instrucción psicológica oficial para mantener control evasivo hasta el final)

ANÁLISIS OBLIGATORIO si la pregunta menciona colisión frontal / head-on collision:
  1. ¿Menciona girar a la DERECHA como acción correcta? → FALSO (en Japón es siempre izquierda)
  2. ¿Menciona frenar + girar a la IZQUIERDA? → VERDADERO
  3. ¿Menciona "no rendirse" o "mantener esperanza" de evasión? → VERDADERO
  4. La frase "no dar por perdida la esperanza" NO es poética — es una instrucción técnica
     para prevenir que el conductor suelte el volante/manillar y pierda capacidad evasiva.

PALABRAS CLAVE DE ALERTA:
  "head-on collision / colisión frontal / 正面衝突",
  "oncoming vehicle / vehículo en sentido contrario",
  "steer to the left/right / girar a izquierda/derecha",
  "do not give up / no rendirse / あきらめない",
  "apply the brakes / frenar / ブレーキをかける"

──────────────────────────────────────────────────────────────────
PASO 2D-14 — TRAMPA DE MARCA VIAL DE VÍA PRIORITARIA (前方優先道路・路面標示)
──────────────────────────────────────────────────────────────────
MARCA VIAL: Rombo/diamante pintado en el pavimento antes de una intersección.
  En Japón, esta marca específica (路面標示) indica que la vía que se cruza ADELANTE
  es una 優先道路 (vía prioritaria).

FUENTE: 教則 第2部 標識と標示 — 優先道路は、標識や特定の路面表示で示されます。
  (Las vías prioritarias se indican con señales o marcas específicas en el pavimento.)

FORMAS DE INDICAR VÍA PRIORITARIA EN JAPÓN:
  1. Señal vertical 優先道路 (rectángulo azul con flecha)
  2. Marca vial de rombo/diamante pintada en el pavimento antes de la intersección ← ESTA
  3. Señal 前方優先道路 (indica que la vía cruzada tiene prioridad y el conductor debe parar/ceder)

TRAMPAS COMUNES CON IMÁGENES DE MARCAS VIALES:
  ✓ "Esta marca vial indica que hay una vía prioritaria adelante" → si muestra un rombo/diamante → VERDADERO
  ✗ ERROR FRECUENTE DE LA IA: "No veo una señal de prioridad clara" → analiza la imagen
    como si fuera una señal vertical, ignorando que las marcas de pavimento SON señales oficiales.
  CORRECCIÓN: El rombo pintado en el pavimento ES la marca oficial de vía prioritaria → VERDADERO.

ANÁLISIS OBLIGATORIO si la pregunta menciona "priority road" + imagen de pavimento:
  1. ¿La imagen muestra una marca de rombo/diamante en la calzada? → VERDADERO (es marca de prioridad)
  2. ¿La imagen muestra una señal vertical azul con la palabra 優先道路? → también VERDADERO
  3. ¿La pregunta dice que el conductor DEBE ceder/parar ante esa vía? → VERDADERO
  4. ¿La pregunta dice que los tranvías (路面電車) también deben parar? → VERDADERO (igual que autos)

EJEMPLO VERIFICADO (pregunta #456):
  Imagen: marca vial pintada en pavimento (rombo/líneas diagonales en intersección)
  Pregunta: "When traveling in the direction indicated by the arrow, this road marking
             indicates that there is a priority road ahead."
  → La marca de pavimento ES la señal oficial de vía prioritaria (優先道路路面標示)
  → RESULTADO: VERDADERO ✓
  ERROR: La IA dijo FALSO porque "no ve señales de prioridad verticales claras".
  CORRECCIÓN: Las marcas de pavimento son señales tan oficiales como las verticales.

──────────────────────────────────────────────────────────────────
PASO 2D-11 — TRAMPA DEL ESTADO DEL MOTOR AL EMPUJAR UNA MOTOCICLETA (二輪車を押す運転者の歩行者扱い)
──────────────────────────────────────────────────────────────────
REGLA GENERAL (道路交通法 第2条): Una persona que empuja (a pie) una motocicleta o ciclomotor
es tratada como PEATÓN. Esta es la regla base.

EXCEPCIONES CRÍTICAS — pierde el estatus de peatón y se convierte en conductor de vehículo motorizado:
  1. Motor ENCENDIDO ("engine is running" / "エンジンがかかっている"):
     → Aunque empuje el vehículo sin usar la tracción, si el motor está en marcha,
       el vehículo se considera "operando como máquina motorizada" → NO es peatón.
  2. Sidecar acoplado ("side car attached" / "側車がついている"):
     → La presencia del sidecar cambia el carácter del vehículo → NO es peatón.
  3. Remolcando otro vehículo ("towing another vehicle" / "他の車をけん引している"):
     → Arrastrar otro vehículo = operación de vehículo → NO es peatón.

PUNTO CRÍTICO — LA PALABRA CLAVE DEL EXAMEN:
  → "engine is running" / "motor encendido" / "エンジンがかかっている"
     → Activa la excepción → la persona NO es peatón → debe circular por la calzada.
  → "engine is stopped / off" / "motor apagado" / "エンジンを切っている"
     → NO activa la excepción → la persona SÍ es peatón (regla general).

TRAMPA MÁS COMÚN — ERROR FRECUENTE DE LA IA:
  El banco de preguntas menkyo-online contiene la fuente:
  「二輪車を押して歩く場合、エンジンがかかっていたり、側車がついていたり、
    他の車をけん引しているものも、歩行者として扱われる。」
  ⚠ ERROR de interpretación: esta oración puede leerse como "los que tienen motor encendido
    también son peatones", pero la interpretación legal correcta (verificada por el instructor)
    es la INVERSA: esas tres condiciones son las EXCEPCIONES que quitan el estatus de peatón.
  ⚠ La traducción correcta del contexto jurídico es:
    "Cuando se empuja una motocicleta con el motor encendido → NO se considera peatón."
  → NO uses la fuente menkyo-online para concluir que el motor encendido mantiene el estatus
    de peatón. La interpretación legal del instructor es la que prevalece.

ANÁLISIS OBLIGATORIO si la pregunta menciona "pushing a motorcycle / empujar una motocicleta":
  1. ¿Menciona el estado del motor? → "running / encendido" → NO es peatón → afirmación VERDADERA.
                                      "stopped / apagado / off" → SÍ es peatón → afirmación FALSA.
  2. ¿Menciona sidecar o remolque? → Sí → NO es peatón independientemente del motor.
  3. ¿La afirmación dice que "no es peatón" cuando el motor está encendido? → VERDADERO ✓
  4. ¿La afirmación dice que "sí es peatón" cuando el motor está encendido? → FALSO ✗

PALABRAS CLAVE DE ALERTA:
  "dismounted rider / conductor a pie / 歩いて押している",
  "pushing motorcycle or moped / empujando motocicleta / 二輪車を押して歩く",
  "engine is running / motor encendido / エンジンがかかっている",
  "not regarded as pedestrian / no se considera peatón / 歩行者として扱われない",
  "regarded as pedestrian / se considera peatón / 歩行者として扱われる"

EJEMPLO REAL (pregunta #486, respuesta verificada por instructor):
  "A dismounted rider pushing his/her motorcycle or moped is not regarded as a pedestrian
   when the engine is running."
  → Situación: empujando motocicleta a pie.
  → Condición: "engine is running" = excepción activa.
  → Afirmación: "not regarded as a pedestrian" = correcto según la ley.
  → RESULTADO: VERDADERO ✓
  Trampa: La IA usa la fuente menkyo-online mal interpretada y responde FALSO.
  Corrección: el motor encendido quita el estatus de peatón — respuesta correcta = VERDADERO.

──────────────────────────────────────────────────────────────────
PASO 2C — LEY LÓGICA DE CONJUNCIÓN (CRÍTICO — la trampa más frecuente del examen japonés):
═══════════════════════════════════════════════════════
PRINCIPIO: Una afirmación compuesta es VERDADERA solo si TODAS sus partes son verdaderas.
Si UNA SOLA parte es falsa → TODA la afirmación es FALSA.
═══════════════════════════════════════════════════════

EJEMPLO DE TRAMPA (el examen usa este patrón constantemente):
  Afirmación: "Hoy es sábado y mañana será lunes"
  → Parte A ("hoy es sábado") = VERDADERO
  → Parte B ("mañana será lunes") = FALSO (el día siguiente al sábado es domingo)
  → RESULTADO: FALSO — aunque la primera parte sea correcta, la segunda la invalida

CONECTORES que indican cláusulas compuestas (buscar en la pregunta):
  "and", "but", "however", "although", "while", "as well as", "also", "furthermore",
  "moreover", "in addition", "y", "pero", "sin embargo", "aunque", "además"

⚠️ EXCEPCIÓN CRÍTICA — CLÁUSULAS "BECAUSE / PORQUE / ので / から" (RAZONES):
──────────────────────────────────────────────────────────────────
Cuando la pregunta da una RAZÓN con "because", "since", "as", "porque", "ので", "から",
la cláusula de razón NO se evalúa igual que una afirmación de hecho.

REGLA:
  • La razón solo vuelve la respuesta FALSO si es FACTUALMENTE INCORRECTA o CONTRADICE la ley.
  • Si la razón es lógicamente válida y coherente con la ley (aunque no esté textualmente
    en el libro), NO es causa para responder FALSO.
  • "El libro no menciona exactamente esa razón" NO ES suficiente para decir FALSO.
    El libro describe reglas, no siempre explica todos los motivos detrás de ellas.

PROCESO PARA PREGUNTAS CON "BECAUSE":
  1. Identifica la REGLA PRINCIPAL (lo que viene antes de "because").
  2. ¿La regla principal es correcta según la ley? → Si SÍ, base sólida para VERDADERO.
  3. Identifica la RAZÓN dada (lo que viene después de "because").
  4. ¿La razón CONTRADICE algún principio del reglamento? → Si SÍ → FALSO.
     ¿La razón es lógicamente coherente aunque no esté textualmente en el libro? → VERDADERO.
  5. Solo es FALSO si la razón es ACTIVAMENTE ERRÓNEA (no simplemente "no encontrada en el libro").

EJEMPLO CORRECTO (pregunta #485, verificada por instructor):
  "Altering a handle bar of a two-wheeled motor vehicle to an illegally modified handle bar
   is prohibited because such a handle could [affect] the proper steering of the vehicle."
  → Regla principal: "modificar el manillar ilegalmente está prohibido"
    → 道路交通法 第99条: correcto ✓
  → Razón dada: "porque podría afectar el control del vehículo"
    → ¿Contradice la ley? NO. ¿Es lógicamente válida? SÍ (modificaciones ilegales
      afectan la operación segura del vehículo — coherente con el Art. 99).
  → RESULTADO: VERDADERO ✓
  ERROR FRECUENTE DE LA IA: dice FALSO porque "el libro no da esa razón exacta".
  CORRECCIÓN: La razón es coherente. No contradice ninguna norma. → VERDADERO.

EJEMPLO DE RAZÓN INCORRECTA (esto SÍ sería FALSO):
  "No debes usar el cinturón de seguridad porque te impide girar el volante libremente."
  → Regla principal: "no debes usar cinturón" → FALSA (el cinturón es obligatorio).
  → Además la razón es falsa.
  → RESULTADO: FALSO ✗

PROCESO OBLIGATORIO para preguntas compuestas:
  1. Separar la afirmación en partes individuales por cada conector
  2. Si hay "because/porque": aplicar la EXCEPCIÓN DE RAZONES descrita arriba
  3. Para los demás conectores: verificar CADA parte contra el libro oficial
  4. Si CUALQUIER parte CONTRADICE el libro → respuesta = FALSO
     (pero "no encontrada en el libro" para una razón ≠ "contradice el libro")

EJEMPLOS DEL EXAMEN JAPONÉS:
  ✗ TRAMPA: "Cuando el semáforo está en amarillo debes detenerte, y si ya estás cruzando
             puedes continuar a alta velocidad"
    → Parte A (detenerse en amarillo) = VERDADERO
    → Parte B (continuar a alta velocidad) = FALSO (debes reducir velocidad)
    → RESPUESTA: FALSO

  ✗ TRAMPA: "En una intersección sin señales el vehículo de la derecha tiene prioridad,
             y los vehículos que vienen de la vía principal también deben ceder"
    → Parte A (derecha tiene prioridad) = VERDADERO
    → Parte B (vía principal cede) = FALSO (vía principal siempre tiene prioridad)
    → RESPUESTA: FALSO

PASO 2E — TRAMPA DE PRINCIPIO GENERAL vs. APLICACIÓN ESPECÍFICA (error frecuente de IA):
═══════════════════════════════════════════════════════
El libro 教則 enuncia PRINCIPIOS GENERALES. Las preguntas del examen frecuentemente enuncian
una APLICACIÓN ESPECÍFICA de ese principio. La IA comete el error de decir FALSO porque
"el libro no menciona ese detalle específico" — cuando en realidad ese detalle ES una
manifestación válida y reconocida del principio general.

REGLA:
  Si el libro establece un principio general (P) y la pregunta describe una aplicación
  específica (A) que es coherente con P, lógicamente derivable de P, o reconocida
  oficialmente como parte del sistema de examen japonés → la respuesta es VERDADERO.

  Solo es FALSO si la aplicación específica CONTRADICE el principio general,
  no simplemente porque el libro no la mencione textualmente.

EJEMPLO VERIFICADO (pregunta #476):
  Libro: "Al elegir una motocicleta, es importante seleccionar una que se ajuste a la
          complexión y habilidades del conductor" (教則 第1部 二輪車の選び方)
  Pregunta: "Uno de los criterios para elegir la moto correcta es tener control total
             mientras se camina con ella empujándola en formación de número '8'."
  → La maniobra en '8' ES el criterio estándar japonés para evaluar el control de la moto
    a pie — aplicación específica del principio de adecuación al conductor.
  → El libro no menciona el '8' textualmente pero la maniobra es coherente y reconocida.
  → RESULTADO: VERDADERO ✓
  ERROR FRECUENTE: la IA dice FALSO porque "el libro no menciona la formación en 8".
  CORRECCIÓN: El libro da el marco general; la maniobra es su aplicación estándar → VERDADERO.

OTROS CASOS TÍPICOS DE ESTE PATRÓN:
  • El libro dice: "ajustar velocidad con el acelerador sin desacoplar el embrague en curvas"
    → Pregunta menciona específicamente "mantener la tracción" → VERDADERO (aplicación coherente)
  • El libro dice: "no exceder la capacidad de carga"
    → Pregunta menciona la consecuencia técnica de excederla → VERDADERO si es coherente

⚠️ CASO ESPECIAL — CRITERIOS DE SELECCIÓN DE MOTOCICLETA (8の字・センタースタンド):
  El libro 教則 pág. 15 define TRES criterios para elegir el tipo correcto de moto:
    1. Poder usar el caballete central (センタースタンド) en terreno plano
    2. Poder mantener equilibrio con los pies apoyados en el suelo
    3. Poder empujarla en formación de número "8" sin perder el control (8の字走行)
  TODOS son criterios válidos y reales del examen japonés.

  TRAMPA: "No pudo usar el caballete, pero sí pudo hacer el 8の字 → eligió la moto" → FALSO
    (porque falló criterio #1 — cumplir solo uno de los tres no es suficiente)
  VERDADERO: "Uno de los criterios es poder empujarla en formación de 8" → VERDADERO
    (el criterio en sí es correcto; la pregunta no dice que sea el ÚNICO criterio)

PROCESO:
  1. ¿El libro cita un principio P relevante al tema de la pregunta? Si SÍ →
  2. ¿La aplicación específica A de la pregunta CONTRADICE P? → Si NO → VERDADERO.
  3. ¿A es coherente, lógicamente derivable, o reconocida en el sistema japonés? → VERDADERO.

PASO 3 — SOLO para temas genuinamente no cubiertos por el reglamento estándar:
Si el tema no está en 教則 ni en 道路交通法 (muy raro), indica confianza "baja".
Esto NO aplica para cualquier tema estándar de tránsito — para esos SIEMPRE hay cita.

PASO 4 — VERIFICACIÓN ANTI-ERROR (obligatorio antes de responder):
Antes de emitir la respuesta final, verifica EXPLÍCITAMENTE:

a) NÚMEROS EN LA PREGUNTA: ¿Hay medidas en metros, km/h, segundos, %, grados?
   → Si SÍ y tu fuente es solo conocimiento general (no [LIBRO OFICIAL] ni [VERIFICADAS]):
     → cambia confianza a "media" y añade advertencia "Verificar el número exacto en el libro oficial"

   ⚠ REGLA CRÍTICA PARA NÚMEROS: Tu propio cálculo o estimación personal JAMÁS puede
   ser causa suficiente para responder FALSO con confianza alta.
   Solo puedes responder FALSO por un número si el LIBRO OFICIAL cita EXPLÍCITAMENTE un
   número diferente. Si el libro no menciona ese número exacto, la respuesta es:
     → confianza "media" + advertencia: "El libro no cita este número exacto; verificar"
   NO digas "44 metros" o "el valor correcto es X" si el libro no lo dice textualmente.

b) EXCEPCIONES OCULTAS: ¿Existe alguna excepción en la ley que haga que la afirmación sea
   verdadera cuando parece falsa, o viceversa?
   → Piensa específicamente en: vías prioritarias, zonas escolares, vehículos de emergencia,
     autopistas, señales especiales, horarios, permisos temporales.

c) TRAMPA LÓGICA COMPUESTA — verificación obligatoria antes de emitir respuesta:
   ¿La pregunta contiene "and", "but", "however", "although", "while", "also"?
   Si SÍ → desglosar en partes:
     Parte 1: [texto] → ¿correcto según libro? ✓ o ✗
     Parte 2: [texto] → ¿correcto según libro? ✓ o ✗
     ...
   Si CUALQUIER parte tiene ✗ → respuesta = FALSO, aunque las demás partes sean ✓
   Incluir en "explicacion" el análisis parte por parte.

d) TRAMPA DE NEGACIÓN: ¿La pregunta usa "must NOT", "cannot", "should not", "no debe", "no se permite"?
   → Leer dos veces. La doble negación o la negación camuflada es la trampa más clásica.
   → Verifica: ¿qué dice EXACTAMENTE el libro sobre esta situación?

═══════════════════════════════════════════════════════════════
REGLAS ABSOLUTAS:
• Si la 教則 dice algo → esa es la respuesta, sin importar lo que parezca lógico.
• Números exactos importan: 10m ≠ 15m, 30km/h ≠ 40km/h.
• Excepciones del libro son parte del libro — si dice "excepto X", X es verdadero.
• Si tuviste que cambiar tu respuesta después del PASO 4 → confianza "media" + advertencia explicando el cambio.
═══════════════════════════════════════════════════════════════

Responde SIEMPRE con este JSON exacto (sin markdown, sin texto adicional):
{
  "respuesta": true o false,
  "explicacion": "En español: explica qué dice el libro sobre este tema${imagenUrl ? " — primero transcribe TODO el texto visible en la imagen (japonés, números, horarios, etc.) y describe la figura; luego explica qué significa según el libro" : ""}. Incluye traducción de la frase japonesa citada.",
  "referencia": "Ubicación + cita bilingüe. Formato exacto: '[Capítulo o artículo] — [frase en japonés] / [traducción al español de esa frase]'. Ejemplos: '道路交通法 第30条 — 交差点及びその手前30メートル以内の部分においては追越しをしてはならない。 / Ley de Tránsito Art.30: Está prohibido adelantar en intersecciones y dentro de los 30 metros antes de ellas.' o '教則 第2部 信号の意味 — 赤色の灯火のとき、停止位置を越えて進んではいけません。 / Manual 教則 Parte 2, Significado de señales: Cuando la luz es roja, no debes avanzar más allá de la línea de parada.' Incluye siempre la traducción en español después de la barra /",
  "confianza": "alta" si la regla es específica y clara en el libro | "media" si aplica una regla general o hay ambigüedad menor | "baja" solo si el tema genuinamente no está en la ley de tránsito,
  "advertencia": null | "Regla general aplicada — verificar si hay disposición específica para este caso concreto" (solo para confianza media) | "Tema no cubierto directamente por 教則 — consultar instructor" (solo para confianza baja),
  "pregunta_aclaratoria": null | "Pregunta concreta en español sobre un detalle visual de la imagen que cambiaría la respuesta si lo supieras con certeza. Úsala SOLO cuando hay imagen Y el detalle visual es decisivo Y no puedes determinarlo con certeza desde la imagen. Sé específico: no '¿puedes describir la imagen?' sino '¿El brazo del oficial está extendido horizontalmente o apuntando hacia arriba?' o '¿La flecha de la señal apunta a la derecha o hacia atrás (U-turn)?' o '¿Hay alguna señal adicional junto a la señal principal?' Si ya tienes descripción de imagen del instructor, pon null."
}

IMPORTANTE sobre pregunta_aclaratoria:
- Ponla en null en la MAYORÍA de los casos — solo úsala cuando sea DECISIVA para cambiar la respuesta.
- Si ya hay descripción del instructor o el detalle visual es claro en la imagen → null.
- Máximo 1 pregunta, la más importante. No preguntes lo obvio.

Nivel del examen: ${nivel === 1 ? "1 — Karimen (permiso provisional)" : "2 — Honmen (licencia definitiva)"}${excludedQuestionNota}${verifiedContext}${menkyoContext}${knowledgeContext}`;

  // Si hay imagen, descargar y convertir a base64 para GPT-4o Vision
  let imageBase64: string | null = null;
  let imageMime = "image/jpeg";
  if (imagenUrl) {
    try {
      const objFile = await objectStorage.getObjectEntityFile(imagenUrl);
      const dlResponse = await objectStorage.downloadObject(objFile);
      const contentType = dlResponse.headers.get("content-type");
      if (contentType) imageMime = contentType.split(";")[0].trim();
      const arrayBuf = await dlResponse.arrayBuffer();
      imageBase64 = Buffer.from(arrayBuf).toString("base64");
    } catch (imgErr: any) {
      // Si falla la descarga continuamos sin imagen
    }
  }

  const descripcionNote = imagenDescripcion
    ? `\n\n[DESCRIPCIÓN DE LA(S) IMAGEN(ES) ANOTADA POR EL INSTRUCTOR]\n${imagenDescripcion}\nUsa esta descripción junto con la imagen visual para asegurarte de analizar TODAS las señales presentes.`
    : "";

  const userContent: OpenAI.ChatCompletionContentPart[] = imageBase64
    ? [
        { type: "text", text: `Analiza esta pregunta de tránsito japonés y determina si es VERDADERA o FALSA. La imagen que ves es la figura asociada a la pregunta:${descripcionNote}\n\n"${pregunta}"` },
        { type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}`, detail: "high" } },
      ]
    : [{ type: "text", text: `Analiza esta pregunta y determina si es VERDADERA o FALSA:${descripcionNote}\n\n"${pregunta}"` }];

  const response = await openai.chat.completions.create({
    model: useMini ? "gpt-4o-mini" : "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { respuesta: false, explicacion: "No se pudo analizar la pregunta.", confianza: "baja", advertencia: "Error de análisis — revisar manualmente." };
  }

  const fuentes = knowledgeResults.slice(0, 3).map((k: any) => k.fuente ?? "libro_japonés");
  const confianza = ["alta", "media", "baja"].includes(parsed.confianza) ? parsed.confianza : "media";

  // Override: si GPT contradice la respuesta verificada por instructor con confianza no-alta,
  // o si la explicación quedó vacía, usar directamente el razonamiento verificado.
  if (verifiedOverride !== null) {
    const gptRespuesta = Boolean(parsed.respuesta);
    const gptExplicacion = String(parsed.explicacion ?? "").trim();
    const contradicts = gptRespuesta !== verifiedOverride.respuesta;
    const emptyExplicacion = gptExplicacion.length === 0;
    if (contradicts || emptyExplicacion || confianza !== "alta") {
      return {
        respuesta: verifiedOverride.respuesta,
        explicacion: verifiedOverride.explicacion,
        referencia: parsed.referencia ? String(parsed.referencia) : null,
        confianza: "alta" as const,
        advertencia: null,
        fuentes: fuentes.length > 0 ? fuentes : ["conocimiento_general"],
      };
    }
  }

  // Override parcial: revisado=true pero sin explicación guardada.
  // GPT ya recibió instrucción de respetar la respuesta verificada.
  // Si aún así la contradice, forzar la respuesta correcta manteniendo la explicación de GPT.
  if (verifiedAnswerOnly !== null) {
    const gptRespuesta = Boolean(parsed.respuesta);
    const gptExplicacion = String(parsed.explicacion ?? "").trim();
    if (gptRespuesta !== verifiedAnswerOnly) {
      return {
        respuesta: verifiedAnswerOnly,
        explicacion: gptExplicacion || `La respuesta correcta según el reglamento es ${verifiedAnswerOnly ? "VERDADERO" : "FALSO"}.`,
        referencia: "✅ Respuesta verificada por instructor — explicación generada por IA",
        confianza: "alta" as const,
        advertencia: null,
        fuentes: fuentes.length > 0 ? fuentes : ["conocimiento_general"],
      };
    }
    // GPT acertó la respuesta — devolver con alta confianza y nota de verificación
    return {
      respuesta: Boolean(parsed.respuesta),
      explicacion: gptExplicacion || String(parsed.explicacion ?? ""),
      referencia: "✅ Respuesta verificada por instructor — explicación generada por IA",
      confianza: "alta" as const,
      advertencia: null,
      fuentes: fuentes.length > 0 ? fuentes : ["conocimiento_general"],
    };
  }

  const preguntaAclaratoria = (parsed.pregunta_aclaratoria && typeof parsed.pregunta_aclaratoria === "string" && parsed.pregunta_aclaratoria.trim())
    ? parsed.pregunta_aclaratoria.trim()
    : null;

  return {
    respuesta: Boolean(parsed.respuesta),
    explicacion: String(parsed.explicacion ?? ""),
    referencia: parsed.referencia ? String(parsed.referencia) : null,
    confianza: confianza as "alta" | "media" | "baja",
    advertencia: parsed.advertencia ? String(parsed.advertencia) : null,
    preguntaAclaratoria,
    fuentes: fuentes.length > 0 ? fuentes : ["conocimiento_general"],
  };
}

// ─── GET /exam/stats ──────────────────────────────────────────────────────────

router.get("/exam/stats", async (req, res) => {
  try {
    const [summaryResult, cityResult] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE nivel = 1) AS nivel1,
          COUNT(*) FILTER (WHERE nivel = 2) AS nivel2,
          COUNT(*) FILTER (WHERE revisado = true) AS revisadas,
          COUNT(*) FILTER (WHERE revisado = false) AS pendientes
        FROM exam_questions
      `),
      pool.query(`
        SELECT COALESCE(ciudad, 'Sin ciudad') AS ciudad, COUNT(*) AS total
        FROM exam_questions
        GROUP BY ciudad
        ORDER BY total DESC
      `),
    ]);
    const row = summaryResult.rows[0];
    const porCiudad: Record<string, number> = {};
    for (const r of cityResult.rows) {
      porCiudad[r.ciudad] = Number(r.total);
    }
    return res.json({
      totalPreguntas: Number(row.total),
      nivel1: Number(row.nivel1),
      nivel2: Number(row.nivel2),
      revisadas: Number(row.revisadas),
      pendientesRevision: Number(row.pendientes),
      porCiudad,
    });
  } catch (err) {
    req.log.error({ err }, "exam stats error");
    return res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

// ─── GET /exam/questions ──────────────────────────────────────────────────────

router.get("/exam/questions", async (req, res) => {
  try {
    const params = ListExamQuestionsQueryParams.parse(req.query);
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: ReturnType<typeof eq>[] = [];
    if (params.nivel !== undefined) conditions.push(eq(examQuestionsTable.nivel, params.nivel));
    if (params.revisado !== undefined) conditions.push(eq(examQuestionsTable.revisado, params.revisado));
    if (params.ciudad !== undefined) conditions.push(eq(examQuestionsTable.ciudad, params.ciudad));
    if (params.examenNumero !== undefined) conditions.push(eq(examQuestionsTable.examenNumero, params.examenNumero));

    let baseQuery = db.select().from(examQuestionsTable);
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(examQuestionsTable);

    if (params.q) {
      const likeFilter = ilike(examQuestionsTable.pregunta, `%${params.q}%`);
      if (conditions.length > 0) {
        // @ts-ignore
        baseQuery = baseQuery.where(and(...conditions, likeFilter));
        // @ts-ignore
        countQuery = countQuery.where(and(...conditions, likeFilter));
      } else {
        // @ts-ignore
        baseQuery = baseQuery.where(likeFilter);
        // @ts-ignore
        countQuery = countQuery.where(likeFilter);
      }
    } else if (conditions.length > 0) {
      // @ts-ignore
      baseQuery = baseQuery.where(and(...conditions));
      // @ts-ignore
      countQuery = countQuery.where(and(...conditions));
    }

    const [items, countResult] = await Promise.all([
      // @ts-ignore
      baseQuery.orderBy(asc(examQuestionsTable.id)).limit(limit).offset(offset),
      countQuery,
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    return res.json({
      total,
      offset,
      limit,
      items: items.map(q => ({
        ...q,
        vecesUsada: q.vecesUsada,
        vecesCorrecta: q.vecesCorrecta,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "list exam questions error");
    return res.status(500).json({ error: "Error al listar preguntas" });
  }
});

// ─── GET /exam/questions/examen-numeros ──────────────────────────────────────

router.get("/exam/questions/examen-numeros", async (req, res) => {
  try {
    const nivel = req.query.nivel ? Number(req.query.nivel) : null;
    const ciudad = (req.query.ciudad as string) ?? null;

    const conditions: string[] = ["examen_numero IS NOT NULL"];
    const params: any[] = [];
    if (nivel !== null) { params.push(nivel); conditions.push(`nivel = $${params.length}`); }
    if (ciudad) { params.push(ciudad); conditions.push(`ciudad = $${params.length}`); }

    const result = await pool.query(
      `SELECT DISTINCT examen_numero FROM exam_questions WHERE ${conditions.join(" AND ")} ORDER BY examen_numero`,
      params
    );
    const numeros: number[] = result.rows.map((r: any) => r.examen_numero as number);

    // Join with exam_sets to get custom names
    let nombres: Record<number, string | null> = {};
    if (numeros.length > 0 && ciudad) {
      const setsResult = await pool.query(
        `SELECT examen_numero, nombre FROM exam_sets WHERE ciudad = $1 AND examen_numero = ANY($2)`,
        [ciudad, numeros]
      );
      for (const row of setsResult.rows) {
        nombres[row.examen_numero as number] = row.nombre as string | null;
      }
    }

    const examenes = numeros.map(n => ({ numero: n, nombre: nombres[n] ?? null }));
    return res.json({ numeros, examenes });
  } catch (err) {
    req.log.error({ err }, "examen-numeros error");
    return res.status(500).json({ error: "Error al obtener números de examen" });
  }
});

// ─── GET /exam/sets — list all exam sets with names ──────────────────────────

router.get("/exam/sets", async (req, res) => {
  try {
    const ciudad = (req.query.ciudad as string) ?? null;
    const params: any[] = [];
    const where = ciudad ? `WHERE ciudad = $1` : "";
    if (ciudad) params.push(ciudad);
    const result = await pool.query(
      `SELECT ciudad, examen_numero, nombre FROM exam_sets ${where} ORDER BY ciudad, examen_numero`,
      params
    );
    return res.json({ sets: result.rows });
  } catch (err) {
    req.log.error({ err }, "exam-sets list error");
    return res.status(500).json({ error: "Error al obtener exam sets" });
  }
});

// ─── PUT /exam/sets/:ciudad/:numero/nombre ────────────────────────────────────

const examSetNombreBody = _z.object({ nombre: _z.string().max(200).nullable() });

router.put("/exam/sets/:ciudad/:numero/nombre", async (req, res) => {
  try {
    const ciudad = req.params.ciudad;
    const numero = Number(req.params.numero);
    if (!ciudad || isNaN(numero) || numero < 1) return res.status(400).json({ error: "Ciudad y número requeridos" });
    const parsed = examSetNombreBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Cuerpo inválido", details: parsed.error.flatten() });
    const nombre = parsed.data.nombre;

    await pool.query(
      `INSERT INTO exam_sets (ciudad, examen_numero, nombre, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT ON CONSTRAINT exam_sets_ciudad_numero_unique
       DO UPDATE SET nombre = EXCLUDED.nombre, updated_at = now()`,
      [ciudad, numero, nombre?.trim() || null]
    );
    return res.json({ ok: true, ciudad, examenNumero: numero, nombre: nombre?.trim() || null });
  } catch (err) {
    req.log.error({ err }, "exam-sets upsert error");
    return res.status(500).json({ error: "Error al guardar nombre del examen" });
  }
});

// ─── POST /exam/questions/bulk-assign-examen ──────────────────────────────────

router.post("/exam/questions/bulk-assign-examen", async (req, res) => {
  try {
    const { ciudad, nivel, examenNumero, soloSinNumero, deExamen, limite } = req.body as {
      ciudad?: string;
      nivel?: number;
      examenNumero: number | null;   // null = limpiar (poner NULL)
      soloSinNumero?: boolean;       // solo las que aún no tienen número
      deExamen?: number;             // solo las que tienen este número actualmente
      limite?: number;               // máximo de filas a actualizar
    };

    const nuevoValor = examenNumero ?? null;

    const whereParts: string[] = [];
    const params: any[] = [nuevoValor];

    if (ciudad)           { params.push(ciudad);   whereParts.push(`ciudad = $${params.length}`); }
    if (nivel !== undefined) { params.push(nivel); whereParts.push(`nivel = $${params.length}`); }
    if (soloSinNumero)    whereParts.push("examen_numero IS NULL");
    if (deExamen !== undefined) { params.push(deExamen); whereParts.push(`examen_numero = $${params.length}`); }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const limitClause = limite && limite > 0
      ? `AND id IN (SELECT id FROM exam_questions ${whereClause} ORDER BY id LIMIT ${Number(limite)})`
      : "";

    let sql: string;
    if (limitClause) {
      // Re-build: UPDATE ... WHERE id IN (subquery with limit)
      const innerWhere = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
      sql = `UPDATE exam_questions SET examen_numero = $1 WHERE id IN (SELECT id FROM exam_questions ${innerWhere} ORDER BY id LIMIT ${Number(limite)})`;
    } else {
      sql = `UPDATE exam_questions SET examen_numero = $1 ${whereClause}`;
    }

    const result = await pool.query(sql, params);
    return res.json({ actualizadas: result.rowCount ?? 0 });
  } catch (err) {
    req.log.error({ err }, "bulk-assign-examen error");
    return res.status(500).json({ error: "Error al asignar número de examen" });
  }
});

// ─── POST /exam/questions ─────────────────────────────────────────────────────

router.post("/exam/questions", async (req, res) => {
  try {
    const body = CreateExamQuestionBody.parse(req.body);
    const [created] = await db.insert(examQuestionsTable).values({
      pregunta: body.pregunta,
      respuesta: body.respuesta,
      explicacion: body.explicacion ?? null,
      nivel: body.nivel ?? 2,
      ciudad: body.ciudad ?? null,
      imagenUrl: body.imagenUrl ?? null,
      imagenesUrls: (body.imagenesUrls as string[] | null | undefined) ?? null,
      examenNumero: body.examenNumero ?? null,
      fuente: body.fuente ?? null,
      revisado: body.revisado ?? false,
    }).returning();
    return res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "create exam question error");
    return res.status(500).json({ error: "Error al crear pregunta" });
  }
});

// ─── POST /exam/questions/analyze ────────────────────────────────────────────

router.post("/exam/questions/analyze", async (req, res) => {
  try {
    const body = AnalyzeExamQuestionBody.parse(req.body);
    const nivel = body.nivel ?? 1;
    const ciudad = body.ciudad ?? null;
    const guardar = body.guardar ?? false;

    const imagenUrl = body.imagenUrl ?? null;
    // excludeId, imagenDescripcion y skipVerified no están en el schema Zod generado,
    // se leen directamente de req.body para no romper la compatibilidad con el spec.
    const excludeId = (req.body as any).excludeId ?? null;
    const imagenDescripcion = (req.body as any).imagenDescripcion ?? null;
    const skipVerified = Boolean((req.body as any).skipVerified);
    const analysis = await analyzeWithGPT(body.pregunta, nivel, imagenUrl, excludeId, imagenDescripcion, skipVerified);

    let questionId: number | null = null;
    if (guardar) {
      const [created] = await db.insert(examQuestionsTable).values({
        pregunta: body.pregunta,
        respuesta: analysis.respuesta,
        explicacion: analysis.explicacion,
        nivel,
        ciudad,
        fuente: analysis.fuentes[0] ?? null,
        revisado: false,
      }).returning();
      questionId = created?.id ?? null;
    }

    return res.json({
      pregunta: body.pregunta,
      respuesta: analysis.respuesta,
      explicacion: analysis.explicacion,
      referencia: analysis.referencia,
      confianza: analysis.confianza,
      advertencia: analysis.advertencia,
      fuentes: analysis.fuentes,
      guardado: guardar && questionId !== null,
      questionId,
    });
  } catch (err) {
    req.log.error({ err }, "analyze exam question error");
    return res.status(500).json({ error: "Error al analizar pregunta" });
  }
});

// ─── POST /exam/questions/analyze-batch ──────────────────────────────────────

router.post("/exam/questions/analyze-batch", async (req, res) => {
  try {
    const body = AnalyzeBatchExamQuestionsBody.parse(req.body);
    const nivel = body.nivel ?? 1;
    const ciudad = body.ciudad ?? null;
    const guardar = body.guardar ?? false;

    const imagenUrl = (body as any).imagenUrl ?? null;

    const resultados = await Promise.all(
      body.preguntas.map(async (pregunta: string) => {
        const analysis = await analyzeWithGPT(pregunta, nivel, imagenUrl);
        let questionId: number | null = null;
        if (guardar) {
          const [created] = await db.insert(examQuestionsTable).values({
            pregunta,
            respuesta: analysis.respuesta,
            explicacion: analysis.explicacion,
            nivel,
            ciudad,
            fuente: analysis.fuentes[0] ?? null,
            revisado: false,
          }).returning();
          questionId = created?.id ?? null;
        }
        return {
          pregunta,
          respuesta: analysis.respuesta,
          explicacion: analysis.explicacion,
          referencia: analysis.referencia,
          confianza: analysis.confianza,
          advertencia: analysis.advertencia,
          fuentes: analysis.fuentes,
          guardado: guardar && questionId !== null,
          questionId,
        };
      })
    );

    return res.json({ resultados });
  } catch (err) {
    req.log.error({ err }, "batch analyze error");
    return res.status(500).json({ error: "Error en análisis por lotes" });
  }
});

// ─── GET /exam/questions/:id ──────────────────────────────────────────────────

router.get("/exam/questions/:id", async (req, res) => {
  try {
    const { id } = GetExamQuestionParams.parse(req.params);
    const [question] = await db.select().from(examQuestionsTable).where(eq(examQuestionsTable.id, id));
    if (!question) return res.status(404).json({ error: "Pregunta no encontrada" });
    return res.json(question);
  } catch (err) {
    req.log.error({ err }, "get exam question error");
    return res.status(500).json({ error: "Error al obtener pregunta" });
  }
});

// ─── PUT /exam/questions/:id ──────────────────────────────────────────────────

router.put("/exam/questions/:id", async (req, res) => {
  try {
    const { id } = UpdateExamQuestionParams.parse(req.params);
    const body = UpdateExamQuestionBody.parse(req.body);
    const [updated] = await db.update(examQuestionsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(examQuestionsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Pregunta no encontrada" });
    // Si la pregunta quedó revisada (con o sin explicación), regenerar su embedding
    // en background para que futuras búsquedas semánticas la encuentren.
    if (updated.revisado) {
      saveEmbeddingAsync(updated.id, updated.pregunta);
    }
    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "update exam question error");
    return res.status(500).json({ error: "Error al actualizar pregunta" });
  }
});

// ─── POST /exam/questions/bulk-generate-explanations ─────────────────────────
// Genera y guarda explicaciones para preguntas revisadas=true sin explicación.
// Procesa hasta 10 a la vez para no exceder timeouts. El cliente puede volver a llamar
// si quedan pendientes.

router.post("/exam/questions/bulk-generate-explanations", async (req, res) => {
  try {
    const { ciudad, examenNumero } = req.body as { ciudad?: string; examenNumero?: number };
    if (!ciudad || !examenNumero) {
      return res.status(400).json({ error: "Falta ciudad o examenNumero" });
    }

    // Buscar preguntas revisadas sin explicación (hasta 10)
    const BATCH = 10;
    const pending = await pool.query(
      `SELECT id, pregunta, respuesta, nivel, imagen_url AS "imagenUrl", imagenes_urls AS "imagenesUrls"
       FROM exam_questions
       WHERE ciudad = $1 AND examen_numero = $2 AND revisado = true AND (explicacion IS NULL OR explicacion = '')
       ORDER BY id
       LIMIT $3`,
      [ciudad, examenNumero, BATCH]
    );

    // Contar pendientes totales (para informar al cliente)
    const totalPending = await pool.query(
      `SELECT COUNT(*) AS cnt FROM exam_questions
       WHERE ciudad = $1 AND examen_numero = $2 AND revisado = true AND (explicacion IS NULL OR explicacion = '')`,
      [ciudad, examenNumero]
    );
    const totalLeft = Number(totalPending.rows[0]?.cnt ?? 0);

    let exitosas = 0;
    let errores = 0;

    for (const row of pending.rows) {
      try {
        const imagenUrl = (row.imagenesUrls as string[] | null)?.[0] ?? row.imagenUrl ?? null;
        // excludeId = el propio ID activa verifiedAnswerOnly (revisado=true sin explicación)
        // useMini=true: generación masiva no necesita gpt-4o — mini es suficiente y ~85% más barato
        const result = await analyzeWithGPT(row.pregunta, row.nivel ?? 2, imagenUrl, row.id, null, false, true);
        if (result.explicacion) {
          await pool.query(
            `UPDATE exam_questions SET explicacion = $1, updated_at = NOW() WHERE id = $2`,
            [result.explicacion, row.id]
          );
          exitosas++;
        } else {
          errores++;
        }
      } catch {
        errores++;
      }
    }

    const pendientesRestantes = Math.max(0, totalLeft - exitosas);
    return res.json({ procesadas: pending.rows.length, exitosas, errores, pendientes: pendientesRestantes });
  } catch (err) {
    req.log.error({ err }, "bulk-generate-explanations error");
    return res.status(500).json({ error: "Error al generar explicaciones" });
  }
});

// ─── POST /exam/questions/bulk-generate-embeddings ───────────────────────────
// Genera y guarda embeddings semánticos para todas las preguntas revisadas=true
// que aún no tienen embedding. Procesa en lotes de 100 usando la API de embeddings
// de OpenAI (text-embedding-3-small). Costo ≈ $0.001 para 520 preguntas.

router.post("/exam/questions/bulk-generate-embeddings", async (req, res) => {
  try {
    const BATCH = 100;

    // Total sin embedding
    const totalRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM exam_questions WHERE revisado = true AND embedding IS NULL`
    );
    const totalSinEmbedding = Number(totalRes.rows[0]?.cnt ?? 0);

    // Obtener lote
    const pending = await pool.query(
      `SELECT id, pregunta FROM exam_questions
       WHERE revisado = true AND embedding IS NULL
       ORDER BY id
       LIMIT $1`,
      [BATCH]
    );

    if (pending.rows.length === 0) {
      return res.json({ procesadas: 0, exitosas: 0, errores: 0, pendientes: 0, mensaje: "Todas las preguntas ya tienen embedding." });
    }

    // Llamada batch a OpenAI (mucho más eficiente que una por una)
    const texts = pending.rows.map((r: any) =>
      r.pregunta.replace(/^\s*\d+[.\-)]+\s*/g, "").trim()
    );

    let exitosas = 0;
    let errores = 0;

    try {
      const embResp = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: texts,
      });

      for (let i = 0; i < pending.rows.length; i++) {
        const emb = embResp.data[i]?.embedding;
        if (!emb) { errores++; continue; }
        try {
          await pool.query(
            `UPDATE exam_questions SET embedding = $1 WHERE id = $2`,
            [JSON.stringify(emb), pending.rows[i].id]
          );
          exitosas++;
        } catch { errores++; }
      }
    } catch {
      // Si la llamada batch falla, intentar una a una
      for (const row of pending.rows) {
        const emb = await getEmbedding(row.pregunta);
        if (!emb) { errores++; continue; }
        try {
          await pool.query(`UPDATE exam_questions SET embedding = $1 WHERE id = $2`, [JSON.stringify(emb), row.id]);
          exitosas++;
        } catch { errores++; }
      }
    }

    const pendientesRestantes = Math.max(0, totalSinEmbedding - exitosas);
    return res.json({ procesadas: pending.rows.length, exitosas, errores, pendientes: pendientesRestantes });
  } catch (err) {
    req.log.error({ err }, "bulk-generate-embeddings error");
    return res.status(500).json({ error: "Error al generar embeddings" });
  }
});

// ─── DELETE /exam/questions/:id ───────────────────────────────────────────────

router.delete("/exam/questions/:id", async (req, res) => {
  try {
    const { id } = DeleteExamQuestionParams.parse(req.params);
    const [deleted] = await db.delete(examQuestionsTable).where(eq(examQuestionsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Pregunta no encontrada" });
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "delete exam question error");
    return res.status(500).json({ error: "Error al eliminar pregunta" });
  }
});

// ─── POST /exam/questions/import-docx ────────────────────────────────────────

function parseQuestionsFromText(text: string): { pregunta: string; respuesta: boolean | null }[] {
  // Normalize full-width digits/punctuation to ASCII
  const normalize = (s: string) =>
    s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
     .replace(/[．]/g, ".").replace(/[，]/g, ",").replace(/\t/g, " ");

  const trueRe  = /[○◯✓✔]|verdadero|true|〇|\bV\b/i;
  const answerOnlyRe = /^[○◯✓✔×✗✘〇]$|^(verdadero|falso|true|false)$/i;
  // inline answer at the end of a line: "...texto  ○" or "...texto  Verdadero"
  const inlineAnswerRe = /[\s　]+([○◯✓✔×✗✘〇]|verdadero|falso|true|false)[\s.]*$/i;

  const extractInlineAnswer = (line: string): { text: string; answer: boolean | null } => {
    const m = line.match(inlineAnswerRe);
    if (m) return { text: line.replace(inlineAnswerRe, "").trim(), answer: trueRe.test(m[1]) };
    return { text: line, answer: null };
  };

  // ── Strategy 1: numbered questions (1. / 1) / 問1 / etc.) ────────────────
  const questionStartRe = /^(?:問\s*|第\s*|No\.?\s*|Q\.?\s*)?\d+[.)、．。：:\s]/i;
  const allLines = text.split("\n").map(l => normalize(l).trim()).filter(Boolean);
  const hasNumbered = allLines.some(l => questionStartRe.test(l));

  if (hasNumbered) {
    const questions: { pregunta: string; respuesta: boolean | null }[] = [];
    let currentParts: string[] = [];
    let currentAnswer: boolean | null = null;

    const flush = () => {
      if (currentParts.length === 0) return;
      const raw = currentParts.join(" ").trim();
      const pregunta = raw.replace(/^(?:問\s*|第\s*|No\.?\s*|Q\.?\s*)?\d+[.)、．。：:\s]+/, "").trim();
      if (pregunta.length > 5) questions.push({ pregunta, respuesta: currentAnswer });
      currentParts = [];
      currentAnswer = null;
    };

    for (const line of allLines) {
      if (answerOnlyRe.test(line)) { currentAnswer = trueRe.test(line); continue; }

      if (questionStartRe.test(line)) {
        flush();
        const { text: t, answer } = extractInlineAnswer(line);
        if (answer !== null) currentAnswer = answer;
        currentParts.push(t);
      } else {
        const { text: t, answer } = extractInlineAnswer(line);
        if (answer !== null && currentParts.length > 0) {
          currentAnswer = answer;
          currentParts.push(t);
        } else if (currentParts.length > 0) {
          currentParts.push(line);
        }
      }
    }
    flush();
    return questions;
  }

  // ── Strategy 2: paragraph-per-question (no numbers, blank-line separated) ─
  // Split text into paragraphs using blank lines as separators.
  // Each paragraph = one question. Answer can be inline or on the next para.
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map(p => normalize(p).replace(/\n/g, " ").trim())
    .filter(Boolean);

  const questions: { pregunta: string; respuesta: boolean | null }[] = [];
  let i = 0;
  while (i < paragraphs.length) {
    const para = paragraphs[i];

    // Skip if this paragraph is just an answer marker by itself
    if (answerOnlyRe.test(para)) { i++; continue; }

    // Check if next paragraph is a standalone answer marker
    const nextPara = paragraphs[i + 1] ?? "";
    let answer: boolean | null = null;

    const { text: questionText, answer: inlineAns } = extractInlineAnswer(para);
    if (inlineAns !== null) {
      answer = inlineAns;
      if (questionText.length > 5) questions.push({ pregunta: questionText, respuesta: answer });
      i++;
    } else if (answerOnlyRe.test(nextPara)) {
      answer = trueRe.test(nextPara);
      if (para.length > 5) questions.push({ pregunta: para, respuesta: answer });
      i += 2; // skip both question and answer paragraphs
    } else {
      if (para.length > 5) questions.push({ pregunta: para, respuesta: null });
      i++;
    }
  }

  return questions;
}

// Extract questions from mammoth HTML output (handles auto-numbered Word lists)
function parseQuestionsFromHtml(html: string): { pregunta: string; respuesta: boolean | null }[] {
  const trueRe  = /[○◯✓✔]|verdadero|true|〇|\bV\b/i;
  const inlineAnswerRe = /[\s　]+([○◯✓✔×✗✘〇]|verdadero|falso|true|false)[\s.]*$/i;

  const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const questions: { pregunta: string; respuesta: boolean | null }[] = [];

  // Extract all <li> elements (handles auto-numbered lists)
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) !== null) {
    const text = stripTags(m[1]).trim();
    if (text.length < 5) continue;
    const match = text.match(inlineAnswerRe);
    if (match) {
      questions.push({ pregunta: text.replace(inlineAnswerRe, "").trim(), respuesta: trueRe.test(match[1]) });
    } else {
      questions.push({ pregunta: text, respuesta: null });
    }
  }

  return questions;
}

router.post("/exam/questions/import-docx", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

    // Detect old .doc format (OLE2 magic bytes: D0 CF 11 E0) — mammoth only supports .docx
    const magic = req.file.buffer.slice(0, 4);
    if (magic[0] === 0xD0 && magic[1] === 0xCF && magic[2] === 0x11 && magic[3] === 0xE0) {
      return res.status(422).json({
        error: "Formato antiguo detectado (.doc). Por favor guarda el archivo como .docx en Word: Archivo → Guardar como → Formato: Word (.docx)",
      });
    }

    // Detect non-ZIP (non-docx) files
    if (magic[0] !== 0x50 || magic[1] !== 0x4B) {
      return res.status(422).json({
        error: "El archivo no es un Word válido (.docx). Asegúrate de guardar como .docx desde Word o Google Docs.",
      });
    }

    // Use HTML conversion to preserve auto-numbered list structure
    let html = "";
    let rawText = "";
    try {
      const htmlResult = await mammoth.convertToHtml({ buffer: req.file.buffer });
      const rawResult  = await mammoth.extractRawText({ buffer: req.file.buffer });
      html    = htmlResult.value;
      rawText = rawResult.value;
    } catch (parseErr: any) {
      req.log.warn({ parseErr }, "mammoth parse error");
      return res.status(422).json({
        error: `No se pudo leer el archivo: ${parseErr?.message ?? "archivo corrupto o no compatible"}. Intenta abrirlo en Word y guardarlo de nuevo como .docx.`,
      });
    }

    // Strategy 1: extract from HTML <li> items (Word numbered lists)
    let parsed = parseQuestionsFromHtml(html);

    // Strategy 2: fallback — plain text paragraph/numbered parser
    if (parsed.length === 0) {
      parsed = parseQuestionsFromText(rawText);
    }

    if (parsed.length === 0) {
      return res.status(422).json({
        error: "No se encontraron preguntas en el documento. Verifica el formato.",
        rawText: rawText.slice(0, 1000),
      });
    }

    // Dry-run: if guardar=false (default), just return parsed questions
    const guardar = req.query.guardar === "true";
    const nivel = Number(req.query.nivel ?? 1);
    const ciudad = (req.query.ciudad as string) ?? null;
    const examenNumero = req.query.examenNumero ? Number(req.query.examenNumero) : null;

    if (!guardar) {
      return res.json({ total: parsed.length, preguntas: parsed.slice(0, 20), rawText: rawText.slice(0, 500) });
    }

    // Save all questions
    let saved = 0;
    for (const q of parsed) {
      await db.insert(examQuestionsTable).values({
        pregunta: q.pregunta,
        respuesta: q.respuesta ?? false,
        nivel,
        ciudad,
        examenNumero,
        revisado: q.respuesta !== null,
      });
      saved++;
    }

    return res.json({ saved, sinRespuesta: parsed.filter(q => q.respuesta === null).length });
  } catch (err) {
    req.log.error({ err }, "import docx error");
    return res.status(500).json({ error: "Error al procesar el documento" });
  }
});

// ─── POST /exam/sessions ──────────────────────────────────────────────────────

router.post("/exam/sessions", async (req, res) => {
  try {
    const body = CreateExamSessionBody.parse(req.body);
    const nivel = body.nivel;
    const ciudad = body.ciudad ?? null;
    const examenNumero = body.examenNumero ?? null;

    // Karimen (nivel 1) = 50 questions, Honmen (nivel 2) = 100 questions
    const questionLimit = nivel === 2 ? 100 : 50;

    // Build WHERE conditions dynamically
    const whereParts: string[] = ["nivel = $1"];
    const queryParams: any[] = [nivel];
    if (ciudad) { queryParams.push(ciudad); whereParts.push(`ciudad = $${queryParams.length}`); }
    if (examenNumero !== null) { queryParams.push(examenNumero); whereParts.push(`examen_numero = $${queryParams.length}`); }
    queryParams.push(questionLimit);
    const limitParam = `$${queryParams.length}`;

    const questionsResult = await pool.query(
      `SELECT id, pregunta, respuesta, explicacion, imagen_url, imagenes_urls
       FROM exam_questions
       WHERE ${whereParts.join(" AND ")}
       ORDER BY ${examenNumero !== null ? "id" : "RANDOM()"}
       LIMIT ${limitParam}`,
      queryParams
    );

    const questions = questionsResult.rows;
    if (questions.length === 0) {
      return res.status(400).json({
        error: ciudad
          ? `No hay preguntas disponibles para ${ciudad} nivel ${nivel}`
          : "No hay preguntas disponibles para este nivel"
      });
    }

    // Create session
    const [session] = await db.insert(examSessionsTable).values({
      nivel,
      ciudad,
      participante: body.participante ?? null,
      totalPreguntas: questions.length,
    }).returning();

    // Insert session questions
    await db.insert(examSessionQuestionsTable).values(
      questions.map((q: any, i: number) => ({
        sessionId: session.id,
        questionId: q.id,
        numero: i + 1,
        pregunta: q.pregunta,
        respuesta: q.respuesta,
        explicacion: q.explicacion,
        imagenUrl: q.imagen_url ?? null,
        imagenesUrls: (q.imagenes_urls as string[] | null) ?? null,
      }))
    );

    // Update veces_usada for each question
    await pool.query(
      `UPDATE exam_questions SET veces_usada = veces_usada + 1 WHERE id = ANY($1)`,
      [questions.map((q: any) => q.id)]
    );

    return res.status(201).json({
      sessionId: session.id,
      nivel: session.nivel,
      ciudad: session.ciudad ?? null,
      totalPreguntas: questions.length,
      preguntaActual: {
        numero: 1,
        pregunta: questions[0].pregunta,
        imagenUrl: questions[0].imagen_url ?? null,
        imagenesUrls: (questions[0].imagenes_urls as string[] | null) ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "create exam session error");
    return res.status(500).json({ error: "Error al crear sesión de examen" });
  }
});

// ─── GET /exam/sessions/:id ───────────────────────────────────────────────────

router.get("/exam/sessions/:id", async (req, res) => {
  try {
    const { id } = GetExamSessionParams.parse(req.params);
    const [session] = await db.select().from(examSessionsTable).where(eq(examSessionsTable.id, id));
    if (!session) return res.status(404).json({ error: "Sesión no encontrada" });

    const porcentaje = session.respondidas > 0
      ? Math.round((session.correctas / session.respondidas) * 100)
      : null;

    // Also return the current unanswered question
    const [currentQ] = await db.select()
      .from(examSessionQuestionsTable)
      .where(
        and(
          eq(examSessionQuestionsTable.sessionId, id),
          eq(examSessionQuestionsTable.respondida, false)
        )
      )
      .orderBy(examSessionQuestionsTable.numero)
      .limit(1);

    return res.json({
      ...session,
      porcentaje,
      preguntaActual: currentQ ? { numero: currentQ.numero, pregunta: currentQ.pregunta, imagenUrl: currentQ.imagenUrl ?? null, imagenesUrls: (currentQ.imagenesUrls as string[] | null) ?? null } : null,
    });
  } catch (err) {
    req.log.error({ err }, "get exam session error");
    return res.status(500).json({ error: "Error al obtener sesión" });
  }
});

// ─── POST /exam/sessions/:id/answer ──────────────────────────────────────────

router.post("/exam/sessions/:id/answer", async (req, res) => {
  try {
    const { id } = AnswerExamQuestionParams.parse(req.params);
    const body = AnswerExamQuestionBody.parse(req.body);

    // Load session
    const [session] = await db.select().from(examSessionsTable).where(eq(examSessionsTable.id, id));
    if (!session) return res.status(404).json({ error: "Sesión no encontrada" });
    if (session.estado === "terminado") {
      return res.status(400).json({ error: "La sesión ya terminó" });
    }

    // Get current unanswered question
    const [currentQ] = await db.select()
      .from(examSessionQuestionsTable)
      .where(
        and(
          eq(examSessionQuestionsTable.sessionId, id),
          eq(examSessionQuestionsTable.respondida, false)
        )
      )
      .orderBy(examSessionQuestionsTable.numero)
      .limit(1);

    if (!currentQ) {
      return res.status(400).json({ error: "No hay preguntas pendientes" });
    }

    const correcto = body.respuesta === currentQ.respuesta;

    // Mark answered
    await db.update(examSessionQuestionsTable)
      .set({
        respondida: true,
        respuestaUsuario: body.respuesta,
        correcta: correcto,
      })
      .where(eq(examSessionQuestionsTable.id, currentQ.id));

    // Update veces_correcta if correct
    if (correcto && currentQ.questionId) {
      await pool.query(
        `UPDATE exam_questions SET veces_correcta = veces_correcta + 1 WHERE id = $1`,
        [currentQ.questionId]
      );
    }

    // Update session counts
    const nuevasRespondidas = session.respondidas + 1;
    const nuevasCorrectas = session.correctas + (correcto ? 1 : 0);
    const terminado = nuevasRespondidas >= session.totalPreguntas;

    const sessionUpdate: Record<string, any> = {
      respondidas: nuevasRespondidas,
      correctas: nuevasCorrectas,
    };
    if (terminado) {
      sessionUpdate.estado = "terminado";
      sessionUpdate.finishedAt = new Date();
    }

    await db.update(examSessionsTable).set(sessionUpdate).where(eq(examSessionsTable.id, id));

    // Get explicacion (generate if missing)
    let explicacion = currentQ.explicacion;
    if (!explicacion) {
      if (correcto) {
        explicacion = "¡Correcto! Tu respuesta es acertada.";
      } else {
        explicacion = `Incorrecto. La respuesta correcta es ${currentQ.respuesta ? "VERDADERO" : "FALSO"}.`;
      }
    }

    // Get next question if not finished
    let siguientePregunta = null;
    if (!terminado) {
      const [nextQ] = await db.select()
        .from(examSessionQuestionsTable)
        .where(
          and(
            eq(examSessionQuestionsTable.sessionId, id),
            eq(examSessionQuestionsTable.respondida, false)
          )
        )
        .orderBy(examSessionQuestionsTable.numero)
        .limit(1);

      if (nextQ) {
        siguientePregunta = {
          numero: nextQ.numero,
          pregunta: nextQ.pregunta,
          imagenUrl: nextQ.imagenUrl ?? null,
          imagenesUrls: (nextQ.imagenesUrls as string[] | null) ?? null,
        };
      }
    }

    const porcentajeFinal = terminado
      ? Math.round((nuevasCorrectas / session.totalPreguntas) * 100)
      : null;

    return res.json({
      correcto,
      respuestaCorrecta: currentQ.respuesta,
      explicacion,
      correctas: nuevasCorrectas,
      respondidas: nuevasRespondidas,
      terminado,
      porcentajeFinal,
      siguientePregunta,
    });
  } catch (err) {
    req.log.error({ err }, "answer exam question error");
    return res.status(500).json({ error: "Error al procesar respuesta" });
  }
});

export default router;
