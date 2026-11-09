CREATE TABLE "shift_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"closed_by_id" uuid,
	"closed_by_name" text NOT NULL,
	"opening_float_paise" integer NOT NULL,
	"counted_cash_paise" integer NOT NULL,
	"expected_cash_paise" integer NOT NULL,
	"variance_paise" integer NOT NULL,
	"takings_by_method" jsonb NOT NULL,
	"net_paise" integer NOT NULL,
	"open_orders" integer NOT NULL,
	"note" text,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_closed_by_id_staff_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_closes_outlet_day" ON "shift_closes" USING btree ("outlet_id","business_date");