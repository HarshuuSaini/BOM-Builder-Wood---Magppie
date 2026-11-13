/** Explicit build flag: hosted database credentials remain server-only. */
export function cloudCostingsEnabled() { return process.env.NEXT_PUBLIC_COSTING_STORAGE === "supabase"; }
export function browserCostingsEnabled() { return process.env.NODE_ENV === "production" && !cloudCostingsEnabled(); }
export function costingPortalEnabled() { return cloudCostingsEnabled() || browserCostingsEnabled() || process.env.LOCAL_COSTINGS_ENABLED === "1"; }
