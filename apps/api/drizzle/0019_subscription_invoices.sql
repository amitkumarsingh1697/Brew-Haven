CREATE TABLE "platform_counters" (
	"series" text PRIMARY KEY NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"plan" text NOT NULL,
	"period" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"taxable_paise" integer NOT NULL,
	"cgst_paise" integer NOT NULL,
	"sgst_paise" integer NOT NULL,
	"igst_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"payment" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_invoices_tenant" ON "subscription_invoices" USING btree ("tenant_id","issued_on");