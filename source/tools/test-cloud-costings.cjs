const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
require.extensions['.css'] = mod => { mod.exports = {}; };
require('./test-purchase-rounding.cjs');
const { browserCostingOperation, emptyBrowserCostings } = require('../src/lib/browser-costing-data.ts');
const { priceChangesFor } = require('../src/lib/price-change-audit.ts');
const { exposeSavedCosting } = require('../src/lib/costing-visibility.ts');
const { priceDesignerCosting } = require('../src/lib/server-project-pricing.ts');
let actor = { username:'preview',role:'admin' }, open = false, calls = [], rows = [], commitConflict = false;
const env = { SUPABASE_URL:'https://fixture.supabase.co', SUPABASE_SECRET_KEY:'test-server-only' };
const filename = path.resolve('src/lib/supabase-costing-http.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleFixture = {exports:{}};
const fetchMock = async (input,init) => {
 const url=new URL(input); calls.push({url,init});
 assert.equal(init.headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(init.cache,'no-store');
 if(url.pathname.endsWith('/wood_commit_costings')) {
  if(commitConflict) return Response.json({code:'40001'},{status:409});
  const body=JSON.parse(init.body); assert.equal(body.actor_name,actor.username); assert.equal(body.actor_admin,actor.role==='admin');
  for(const c of body.changes) rows=[...rows.filter(s=>s.id!==c.saved.id),c.saved];
  return Response.json({ok:true});
 }
 if(url.pathname.endsWith('/wood_accessories')) return Response.json([]);
 let matching=rows.filter(s=>(!url.searchParams.has('owner') || url.searchParams.get('owner')==='eq.'+s.owner));
 if(url.searchParams.has('id')) {
  const value=url.searchParams.get('id'); matching=matching.filter(s=>value==='eq.'+s.id || value.startsWith('in.(')&&value.includes(s.id));
 }
 if(url.searchParams.has('workspace_id')) matching=matching.filter(s=>url.searchParams.get('workspace_id')==='eq.'+s.entry.id);
 return Response.json(matching.map(s=>url.searchParams.get('select')==='summary'?{summary:(({entry,...summary})=>summary)(s)}:{payload:s}));
};
vm.runInNewContext(compiled,{module:moduleFixture,exports:moduleFixture.exports,process:{env},Buffer,URL,URLSearchParams,Response,Request,AbortSignal,
 fetch:fetchMock,require:name=>({
 'server-only':{},'./user-session':{currentIdentity:async()=>actor,isOpenCostingAccess:()=>open},
 './costing-storage-mode':{cloudCostingsEnabled:()=>true},
 './browser-costing-data':require('../src/lib/browser-costing-data.ts'),
 './costing-visibility':{exposeSavedCosting},'./server-project-pricing':{priceDesignerCosting}
 })[name]}, {filename});
const {cloudCostingResponse:handle,listCloudCostings}=moduleFixture.exports;
const request=(p,body,origin='https://app.example')=>new Request('https://app.example'+p,{method:body?'POST':'GET',headers:{origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const entry=()=>{
 const e={id:crypto.randomUUID(),name:'Cloud fixture',rows:[{'Record Type':'cabinet',Data:'{}'}],costing:{areaSqft:10,materialCost:100,transportation:0,installation:0,loading:0,conversion:0,tax:0,total:100,items:[],unpriced:[]}};
 e.priceChanges=priceChangesFor(e).map(c=>({...c,reason:'Approved fixture'}));return e;
};
(async()=>{
 actor=null; assert.equal((await handle(request('/api/saved-costings'))).status,401);assert.equal(calls.length,0);
 actor={username:'preview',role:'admin'};open=true;assert.equal((await handle(request('/api/saved-costings'))).status,503);await assert.rejects(()=>listCloudCostings(actor),e=>e.status===503);open=false;
 assert.equal((await handle(request('/api/saved-costings',entry(),'https://evil.example'))).status,403);assert.equal(calls.length,0);
 let response=await handle(request('/api/saved-costings',entry()));assert.equal(response.status,200);const saved=(await response.json()).costing;
 assert.equal(saved.version,1);assert.equal(rows.length,1);
 assert.equal(calls.at(-1).url.pathname,'/rest/v1/rpc/wood_commit_costings');
 calls=[];await listCloudCostings(actor);assert(calls.every(c=>c.url.searchParams.get('select')==='summary'),'List must not download kitchen payloads or history');
 actor={username:'Sudha@31',role:'user'};calls=[];
 assert.equal((await handle(request('/api/saved-costings/'+saved.id))).status,404);
 assert.equal(calls[0].url.searchParams.get('owner'),'eq.Sudha@31');
 calls=[];assert.equal((await handle(request('/api/saved-costings/compare',{ids:[saved.id,crypto.randomUUID()]}))).status,403);assert.equal(calls.length,0);
 actor={username:'preview',role:'admin'};
 response=await handle(request('/api/saved-costings/actions',{ids:[saved.id],action:'clone',copies:2}));assert.equal(response.status,200);assert.equal(rows.length,3);
 const latest=rows.find(s=>s.id===saved.id);commitConflict=true;
 response=await handle(request('/api/saved-costings',{...latest.entry,name:'Conflicting save'}));assert.equal(response.status,409);assert.equal(rows.find(s=>s.id===saved.id).version,1);commitConflict=false;
 response=await handle(request('/api/saved-costings/'+saved.id));assert.equal(response.status,200);
 assert(!(await response.text()).includes('test-server-only'),'Server key must never be serialized');
 console.log('Cloud adapter passed: login, origin, owner isolation, summary-only lists, private commits, cloning and conflict handling.');
})().catch(e=>{console.error(e);process.exitCode=1;});
