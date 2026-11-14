ALTER TABLE "orders" ADD COLUMN "prices_include_tax" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "round_off_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tendered_paise" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "instrument" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "prices_include_tax" boolean DEFAULT true NOT NULL;