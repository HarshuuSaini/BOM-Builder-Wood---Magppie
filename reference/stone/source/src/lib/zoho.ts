import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REQUIRED_ENV = [
  "ZOHO_ORGANIZATION_ID",
  "ZOHO_REFRESH_TOKEN",
  "ZOHO_CLIENT_ID",
  "ZOHO_CLIENT_SECRET",
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV)[number];

type TokenCache = {
  token: string;
  expiresAt: number;
  refreshBlockedUntil?: number;
  lastError?: string;
};

// Use the OS temp dir (writable on serverless platforms like Vercel/Lambda, where the
// app directory `process.cwd()` is read-only). Falls back gracefully if even this fails —
// the in-memory `cachedToken` keeps a warm instance working without any disk access.
const TOKEN_CACHE_PATH = path.join(os.tmpdir(), "magppie-cache", "zoho-access-token.json");
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const TOKEN_BACKOFF_MS = 5 * 60 * 1000;

let cachedToken: TokenCache | null = null;
let refreshPromise: Promise<string> | null = null;

function getEnv(name: RequiredEnvKey): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env.local.`);
  }
  return value;
}

function getAccountsBaseUrl(): string {
  return process.env.ZOHO_ACCOUNTS_BASE_URL ?? "https://accounts.zoho.in";
}

function getInventoryBaseUrl(): string {
  return process.env.ZOHO_INVENTORY_BASE_URL ?? "https://www.zohoapis.in/inventory/v1";
}

function hasUsableToken(cache: TokenCache | null): boolean {
  return Boolean(cache?.token && cache.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS);
}

async function readTokenCache(): Promise<TokenCache | null> {
  if (cachedToken) return cachedToken;

  try {
    const cache = JSON.parse(await readFile(TOKEN_CACHE_PATH, "utf8")) as TokenCache;
    cachedToken = cache;
    return cache;
  } catch {
    return null;
  }
}

async function writeTokenCache(cache: TokenCache) {
  cachedToken = cache;
  // Disk persistence is best-effort: never let a read-only/full filesystem break a request.
  try {
    await mkdir(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
    await writeFile(TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // Ignore — the in-memory cachedToken still serves the current instance.
  }
}

async function clearTokenCache() {
  cachedToken = null;
  try {
    await rm(TOKEN_CACHE_PATH, { force: true });
  } catch {
    // Ignore — disk cache is best-effort.
  }
}

function isTokenRateLimit(body: unknown) {
  const serialized = JSON.stringify(body).toLowerCase();
  return serialized.includes("too many requests") || serialized.includes("access denied");
}

async function refreshZohoAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: getEnv("ZOHO_REFRESH_TOKEN"),
    client_id: getEnv("ZOHO_CLIENT_ID"),
    client_secret: getEnv("ZOHO_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });

  const response = await fetch(`${getAccountsBaseUrl()}/oauth/v2/token?${params.toString()}`, {
    method: "POST",
    cache: "no-store",
  });

  const body = await response.json();
  if (!response.ok || !body.access_token) {
    if (isTokenRateLimit(body)) {
      await writeTokenCache({
        token: "",
        expiresAt: 0,
        refreshBlockedUntil: Date.now() + TOKEN_BACKOFF_MS,
        lastError: JSON.stringify(body),
      });
    }
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(body)}`);
  }

  const nextCache = {
    token: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 - 30_000,
  };
  await writeTokenCache(nextCache);

  return nextCache.token;
}

export async function getZohoAccessToken(): Promise<string> {
  const cache = await readTokenCache();

  if (cache && hasUsableToken(cache)) {
    return cache.token;
  }

  if (cache?.refreshBlockedUntil && cache.refreshBlockedUntil > Date.now()) {
    const waitSeconds = Math.ceil((cache.refreshBlockedUntil - Date.now()) / 1000);
    throw new Error(`Zoho token refresh is cooling down. Try again in about ${waitSeconds} seconds.`);
  }

  if (!refreshPromise) {
    refreshPromise = refreshZohoAccessToken().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export function getZohoRuntimeInfo() {
  const cache = cachedToken;
  return {
    organizationId: getEnv("ZOHO_ORGANIZATION_ID"),
    accountsBaseUrl: getAccountsBaseUrl(),
    inventoryBaseUrl: getInventoryBaseUrl(),
    tokenCached: hasUsableToken(cache),
    tokenExpiresAt: cache?.expiresAt,
    refreshBlockedUntil: cache?.refreshBlockedUntil,
  };
}

function buildUrl(path: string, params: Record<string, string | number | undefined> = {}): URL {
  const url = new URL(`${getInventoryBaseUrl()}${path}`);
  url.searchParams.set("organization_id", getEnv("ZOHO_ORGANIZATION_ID"));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function zohoInventoryGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  return zohoInventoryRequest<T>("GET", path, params);
}

export async function zohoInventoryPut<T>(
  path: string,
  payload: unknown,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  return zohoInventoryRequest<T>("PUT", path, params, payload);
}

export async function zohoInventoryPost<T>(
  path: string,
  payload: unknown,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  return zohoInventoryRequest<T>("POST", path, params, payload);
}

async function zohoInventoryRequest<T>(
  method: "GET" | "PUT" | "POST",
  path: string,
  params: Record<string, string | number | undefined>,
  payload?: unknown,
): Promise<T> {
  let accessToken = await getZohoAccessToken();
  const url = buildUrl(path, params);

  const doFetch = (token: string) =>
    fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      cache: "no-store",
    });

  let response = await doFetch(accessToken);
  let body = await response.json();

  if ((response.status === 401 || body.code === 57 || body.code === 14) && accessToken) {
    await clearTokenCache();
    accessToken = await getZohoAccessToken();
    response = await doFetch(accessToken);
    body = await response.json();
  }

  if (!response.ok || (typeof body.code === "number" && body.code > 0)) {
    throw new Error(JSON.stringify(body));
  }

  return body as T;
}

export function toApiError(error: unknown) {
  console.error('[Zoho API Error]:', error);
  if (error instanceof Error) {
    if (error.message.includes("cooling down")) {
      return { error: error.message };
    }
    if (error.message.toLowerCase().includes("too many requests")) {
      return {
        error:
          "Zoho is temporarily blocking token refresh because too many refresh requests were made. The app will reuse cached tokens and wait before trying again.",
      };
    }
    return { error: error.message };
  }
  return { error: "Unknown server error", detail: error };
}
