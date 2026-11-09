CREATE TABLE "invoice_counters" (
	"outlet_id" uuid NOT NULL,
	"financial_year" text NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_counters_outlet_id_financial_year_pk" PRIMARY KEY("outlet_id","financial_year")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_no" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_invoice" ON "orders" USING btree ("tenant_id","invoice_no");