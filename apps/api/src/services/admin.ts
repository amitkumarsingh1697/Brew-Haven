import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  AdminSettingsRequest,
  AdminSetup,
  CategoryRequest,
  CreateOutletRequest,
  ItemRequest,
  ListingRequest,
  ModifierGroupInput,
  OutletWithStations,
  StaffUserRequest,
  StationInput,
  UpdateItemRequest,
  UpdateOutletRequest,
  UpdateStaffUserRequest,
} from "@brew-haven/contracts";
import { hashPin, type StaffClaims } from "../auth.js";
import type { Db, Tx } from "../db/client.js";
import { categories, menuItems, modifierGroups, modifierOptions, outletItemStock, outlets, staffUsers, stations, tenants } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";

/** Owner self-service (D-17). Every function here is ADMIN-only and scoped to the admin's tenant. */

export function assertAdmin(staff: StaffClaims) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner/admin can change the café setup");
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s.length >= 2 ? s : `x-${s || "item"}`;
}

const isUnique = (e: unknown) => (e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505";

// ---------- Read ----------

export async function outletsWithStations(db: Db | Tx, tenantId: string, outletIds?: string[]): Promise<OutletWithStations[]> {
  const cond = outletIds ? and(eq(outlets.tenantId, tenantId), inArray(outlets.id, outletIds.length ? outletIds : ["00000000-0000-0000-0000-000000000000"])) : eq(outlets.tenantId, tenantId);
  const os = await db.select().from(outlets).where(cond).orderBy(asc(outlets.createdAt), asc(outlets.name));
  const st = os.length ? await db.select().from(stations).where(inArray(stations.outletId, os.map((o) => o.id))).orderBy(asc(stations.sort), asc(stations.name)) : [];
  return os.map((o) => ({
    id: o.id,
    slug: o.slug,
    name: o.name,
    pickupPrefix: o.pickupPrefix,
    address: o.address,
    isOpen: o.isOpen,
    stations: st.filter((s) => s.outletId === o.id).map((s) => ({ id: s.id, key: s.key, name: s.name })),
  }));
}

/** Outlets this staff member can work at. Admins see every outlet, including ones created after they signed in. */
export async function accessibleOutlets(db: Db, staff: StaffClaims) {
  return outletsWithStations(db, staff.tenantId, staff.role === "ADMIN" ? undefined : staff.outletIds);
}

export async function getSetup(db: Db, staff: StaffClaims): Promise<AdminSetup> {
  assertAdmin(staff);
  const t = staff.tenantId;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, t));
  const [os, cats, items, groups, options, unlisted, users] = await Promise.all([
    outletsWithStations(db, t),
    db.select().from(categories).where(eq(categories.tenantId, t)).orderBy(asc(categories.sort), asc(categories.name)),
    db.select().from(menuItems).where(eq(menuItems.tenantId, t)).orderBy(asc(menuItems.sort), asc(menuItems.name)),
    db.select().from(modifierGroups).where(eq(modifierGroups.tenantId, t)).orderBy(asc(modifierGroups.sort)),
    db.select().from(modifierOptions).where(eq(modifierOptions.tenantId, t)).orderBy(asc(modifierOptions.sort)),
    db.select().from(outletItemStock).where(and(eq(outletItemStock.tenantId, t), eq(outletItemStock.listed, false))),
    db.select().from(staffUsers).where(eq(staffUsers.tenantId, t)).orderBy(asc(staffUsers.name)),
  ]);
  const b = tenant!.branding as Record<string, string | undefined>;
  return {
    tenant: {
      slug: tenant!.slug,
      name: tenant!.name,
      taxRateBps: tenant!.taxRateBps,
      branding: { displayName: b.displayName ?? tenant!.name, tagline: b.tagline, greeting: b.greeting, managerName: b.managerName, logoUrl: b.logoUrl ?? null },
    },
    outlets: os,
    categories: cats.map((c) => ({ id: c.id, name: c.name, sort: c.sort, active: c.active })),
    items: items.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      description: i.description,
      pricePaise: i.pricePaise,
      isVeg: i.isVeg,
      tags: i.tags,
      stationKey: i.stationKey,
      imageUrl: i.imageUrl,
      active: i.active,
      modifierGroups: groups
        .filter((g) => g.itemId === i.id)
        .map((g) => ({
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: options.filter((o) => o.groupId === g.id).map((o) => ({ name: o.name, pricePaise: o.pricePaise })),
        })),
      unlistedAt: unlisted.filter((u) => u.itemId === i.id).map((u) => u.outletId),
    })),
    staff: users.map((u) => ({ id: u.id, name: u.name, role: u.role, outletIds: u.outletIds, active: u.active })),
  };
}

