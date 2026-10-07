import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { MATERIAL_MASTER, validateMaterialMaster, type MaterialMaster } from "@/lib/material-master";

export const dynamic = "force-dynamic";
const REPO = "HarshuuSaini/BOM-Builder-Wood---Magppie";
const PATH = "source/src/data/material_master.json";
const GITHUB_URL = `https://api.github.com/repos/${REPO}/contents/${PATH}`;

function authorized(request: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  const supplied = request.headers.get("x-admin-password");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function githubFile(): Promise<{ sha: string; master: MaterialMaster }> {
  const token = process.env.GITHUB_CONTENTS_TOKEN;
  if (!token) throw new Error("GITHUB_CONTENTS_TOKEN is not configured.");
  const result = await fetch(`${GITHUB_URL}?ref=main`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (!result.ok) throw new Error(`Could not read the GitHub material master (HTTP ${result.status}).`);
  const data = await result.json() as { sha?: string; content?: string; encoding?: string };
  if (!data.sha || data.encoding !== "base64" || !data.content) throw new Error("GitHub returned an unexpected material master response.");
  const master = validateMaterialMaster(JSON.parse(Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8")));
  return { sha: data.sha, master };
}

export async function GET(request: Request) {
  if (!authorized(request)) return response({ error: "Unauthorized" }, 401);
  if (!process.env.GITHUB_CONTENTS_TOKEN) return response({ master: MATERIAL_MASTER, sha: null, writable: false, source: "bundled-json" });
  try {
    const { sha, master } = await githubFile();
    return response({ master, sha, writable: true, source: "github-json" });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Could not load the material master." }, 502);
  }
}

export async function PUT(request: Request) {
  if (!authorized(request)) return response({ error: "Unauthorized" }, 401);
  if (!process.env.GITHUB_CONTENTS_TOKEN) return response({ error: "GitHub source updates are not configured. Set GITHUB_CONTENTS_TOKEN in Vercel." }, 503);
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return response({ error: "Cross-origin updates are not allowed." }, 403);
    } catch { return response({ error: "Invalid request origin." }, 400); }
  }
  try {
    const bodyText = await request.text();
    if (bodyText.length > 65536) return response({ error: "Material master is too large." }, 413);
    const body = JSON.parse(bodyText) as { master?: unknown; baseSha?: unknown };
    if (typeof body.baseSha !== "string" || !/^[a-f0-9]{40}$/.test(body.baseSha)) return response({ error: "Reload the current master before saving." }, 400);
    const checked = validateMaterialMaster(body.master);
    const master: MaterialMaster = {
      schemaVersion: 1, sheetAreaSqft: 32, includedLaminateSheetPrice: 550,
      laminates: checked.laminates.map((item) => ({ id: item.id, name: item.name.trim(), pricePerSheet: item.pricePerSheet })),
      postlam: { ...checked.postlam }, visibleSideShutterMaterialId: checked.visibleSideShutterMaterialId,
    };
    const current = await githubFile();
    if (current.sha !== body.baseSha) return response({ error: "The master changed in GitHub. Reload before saving to avoid overwriting another edit." }, 409);
    const result = await fetch(GITHUB_URL, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_CONTENTS_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "Update kitchen material master", content: Buffer.from(`${JSON.stringify(master, null, 2)}\n`).toString("base64"), sha: current.sha, branch: "main" }),
    });
    if (!result.ok) return response({ error: `GitHub rejected the update (HTTP ${result.status}). Check repository permissions and branch protection.` }, 502);
    const saved = await result.json() as { content?: { sha?: string }; commit?: { sha?: string } };
    return response({ ok: true, sha: saved.content?.sha, commit: saved.commit?.sha,
      message: "JSON committed to GitHub. The connected Vercel project will redeploy this commit." });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Could not save the material master." }, 400);
  }
}
