import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {publishFixtureOwnerGrant} from './fixtures/m03-clean-shop-owner-grant.mjs';

test('shop grants only advance and a disabled generation cannot be revived',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  try{
    sqlite.exec(readFileSync('staging-migrations/shop-identity/0001_shop_identity.sql','utf8'));
    sqlite.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)').run('a'.repeat(36),'b'.repeat(36),'c'.repeat(36));
    sqlite.exec(readFileSync('staging-migrations/shop-owner-write/0002_shop_owner_write_grant.sql','utf8'));
    const DB={prepare(sql){return {bind(...values){return {async first(){return sqlite.prepare(sql).get(...values)??null;}};}};}};
    const old='a'.repeat(64),current='b'.repeat(64);
    assert.equal(await publishFixtureOwnerGrant(DB,old,1),true);
    assert.equal(await publishFixtureOwnerGrant(DB,current,2),true);
    assert.equal(await publishFixtureOwnerGrant(DB,old,1),false);
    assert.equal(await publishFixtureOwnerGrant(DB,old,2),false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM shop_owner_write_grant').get().n,1);
    sqlite.prepare('UPDATE shop_owner_write_grant SET enabled=0').run();
    assert.equal(await publishFixtureOwnerGrant(DB,current,2),false);
    assert.equal(sqlite.prepare('SELECT enabled FROM shop_owner_write_grant').get().enabled,0);
    await assert.rejects(()=>publishFixtureOwnerGrant(DB,current,0),/grant/i);
  }finally{sqlite.close();}
});
