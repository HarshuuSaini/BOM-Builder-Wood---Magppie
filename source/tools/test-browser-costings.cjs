const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const { browserCostingOperation: operate, emptyBrowserCostings } = require('../src/lib/browser-costing-data.ts');
const { priceChangesFor } = require('../src/lib/price-change-audit.ts');
const admin = { username:'preview',role:'admin' }, user = { username:'designer',role:'user' };
const entry = () => {
  const value = {id:crypto.randomUUID(),name:'Browser kitchen',rows:[{'Record Type':'cabinet',Data:'{}'}],
    costing:{areaSqft:10,materialCost:100,transportation:0,installation:0,loading:0,conversion:0,tax:0,total:100,items:[],unpriced:[]}};
  value.priceChanges=priceChangesFor(value).map(c=>({...c,reason:'Fixture rate'})); return value;
};
let state = emptyBrowserCostings();
const call = (path,method='GET',body,actor=admin) => { const r=operate(state,actor,path,method,body);state=r.state;return r.result; };
const source = entry(); const first=call('/api/saved-costings','POST',source).costing;
assert.equal(source.savedCostingId,undefined);
assert.equal(call('/api/saved-costings').costings.length,1);
assert.equal(call('/api/saved-costings','GET',undefined,user).costings.length,0);
assert.throws(()=>call('/api/saved-costings/'+first.id,'GET',undefined,user),e=>e.status===404);
const second=call('/api/saved-costings/actions','POST',{ids:[first.id],action:'clone',copies:1}).costings[0];
assert.notEqual(second.id,first.id);
assert.equal(call('/api/saved-costings/compare','POST',{ids:[first.id,second.id]}).comparison.columns.length,2);
assert.throws(()=>call('/api/saved-costings/compare','POST',{ids:[first.id,second.id]},user),e=>e.status===403);
const beforeConflict=JSON.stringify(state);
assert.throws(()=>call('/api/saved-costings','POST',{...first.entry,savedCostingVersion:99}),e=>e.status===409);
assert.equal(JSON.stringify(state),beforeConflict);
call('/api/saved-costings/actions','POST',{ids:[first.id],action:'bin'});
assert.equal(call('/api/saved-costings').costings.length,1);
assert.equal(call('/api/saved-costings?bin=1').costings.length,1);
assert.throws(()=>call('/api/saved-costings','POST',first.entry),e=>e.code==='COSTING_IN_BIN');
call('/api/saved-costings/actions','POST',{ids:[first.id],action:'restore'});
const updated = call('/api/saved-costings/'+first.id).costing;
call('/api/saved-costings/project-pricing','POST',{reason:'Margin test',kitchens:[{id:first.id,version:updated.version,rates:{transportation:0,installation:0,loading:0,conversionPct:40,includeTax:false}}]});
assert(Math.abs(call('/api/saved-costings/'+first.id).costing.total-100/0.6)<1e-8);
assert.equal(JSON.stringify(state),JSON.stringify(JSON.parse(JSON.stringify(state))));

(async()=>{
  const priorEnv=process.env.NODE_ENV; process.env.NODE_ENV='production';
  const originalFetch=global.fetch, originalWindow=global.window, originalNavigator=Object.getOwnPropertyDescriptor(global,'navigator');
  const values=new Map();let quota=false;const network=[];
  global.window={localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(quota)throw new Error('QuotaExceeded');values.set(k,v);}}};
  Object.defineProperty(global,'navigator',{configurable:true,value:{locks:{request:async(_name,fn)=>fn()}}});
  global.fetch=async(path,init)=>{network.push({path,init});return Response.json({user:'preview',role:'admin'});};
  try {
    const {costingFetch,BROWSER_COSTINGS_KEY}=require('../src/lib/costing-client.ts');
    const payload=entry();
    assert.equal((await costingFetch('/api/saved-costings',{method:'POST',body:JSON.stringify(payload)})).status,200);
    assert.equal((await (await costingFetch('/api/saved-costings')).json()).costings.length,1);
    assert(network.every(r=>r.path==='/api/user-session'&&!r.init.body),'No kitchen payload may be transmitted to the server');
    const persisted=values.get(BROWSER_COSTINGS_KEY);quota=true;
    assert.equal((await costingFetch('/api/saved-costings',{method:'POST',body:JSON.stringify(entry())})).status,507);
    assert.equal(values.get(BROWSER_COSTINGS_KEY),persisted,'Quota failure must preserve all saved kitchens');quota=false;
    assert.equal((await costingFetch('/api/saved-costings',{method:'POST',headers:{'x-costing-user':'different'},body:JSON.stringify(entry())})).status,409);
    values.set(BROWSER_COSTINGS_KEY,'broken');
    assert.equal((await costingFetch('/api/saved-costings')).status,500);
    assert.equal(values.get(BROWSER_COSTINGS_KEY),'broken','Corrupt data must not be overwritten');
  } finally {
    global.fetch=originalFetch;global.window=originalWindow;
    if(originalNavigator)Object.defineProperty(global,'navigator',originalNavigator);else delete global.navigator;
    if(priorEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorEnv;
  }
  console.log('PASS: browser-local save/reload, ownership, clone, compare, bin/restore, margin edits, conflicts, quota preservation and no costing upload.');
})().catch(e=>{console.error(e);process.exitCode=1;});
