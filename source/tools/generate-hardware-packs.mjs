import fs from "node:fs";
import path from "node:path";

const sourcePath = path.resolve(process.argv[2] ?? "../reference/stone/source/src/components/CarcassBomBuilder.tsx");
const outputPath = path.resolve(process.argv[3] ?? "src/data/hardware_packs.json");
const source = fs.readFileSync(sourcePath, "utf8");
const marker = "const HARDWARE_PACK_DEFINITIONS";
const start = source.indexOf(marker);
if (start < 0) throw new Error(`Could not find ${marker}`);
const assignment = source.indexOf("= {", start);
const objectStart = assignment < 0 ? -1 : assignment + 2;
const objectEnd = source.indexOf("\n};", objectStart);
if (objectStart < 0 || objectEnd < 0) throw new Error("Could not locate hardware-pack object boundaries");
const objectLiteral = source.slice(objectStart, objectEnd + 2);
const definitions = Function(`"use strict"; return (${objectLiteral});`)();
const payload = {
  schemaVersion: 1,
  source: "reference/stone/source/src/components/CarcassBomBuilder.tsx:HARDWARE_PACK_DEFINITIONS",
  generatedAt: new Date().toISOString(),
  packCount: Object.keys(definitions).length,
  definitions,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${payload.packCount} hardware packs to ${outputPath}`);
