import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const authorized=`SELECT EXISTS(SELECT 1 FROM shop_owner_write_grant
  WHERE singleton=1 AND enabled=1 AND token_hash=? AND expires_at_ms>${NOW}) AS allowed`;

test('M03 Owner grant upgrade denies pre-existing unleased tokens and prevents same-generation extension',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(read('staging-migrations/shop-identity/0001_shop_identity.sql'));
    db.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)').run('a'.repeat(36),'b'.repeat(36),'c'.repeat(36));
    db.exec(read('staging-migrations/shop-owner-write/0002_shop_owner_write_grant.sql'));
    const old='a'.repeat(64),current='b'.repeat(64),rotated='c'.repeat(64);
    db.prepare('UPDATE shop_owner_write_grant SET generation=1,token_hash=?,enabled=1').run(old);
    // Migration must not turn an old, unbounded bearer into a valid Shop writer.
    db.exec(read('staging-migrations/shop-owner-write/0004_owner_write_lease.sql'));
    assert.equal(db.prepare('SELECT expires_at_ms FROM shop_owner_write_grant').get().expires_at_ms,null);
    assert.equal(db.prepare(authorized).get(old).allowed,0);
    const deadline=Date.now()+60_000;
    assert.throws(()=>db.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=?').run(deadline),
      /grant|lease/i,'existing generation cannot be upgraded without a fresh session');
    db.prepare('UPDATE shop_owner_write_grant SET generation=2,token_hash=?,enabled=1,expires_at_ms=?')
      .run(current,deadline);
    assert.equal(db.prepare(authorized).get(current).allowed,1);
    assert.throws(()=>db.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=?').run(deadline+60_000),
      /grant|lease/i,'same generation must never extend its deadline');
    db.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=?').run(Date.now()-1000);
    assert.equal(db.prepare(authorized).get(current).allowed,0,
      'enabled grant and correct token are insufficient after expiry');
    db.prepare('UPDATE shop_owner_write_grant SET generation=3,token_hash=?,enabled=1,expires_at_ms=?')
      .run(rotated,Date.now()+60_000);
    assert.equal(db.prepare(authorized).get(rotated).allowed,1);
    db.prepare('UPDATE shop_owner_write_grant SET enabled=0').run();
    assert.equal(db.prepare(authorized).get(rotated).allowed,0);
  }finally{db.close();}
});
