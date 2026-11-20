import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {publishOwnerWriteGrant,withdrawOwnerWriteGrant} from '../src/db/shop-owner-write-grant.js';

test('shop grants only advance and a disabled generation cannot be revived',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  try{
    sqlite.exec(readFileSync('staging-migrations/shop-identity/0001_shop_identity.sql','utf8'));
    sqlite.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)').run('a'.repeat(36),'b'.repeat(36),'c'.repeat(36));
    sqlite.exec(readFileSync('staging-migrations/shop-owner-write/0002_shop_owner_write_grant.sql','utf8'));
    sqlite.exec(readFileSync('staging-migrations/shop-owner-write/0004_owner_write_lease.sql','utf8'));
    const DB={prepare(sql){return {bind(...values){return {async first(){return sqlite.prepare(sql).get(...values)??null;}};}};}};
    const scope={shopId:'a'.repeat(36),databaseId:'b'.repeat(36),databaseMarker:'c'.repeat(36)};
    const wrongScope={...scope,databaseMarker:'d'.repeat(36)};
    const old='a'.repeat(64),current='b'.repeat(64);
    const expiresAt=Date.now()+60_000;
    assert.equal(await publishOwnerWriteGrant(DB,wrongScope,old,1,expiresAt),false);
    assert.equal(await publishOwnerWriteGrant(DB,scope,old,1,expiresAt),true);
    assert.equal(await publishOwnerWriteGrant(DB,scope,current,2,expiresAt),true);
    assert.equal(await publishOwnerWriteGrant(DB,scope,old,1,expiresAt),false);
    assert.equal(await publishOwnerWriteGrant(DB,scope,old,2,expiresAt),false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM shop_owner_write_grant').get().n,1);
    assert.equal(await withdrawOwnerWriteGrant(DB,wrongScope,current),false);
    assert.equal(await withdrawOwnerWriteGrant(DB,scope,old),false);
    assert.equal(await withdrawOwnerWriteGrant(DB,scope,current),true);
    assert.equal(await withdrawOwnerWriteGrant(DB,scope,current),true);
    assert.equal(await publishOwnerWriteGrant(DB,scope,current,2,expiresAt),false);
    assert.equal(sqlite.prepare('SELECT enabled FROM shop_owner_write_grant').get().enabled,0);
    await assert.rejects(()=>publishOwnerWriteGrant(DB,scope,current,0,expiresAt),/grant/i);
  }finally{sqlite.close();}
});
