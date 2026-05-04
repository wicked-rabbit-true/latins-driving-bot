# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## WhatsApp Bot — Latin's Driving Support

An AI-powered WhatsApp assistant for the driving school "Latin's Driving Support".

### Files
- `artifacts/api-server/src/whatsapp/bot.js` — Main bot logic (whatsapp-web.js + OpenAI GPT-4o)
- `artifacts/api-server/src/whatsapp/manual.txt` — School knowledge base (edit this to update bot info)

### Architecture
- **WhatsApp**: `whatsapp-web.js` with `LocalAuth` (session persistence at `/home/runner/.wwebjs_auth`)
- **Browser**: System Chromium from Nix (`/nix/store/.../chromium`)
- **AI**: OpenAI GPT-4o with the school manual as system prompt
- **Web version cache**: Local at `/home/runner/.wwebjs_cache`

### Features
- Smart intent filter — only responds to driving school topics
- Ignores personal/social messages completely
- Multilingual (Urdu, Nepali, Turkish, English, Portuguese, Spanish, etc.)
- Escalates to Carlos for: 4-ton license, human agent requests, unknown answers
- No discounts policy enforced
- Appointment requests: collects Name + Service + Time, then "Carlos will confirm"

### Workflow
- Name: `WhatsApp Bot - Latin's Driving Support`
- Command: `pnpm --filter @workspace/api-server run bot`
- Type: console

### Setup / QR Scan
1. Start the workflow
2. Open WhatsApp > 3 dots > Linked Devices > Link a Device
3. Scan the QR code shown in the console
4. Session is persisted — no re-scan needed on restarts (unless session expires)

### To reset session
```bash
rm -rf /home/runner/.wwebjs_auth /home/runner/.wwebjs_cache
```

## Bookitit Integration

El bot intenta crear citas automáticamente en Bookitit cuando un cliente solicita turno por WhatsApp.

### Archivos
- `artifacts/api-server/src/whatsapp/bookitit.js` — Módulo de integración con la API de Bookitit

### Variables de entorno del bot

| Variable | Default | Description |
|---|---|---|
| `LANG_CACHE_TTL_MONTHS` | `12` | Number of months before an idle language-cache entry is pruned. Increase for stability; decrease for stricter privacy retention. |

### Variables de entorno necesarias
- `BOOKITIT_PUBLIC_KEY` — Clave pública (ya configurada)
- `BOOKITIT_PRIVATE_KEY` — Clave privada (ya configurada como secreto)
- `BOOKITIT_AGENDA_ID` — ID de la agenda en Bookitit (pendiente de configurar)
- `BOOKITIT_SERVICE_ID` — ID del servicio por defecto (pendiente de configurar)

### Estado de autenticación
La API de Bookitit responde pero rechaza las credenciales (error -46). Se usa Basic Auth con `public_key:sha1(public+private)`. Puede requerir activación específica del plan API en Bookitit.

### Comandos WhatsApp de Carlos para Bookitit
- `@bookitit test` — Probar la conexión con la API
- `@bookitit agendas` — Listar agendas disponibles (con sus IDs)
- `@bookitit servicios ID_AGENDA` — Listar servicios de una agenda

### Variables de entorno de servicios (Bookitit)
- `BOOKITIT_SERVICE_50TEST_ID` — ID servicio examen 50 preguntas
- `BOOKITIT_SERVICE_100TEST_ID` — ID servicio examen 100 preguntas
- `BOOKITIT_SERVICE_KUMAGAYA_ID` — ID servicio Kumagaya admisión
- `BOOKITIT_SERVICE_CAMPING_ID` — ID servicio Camping Course Tsuruoka
- `BOOKITIT_SERVICE_EXAM_ID` — ID servicio clases Oyama
- `BOOKITIT_AGENDA_MENKYO_ID` — ID agenda Menkyo Center (Chiba)

### Flujo de citas automático en confirmaciones
Al ejecutar cualquier `@confirmar*` (Konosu/Tochigi/Chiba/Kumagaya), el bot:
1. Crea automáticamente la cita en Bookitit (`createBookititAppt`)
2. Envía la plantilla WhatsApp al alumno
3. Notifica a Carlos con el resultado de Bookitit (✅ ID o ❌ error) en el mismo mensaje

El flujo de clientes AI sigue igual: `[NOTIFICAR_CARLOS:]` → intento Bookitit automático.

## iGiveTest Integration

El bot puede crear accesos de práctica en `lds-support.igivetest.net` automáticamente mediante el comando `@acceso`.

