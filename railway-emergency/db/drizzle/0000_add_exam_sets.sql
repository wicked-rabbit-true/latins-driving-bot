CREATE TABLE IF NOT EXISTS "exam_sets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exam_sets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ciudad" text NOT NULL,
	"examen_numero" integer NOT NULL,
	"nombre" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "exam_sets_ciudad_numero_unique" UNIQUE("ciudad","examen_numero")
);