// ---------- Settings ----------

export async function updateSettings(db: Db, staff: StaffClaims, body: z.output<typeof AdminSettingsRequest>) {
  assertAdmin(staff);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, staff.tenantId));
  const branding = { ...(tenant!.branding as Record<string, unknown>), displayName: body.displayName, tagline: body.tagline, greeting: body.greeting, managerName: body.managerName };
  await db.update(tenants).set({ branding, taxRateBps: body.taxRateBps }).where(eq(tenants.id, staff.tenantId));
  return getSetup(db, staff);
}

// ---------- Outlets and stations ----------

async function ownOutlet(db: Db | Tx, staff: StaffClaims, outletId: string) {
  const [o] = await db.select().from(outlets).where(and(eq(outlets.id, outletId), eq(outlets.tenantId, staff.tenantId)));
  if (!o) throw notFound("Café");
  return o;
}

export async function createOutlet(db: Db, staff: StaffClaims, body: z.output<typeof CreateOutletRequest>) {
  assertAdmin(staff);
  const slug = body.slug ?? slugify(body.name);
  const existing = await db.select().from(outlets).where(eq(outlets.tenantId, staff.tenantId));
  if (existing.some((o) => o.slug === slug)) throw new AppError("CONFLICT", `A café with the link "${slug}" already exists. Choose a different name or link.`);
  if (existing.some((o) => o.pickupPrefix === body.pickupPrefix)) throw new AppError("CONFLICT", `Pickup letter ${body.pickupPrefix} is already used by another café`);

  let stationList: Array<{ key: string; name: string }>;
  if (body.stations?.length) {
    stationList = body.stations.map((s) => ({ key: s.key ?? slugify(s.name), name: s.name }));
  } else if (existing[0]) {
    const template = await db.select().from(stations).where(eq(stations.outletId, existing[0].id)).orderBy(asc(stations.sort));
    stationList = template.map((s) => ({ key: s.key, name: s.name }));
  } else {
    stationList = [{ key: "kitchen", name: "Kitchen" }];
  }
  if (new Set(stationList.map((s) => s.key)).size !== stationList.length) throw new AppError("VALIDATION", "Two kitchens have the same name");

  return db.transaction(async (tx) => {
    const [o] = await tx
      .insert(outlets)
      .values({ tenantId: staff.tenantId, slug, name: body.name, pickupPrefix: body.pickupPrefix, address: body.address ?? null, isOpen: true })
      .returning();
    if (stationList.length) await tx.insert(stations).values(stationList.map((s, i) => ({ tenantId: staff.tenantId, outletId: o!.id, key: s.key, name: s.name, sort: i })));
    return (await outletsWithStations(tx, staff.tenantId, [o!.id]))[0]!;
  });
}

export async function updateOutlet(db: Db, staff: StaffClaims, outletId: string, body: z.output<typeof UpdateOutletRequest>) {
  assertAdmin(staff);
  await ownOutlet(db, staff, outletId);
  if (body.pickupPrefix) {
    const clash = await db.select({ id: outlets.id }).from(outlets).where(and(eq(outlets.tenantId, staff.tenantId), eq(outlets.pickupPrefix, body.pickupPrefix), ne(outlets.id, outletId)));
    if (clash.length) throw new AppError("CONFLICT", `Pickup letter ${body.pickupPrefix} is already used by another café`);
  }
  const patch: Partial<typeof outlets.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.pickupPrefix !== undefined) patch.pickupPrefix = body.pickupPrefix;
  if (body.address !== undefined) patch.address = body.address || null;
  if (body.isOpen !== undefined) patch.isOpen = body.isOpen;
  if (Object.keys(patch).length) await db.update(outlets).set(patch).where(eq(outlets.id, outletId));
  return (await outletsWithStations(db, staff.tenantId, [outletId]))[0]!;
}

