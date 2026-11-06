/** Hosted previews keep kitchen data in this browser, never in Vercel's filesystem. */
export function browserCostingsEnabled() { return process.env.NODE_ENV === "production"; }
export function costingPortalEnabled() { return browserCostingsEnabled() || process.env.LOCAL_COSTINGS_ENABLED === "1"; }
