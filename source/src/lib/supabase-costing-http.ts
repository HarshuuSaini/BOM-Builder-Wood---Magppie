import "server-only";
import { currentIdentity, isOpenCostingAccess } from "./user-session";
import { cloudCostingsEnabled } from "./costing-storage-mode";
import { BrowserCostingError, browserCostingOperation, type BrowserCostingData } from "./browser-costing-data";
import type { CostingActor, SavedCosting, SavedCostingSummary } from "./local-costing-store";
import { exposeSavedCosting } from "./costing-visibility";
import { priceDesignerCosting } from "./server-project-pricing";

// This module runs only on the server. Neither the key nor unrestricted payloads enter client bundles.
async function rest(path: string, init?: RequestInit) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new BrowserCostingError("Cloud costing storage is not configured.", 503);
  const response = await fetch(`${base.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { apikey: key, "Content-Type": "application/json", ...init?.headers },
  });
  const result = await response.json();
  if (!response.ok) {
    if (["40001", "23505"].includes(result.code)) throw new BrowserCostingError("This costing changed. Reopen its latest saved version.", 409);
    if (result.code === "P0002") throw new BrowserCostingError("Costing not found.", 404);
    throw new BrowserCostingError("Could not access cloud costings. Your draft is preserved; try again.", 503);
  }
  return result;
}
function ownerFilter(actor: CostingActor): Record<string, string> { return actor.role === "admin" ? {} : { owner: `eq.${actor.username}` }; }
async function allRows<T>(table: string, params: URLSearchParams): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    params.set("offset", String(offset)); params.set("limit", "1000");
    const batch = await rest(`${table}?${params}`) as T[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}
export async function listCloudCostings(actor: CostingActor, bin = false): Promise<SavedCostingSummary[]> {
  if (isOpenCostingAccess()) throw new BrowserCostingError("Cloud storage requires user login to be enabled.", 503);
  const params = new URLSearchParams({ select: "summary", ...ownerFilter(actor), deleted_at: bin ? "not.is.null" : "is.null", order: "updated_at.desc", limit: "1000" });
  const rows = await allRows<{ summary: SavedCostingSummary }>("wood_costings", params);
  return rows.map(row => exposeSavedCosting(row.summary, actor.role));
}
async function loadCostings(actor: CostingActor, filter: Record<string, string>): Promise<SavedCosting[]> {
  const params = new URLSearchParams({ select: "payload", ...filter, ...ownerFilter(actor), limit: "100" });
  return (await rest(`wood_costings?${params}`) as { payload: SavedCosting }[]).map(row => row.payload);
}
function validId(id: unknown): id is string { return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id); }

/** Read only the requested kitchens; mutations commit atomically through a private database function. */
export async function cloudCostingResponse(request: Request): Promise<Response | null> {
  if (!cloudCostingsEnabled()) return null;
  const headers = { "Cache-Control": "no-store" };
  try {
    if (isOpenCostingAccess()) throw new BrowserCostingError("Cloud storage requires user login to be enabled.", 503);
    const actor = await currentIdentity();
    if (!actor) throw new BrowserCostingError("Sign in first.", 401);
    const url = new URL(request.url), method = request.method;
    if (!["GET", "POST"].includes(method)) throw new BrowserCostingError("Unsupported action.", 405);
    if (method !== "GET" && request.headers.get("origin") !== url.origin) throw new BrowserCostingError("Invalid request origin.", 403);
    const expectedUser = request.headers.get("x-costing-user");
    if (expectedUser && expectedUser !== actor.username) throw new BrowserCostingError("The signed-in account changed. Reload before saving.", 409);
    let body: any;
    if (method === "POST") {
      if (Number(request.headers.get("content-length") || 0) > 2_000_000) throw new BrowserCostingError("This request exceeds the 2 MB save limit.", 413);
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 2_000_000) throw new BrowserCostingError("This request exceeds the 2 MB save limit.", 413);
      try { body = JSON.parse(raw); } catch { throw new BrowserCostingError("Invalid costing data."); }
    }
    if (url.pathname === "/api/saved-costings" && method === "GET") return Response.json({ actor, costings: await listCloudCostings(actor, url.searchParams.get("bin") === "1") }, { headers });
    const state: BrowserCostingData = { version: 1, costings: [], accessories: [] };
    if (url.pathname === "/api/accessory-master" && method === "GET") {
      const rows = await allRows<{ payload: BrowserCostingData["accessories"][number] }>("wood_accessories", new URLSearchParams({ select: "payload", order: "id.asc" }));
      return Response.json({ items: rows.map(r => r.payload) }, { headers });
    }
    if (["/api/saved-costings/compare", "/api/saved-costings/project-pricing"].includes(url.pathname) && actor.role !== "admin") throw new BrowserCostingError("Only admins can compare kitchens or edit service rates.", 403);
    if (url.pathname === "/api/saved-costings" && method === "POST") {
      if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.rows) || !body.rows.every((r: any) => r && typeof r["Record Type"] === "string" && typeof r.Data === "string")) throw new BrowserCostingError("Invalid kitchen costing.");
      if (body.savedCostingId) {
        if (!validId(body.savedCostingId)) throw new BrowserCostingError("Costing not found.", 404);
        state.costings = await loadCostings(actor, { id: `eq.${body.savedCostingId}` });
      } else if (typeof body.id === "string") {
        // owner is explicit even for admins: fresh drafts belong to the person saving them.
        state.costings = await loadCostings(actor, { workspace_id: `eq.${body.id}`, owner: `eq.${actor.username}` });
      }
      if (actor.role !== "admin") body = priceDesignerCosting(body, state.costings[0]?.entry);
    } else if (method === "POST") {
      const ids = url.pathname === "/api/saved-costings/project-pricing" ? body?.kitchens?.map((k: any) => k?.id) : body?.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(validId)) throw new BrowserCostingError("Select valid kitchens.");
      state.costings = await loadCostings(actor, { id: `in.(${ids.join(",")})` });
    } else {
      const id = decodeURIComponent(url.pathname.split("/").pop()!);
      if (!validId(id)) throw new BrowserCostingError("Costing not found.", 404);
      state.costings = await loadCostings(actor, { id: `eq.${id}` });
    }
    const transaction = browserCostingOperation(state, actor, url.pathname + url.search, method, body);
    if (transaction.changed) {
      const before = new Map(state.costings.map(s => [s.id, s]));
      const changes = transaction.state.costings.filter(s => before.get(s.id)?.version !== s.version)
        .map(saved => ({ saved, expectedVersion: before.get(saved.id)?.version ?? null }));
      await rest("rpc/wood_commit_costings", { method: "POST", body: JSON.stringify({ actor_name: actor.username, actor_admin: actor.role === "admin",
        checks: state.costings.map(s => ({ id: s.id, version: s.version })), changes, accessories: transaction.state.accessories }) });
    }
    return Response.json(transaction.result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof BrowserCostingError ? error.message : "Could not access cloud costings. Your draft is preserved.",
      ...(error instanceof BrowserCostingError && error.code ? { code: error.code } : {}) },
      { status: error instanceof BrowserCostingError ? error.status : 500, headers });
  }
}
