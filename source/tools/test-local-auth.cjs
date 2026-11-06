const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Load only source and explicit test fixtures; never load private env files.
function load(relativePath, env = {}, mocks = {}) {
  const filename = path.join(__dirname, "..", relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, process: { env }, Buffer, URL,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
  }, { filename });
  return module.exports;
}

const auth = load("src/lib/local-auth.ts");
const localAccounts = [
  { username: "Sudha@31", password: "Sudha@31", role: "user" },
  { username: "Abdul@31", password: "Abdul@31", role: "admin" },
];
const env = {
  USER_LOGIN_REQUIRED: "1",
  NODE_ENV: "development", USER_LOGIN_NAME: "preview", USER_LOGIN_PASSWORD: "preview-test-password",
  USER_LOGIN_ROLE: "admin", USER_LOCAL_ACCOUNTS: JSON.stringify(localAccounts), USER_SESSION_SECRET: "test-secret-".repeat(4),
};
const sudha = auth.authenticateAccount(env, "Sudha@31", "Sudha@31");
const abdul = auth.authenticateAccount(env, "Abdul@31", "Abdul@31");
assert.equal(sudha.role, "user");
assert.equal(abdul.role, "admin");
assert.equal(auth.authenticateAccount(env, "preview", "preview-test-password").role, "admin");
for (const [username, password] of [["Sudha@31", "Abdul@31"], ["sudha@31", "Sudha@31"], ["unknown", "Sudha@31"], ["", ""], ["x".repeat(257), "p"], ["Sudha@31", "x".repeat(1025)]]) {
  assert.equal(auth.authenticateAccount(env, username, password), null);
}
assert.equal(auth.authenticateAccount({ NODE_ENV: "development", USER_LOCAL_ACCOUNTS: env.USER_LOCAL_ACCOUNTS }, "Sudha@31", "Sudha@31").role, "user");
for (const mode of ["production", "test", undefined]) {
  const production = { ...env, NODE_ENV: mode };
  assert.equal(auth.authenticateAccount(production, "Sudha@31", "Sudha@31"), null);
  assert.equal(auth.authenticateAccount(production, "preview", "preview-test-password").role, "admin");
  assert.equal(auth.authenticateAccount({ ...production, USER_LOGIN_ROLE: undefined }, "preview", "preview-test-password").role, "user");
  assert.equal(auth.identityForSession(production, { user: sudha.username, credentialVersion: sudha.credentialVersion }), null);
}
for (const invalid of ["invalid JSON", "null", "{}", '[{"username":"bad","password":"p","role":"owner"}]', JSON.stringify([...localAccounts, localAccounts[0]]), JSON.stringify([{ ...localAccounts[0], username: "preview" }])]) {
  const broken = { ...env, USER_LOCAL_ACCOUNTS: invalid };
  assert.equal(auth.configuredAccounts(broken).length, 1);
  assert.ok(auth.authenticateAccount(broken, "preview", "preview-test-password"));
}
const sessionFor = account => ({ user: account.username, credentialVersion: account.credentialVersion });
assert.equal(auth.identityForSession(env, sessionFor(sudha)).username, sudha.username);
assert.equal(auth.identityForSession(env, { ...sessionFor(sudha), user: abdul.username }), null);
assert.equal(auth.identityForSession(env, { user: "Sudha@31" }), null);
assert.equal(auth.identityForSession(env, { user: "preview", credentialVersion: createHash("sha256").update(env.USER_LOGIN_PASSWORD).digest("hex") }), null);
for (const change of [{ password: "rotated" }, { role: "admin" }, { username: "renamed" }]) {
  const changed = { ...env, USER_LOCAL_ACCOUNTS: JSON.stringify([{ ...localAccounts[0], ...change }, localAccounts[1]]) };
  assert.equal(auth.identityForSession(changed, sessionFor(sudha)), null);
  assert.equal(auth.identityForSession(changed, sessionFor(abdul)).username, "Abdul@31");
}
assert.equal(auth.identityForSession({ ...env, USER_LOCAL_ACCOUNTS: "[]" }, sessionFor(sudha)), null);
assert.equal(auth.identityForSession(env, { ...sessionFor(sudha), role: "admin" }).role, "user");

