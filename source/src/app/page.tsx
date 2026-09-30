import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>Magppie — Wood Kitchen BOM</h1>
      <p style={{ color: "#66757F", marginTop: 0 }}>Plywood carcass kitchens.</p>
      <ul style={{ lineHeight: 2, paddingLeft: 18 }}>
        <li><Link href="/builder">Builder</Link> — configure cabinets and build a BOM</li>
        <li><Link href="/designer">Designer</Link> — builder in sales-order mode</li>
        <li><Link href="/planning">Planning</Link> — builder in planning mode</li>
        <li><Link href="/dashboard">BOM dashboard</Link> — Zoho orders, raw material and stock</li>
        <li><Link href="/reorder">Reorder report</Link></li>
      </ul>
    </main>
  );
}
