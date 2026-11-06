import { browserCostingsEnabled } from "./costing-storage-mode";
import { BrowserCostingError, browserCostingOperation, emptyBrowserCostings, type BrowserCostingData } from "./browser-costing-data";

export const BROWSER_COSTINGS_KEY = "wood-bom-saved-costings-v1";

/** Kitchen payloads never leave the browser in hosted mode. Only identity is fetched. */
export async function costingFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!browserCostingsEnabled() || !(path === "/api/accessory-master" || path.startsWith("/api/saved-costings"))) return fetch(path, init);
  try {
    const identity = await fetch("/api/user-session", { cache: "no-store" });
    const session = await identity.json();
    if (!identity.ok || !session.user || !["admin", "user"].includes(session.role)) throw new BrowserCostingError("Sign in first.", 401);
    const expectedUser = new Headers(init?.headers).get("x-costing-user");
    if (expectedUser && expectedUser !== session.user) throw new BrowserCostingError("The signed-in account changed. Reload before saving.", 409);
    const method = init?.method ?? "GET";
    const execute = () => {
      const raw = window.localStorage.getItem(BROWSER_COSTINGS_KEY);
      let previous: BrowserCostingData;
      try { previous = raw ? JSON.parse(raw) : emptyBrowserCostings(); }
      catch { throw new BrowserCostingError("Saved browser costings could not be read. Existing data has been kept.", 500); }
      if (previous.version !== 1 || !Array.isArray(previous.costings) || !Array.isArray(previous.accessories)) throw new BrowserCostingError("Unrecognized saved browser data. Existing data has been kept.", 500);
      const transaction = browserCostingOperation(previous, { username: session.user, role: session.role }, path, method,
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
      if (transaction.changed) {
        try { window.localStorage.setItem(BROWSER_COSTINGS_KEY, JSON.stringify(transaction.state)); }
        catch { throw new BrowserCostingError("Browser storage is full or unavailable. Existing saved costings and your current draft are preserved. Export PDFs before clearing browser data.", 507); }
      }
      return Response.json(transaction.result);
    };
    if (navigator.locks) return await navigator.locks.request(BROWSER_COSTINGS_KEY, execute);
    if (method !== "GET") throw new BrowserCostingError("Use an up-to-date Chrome, Edge, Firefox or Safari browser to save costings safely.", 503);
    return execute();
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not access browser costings.",
      ...(error instanceof BrowserCostingError && error.code ? { code: error.code } : {}) },
      { status: error instanceof BrowserCostingError ? error.status : 500 });
  }
}
