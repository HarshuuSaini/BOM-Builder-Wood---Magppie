import "server-only";
import { deflateSync, inflateSync } from "node:zlib";

import { createHash, timingSafeEqual } from "node:crypto";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { KitchenMaterials } from "@/lib/kitchen-materials";

type UserSession = { user: string; credentialVersion: string; materials?: KitchenMaterials; materialsCompressed?: string };

export function sessionMaterials(session: Partial<UserSession>): KitchenMaterials | undefined {
  if (!session.materialsCompressed) return session.materials;
  try { return JSON.parse(inflateSync(Buffer.from(session.materialsCompressed, "base64"), { maxOutputLength: 12000 }).toString("utf8")) as KitchenMaterials; }
  catch { return undefined; }
}

export function setSessionMaterials(session: Partial<UserSession>, materials: KitchenMaterials) {
  session.materialsCompressed = deflateSync(JSON.stringify(materials)).toString("base64");
  delete session.materials;
}

const cookieName = "wood_bom_user";

function secret() {
  const value = process.env.USER_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("USER_SESSION_SECRET must be configured with at least 32 characters.");
  return value;
}

function credentialVersion() {
  const password = process.env.USER_LOGIN_PASSWORD;
  if (!password) return "";
  return createHash("sha256").update(password).digest("hex");
}

export function verifyUserCredentials(user: string, password: string) {
  const expectedUser = process.env.USER_LOGIN_NAME;
  const expectedPassword = process.env.USER_LOGIN_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;
  const actual = createHash("sha256").update(`${user}\0${password}`).digest();
  const expected = createHash("sha256").update(`${expectedUser}\0${expectedPassword}`).digest();
  return timingSafeEqual(actual, expected);
}

export async function userSession() {
  return getIronSession<UserSession>(await cookies(), {
    cookieName,
    password: secret(),
    ttl: 60 * 60 * 12,
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
  });
}

export async function currentUser() {
  const session = await userSession();
  const configuredUser = process.env.USER_LOGIN_NAME;
  return configuredUser && session.user === configuredUser && session.credentialVersion === credentialVersion() ? configuredUser : null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export function userCredentialVersion() { return credentialVersion(); }
