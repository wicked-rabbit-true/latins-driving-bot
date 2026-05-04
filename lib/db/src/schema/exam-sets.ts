import { pgTable, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const examSetsTable = pgTable("exam_sets", {
  id:            integer("id").generatedAlwaysAsIdentity().primaryKey(),
  ciudad:        text("ciudad").notNull(),
  examenNumero:  integer("examen_numero").notNull(),
  nombre:        text("nombre"),
  createdAt:     timestamp("created_at").defaultNow(),
  updatedAt:     timestamp("updated_at").defaultNow(),
}, (t) => [
  unique("exam_sets_ciudad_numero_unique").on(t.ciudad, t.examenNumero),
]);

export const upsertExamSetSchema = z.object({
  ciudad: z.string().min(1),
  examenNumero: z.number().int().min(1),
  nombre: z.string().max(200).nullable().optional(),
});

export type ExamSet = typeof examSetsTable.$inferSelect;
