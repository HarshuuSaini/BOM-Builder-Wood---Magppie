// Pass a separately installed PGlite package path to keep this test runtime out of the app bundle.
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
 const db = new PGlite();
 try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO service_role;');
  await db.exec(fs.readFileSync(path.resolve(__dirname,'../database/supabase-costings.sql'),'utf8'));
  const id=crypto.randomUUID(), workspace=crypto.randomUUID();
  const saved=(version,owner='designer')=>({id,owner,version,name:'SQL fixture',updatedAt:new Date().toISOString(),entry:{id:workspace,savedCostingVersion:version}});
  const commit=(actor,admin,checks,changes,accessories=[])=>db.query('SELECT public.wood_commit_costings($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)',[actor,admin,JSON.stringify(checks),JSON.stringify(changes),JSON.stringify(accessories)]);
  await db.exec('SET ROLE service_role');
  for(let version=1;version<=9;version++) await commit('designer',false,version===1?[]:[{id,version:version-1}],[{expectedVersion:version===1?null:version-1,saved:saved(version)}],[{id:'basket',rate:version}]);
  assert.deepEqual((await db.query('SELECT version FROM public.wood_costing_versions ORDER BY version')).rows.map(r=>r.version),[5,6,7,8,9]);
  assert.equal((await db.query('SELECT COUNT(*)::integer n FROM public.wood_accessory_versions')).rows[0].n,5);
  await assert.rejects(commit('another-user',false,[{id,version:9}],[]),e=>e.code==='P0002');
  await assert.rejects(commit('designer',false,[{id,version:8}],[{expectedVersion:8,saved:saved(9)}]),e=>e.code==='40001');
  await assert.rejects(commit('designer',false,[{id,version:9}],[{expectedVersion:9,saved:saved(10,'other')}]),e=>e.code==='42501');
  // A later invalid record must roll back an earlier write and its retention deletions.
  await assert.rejects(commit('designer',false,[{id,version:9}],[{expectedVersion:9,saved:saved(10)},{expectedVersion:null,saved:{...saved(2),id:crypto.randomUUID()}}]));
  assert.equal((await db.query('SELECT version FROM public.wood_costings WHERE id=$1',[id])).rows[0].version,9);
  assert.deepEqual((await db.query('SELECT version FROM public.wood_costing_versions ORDER BY version')).rows.map(r=>r.version),[5,6,7,8,9]);
  await commit('preview',true,[{id,version:9}],[{expectedVersion:9,saved:{...saved(10),deletedAt:new Date().toISOString()}}]);
  assert((await db.query('SELECT deleted_at FROM public.wood_costings WHERE id=$1',[id])).rows[0].deleted_at);
  assert.equal((await db.query('SELECT COUNT(*)::integer n FROM public.wood_costing_versions')).rows[0].n,5);
  await db.exec('RESET ROLE');
  for(const role of ['anon','authenticated']) {
   for(const table of ['wood_costings','wood_costing_versions','wood_accessories','wood_accessory_versions']) {
    assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') allowed",[role,'public.'+table])).rows[0].allowed,false);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",['public.'+table])).rows[0].relrowsecurity,true);
   }
   assert.equal((await db.query("SELECT has_function_privilege($1,'public.wood_commit_costings(text,boolean,jsonb,jsonb,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
  console.log('PostgreSQL migration passed: five-version retention, private tables/RPC, user isolation, admin access, stale conflicts, bin saves and full transactional rollback.');
 } finally { await db.close(); }
})().catch(error=>{ console.error(error);process.exitCode=1;});
