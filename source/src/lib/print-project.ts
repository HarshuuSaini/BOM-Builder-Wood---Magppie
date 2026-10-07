const PRINT_PREFIX = "WBOM1";
const CHUNK_LENGTH = 96;

/** The print appendix keeps the exact editable project state inside browser-made PDFs. */
export function encodeProjectPrintData(value: unknown): string[] {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const base64 = btoa(binary);
  const chunks = base64.match(new RegExp(`.{1,${CHUNK_LENGTH}}`, "g")) ?? [];
  return chunks.map((chunk, index) => `${PRINT_PREFIX}.${String(index).padStart(5, "0")}.${chunk}`);
}

export function decodeProjectPrintData(text: string): unknown {
  const matches = [...text.matchAll(/WBOM1\.(\d{5})\.([A-Za-z0-9+/=]+)/g)];
  if (!matches.length) throw new Error("This PDF has no Wood BOM restore data. Use Print project PDF in the builder, or import the original Excel BOM. Older printouts need a sample PDF for a separate reader.");
  const chunks = new Map<number, string>();
  for (const match of matches) {
    const index = Number(match[1]);
    if (chunks.has(index) && chunks.get(index) !== match[2]) throw new Error("Conflicting project data was found in the PDF.");
    chunks.set(index, match[2]);
  }
  const ordered = [...chunks.entries()].sort(([a], [b]) => a - b);
  if (ordered.length > 10000 || ordered.some(([index], position) => index !== position)) {
    throw new Error("The PDF project data is incomplete. Print the entire document, including its final restore page.");
  }
  try {
    const binary = atob(ordered.map(([, chunk]) => chunk).join(""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("The PDF project data could not be decoded. Print the entire document again.");
  }
}

export type LegacyPrintedProject = { legacyPages: string[] };

export async function readPrintedProjectPdf(file: File): Promise<unknown | LegacyPrintedProject> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const textParts: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if ("str" in item) {
          pageText += item.str;
          if (item.hasEOL) pageText += "\n";
        }
      }
      textParts.push(pageText);
    }
    const text = textParts.join("\n");
    if (!text.includes(`${PRINT_PREFIX}.`)) return { legacyPages: textParts };
    return decodeProjectPrintData(text);
  } finally {
    await task.destroy();
  }
}
