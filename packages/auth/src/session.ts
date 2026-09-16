import { createHash, randomBytes } from "node:crypto";

export function generateSessionToken(): string { return randomBytes(32).toString("base64url"); }
export function hashSessionToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Password must contain at least 12 characters");
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function sessionExpiresAt(ttlHours: number, now = new Date()): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}