export async function addStation(db: Db, staff: StaffClaims, outletId: string, body: z.output<typeof StationInput>) {
  assertAdmin(staff);
  await ownOutlet(db, staff, outletId);
  const key = body.key ?? slugify(body.name);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(stations).where(eq(stations.outletId, outletId))) as [{ n: number }];
  try {
    await db.insert(stations).values({ tenantId: staff.tenantId, outletId, key, name: body.name, sort: n });
  } catch (e) {
    if (isUnique(e)) throw new AppError("CONFLICT", "This café already has a kitchen with that name");
    throw e;
  }
  return (await outletsWithStations(db, staff.tenantId, [outletId]))[0]!;
}

export async function renameStation(db: Db, staff: StaffClaims, stationId: string, name: string) {
  assertAdmin(staff);
  const [s] = await db.update(stations).set({ name }).where(and(eq(stations.id, stationId), eq(stations.tenantId, staff.tenantId))).returning();
  if (!s) throw notFound("Kitchen");
  return (await outletsWithStations(db, staff.tenantId, [s.outletId]))[0]!;
}

export async function removeStation(db: Db, staff: StaffClaims, stationId: string) {
  assertAdmin(staff);
  const [s] = await db.select().from(stations).where(and(eq(stations.id, stationId), eq(stations.tenantId, staff.tenantId)));
  if (!s) throw notFound("Kitchen");
  const siblings = await db.select().from(stations).where(eq(stations.outletId, s.outletId));
  if (siblings.length <= 1) throw new AppError("CONFLICT", "A café needs at least one kitchen");
  await db.delete(stations).where(eq(stations.id, stationId));
  return (await outletsWithStations(db, staff.tenantId, [s.outletId]))[0]!;
}

// ---------- Menu ----------

export async function createCategory(db: Db, staff: StaffClaims, body: z.output<typeof CategoryRequest>) {
  assertAdmin(staff);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(categories).where(eq(categories.tenantId, staff.tenantId))) as [{ n: number }];
  const [c] = await db.insert(categories).values({ tenantId: staff.tenantId, name: body.name, sort: body.sort ?? n, active: body.active ?? true }).returning();
  return { id: c!.id, name: c!.name, sort: c!.sort, active: c!.active };
}

export async function updateCategory(db: Db, staff: StaffClaims, id: string, body: z.output<typeof CategoryRequest>) {
  assertAdmin(staff);
  const patch: Partial<typeof categories.$inferInsert> = { name: body.name };
  if (body.sort !== undefined) patch.sort = body.sort;
  if (body.active !== undefined) patch.active = body.active;
  const [c] = await db.update(categories).set(patch).where(and(eq(categories.id, id), eq(categories.tenantId, staff.tenantId))).returning();
  if (!c) throw notFound("Menu section");
  return { id: c.id, name: c.name, sort: c.sort, active: c.active };
}

async function assertCategory(db: Db | Tx, staff: StaffClaims, categoryId: string) {
  const [c] = await db.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.tenantId, staff.tenantId)));
  if (!c) throw new AppError("VALIDATION", "Choose a menu section that exists");
}

async function replaceModifiers(tx: Tx, tenantId: string, itemId: string, groups: Array<z.output<typeof ModifierGroupInput>>) {
  const old = await tx.select({ id: modifierGroups.id }).from(modifierGroups).where(eq(modifierGroups.itemId, itemId));
  if (old.length) {
    await tx.delete(modifierOptions).where(inArray(modifierOptions.groupId, old.map((g) => g.id)));
    await tx.delete(modifierGroups).where(eq(modifierGroups.itemId, itemId));
  }
  // Order lines keep a snapshot of the options they were ordered with, so replacing options is safe.
  for (const [gi, g] of groups.entries()) {
    const [row] = await tx.insert(modifierGroups).values({ tenantId, itemId, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, sort: gi }).returning();
    await tx.insert(modifierOptions).values(g.options.map((o, oi) => ({ tenantId, groupId: row!.id, name: o.name, pricePaise: o.pricePaise, sort: oi })));
  }
}

export async function createItem(db: Db, staff: StaffClaims, body: z.output<typeof ItemRequest>) {
  assertAdmin(staff);
  await assertCategory(db, staff, body.categoryId);
  const id = await db.transaction(async (tx) => {
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(menuItems).where(eq(menuItems.categoryId, body.categoryId))) as [{ n: number }];
    const [item] = await tx
      .insert(menuItems)
      .values({
        tenantId: staff.tenantId,
        categoryId: body.categoryId,
        name: body.name,
        description: body.description,
        pricePaise: body.pricePaise,
        isVeg: body.isVeg,
        tags: body.tags,
        stationKey: body.stationKey,
        imageUrl: body.imageUrl ?? null,
        active: body.active ?? true,
        sort: n,
      })
      .returning();
    await replaceModifiers(tx, staff.tenantId, item!.id, body.modifierGroups ?? []);
    return item!.id;
  });
  return (await getSetup(db, staff)).items.find((i) => i.id === id)!;
}

