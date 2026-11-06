import type { CostingActor, SavedCosting } from "./local-costing-store";
import type { KitchenWorkspaceEntry } from "./kitchen-workspace";
import type { SavedAccessoryItem } from "./accessory-master";
import { accessoryMasterCandidates } from "./accessory-master";
import { normalizeMarginPricing } from "./normalize-margin-pricing";
import { priceChangesFor, missingPriceReasons, validPriceChanges } from "./price-change-audit";
import { validServiceRates, withServiceRates } from "./project-service-rates";
import { compareCostings } from "./costing-comparison";
import { exposeSavedCosting } from "./costing-visibility";

export type BrowserCostingData = { version: 1; costings: SavedCosting[]; accessories: SavedAccessoryItem[] };
export const emptyBrowserCostings = (): BrowserCostingData => ({ version: 1, costings: [], accessories: [] });
export class BrowserCostingError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}
function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 160; }
function snapshotValid(value: KitchenWorkspaceEntry["costing"]) {
  return value && ["areaSqft", "materialCost", "conversion", "transportation", "installation", "loading", "tax", "total"].every(key => Number.isFinite(value[key as keyof typeof value])) &&
    Array.isArray(value.unpriced) && value.unpriced.every(v => typeof v === "string") && Array.isArray(value.items) && value.items.every(item =>
      item && [item.category, item.itemCode, item.item, item.unit].every(v => typeof v === "string") && [item.quantity, item.rate, item.amount].every(Number.isFinite));
}
export function summarizeBrowserCosting(saved: SavedCosting): SavedCosting {
  const entry = normalizeMarginPricing(saved.entry), c = entry.costing;
  return { ...saved, entry, name: entry.name.trim() || "Untitled kitchen", sourceName: entry.sourceName,
    areaSqft: c?.areaSqft ?? 0, materialCost: c?.materialCost ?? 0, total: c?.total ?? 0,
    transportation: c?.transportation ?? 0, installation: c?.installation ?? 0, loading: c?.loading ?? 0,
    conversion: c?.conversion ?? 0, tax: c?.tax ?? 0,
    cabinetCount: entry.rows.filter(row => row["Record Type"] === "cabinet").length };
}
/** Pure transaction: the browser adapter commits the whole result atomically under a Web Lock. */
export function browserCostingOperation(previous: BrowserCostingData, actor: CostingActor, path: string, method: string, body?: any) {
  const state = structuredClone(previous);
  const url = new URL(path, "https://local.invalid");
  const get = (id: unknown, includeBin = false) => {
    const saved = state.costings.find(s => s.id === id && (actor.role === "admin" || s.owner === actor.username) && (includeBin || !s.deletedAt));
    if (!validId(id) || !saved) throw new BrowserCostingError("Costing not found.", 404);
    return summarizeBrowserCosting(saved);
  };
  const summary = (s: SavedCosting) => { const { entry: _entry, ...rest } = exposeSavedCosting(summarizeBrowserCosting(s), actor.role); return rest; };
  const now = new Date().toISOString();
  let result: unknown;
  let changed = false;
  if (url.pathname === "/api/accessory-master" && method === "GET") {
    result = { items: state.accessories };
  } else if (url.pathname === "/api/saved-costings" && method === "GET") {
    result = { actor, costings: state.costings.filter(s => (actor.role === "admin" || s.owner === actor.username) && !!s.deletedAt === (url.searchParams.get("bin") === "1"))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary) };
  } else if (url.pathname === "/api/saved-costings" && method === "POST") {
    const entry = body as KitchenWorkspaceEntry;
    if (!entry || !validId(entry.id) || typeof entry.name !== "string" || entry.name.length > 200 || !Array.isArray(entry.rows) || entry.rows.length > 20000 ||
      !entry.rows.every(r => r && typeof r["Record Type"] === "string" && !!r["Record Type"].trim() && typeof r.Data === "string") ||
      (entry.costing !== undefined && !snapshotValid(entry.costing)) ||
      (entry.priceChanges !== undefined && !validPriceChanges(entry.priceChanges)) ||
      (entry.materials?._priceChanges !== undefined && !validPriceChanges(entry.materials._priceChanges))) throw new BrowserCostingError("Invalid kitchen costing.");
    if (new TextEncoder().encode(JSON.stringify(entry)).length > 2_000_000) throw new BrowserCostingError("This costing exceeds the 2 MB save limit.", 413);
    const existing = entry.savedCostingId ? get(entry.savedCostingId, true) : state.costings.find(s => s.owner === actor.username && s.entry.id === entry.id);
    if (existing?.deletedAt) throw new BrowserCostingError("This costing is in the bin. Restore it before editing.", 409, "COSTING_IN_BIN");
    if (existing && entry.savedCostingVersion !== existing.version) throw new BrowserCostingError("This costing changed in another tab. Reopen its latest saved version.", 409);
    if (!existing && !entry.rows.some(r => !["format", "settings"].includes(r["Record Type"]))) throw new BrowserCostingError("Add or import kitchen items before saving.");
    const priceChanges = priceChangesFor(entry, existing?.entry);
    if (missingPriceReasons(priceChanges).length) throw new BrowserCostingError("Enter a reason for each changed price before saving.");
    const id = existing?.id ?? crypto.randomUUID(), version = (existing?.version ?? 0) + 1;
    const saved = summarizeBrowserCosting({ ...existing, id, version, owner: existing?.owner ?? actor.username,
      createdAt: existing?.createdAt ?? now, updatedAt: now, updatedBy: actor.username,
      entry: { ...entry, priceChanges, savedCostingId: id, savedCostingVersion: version } } as SavedCosting);
    state.costings = [...state.costings.filter(s => s.id !== id), saved];
    const before = new Map((existing ? accessoryMasterCandidates(existing.entry) : []).map(item => [item.id, JSON.stringify(item)]));
    for (const item of accessoryMasterCandidates(saved.entry)) if (before.get(item.id) !== JSON.stringify(item)) state.accessories = [...state.accessories.filter(a => a.id !== item.id), item];
    result = { costing: exposeSavedCosting(saved, actor.role) }; changed = true;
  } else if (url.pathname === "/api/saved-costings/actions" && method === "POST") {
    const { ids, action, copies = 1 } = body ?? {};
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(validId) || new Set(ids).size !== ids.length ||
      !["clone", "bin", "restore"].includes(action) || !Number.isSafeInteger(copies) || copies < 1 || copies * ids.length > 100) throw new BrowserCostingError("Select up to 100 valid kitchens/copies.");
    const sources = ids.map(id => get(id, true));
    if (sources.some(s => action === "restore" ? !s.deletedAt : !!s.deletedAt)) throw new BrowserCostingError("The list changed. Reload before applying this action.", 409);
    const output: SavedCosting[] = [];
    for (const source of sources) {
      if (action === "clone") for (let n = 1; n <= copies; n++) {
        const id = crypto.randomUUID(), name = `${source.name.slice(0, 175)} — copy${copies > 1 ? ` ${n}` : ""}`;
        const entry = { ...source.entry, id: crypto.randomUUID(), name, savedCostingId: id, savedCostingVersion: 1,
          rows: source.entry.rows.map(row => { if (row["Record Type"] !== "settings") return row; try { return { ...row, Data: JSON.stringify({ ...JSON.parse(row.Data), name }) }; } catch { return row; } }) };
        output.push(summarizeBrowserCosting({ ...source, id, name, entry, version: 1, createdAt: now, updatedAt: now, updatedBy: actor.username }));
      } else output.push({ ...source, deletedAt: action === "bin" ? now : undefined, version: source.version + 1, updatedAt: now, updatedBy: actor.username,
        entry: { ...source.entry, savedCostingVersion: source.version + 1 } });
    }
    state.costings = [...state.costings.filter(s => !output.some(o => o.id === s.id)), ...output];
    result = { costings: output.map(summary) }; changed = true;
  } else if (url.pathname === "/api/saved-costings/compare" && method === "POST") {
    if (actor.role !== "admin") throw new BrowserCostingError("Comparison is available to admins only.", 403);
    if (!Array.isArray(body?.ids) || body.ids.length < 2 || body.ids.length > 100 || new Set(body.ids).size !== body.ids.length) throw new BrowserCostingError("Select 2–100 kitchens to compare.");
    result = { comparison: compareCostings(body.ids.map((id: string) => get(id))) };
  } else if (url.pathname === "/api/saved-costings/project-pricing" && method === "POST") {
    if (actor.role !== "admin") throw new BrowserCostingError("Only admins can edit service rates.", 403);
    if (typeof body?.reason !== "string" || !body.reason.trim() || !Array.isArray(body.kitchens) || !body.kitchens.length || body.kitchens.length > 100 ||
      new Set(body.kitchens.map((k: any) => k.id)).size !== body.kitchens.length) throw new BrowserCostingError("Enter valid rates, a reason and kitchens.");
    const output: SavedCosting[] = body.kitchens.map((k: any) => {
      const saved = get(k.id), rates = k.rates ?? body.rates;
      if (!validServiceRates(rates)) throw new BrowserCostingError("Enter valid rates; conversion must be below 100%.");
      if (saved.version !== k.version) throw new BrowserCostingError("This kitchen changed. Refresh comparison before saving.", 409);
      if (!saved.entry.costing) throw new BrowserCostingError("Save the kitchen's costing breakdown first.");
      const entry = withServiceRates(saved.entry, rates, body.reason), priceChanges = priceChangesFor(entry, saved.entry);
      if (missingPriceReasons(priceChanges).length) throw new BrowserCostingError("Resolve outstanding price-change reasons first.");
      return summarizeBrowserCosting({ ...saved, version: saved.version + 1, updatedAt: now, updatedBy: actor.username,
        entry: { ...entry, priceChanges, savedCostingVersion: saved.version + 1 } });
    });
    state.costings = state.costings.map(s => output.find(o => o.id === s.id) ?? s);
    result = { updated: output.map(s => ({ id: s.id, version: s.version })) }; changed = true;
  } else if (method === "GET" && /^\/api\/saved-costings\/[^/]+$/.test(url.pathname)) {
    result = { costing: exposeSavedCosting(get(decodeURIComponent(url.pathname.split("/").pop()!)), actor.role) };
  } else throw new BrowserCostingError("Unsupported browser costing action.", 404);
  return { state, result, changed };
}