const workspace = load("src/lib/login-workspace.ts");
const workspaceKey = "wood-bom-kitchen-workspace-v1";
const activeKey = "wood-bom-active-kitchen-v1";
const draftKey = "wood-bom-material-edit-draft";
const values = new Map([[workspaceKey, "legacy private data"], [activeKey, "legacy"], [draftKey, "legacy draft"], ["unrelated", "keep"]]);
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
workspace.isolateLoginWorkspace(storage, "Sudha@31");
assert.equal(values.get(workspace.WORKSPACE_USER_KEY), "Sudha@31");
assert.equal(values.has(workspaceKey), false);
assert.equal(values.has(activeKey), false);
assert.equal(values.has(draftKey), false);
values.set(workspaceKey, "Sudha private data");
workspace.isolateLoginWorkspace(storage, "Sudha@31");
assert.equal(values.get(workspaceKey), "Sudha private data");
workspace.isolateLoginWorkspace(storage, "Abdul@31");
assert.equal(values.has(workspaceKey), false);
assert.equal(values.get("unrelated"), "keep");

async function main() {
  const accessMode = load("src/lib/access-mode.ts", env);
  assert.equal(accessMode.isOpenCostingAccess({}), true);
  assert.equal(accessMode.isOpenCostingAccess({ USER_LOGIN_REQUIRED: "1" }), false);
  let saved = 0;
  const session = { materials: { old: true }, materialsCompressed: "old", save: async () => { saved++; }, destroy() { delete this.user; delete this.credentialVersion; } };
  const userSession = load("src/lib/user-session.ts", env, {
    "server-only": {}, "@/lib/local-auth": auth,
    "@/lib/access-mode": accessMode,
    "iron-session": { getIronSession: async () => session },
    "next/headers": { cookies: async () => ({}) },
    "next/navigation": { redirect: location => { throw new Error(`redirect:${location}`); } },
  });
  const route = load("src/app/api/user-session/route.ts", env, {
    "@/lib/user-session": userSession,
    "@/lib/costing-storage-mode": load("src/lib/costing-storage-mode.ts", env),
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  });
  const request = (user, password, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/user-session", {
    method: "POST", headers: { origin, host: "localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ user, password, role: "admin" }),
  });
  assert.equal((await route.POST(request("Sudha@31", "Sudha@31", "http://other.test"))).status, 403);
  assert.equal((await route.POST(request("Sudha@31", "wrong"))).status, 401);
  assert.equal(saved, 0);
  for (const account of [...localAccounts, { username: "preview", password: "preview-test-password", role: "admin" }]) {
    session.materials = { old: true };
    session.materialsCompressed = "old";
    const response = await route.POST(request(account.username, account.password));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, { user: account.username, role: account.role, localCostingsEnabled: false });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(session.materials, undefined);
    assert.equal(session.materialsCompressed, undefined);
    assert.equal(await userSession.currentUser(), account.username);
    assert.equal((await userSession.requireIdentity()).role, account.role);
    assert.equal(await userSession.requireUser(), account.username);
    assert.equal(userSession.userCredentialVersion(account.username), session.credentialVersion);
    assert.deepEqual(await (await route.GET()).json(), { user: account.username, role: account.role, openAccess: false });
  }
  assert.equal(saved, 3);
  // Role/password changes and legacy cookies are rejected through the real server helpers too.
  env.USER_LOGIN_ROLE = "user";
  assert.equal(await userSession.currentIdentity(), null);
  assert.equal(await userSession.currentUser(), null);
  await assert.rejects(userSession.requireIdentity(), /redirect:\/login/);
  await assert.rejects(userSession.requireUser(), /redirect:\/login/);
  assert.deepEqual(await (await route.GET()).json(), { user: null, role: null, openAccess: false });
  env.USER_LOGIN_NAME = "";
  env.USER_LOGIN_PASSWORD = "";
  assert.equal((await route.POST(request("Sudha@31", "Sudha@31"))).status, 200);
  env.NODE_ENV = "production";
  assert.equal(await userSession.currentIdentity(), null);
  assert.equal((await route.POST(request("Sudha@31", "Sudha@31"))).status, 503);
  env.USER_LOGIN_REQUIRED = "0";
  env.USER_LOGIN_NAME = "preview";
  assert.equal((await userSession.requireIdentity()).role, "admin");
  assert.deepEqual(await (await route.GET()).json(), { user: "preview", role: "admin", openAccess: true });
  const savedBeforeOpen = saved;
  session.materials = { keep: true };
  assert.equal((await route.POST(request("", ""))).status, 200);
  assert.equal(saved, savedBeforeOpen, 'Open access must not reset the material session');
  assert.deepEqual(session.materials, { keep: true });
  console.log("Local auth passed: credentials, roles, development gate, stale sessions, API and workspace isolation.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
