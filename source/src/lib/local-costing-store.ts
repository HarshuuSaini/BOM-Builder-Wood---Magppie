import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { KitchenWorkspaceEntry } from "@/lib/kitchen-workspace";
import { priceChangesFor, missingPriceReasons, validPriceChanges } from "@/lib/price-change-audit";
import { validServiceRates, withServiceRates, type ProjectServiceRates } from "@/lib/project-service-rates";
import { accessoryMasterCandidates, type SavedAccessoryItem } from "@/lib/accessory-master";
import { normalizeMarginPricing } from "@/lib/normalize-margin-pricing";

export type CostingActor = { username: string; role: "admin" | "user" };
export type SavedCostingSummary = {
  id: string; name: string; owner: string; sourceName?: string;
  createdAt: string; updatedAt: string; updatedBy: string; version: number;
  areaSqft: number; total: number; materialCost: number; cabinetCount: number;
  installation: number; transportation: number; loading: number;
  conversion: number; tax: number;
  deletedAt?: string;
};
export type SavedCosting = SavedCostingSummary & { entry: KitchenWorkspaceEntry };
type StoredRow = { id: string; owner: string; workspace_id: string; payload: string;
  created_at: string; updated_at: string; updated_by: string; version: number; deleted_at?: string | null };

export function isLocalCostingsEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.LOCAL_COSTINGS_ENABLED === "1";
}

