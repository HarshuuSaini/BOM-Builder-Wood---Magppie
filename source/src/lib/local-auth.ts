import { createHash, timingSafeEqual } from "node:crypto";

export type UserRole = "user" | "admin";
export type UserIdentity = { username: string; role: UserRole };
type Account = UserIdentity & { password: string; source: "primary" | "local" };
type AuthEnvironment = {
  NODE_ENV?: string;
  USER_LOGIN_NAME?: string;
  USER_LOGIN_PASSWORD?: string;
  USER_LOGIN_ROLE?: string;
  USER_LOCAL_ACCOUNTS?: string;
};

function validCredentials(username: unknown, password: unknown): username is string {
  return typeof username === "string" && username.length > 0 && username.length <= 256
    && typeof password === "string" && password.length > 0 && password.length <= 1024;
}

/** Private configuration: callers must never serialize these accounts to the client. */
export function configuredAccounts(env: AuthEnvironment): Account[] {
  const accounts: Account[] = [];
  if (validCredentials(env.USER_LOGIN_NAME, env.USER_LOGIN_PASSWORD)) {
    accounts.push({
      username: env.USER_LOGIN_NAME!, password: env.USER_LOGIN_PASSWORD!, source: "primary",
      role: env.NODE_ENV === "development" && env.USER_LOGIN_ROLE === "admin" ? "admin" : "user",
    });
  }
  // Local accounts and preview administrator privileges must never activate outside development.
  if (env.NODE_ENV !== "development" || !env.USER_LOCAL_ACCOUNTS) return accounts;
  try {
    const entries: unknown = JSON.parse(env.USER_LOCAL_ACCOUNTS);
    if (!Array.isArray(entries)) return accounts;
    const local: Account[] = [];
    const names = new Set(accounts.map(account => account.username));
    for (const entry of entries) {
      if (!entry || !validCredentials(entry.username, entry.password)
        || (entry.role !== "user" && entry.role !== "admin") || names.has(entry.username)) {
        return accounts;
      }
      names.add(entry.username);
      local.push({ username: entry.username, password: entry.password, role: entry.role, source: "local" });
    }
    return [...accounts, ...local];
  } catch {
    // Malformed optional local configuration must not disable the existing preview login.
    return accounts;
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function accountCredentialVersion(account: Account): string {
  return digest(JSON.stringify(["local-auth-v2", account.source, account.username, account.role, account.password])).toString("hex");
}

export function authenticateAccount(env: AuthEnvironment, username: string, password: string) {
  if (!validCredentials(username, password)) return null;
  const actual = digest(JSON.stringify([username, password]));
  const account = configuredAccounts(env).find(candidate =>
    timingSafeEqual(actual, digest(JSON.stringify([candidate.username, candidate.password]))));
  return account ? { username: account.username, role: account.role, credentialVersion: accountCredentialVersion(account) } : null;
}

export function identityForSession(env: AuthEnvironment, session: { user?: unknown; credentialVersion?: unknown }): UserIdentity | null {
  const account = configuredAccounts(env).find(candidate => candidate.username === session.user);
  if (!account || session.credentialVersion !== accountCredentialVersion(account)) return null;
  return { username: account.username, role: account.role };
}
