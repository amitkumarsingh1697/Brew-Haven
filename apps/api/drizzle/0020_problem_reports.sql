CREATE TABLE "problem_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"category" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "problem_reports_tenant_status" ON "problem_reports" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "problem_reports_one_per_order" ON "problem_reports" USING btree ("order_id");