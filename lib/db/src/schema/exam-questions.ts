import { pgTable, serial, text, boolean, integer, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const examQuestionsTable = pgTable("exam_questions", {
  id:            serial("id").primaryKey(),
  pregunta:      text("pregunta").notNull(),
  respuesta:     boolean("respuesta").notNull(),
  explicacion:   text("explicacion"),
  nivel:         integer("nivel").notNull().default(2),
  ciudad:        text("ciudad"),
  imagenUrl:          text("imagen_url"),
  imagenesUrls:       json("imagenes_urls").$type<string[]>(),
  imagenDescripcion:  text("imagen_descripcion"),
  examenNumero:  integer("examen_numero"),
  fuente:        text("fuente"),
  revisado:      boolean("revisado").notNull().default(false),
  vecesUsada:    integer("veces_usada").notNull().default(0),
  vecesCorrecta: integer("veces_correcta").notNull().default(0),
  createdAt:     timestamp("created_at").defaultNow(),
  updatedAt:     timestamp("updated_at").defaultNow(),
});

export const insertExamQuestionSchema = createInsertSchema(examQuestionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExamQuestion = z.infer<typeof insertExamQuestionSchema>;
export type ExamQuestion = typeof examQuestionsTable.$inferSelect;
