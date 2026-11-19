import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {FIXTURE_OWNER_GRANT_SCHEMA,publishFixtureOwnerGrant} from './fixtures/m03-clean-shop-owner-grant.mjs';

test('shop grants only advance and a disabled generation cannot be revived',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  try{
    sqlite.exec(FIXTURE_OWNER_GRANT_SCHEMA);
    const DB={prepare(sql){return {bind(...values){return {async first(){return sqlite.prepare(sql).get(...values)??null;}};}};}};
    const old='a'.repeat(64),current='b'.repeat(64);
    assert.equal(await publishFixtureOwnerGrant(DB,old,1),true);
    assert.equal(await publishFixtureOwnerGrant(DB,current,2),true);
    assert.equal(await publishFixtureOwnerGrant(DB,old,1),false);
    assert.equal(await publishFixtureOwnerGrant(DB,old,2),false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM fixture_owner_write_grants').get().n,1);
    sqlite.prepare('UPDATE fixture_owner_write_grants SET enabled=0').run();
    assert.equal(await publishFixtureOwnerGrant(DB,current,2),false);
    assert.equal(sqlite.prepare('SELECT enabled FROM fixture_owner_write_grants').get().enabled,0);
    await assert.rejects(()=>publishFixtureOwnerGrant(DB,current,0),/grant/i);
  }finally{sqlite.close();}
});
