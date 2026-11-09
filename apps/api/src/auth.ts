import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import type { StaffRole } from "@brew-haven/contracts";
import { AppError } from "./errors.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SEP = ":";

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return ["scrypt", salt.toString("base64"), key.toString("base64")].join(SEP);
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split(SEP);
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(pin, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

export interface StaffClaims {
  sub: string;
  tenantId: string;
  role: StaffRole;
  outletIds: string[];
  name: string;
}

export class StaffTokens {
  private key: Uint8Array;
  constructor(secret: string) {
    if (secret.length < 32) throw new Error("STAFF_TOKEN_SECRET must be at least 32 characters");
    this.key = new TextEncoder().encode(secret);
  }
  async issue(claims: StaffClaims): Promise<string> {
    return new SignJWT({ tenantId: claims.tenantId, role: claims.role, outletIds: claims.outletIds, name: claims.name })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime("14h")
      .setAudience("brew-haven-staff")
      .sign(this.key);
  }
  async verify(token: string): Promise<StaffClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { audience: "brew-haven-staff" });
      return {
        sub: String(payload.sub),
        tenantId: String(payload.tenantId),
        role: payload.role as StaffRole,
        outletIds: payload.outletIds as string[],
        name: String(payload.name),
      };
    } catch {
      throw new AppError("UNAUTHORIZED", "Your session has expired. Please sign in again.");
    }
  }
}

/** Small in-memory limiter for PIN attempts (per staff user and IP). */
export class AttemptLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private max = 5,
    private windowMs = 5 * 60 * 1000,
  ) {}
  check(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (h && h.resetAt > now && h.count >= this.max) {
      throw new AppError("RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
    }
  }
  fail(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count += 1;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}
