ALTER TABLE "categories" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "outlet_item_stock" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stations_outlet_key" ON "stations" USING btree ("outlet_id","key");