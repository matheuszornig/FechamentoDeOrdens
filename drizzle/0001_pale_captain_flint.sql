ALTER TABLE "apuracao_job" ADD COLUMN "include_position" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apuracao_job" ADD COLUMN "position_payload" jsonb;