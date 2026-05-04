import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botKnowledgeTable = pgTable("bot_knowledge", {
  id:           serial("id").primaryKey(),
  situacion:    text("situacion").notNull(),
  respuesta:    text("respuesta").notNull(),
  tipoEntrada:  text("tipo_entrada").default("respuesta"),     // 'respuesta' | 'instruccion'
  tipoUsuario:  text("tipo_usuario").default("general"),       // 'prospecto' | 'alumno' | 'general'
  idioma:       text("idioma").default("es"),                  // 'es' | 'en' | 'pt' | 'ur' | ...
  fuente:       text("fuente").default("manual"),              // 'manual' | 'auto'
  activo:       boolean("activo").default(true),
  vistas:       integer("vistas").default(0),
  creadoPor:    text("creado_por"),                            // número de Carlos u otro admin
  createdAt:    timestamp("created_at").defaultNow(),
  updatedAt:    timestamp("updated_at").defaultNow(),
});

export const insertBotKnowledgeSchema = createInsertSchema(botKnowledgeTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectBotKnowledgeSchema = createSelectSchema(botKnowledgeTable);
export type InsertBotKnowledge = z.infer<typeof insertBotKnowledgeSchema>;
export type BotKnowledge = typeof botKnowledgeTable.$inferSelect;
