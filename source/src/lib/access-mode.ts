/** Temporary public costing access requested by the owner. Set USER_LOGIN_REQUIRED=1 to restore login. */
export function isOpenCostingAccess(env: Record<string, string | undefined> = process.env) {
  return env.USER_LOGIN_REQUIRED !== "1";
}
