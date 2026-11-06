const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { SavedCostingPrint } = require('../src/components/SavedCostingPrint.tsx');
const { exposeSavedCosting } = require('../src/lib/costing-visibility.ts');
const { decodeProjectPrintData } = require('../src/lib/print-project.ts');
const rows = [
  { 'Record Type': 'format', Data: JSON.stringify({name:'wood-bom-project',version:2}) },
  { 'Record Type': 'settings', Data: JSON.stringify({name:'Kitchen & ₹',pricing:{conversionPct:40,conversionModel:'margin',includeTax:false}}) },
  { 'Record Type': 'accessory', Data: JSON.stringify({itemId:'CUSTOM',customName:'Basket <script>bad()</script>',manualRate:'3000',priceChangeReason:'New accessory'}) },
];
const costing = { id:'test-print',name:'Kitchen & ₹',owner:'preview',version:3,areaSqft:123.45,
  updatedAt:'2026-11-06T10:00:00Z',createdAt:'2026-11-06T10:00:00Z',entry:{id:'workspace',name:'Kitchen & ₹',rows,
    costing:{areaSqft:123.45,materialCost:3000,transportation:0,installation:0,loading:0,conversion:2000,conversionModel:'margin',tax:0,total:5000,
      items:[{category:'Accessory',itemCode:'CUSTOM',item:'Basket <script>bad()</script>',unit:'nos',quantity:1,rate:3000,amount:3000}],unpriced:[]}}};
const original = JSON.stringify(costing);
const admin = renderToStaticMarkup(React.createElement(SavedCostingPrint,{costing,admin:true}));
assert(admin.includes('123.45'));
assert(admin.includes('₹5,000.00'));
assert(admin.includes('Final project price'));
assert(admin.includes('40% margin'));
assert(!admin.includes('<script>bad()</script>'),'Item names must be escaped');
const restoreText = [...admin.matchAll(/<div class="restore-line">([^<]+)<\/div>/g)].map(m=>m[1]).join('\n');
assert.deepEqual(decodeProjectPrintData(restoreText),rows,'Printed appendix must restore the exact project rows');
const visible = exposeSavedCosting(costing,'user');
const user = renderToStaticMarkup(React.createElement(SavedCostingPrint,{costing:visible,admin:false}));
assert(!user.includes('Final project price'));
assert(!user.includes('Items + services subtotal'));
assert(!user.includes('40% margin'));
const designerRestore = [...user.matchAll(/<div class="restore-line">([^<]+)<\/div>/g)].map(m=>m[1]).join('\n');
assert(!JSON.parse(decodeProjectPrintData(designerRestore)[1].Data).pricing,'Designer PDF must not embed admin pricing');
assert.equal(JSON.stringify(costing),original,'Printing cannot mutate the saved quote');
const missing = renderToStaticMarkup(React.createElement(SavedCostingPrint,{costing:{...costing,entry:{...costing.entry,costing:undefined}},admin:true}));
assert(missing.includes('no saved costing breakdown'));
assert(!missing.includes('Project restore data'));
console.log('PASS: saved PDF amounts, margin, escaping, admin/designer visibility, exact restore appendix and read-only printing.');