export async function updateItem(db: Db, staff: StaffClaims, itemId: string, body: z.output<typeof UpdateItemRequest>) {
  assertAdmin(staff);
  const [item] = await db.select().from(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.tenantId, staff.tenantId)));
  if (!item) throw notFound("Menu item");
  if (body.categoryId) await assertCategory(db, staff, body.categoryId);
  await db.transaction(async (tx) => {
    const patch: Partial<typeof menuItems.$inferInsert> = {};
    for (const k of ["categoryId", "name", "description", "pricePaise", "isVeg", "tags", "stationKey", "active"] as const) {
      if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
    }
    if (body.imageUrl !== undefined) patch.imageUrl = body.imageUrl;
    if (Object.keys(patch).length) await tx.update(menuItems).set(patch).where(eq(menuItems.id, itemId));
    if (body.modifierGroups) await replaceModifiers(tx, staff.tenantId, itemId, body.modifierGroups);
  });
  return (await getSetup(db, staff)).items.find((i) => i.id === itemId)!;
}

export async function setListing(db: Db, staff: StaffClaims, body: z.output<typeof ListingRequest>) {
  assertAdmin(staff);
  await ownOutlet(db, staff, body.outletId);
  const [item] = await db.select().from(menuItems).where(and(eq(menuItems.id, body.itemId), eq(menuItems.tenantId, staff.tenantId)));
  if (!item) throw notFound("Menu item");
  await db
    .insert(outletItemStock)
    .values({ tenantId: staff.tenantId, outletId: body.outletId, itemId: body.itemId, listed: body.listed })
    .onConflictDoUpdate({ target: [outletItemStock.outletId, outletItemStock.itemId], set: { listed: body.listed, updatedAt: new Date() } });
  return { outletId: body.outletId, itemId: body.itemId, listed: body.listed };
}

// ---------- Staff ----------

async function assertOutletIds(db: Db, staff: StaffClaims, ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: outlets.id }).from(outlets).where(and(eq(outlets.tenantId, staff.tenantId), inArray(outlets.id, ids)));
  if (rows.length !== new Set(ids).size) throw new AppError("VALIDATION", "One of the chosen cafés does not exist");
}

export async function createStaffUser(db: Db, staff: StaffClaims, body: z.output<typeof StaffUserRequest>) {
  assertAdmin(staff);
  if (body.role !== "ADMIN" && body.outletIds.length === 0) throw new AppError("VALIDATION", "Choose at least one café for this person");
  await assertOutletIds(db, staff, body.outletIds);
  const [u] = await db
    .insert(staffUsers)
    .values({ tenantId: staff.tenantId, name: body.name, role: body.role, pinHash: await hashPin(body.pin), outletIds: body.outletIds })
    .returning();
  return { id: u!.id, name: u!.name, role: u!.role, outletIds: u!.outletIds, active: u!.active };
}

export async function updateStaffUser(db: Db, staff: StaffClaims, userId: string, body: z.output<typeof UpdateStaffUserRequest>) {
  assertAdmin(staff);
  const [u] = await db.select().from(staffUsers).where(and(eq(staffUsers.id, userId), eq(staffUsers.tenantId, staff.tenantId)));
  if (!u) throw notFound("Staff member");
  if (userId === staff.sub && (body.active === false || (body.role && body.role !== "ADMIN"))) {
    throw new AppError("CONFLICT", "You can't remove your own admin access");
  }
  if (body.outletIds) await assertOutletIds(db, staff, body.outletIds);
  const patch: Partial<typeof staffUsers.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.role !== undefined) patch.role = body.role;
  if (body.outletIds !== undefined) patch.outletIds = body.outletIds;
  if (body.active !== undefined) patch.active = body.active;
  if (body.pin !== undefined) patch.pinHash = await hashPin(body.pin);
  const [row] = await db.update(staffUsers).set(patch).where(eq(staffUsers.id, userId)).returning();
  return { id: row!.id, name: row!.name, role: row!.role, outletIds: row!.outletIds, active: row!.active };
}
