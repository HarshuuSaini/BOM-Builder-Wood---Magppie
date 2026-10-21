import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const worker = await readFile(join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"));
    return new Response(worker, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("PDF worker unavailable", { status: 503 });
  }
}
