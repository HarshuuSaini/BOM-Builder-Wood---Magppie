// Parent workspace code can use this marker to identify the owner of tab-local data.
export const WORKSPACE_USER_KEY = "wood-bom-workspace-user-v1";

export function loginLandingPage(localCostingsEnabled: unknown) {
  return localCostingsEnabled === true ? "/costings" : "/materials";
}

export function isolateLoginWorkspace(storage: Pick<Storage, "getItem" | "removeItem" | "setItem">, username: string) {
  if (storage.getItem(WORKSPACE_USER_KEY) !== username) {
    // Also discard unowned data from sessions created before username markers existed.
    storage.removeItem("wood-bom-kitchen-workspace-v1");
    storage.removeItem("wood-bom-active-kitchen-v1");
    storage.removeItem("wood-bom-material-edit-draft");
  }
  storage.setItem(WORKSPACE_USER_KEY, username);
}
