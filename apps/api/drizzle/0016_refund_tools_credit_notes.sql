CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"number" text NOT NULL,
	"invoice_no" text NOT NULL,
	"business_date" date NOT NULL,
	"reason" text NOT NULL,
	"tax_rate_bps" integer NOT NULL,
	"taxable_paise" integer NOT NULL,
	"tax_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "approved_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "cashier_refund_limit_paise" integer DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_tenant_number" ON "credit_notes" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "credit_notes_order" ON "credit_notes" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_staff_id_staff_users_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;