import "server-only";
import { deflateSync, inflateSync } from "node:zlib";

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { KitchenMaterials } from "@/lib/kitchen-materials";
import { accountCredentialVersion, authenticateAccount, configuredAccounts, identityForSession } from "@/lib/local-auth";
import { isOpenCostingAccess } from "@/lib/access-mode";
export { isOpenCostingAccess } from "@/lib/access-mode";
export type { UserIdentity, UserRole } from "@/lib/local-auth";

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

export function userLoginConfigured() {
  return configuredAccounts(process.env).length > 0;
}

export function authenticateUserCredentials(user: string, password: string) {
  return authenticateAccount(process.env, user, password);
}

export function verifyUserCredentials(user: string, password: string) {
  return authenticateUserCredentials(user, password) !== null;
}

export async function userSession() {
  return getIronSession<UserSession>(await cookies(), {
    cookieName,
    password: secret(),
    ttl: 60 * 60 * 12,
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
  });
}

export async function currentIdentity() {
  if (isOpenCostingAccess()) return { username: process.env.USER_LOGIN_NAME?.trim() || "preview", role: "admin" as const };
  const session = await userSession();
  return identityForSession(process.env, session);
}

export async function requireIdentity() {
  const identity = await currentIdentity();
  if (!identity) redirect("/login");
  return identity;
}

export async function currentUser(): Promise<string | null> {
  return (await currentIdentity())?.username ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export function userCredentialVersion(user = process.env.USER_LOGIN_NAME) {
  const account = configuredAccounts(process.env).find(candidate => candidate.username === user);
  return account ? accountCredentialVersion(account) : "";
}