let connection: DatabaseSync | undefined;
// The current saved payload is one of these five versions. Version numbers stay monotonic.
export const REVISION_RETENTION_SQL = `
  BEGIN IMMEDIATE;
  CREATE INDEX IF NOT EXISTS accessory_revision_history ON accessory_master_revisions(accessory_id, id);
  CREATE TRIGGER IF NOT EXISTS retain_five_costing_versions AFTER INSERT ON costing_revisions BEGIN
    DELETE FROM costing_revisions WHERE costing_id = NEW.costing_id AND version NOT IN
      (SELECT version FROM costing_revisions WHERE costing_id = NEW.costing_id ORDER BY version DESC LIMIT 5);
  END;
  CREATE TRIGGER IF NOT EXISTS retain_five_accessory_versions AFTER INSERT ON accessory_master_revisions BEGIN
    DELETE FROM accessory_master_revisions WHERE accessory_id = NEW.accessory_id AND id NOT IN
      (SELECT id FROM accessory_master_revisions WHERE accessory_id = NEW.accessory_id ORDER BY id DESC LIMIT 5);
  END;
  DELETE FROM costing_revisions WHERE (costing_id, version) IN
    (SELECT costing_id, version FROM
      (SELECT costing_id, version, ROW_NUMBER() OVER (PARTITION BY costing_id ORDER BY version DESC) AS position FROM costing_revisions)
      WHERE position > 5);
  DELETE FROM accessory_master_revisions WHERE id IN
    (SELECT id FROM
      (SELECT id, ROW_NUMBER() OVER (PARTITION BY accessory_id ORDER BY id DESC) AS position FROM accessory_master_revisions)
      WHERE position > 5);
  COMMIT;
`;
function database() {
  if (!isLocalCostingsEnabled()) throw new Error("Saved costings are enabled only in the local preview.");
  if (!connection) {
    const directory = process.env.LOCAL_COSTINGS_DIRECTORY || join(process.cwd(), ".local-data");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    connection = new DatabaseSync(join(directory, "costings.sqlite"));
    connection.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS costings (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, workspace_id TEXT NOT NULL, payload TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, version INTEGER NOT NULL,
        UNIQUE(owner, workspace_id));
      CREATE TABLE IF NOT EXISTS costing_revisions (
        costing_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
        saved_at TEXT NOT NULL, saved_by TEXT NOT NULL, PRIMARY KEY(costing_id, version));
      CREATE TABLE IF NOT EXISTS accessory_master (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accessory_master_revisions (
        id INTEGER PRIMARY KEY, accessory_id TEXT NOT NULL, payload TEXT NOT NULL, saved_at TEXT NOT NULL, saved_by TEXT NOT NULL);`);
    const columns = connection.prepare("PRAGMA table_info(costings)").all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === "deleted_at")) connection.exec("ALTER TABLE costings ADD COLUMN deleted_at TEXT");
    connection.exec(REVISION_RETENTION_SQL);
  }
  return connection;
}

export class CostingAccessError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export function listAccessoryMaster(): SavedAccessoryItem[] {
  const db = database(), items = new Map<string, SavedAccessoryItem>();
  // Previously priced accessories remain reusable without rewriting old quotes.
  for (const row of db.prepare("SELECT payload FROM costings WHERE deleted_at IS NULL ORDER BY updated_at DESC").all() as { payload: string }[]) {
    for (const item of accessoryMasterCandidates(JSON.parse(row.payload))) if (!items.has(item.id)) items.set(item.id, item);
  }
  for (const row of db.prepare("SELECT payload FROM accessory_master").all() as { payload: string }[]) { const item = JSON.parse(row.payload) as SavedAccessoryItem; items.set(item.id, item); }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function saveAccessoryMaster(entry: KitchenWorkspaceEntry, previous: KitchenWorkspaceEntry | undefined, actor: CostingActor, now: string) {
  const before = new Map((previous ? accessoryMasterCandidates(previous) : []).map(item => [item.id, item]));
  const db = database();
  for (const item of accessoryMasterCandidates(entry)) {
    const old = before.get(item.id);
    if (old && old.rate === item.rate && old.reason === item.reason) continue;
    const stored = db.prepare("SELECT payload FROM accessory_master WHERE id=?").get(item.id) as { payload: string } | undefined;
    const payload = JSON.stringify(item);
    if (stored?.payload === payload) continue;
    db.prepare("INSERT INTO accessory_master VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
      .run(item.id, payload, now, actor.username);
    db.prepare("INSERT INTO accessory_master_revisions(accessory_id,payload,saved_at,saved_by) VALUES(?,?,?,?)").run(item.id, payload, now, actor.username);
  }
}

/** Atomic admin update: retain quote revisions and reject stale comparison versions. */
export function updateComparisonServiceRates(input: { rates?: ProjectServiceRates; reason: string;
  kitchens: { id: string; version: number; rates?: ProjectServiceRates }[] }, actor: CostingActor) {
  if (actor.role !== "admin") throw new CostingAccessError("Only admins can edit service master rates.", 403);
  if (!input || typeof input.reason !== "string" || !input.reason.trim() ||
      !Array.isArray(input.kitchens) || input.kitchens.length > 100 || !input.kitchens.length ||
      !input.kitchens.every(k => validId(k?.id) && Number.isSafeInteger(k.version) && k.version >= 1 && validServiceRates(k.rates ?? input.rates)) || new Set(input.kitchens.map(k => k.id)).size !== input.kitchens.length)
    throw new CostingAccessError("Enter valid rates, a reason and an update scope.", 400);
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = new Date().toISOString();
    for (const kitchen of input.kitchens) {
      const saved = getSavedCosting(kitchen.id, actor);
      if (saved.version !== kitchen.version) throw new CostingAccessError(`${saved.name} changed. Refresh comparison before saving rates.`, 409);
      if (!saved.entry.costing) throw new CostingAccessError(`${saved.name} needs a saved item breakdown before its rates can be changed.`, 400);
      const entry = withServiceRates(saved.entry, (kitchen.rates ?? input.rates)!, input.reason);
      const priceChanges = priceChangesFor(entry, saved.entry);
      if (missingPriceReasons(priceChanges).length) throw new CostingAccessError("Resolve outstanding price-change reasons before updating this kitchen.", 400);
      const version = saved.version + 1;
      const payload = JSON.stringify({ ...entry, priceChanges, savedCostingVersion: version });
      if (Buffer.byteLength(payload, "utf8") > 2_000_000) throw new CostingAccessError("This costing exceeds the 2 MB save limit.", 413);
      db.prepare("UPDATE costings SET payload=?,version=?,updated_at=?,updated_by=? WHERE id=?").run(payload, version, now, actor.username, saved.id);
      db.prepare("INSERT INTO costing_revisions VALUES(?,?,?,?,?)").run(saved.id, version, payload, now, actor.username);
    }
    db.exec("COMMIT");
    return input.kitchens.map(k => getSavedCosting(k.id, actor));
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function validSnapshot(value: unknown) {
  if (!isRecord(value)) return false;
  const amounts = ["areaSqft", "materialCost", "conversion", "transportation", "installation", "loading", "tax", "total"];
  return amounts.every(key => finiteNumber(value[key]))
    && Array.isArray(value.unpriced) && value.unpriced.every(item => typeof item === "string")
    && Array.isArray(value.items) && value.items.every(item => isRecord(item)
      && ["category", "itemCode", "item", "unit"].every(key => typeof item[key] === "string")
      && ["quantity", "rate", "amount"].every(key => finiteNumber(item[key])));
}

function toSaved(row: StoredRow): SavedCosting {
  const entry = normalizeMarginPricing(JSON.parse(row.payload) as KitchenWorkspaceEntry);
  entry.savedCostingId = row.id;
  entry.savedCostingVersion = row.version;
  const summary: SavedCostingSummary = {
    id: row.id, name: entry.name.trim() || "Untitled kitchen", owner: row.owner, sourceName: entry.sourceName,
    createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by, version: row.version,
    areaSqft: entry.costing?.areaSqft ?? 0, total: entry.costing?.total ?? 0,
    materialCost: entry.costing?.materialCost ?? 0,
    installation: entry.costing?.installation ?? 0, transportation: entry.costing?.transportation ?? 0,
    loading: entry.costing?.loading ?? 0, conversion: entry.costing?.conversion ?? 0,
    tax: entry.costing?.tax ?? 0,
    cabinetCount: entry.rows.filter((record) => record["Record Type"] === "cabinet").length,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
  return { ...summary, entry };
}

export function listSavedCostings(actor: CostingActor, bin = false): SavedCostingSummary[] {
  const state = bin ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
  const rows = (actor.role === "admin"
    ? database().prepare(`SELECT * FROM costings WHERE ${state} ORDER BY updated_at DESC`).all()
    : database().prepare(`SELECT * FROM costings WHERE owner = ? AND ${state} ORDER BY updated_at DESC`).all(actor.username)) as unknown as StoredRow[];
  return rows.map((row) => { const { entry: _entry, ...summary } = toSaved(row); return summary; });
}

export function getSavedCosting(id: string, actor: CostingActor, includeBin = false): SavedCosting {
  if (!validId(id)) throw new CostingAccessError("Invalid saved costing ID.", 400);
  const row = database().prepare("SELECT * FROM costings WHERE id = ?").get(id) as unknown as StoredRow | undefined;
  if (!row || (!includeBin && row.deleted_at) || (actor.role !== "admin" && row.owner !== actor.username)) throw new CostingAccessError("Costing not found.", 404);
  return toSaved(row);
}

export function saveCosting(entry: KitchenWorkspaceEntry, actor: CostingActor): SavedCosting {
  if (!entry || !validId(entry.id) ||
      typeof entry.name !== "string" || entry.name.length > 200 || !Array.isArray(entry.rows) || entry.rows.length > 20000 ||
      !entry.rows.every(row => isRecord(row) && typeof row["Record Type"] === "string" && row["Record Type"].trim().length > 0 && typeof row.Data === "string") ||
      (entry.sourceName !== undefined && typeof entry.sourceName !== "string") ||
      (entry.savedCostingId !== undefined && !validId(entry.savedCostingId)) ||
      (entry.savedCostingVersion !== undefined && (!Number.isSafeInteger(entry.savedCostingVersion) || entry.savedCostingVersion < 1)) ||
      (entry.costing !== undefined && !validSnapshot(entry.costing))) {
    throw new CostingAccessError("Invalid kitchen costing.", 400);
  }
  try { entry = normalizeMarginPricing(entry); }
  catch (error) { throw new CostingAccessError(error instanceof Error ? error.message : "Invalid conversion margin.", 400); }
  if (entry.priceChanges !== undefined && !validPriceChanges(entry.priceChanges) || entry.materials?._priceChanges !== undefined && !validPriceChanges(entry.materials._priceChanges))
    throw new CostingAccessError("Invalid price-change remarks.", 400);
  // Existing saved entries may lose their final item. Their ID, owner and version
  // are checked below before an empty replacement can be written.
  if (!entry.savedCostingId && !entry.rows.some((row) => row["Record Type"] !== "format" && row["Record Type"] !== "settings")) {
    throw new CostingAccessError("Add or import kitchen items before saving.", 400);
  }
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = (entry.savedCostingId
      ? db.prepare("SELECT * FROM costings WHERE id = ?").get(entry.savedCostingId)
      : db.prepare("SELECT * FROM costings WHERE owner = ? AND workspace_id = ?").get(actor.username, entry.id)) as unknown as StoredRow | undefined;
    if (entry.savedCostingId && !existing) throw new CostingAccessError("Costing not found.", 404);
    if (existing && actor.role !== "admin" && existing.owner !== actor.username) throw new CostingAccessError("Costing not found.", 404);
    if (existing?.deleted_at) throw new CostingAccessError("This costing is in the bin. Restore it from Saved costings → Bin before editing.", 409, "COSTING_IN_BIN");
    if (existing && entry.savedCostingVersion !== existing.version) throw new CostingAccessError("This costing changed in another session. Reopen its latest saved version before editing.", 409);
    const id = existing?.id ?? randomUUID();
    const version = (existing?.version ?? 0) + 1;
    const now = new Date().toISOString();
    const priceChanges = priceChangesFor(entry, existing ? toSaved(existing).entry : undefined);
    const missing = missingPriceReasons(priceChanges);
    if (missing.length) throw new CostingAccessError(`A price-change reason is required for ${missing[0].label}.`, 400);
    let payload: string;
    try { payload = JSON.stringify({ ...entry, priceChanges, savedCostingId: id, savedCostingVersion: version }); }
    catch { throw new CostingAccessError("Invalid kitchen costing.", 400); }
    if (Buffer.byteLength(payload, "utf8") > 2_000_000) throw new CostingAccessError("This costing exceeds the 2 MB save limit.", 413);
    db.prepare(`INSERT INTO costings(id,owner,workspace_id,payload,created_at,updated_at,updated_by,version)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at,
      updated_by=excluded.updated_by, version=excluded.version`).run(id, existing?.owner ?? actor.username,
      existing?.workspace_id ?? entry.id, payload, existing?.created_at ?? now, now, actor.username, version);
    db.prepare("INSERT INTO costing_revisions(costing_id,version,payload,saved_at,saved_by) VALUES(?,?,?,?,?)")
      .run(id, version, payload, now, actor.username);
    saveAccessoryMaster({ ...entry, priceChanges }, existing ? toSaved(existing).entry : undefined, actor, now);
    db.exec("COMMIT");
    return getSavedCosting(id, actor);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** All selected operations commit together; bin entries are retained indefinitely. */
export function changeSavedCostings(ids: string[], action: "bin" | "restore" | "clone", actor: CostingActor, copies = 1): SavedCostingSummary[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(validId) || new Set(ids).size !== ids.length ||
    !["bin", "restore", "clone"].includes(action) || !Number.isSafeInteger(copies) || copies < 1 || copies * ids.length > 100)
    throw new CostingAccessError("Select up to 100 kitchens/copies with valid whole-number quantities.", 400);
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const sources = ids.map(id => getSavedCosting(id, actor, true));
    if (sources.some(s => action === "restore" ? !s.deletedAt : !!s.deletedAt)) throw new CostingAccessError("The list changed. Reload before applying this action.", 409);
    const changed: string[] = [];
    const now = new Date().toISOString();
    for (const source of sources) {
      if (action === "clone") {
        for (let copy = 1; copy <= copies; copy++) {
          const id = randomUUID(), workspaceId = randomUUID();
          const name = `${source.name.slice(0, 175)} — copy${copies > 1 ? ` ${copy}` : ""}`;
          const entry: KitchenWorkspaceEntry = { ...source.entry, id: workspaceId, name, savedCostingId: id, savedCostingVersion: 1,
            rows: source.entry.rows.map(row => {
              if (row["Record Type"] !== "settings") return row;
              try { return { ...row, Data: JSON.stringify({ ...JSON.parse(row.Data), name }) }; }
              catch { return row; }
            }) };
          const payload = JSON.stringify(entry);
          if (Buffer.byteLength(payload, "utf8") > 2_000_000) throw new CostingAccessError("A cloned costing exceeds the 2 MB save limit.", 413);
          db.prepare("INSERT INTO costings(id,owner,workspace_id,payload,created_at,updated_at,updated_by,version) VALUES(?,?,?,?,?,?,?,1)")
            .run(id, source.owner, workspaceId, payload, now, now, actor.username);
          db.prepare("INSERT INTO costing_revisions VALUES(?,?,?,?,?)").run(id, 1, payload, now, actor.username);
          changed.push(id);
        }
      } else {
        const version = source.version + 1;
        const payload = JSON.stringify({ ...source.entry, savedCostingVersion: version });
        db.prepare("UPDATE costings SET deleted_at=?,payload=?,version=?,updated_at=?,updated_by=? WHERE id=?")
          .run(action === "bin" ? now : null, payload, version, now, actor.username, source.id);
        db.prepare("INSERT INTO costing_revisions VALUES(?,?,?,?,?)").run(source.id, version, payload, now, actor.username);
        changed.push(source.id);
      }
    }
    const result = changed.map(id => { const { entry: _entry, ...summary } = getSavedCosting(id, actor, true); return summary; });
    db.exec("COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
