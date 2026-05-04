import { pgTable, serial, text, integer, timestamp, boolean, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const examSessionsTable = pgTable("exam_sessions", {
  id:           serial("id").primaryKey(),
  nivel:        integer("nivel").notNull(),
  ciudad:       text("ciudad"),
  participante: text("participante"),
  estado:       text("estado").notNull().default("activo"),
  totalPreguntas: integer("total_preguntas").notNull().default(50),
  respondidas:  integer("respondidas").notNull().default(0),
  correctas:    integer("correctas").notNull().default(0),
  createdAt:    timestamp("created_at").defaultNow(),
  finishedAt:   timestamp("finished_at"),
});

export const examSessionQuestionsTable = pgTable("exam_session_questions", {
  id:          serial("id").primaryKey(),
  sessionId:   integer("session_id").notNull().references(() => examSessionsTable.id, { onDelete: "cascade" }),
  questionId:  integer("question_id"),
  numero:      integer("numero").notNull(),
  pregunta:    text("pregunta").notNull(),
  respuesta:   boolean("respuesta").notNull(),
  explicacion: text("explicacion"),
  imagenUrl:    text("imagen_url"),
  imagenesUrls: json("imagenes_urls").$type<string[]>(),
  respondida:  boolean("respondida").notNull().default(false),
  respuestaUsuario: boolean("respuesta_usuario"),
  correcta:    boolean("correcta"),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const insertExamSessionSchema = createInsertSchema(examSessionsTable).omit({ id: true, createdAt: true });
export type InsertExamSession = z.infer<typeof insertExamSessionSchema>;
export type ExamSession = typeof examSessionsTable.$inferSelect;

export const insertExamSessionQuestionSchema = createInsertSchema(examSessionQuestionsTable).omit({ id: true, createdAt: true });
export type InsertExamSessionQuestion = z.infer<typeof insertExamSessionQuestionSchema>;
export type ExamSessionQuestion = typeof examSessionQuestionsTable.$inferSelect;
