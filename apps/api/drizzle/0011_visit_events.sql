CREATE TABLE "visit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"visit" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_events" ADD CONSTRAINT "visit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_events" ADD CONSTRAINT "visit_events_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_events_outlet_time" ON "visit_events" USING btree ("outlet_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_events_once" ON "visit_events" USING btree ("outlet_id","visit","kind");