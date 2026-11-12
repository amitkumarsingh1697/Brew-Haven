import { eq, like, or } from "drizzle-orm";
import type { z } from "zod";
import type { SignupRequest } from "@brew-haven/contracts";
import { trialEndFrom } from "@brew-haven/domain";
import { hashPin, type StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { outlets, staffUsers, stations, tenants } from "../db/schema.js";
import { AppError } from "../errors.js";
import { createCategory, createItem, slugify } from "./admin.js";

/** Words a business link can't be, because they read as part of the product or its pages. */
const RESERVED = new Set(["admin", "api", "app", "staff", "signup", "login", "health", "v1", "order", "orders", "track", "help", "support", "www", "brew-haven", "demo"]);

/** A free link for the business: "blue-door-cafe", or "blue-door-cafe-2" if that's taken. */
async function freeSlug(db: Db, name: string) {
  let base = slugify(name).slice(0, 40).replace(/-+$/, "") || "cafe";
  if (RESERVED.has(base)) base = `${base}-cafe`;
  const taken = new Set((await db.select({ slug: tenants.slug }).from(tenants).where(or(eq(tenants.slug, base), like(tenants.slug, `${base}-%`)))).map((t) => t.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** A starting menu to edit rather than a blank page. Prices are placeholders the owner changes. */
const SAMPLE: Array<{ section: string; items: Array<{ name: string; description: string; pricePaise: number; milk?: boolean }> }> = [
  {
    section: "Coffee",
    items: [
      { name: "Espresso", description: "A short, strong shot.", pricePaise: 12000 },
      { name: "Cappuccino", description: "Espresso with steamed milk and foam.", pricePaise: 18000, milk: true },
      { name: "Café Latte", description: "Espresso with plenty of steamed milk.", pricePaise: 19000, milk: true },
    ],
  },
  {
    section: "Tea",
    items: [{ name: "Masala Chai", description: "Spiced milk tea.", pricePaise: 9000 }],
  },
];

/**
 * Creates a new café business: the business, its first café with one kitchen, and the owner's
 * sign-in. Optionally adds a small sample menu. Returns the business link; the caller signs the
 * owner in.
 */
export async function signup(db: Db, body: z.output<typeof SignupRequest>) {
  const slug = await freeSlug(db, body.businessName);
  const prefix = body.pickupPrefix ?? (slugify(body.cafeName).replace(/[^a-z]/g, "").charAt(0).toUpperCase() || "A");
  const outletSlug = slugify(body.cafeName).slice(0, 40) || "cafe";

  const created = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({ slug, name: body.businessName, branding: { displayName: body.businessName }, contact: { email: body.email, phone: body.phone }, trialEndsAt: trialEndFrom() })
      .returning();
    const [outlet] = await tx
      .insert(outlets)
      .values({ tenantId: tenant!.id, slug: outletSlug, name: body.cafeName, pickupPrefix: prefix, address: body.address || null, isOpen: true })
      .returning();
    await tx.insert(stations).values({ tenantId: tenant!.id, outletId: outlet!.id, key: "kitchen", name: "Kitchen", sort: 0 });
    const [owner] = await tx
      .insert(staffUsers)
      .values({ tenantId: tenant!.id, name: body.ownerName, role: "ADMIN", pinHash: await hashPin(body.pin), outletIds: [] })
      .returning();
    return { tenant: tenant!, outlet: outlet!, owner: owner! };
  });

  if (body.sampleMenu) {
    const as: StaffClaims = { sub: created.owner.id, tenantId: created.tenant.id, role: "ADMIN", outletIds: [created.outlet.id], name: created.owner.name };
    for (const s of SAMPLE) {
      const cat = await createCategory(db, as, { name: s.section });
      for (const item of s.items)
        await createItem(db, as, {
          categoryId: cat.id,
          name: item.name,
          description: item.description,
          pricePaise: item.pricePaise,
          isVeg: true,
          tags: [],
          stationKey: "kitchen",
          modifierGroups: item.milk
            ? [{ name: "Milk", minSelect: 1, maxSelect: 1, options: [{ name: "Regular milk", pricePaise: 0 }, { name: "Oat milk", pricePaise: 5000 }] }]
            : undefined,
        });
    }
  }
  return { tenantSlug: created.tenant.slug, tenantName: created.tenant.name, outletSlug: created.outlet.slug, ownerId: created.owner.id };
}

export function assertSignupOpen(enabled: boolean) {
  if (!enabled) throw new AppError("FORBIDDEN", "Sign-up is closed. Contact us to open an account.");
}
