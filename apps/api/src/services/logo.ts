import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { StaffClaims } from "../auth.js";
import { withTx, type Db } from "../db/client.js";
import { tenantLogos, tenants } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";

/** Largest logo we keep. Receipts and posters print it small; 300 KB is plenty for a crisp 512 px image. */
export const MAX_LOGO_BYTES = 300 * 1024;

type LogoType = (typeof tenantLogos.$inferSelect)["contentType"];

/** Magic bytes, so a file's real type decides, not the name or the label it came with. SVG is refused (it can carry script). */
function sniff(bytes: Buffer): LogoType | null {
  if (
    bytes.length > 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (
    bytes.length > 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

let urls = { api: "http://localhost:8080", customer: "http://localhost:5173" };

/** Logos are shown by the customer app, the staff app and printed receipts, all on different origins, so their URLs are absolute. */
export function configureLogoUrls(api: string, customer: string) {
  urls = { api: api.replace(/\/$/, ""), customer: customer.replace(/\/$/, "") };
}

/**
 * The logo to show for a café: the one the owner uploaded, or else the one set up for them
 * (a path in the customer app, such as the seeded demo logo), or none.
 */
export async function logoUrlFor(
  db: Db,
  tenant: { id: string; slug: string; branding: unknown },
): Promise<string | null> {
  const [up] = await db
    .select({ hash: tenantLogos.hash })
    .from(tenantLogos)
    .where(eq(tenantLogos.tenantId, tenant.id));
  if (up) return `${urls.api}/v1/cafes/${tenant.slug}/logo?v=${up.hash}`;
  const configured = (tenant.branding as { logoUrl?: string | null } | null)
    ?.logoUrl;
  if (!configured) return null;
  return configured.startsWith("/")
    ? `${urls.customer}${configured}`
    : configured;
}

/** Owner only: replace the café's logo with an uploaded PNG, JPG or WebP (sent as a data URL). */
export async function saveLogo(db: Db, staff: StaffClaims, dataUrl: string) {
  if (staff.role !== "ADMIN")
    throw new AppError("FORBIDDEN", "Only the owner can change the logo");
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw new AppError("VALIDATION", "Choose a PNG, JPG or WebP image");
  const bytes = Buffer.from(m[2]!, "base64");
  if (bytes.length > MAX_LOGO_BYTES)
    throw new AppError(
      "VALIDATION",
      "That image is too big. Use one under 300 KB.",
    );
  const contentType = sniff(bytes);
  if (!contentType)
    throw new AppError("VALIDATION", "Choose a PNG, JPG or WebP image");
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const row = {
    contentType,
    data: bytes.toString("base64"),
    hash,
    updatedAt: new Date(),
  };
  await db
    .insert(tenantLogos)
    .values({ tenantId: staff.tenantId, ...row })
    .onConflictDoUpdate({ target: tenantLogos.tenantId, set: row });
  return currentLogo(db, staff.tenantId);
}

/** Owner only: take the logo off everything (also clears a logo that was set up for them). */
export async function removeLogo(db: Db, staff: StaffClaims) {
  if (staff.role !== "ADMIN")
    throw new AppError("FORBIDDEN", "Only the owner can change the logo");
  await withTx(db, async (tx) => {
    await tx
      .delete(tenantLogos)
      .where(eq(tenantLogos.tenantId, staff.tenantId));
    const [t] = await tx
      .select({ branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, staff.tenantId));
    await tx
      .update(tenants)
      .set({
        branding: {
          ...(t!.branding as Record<string, unknown>),
          logoUrl: null,
        },
      })
      .where(eq(tenants.id, staff.tenantId));
  });
  return currentLogo(db, staff.tenantId);
}

async function currentLogo(db: Db, tenantId: string) {
  const [t] = await db
    .select({ id: tenants.id, slug: tenants.slug, branding: tenants.branding })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return { logoUrl: await logoUrlFor(db, t!) };
}

/** Public: the uploaded logo's bytes, for <img> tags anywhere. */
export async function readLogo(db: Db, tenantSlug: string) {
  const [row] = await db
    .select({
      contentType: tenantLogos.contentType,
      data: tenantLogos.data,
      hash: tenantLogos.hash,
    })
    .from(tenantLogos)
    .innerJoin(tenants, eq(tenants.id, tenantLogos.tenantId))
    .where(eq(tenants.slug, tenantSlug));
  if (!row) throw notFound("Logo");
  return {
    contentType: row.contentType,
    bytes: Buffer.from(row.data, "base64"),
    hash: row.hash,
  };
}
