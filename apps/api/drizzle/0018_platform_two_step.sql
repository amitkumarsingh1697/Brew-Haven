ALTER TABLE "platform_admins" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "totp_pending_secret" text;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL;