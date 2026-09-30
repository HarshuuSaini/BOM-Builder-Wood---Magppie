const C = require('./out/core.js');

const line = (s) => console.log(s);
const hr = (t) => line('\n' + '─'.repeat(78) + '\n' + t);

// ---- 1. catalog sanity ----
hr('CATALOG');
line(`zones: ${Object.keys(C.ZONES).length}`);
let fams = new Set();
Object.keys(C.ZONES).forEach(z => Object.keys(C.famSetOf(z)).forEach(f => fams.add(f)));
line(`distinct families: ${fams.size}  →  ${[...fams].join(' ')}`);
line(`sheet: ${C.SHEET_SQFT.toFixed(2)} sqft`);

// ---- 2. build a real project ----
const project = [
  { zk:'BC', fk:'SH',  vid:'double', hand:'LHS', handle:'STD', board:'A', shType:'POSTLAM', neon:'NEON20', W:600, H:720, D:560, drawerModel:'Hettich', qty:4, elevation:'AA' },
  { zk:'BC', fk:'DW',  vid:'3dr',    hand:'LHS', handle:'XCJ', board:'A', shType:'PRELAM',  neon:'NEON20', W:600, H:720, D:560, drawerModel:'Blum',    qty:2, elevation:'AA' },
  { zk:'WC', fk:'WGL', vid:'dbl',    hand:'LHS', handle:'STD', board:'B', shType:'POSTLAM', neon:'NEON50', W:900, H:1085,D:336, drawerModel:'Hettich', qty:3, elevation:'BB' },
  { zk:'TC', fk:'DPN', vid:'h',      hand:'RHS', handle:'STD', board:'A', shType:'PU2',     neon:'NEON20', W:600, H:2400,D:560, drawerModel:'Grass',   qty:1, elevation:'CC' },
];

const lines = project.map((c, i) => ({ id: i, m: C.buildModel(c), qty: c.qty, elevation: c.elevation }));

hr('CABINETS');
lines.forEach(l => {
  line(`${l.elevation}  ${l.m.code}   ×${l.qty}   ${l.m.W}×${l.m.H}×${l.m.D}`);
  l.m.panels.forEach(p =>
    line(`      ${String(p.qty).padStart(2)}×  ${(p.w+'×'+p.h).padEnd(12)} ${String(p.t).padStart(2)}mm  ${(p.mat||'').padEnd(32)} ${p.band?'band':'—'}`));
});

hr('BOARD TOTALS → SHEETS');
C.buildBoardTotals(lines).forEach(b =>
  line(`${b.mat.padEnd(34)} ${String(b.t).padStart(2)}mm  ${b.pack.padEnd(14)} ${b.sqft.toFixed(2).padStart(8)} sqft  +${b.waste}%  → ${b.sheets===null?'by area':b.sheets.toFixed(2)+' sheets'}`));

hr('FULL BOM');
const bom = C.buildFullBomData(lines, 'SO-00042', 'Walnut');
line(`rows: ${bom.length}`);
line(`levels present: ${[...new Set(bom.map(r=>r.Level))].sort().join(', ')}`);
line(`columns: ${Object.keys(bom[0]).length}`);
line('\nsample L4 raw-material rows:');
bom.filter(r=>r.Level===4 && r.Unit==='sqft').slice(0,5).forEach(r =>
  line(`  ${r.Item.padEnd(42)} ${String(r['SO Qty']).padStart(8)} → ${String(r['Actual Qty']).padStart(8)} sqft  (${r['Waste %']}%)  ${r.Pcs} sheets`));

hr('CSV');
const csv = C.buildCSV(lines);
line(csv.split('\n').slice(0,6).join('\n'));
line(`... ${csv.trim().split('\n').length-1} rows total`);

hr('STUBS RAISED');
[...new Set(lines.flatMap(l=>l.m.stubs))].forEach(s=>line('  • '+s));
