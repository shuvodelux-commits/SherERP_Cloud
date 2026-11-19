import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Shop D1 rejects stale, replaced, or re-enabled Owner write grants at the SQL boundary',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(read('staging-migrations/shop-identity/0001_shop_identity.sql'));
    db.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)').run('a'.repeat(36),'b'.repeat(36),'c'.repeat(36));
    db.exec(read('staging-migrations/shop-owner-write/0002_shop_owner_write_grant.sql'));
    const state=()=>({...db.prepare('SELECT generation,enabled,token_hash FROM shop_owner_write_grant').get()});
    assert.deepEqual(state(),{generation:0,enabled:0,token_hash:null});
    const publish=db.prepare('UPDATE shop_owner_write_grant SET generation=?, token_hash=?, enabled=1 WHERE singleton=1');
    const first='a'.repeat(64),next='b'.repeat(64);
    publish.run(1,first);
    publish.run(2,next);
    assert.throws(()=>publish.run(1,first),/Owner write grant/);
    assert.throws(()=>publish.run(2,first),/Owner write grant/);
    db.prepare('UPDATE shop_owner_write_grant SET enabled=0').run();
    assert.throws(()=>publish.run(2,next),/Owner write grant/);
    assert.throws(()=>db.exec('DELETE FROM shop_owner_write_grant'),/Owner write grant/);
    assert.throws(()=>db.prepare('INSERT OR REPLACE INTO shop_owner_write_grant (singleton,generation,token_hash,enabled) VALUES (1,?,?,1)').run(3,first),/Owner write grant/);
    assert.deepEqual(state(),{generation:2,enabled:0,token_hash:next});
  }finally{db.close();}
});
