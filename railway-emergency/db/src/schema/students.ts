import { pgTable, serial, text, date, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studentsTable = pgTable("students", {
  id:              serial("id").primaryKey(),
  codigoAlumno:    text("codigo_alumno").unique(),    // KM2519, KM2520, … (auto-generado)
  nombre:          text("nombre").notNull(),
  telefono:        text("telefono").notNull().unique(),
  email:           text("email"),
  sexo:            text("sexo"),                      // 'M' | 'F' | 'Otro'
  fechaNacimiento: date("fecha_nacimiento"),
  direccion:       text("direccion"),
  codigoPostal:    text("codigo_postal"),
  tipoLicencia:    text("tipo_licencia"),              // 'AT' | 'MT' | '3ton' | etc.
  expiracionVisa:  date("expiracion_visa"),
  valorCurso:      integer("valor_curso").default(0), // en yenes
  montoPagado:     integer("monto_pagado").default(0),// en yenes
  bookititId:      text("bookitit_id"),               // ID asignado por Bookitit al registrar
  notas:           text("notas"),                     // notas libres
  preferredLanguage: text("preferred_language"),      // 'es' | 'en' | 'pt' | 'ur' | 'ne' | 'tr' etc.
  // Campos de la tarjeta de residencia 在留カード
  tipoVisa:        text("tipo_visa"),                 // tipo de residencia (ej: 技術・人文知識)
  numeroZairyu:    text("numero_zairyu"),             // número de tarjeta (ej: UH723111194PA)
  nacionalidad:    text("nacionalidad"),              // país de origen
  categoria3045:   text("categoria_30_45"),           // 法第30条の45に規定する区分
  duracionVisa:    text("duracion_visa"),             // período (1年, 3年, etc.)
  fechaInscripcion:    date("fecha_inscripcion"),                      // fecha de ingreso a la escuela (入校日)
  prefectura:          text("prefectura"),                             // 'tochigi' | 'saitama' | 'kanagawa' | 'tokyo'
  // ── Estado del proceso académico ─────────────────────────────────────────
  examen50Estado:      text("examen_50_estado").default('pendiente'),  // 'pendiente' | 'aprobado'
  internadoFechaInicio: date("internado_fecha_inicio"),                 // null = sin fecha confirmada
  internadoFechaFin:   date("internado_fecha_fin"),
  examen100Estado:     text("examen_100_estado").default('pendiente'), // 'pendiente' | 'aprobado'
  examen100Departamento: text("examen_100_departamento"),              // 'tochigi' | 'saitama' | 'chiba'
  pagoEstado:          text("pago_estado").default('pendiente'),        // 'pendiente' | 'pagado'
  // ── Tsuruoka graduation (卒業証明書) ─────────────────────────────────────
  tsuruokaGraduado:       boolean("tsuruoka_graduado").default(false),
  tsuruokaFechaGraduacion: date("tsuruoka_fecha_graduacion"),
  // ── iGiveTest ────────────────────────────────────────────────────────────
  igtUsername:     text("igt_username"),
  igtPassword:     text("igt_password"),
  igtExpiresAt:    timestamp("igt_expires_at"),
  igtExamType:     text("igt_exam_type"),
  igtExamType2:    text("igt_exam_type2"),
  createdAt:       timestamp("created_at").defaultNow(),
  updatedAt:       timestamp("updated_at").defaultNow(),
});

export const botNotificationsTable = pgTable("bot_notifications", {
  id:          serial("id").primaryKey(),
  type:        text("type").notNull(),
  message:     text("message").notNull(),
  chatId:      text("chat_id"),
  studentName: text("student_name"),
  leida:       boolean("leida").default(false),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const botActionQueueTable = pgTable("bot_action_queue", {
  id:          serial("id").primaryKey(),
  type:        text("type").notNull(),
  payload:     jsonb("payload").notNull().default({}),
  status:      text("status").default('pending'),   // 'pending' | 'done' | 'failed'
  createdAt:   timestamp("created_at").defaultNow(),
  processedAt: timestamp("processed_at"),
  error:       text("error"),
});

export const languageCachePruneLogTable = pgTable("language_cache_prune_log", {
  id:        serial("id").primaryKey(),
  prunedAt:  timestamp("pruned_at").defaultNow().notNull(),
  removed:   integer("removed").notNull(),
  malformed: integer("malformed").notNull(),
});

export type LanguageCachePruneLog = typeof languageCachePruneLogTable.$inferSelect;

export type BotNotification = typeof botNotificationsTable.$inferSelect;
export type BotActionQueue  = typeof botActionQueueTable.$inferSelect;

export const insertStudentSchema = createInsertSchema(studentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectStudentSchema = createSelectSchema(studentsTable);

export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;