### Archivo
- `artifacts/api-server/src/whatsapp/igivetest.js` — Módulo de automatización del panel iGiveTest (login + creación de usuario + asignación de grupos)

### Variables de entorno necesarias
- `IGIVETEST_USERNAME` — Usuario admin del panel (valor: `lds`, guardado como env var)
- `IGIVETEST_PASSWORD` — Contraseña del panel admin (guardada como secreto de Replit)

### Comando `@acceso`
Carlos puede usar en tres modos:
- **Wizard completo**: `@acceso` → el bot pregunta destinatario y tipo de examen paso a paso
- **Semi-inline**: `@acceso +NUMERO` → el bot pregunta el tipo de examen
- **Inline**: `@acceso +NUMERO karimen-tochigi` → ejecuta directamente

### Tipos de examen disponibles
| Código | Descripción |
|---|---|
| `karimen-saitama` | Karimen 50 preguntas (Saitama/Konosu) |
| `karimen-tochigi` | Karimen 50 preguntas (Tochigi) |
| `karimen-chiba` | Karimen 50 preguntas (Chiba) |
| `honmen-saitama` | Honmen 100 preguntas (Saitama) |
| `honmen-tochigi` | Honmen 100 preguntas (Tochigi) |
| `honmen-chiba` | Honmen 100 preguntas (Chiba) |

Al confirmar, el bot: genera usuario+contraseña automáticos → crea la cuenta en iGiveTest → asigna los grupos correctos → envía las credenciales al alumno por WhatsApp → notifica a Carlos con el resumen.

## Exam Practice App — /exam

A standalone React + Vite web app for Japanese driving school exam practice.

### Artifact
- **URL**: `/exam/`
- **Workflow**: `artifacts/exam: web`
- **Source**: `artifacts/exam/src/`

### Pages
- `/` — Home: select Nivel 1 (Karimen) or Nivel 2 (Honmen), start a 50-question session
- `/examen/:sessionId` — Active exam: True/False questions one at a time with instant feedback + explanation
- `/resultado/:sessionId` — Results: score, pass/fail (≥90%), retry option
- `/admin` — Question bank: stats, search/filter, delete questions
- `/admin/analizar` — AI Analyzer: paste questions → GPT-4o analyzes True/False using knowledge base → save to DB

### Database tables
- `exam_questions` — question bank (pregunta, respuesta bool, explicacion, nivel, ciudad, imagen_url, imagenes_urls jsonb, imagen_descripcion text, revisado, veces_usada, veces_correcta)
- `exam_sessions` — practice sessions (nivel, ciudad, estado, respondidas, correctas, total_preguntas)
- `exam_session_questions` — session question list (links session to questions, tracks answers, includes imagen_url snapshot)

### Image support (Object Storage)
- Images stored in Replit Object Storage (GCS) under PRIVATE_OBJECT_DIR
- Upload flow: `POST /api/storage/uploads/request-url` → presigned GCS PUT → store `objectPath` as `imagenUrl` in DB
- Served via `GET /api/storage/objects/{path}` (no auth required in current setup)
- `imagen_url` column on both `exam_questions` and `exam_session_questions` tables

### API endpoints (`/api/exam/...`)
- `GET /exam/stats` — admin stats (total, nivel1, nivel2, revisadas, pendientes)
- `GET /exam/questions` — list with filters (nivel, revisado, q, limit, offset)
- `POST /exam/questions` — manual question creation (accepts imagenUrl)
- `POST /exam/questions/analyze` — single question AI analysis (GPT-4o + knowledge base)
- `POST /exam/questions/analyze-batch` — batch analysis (up to 50 questions)
- `GET/PUT/DELETE /exam/questions/:id` — CRUD per question (PUT accepts imagenUrl)
- `POST /exam/sessions` — start a session (picks 50/100 random questions for nivel, snapshots imagen_url)
- `GET /exam/sessions/:id` — session state + current unanswered question (includes imagenUrl)
- `POST /exam/sessions/:id/answer` — submit answer, get feedback + next question (includes imagenUrl)

### Workflow
1. Carlos goes to `/exam/admin/analizar`
2. Pastes iGiveTest questions (one per line)
3. Selects city + Nivel 1 or Nivel 2
4. Clicks "Analizar con IA" → GPT-4o determines True/False + explanation using the Japanese textbook knowledge base
5. Can correct any answer before saving (toggle V/F)
6. Clicks "Guardar" per question → after saved, an "Agregar imagen" button appears
7. Optionally uploads a traffic sign / scenario image per question
8. Students can take practice exams at `/exam/` — images shown above the question text when present

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/api-server run bot` — run WhatsApp bot

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
