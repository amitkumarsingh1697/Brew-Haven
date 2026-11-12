ALTER TABLE "tenants" ADD COLUMN "plan" text DEFAULT 'starter' NOT NULL;--> statement-breakpoint
-- Businesses that exist before plans (the pilot) keep no limits.
UPDATE "tenants" SET "plan" = 'multi';
