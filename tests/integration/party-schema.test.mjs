import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const catalogSql=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const partySql=readFileSync(new URL('../../migrations/0002_party_identity.sql',import.meta.url),'utf8');
const fresh=()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(catalogSql);
  db.exec(partySql);
  return db;
};

const makeParty=(db,id,name,phone='01700000000') => db.prepare(`INSERT INTO parties (party_id,display_name,phone,party_kind,created_at) VALUES (?,?,?,'PERSON','2026-11-14T00:00:00.000Z')`).run(id,name,phone);
const makeRole=(db,id,role) => db.prepare(`INSERT INTO party_roles (party_id,role,status,created_at) VALUES (?,?,'ACTIVE','2026-11-14T00:00:00.000Z')`).run(id,role);
const insertLink=(db,partyId,group,legacyId,basis='ORIGINAL_RECORD',reviewer=null,reviewedAt=null) =>
  db.prepare(`INSERT INTO party_legacy_links (party_id,source_group,source_id,link_basis,reviewed_by,reviewed_at,created_at) VALUES (?,?,?,?,?,?,'2026-11-14T00:00:00.000Z')`).run(partyId,group,legacyId,basis,reviewer,reviewedAt);

test('creates all four identity-only tables without creating an unreviewed general ledger',()=>{
  const db=fresh();
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
  assert.deepEqual(tables,['parties','party_identity_review','party_legacy_links','party_roles','product_categories','product_units','settings']);
  db.close();
});

test('same phone and same name can belong to two different Parties, without auto-merge',()=>{
  const db=fresh();
  makeParty(db,'PT-A','Rahim Enterprise');
  makeParty(db,'PT-B','Rahim Enterprise');
  const parties=db.prepare('SELECT party_id FROM parties WHERE phone=? ORDER BY party_id').all('01700000000');
  assert.deepEqual(parties.map(p=>p.party_id),['PT-A','PT-B']);
  assert.throws(()=>makeParty(db,'PT-A','Different name'),/UNIQUE|PRIMARY KEY/);
  assert.throws(()=>makeParty(db,'PT-C',''),/CHECK/);
  db.close();
});

test('one Party may hold exactly the seven roles but no staff authorization role',()=>{
  const db=fresh();makeParty(db,'PT-A','Rahim Enterprise');
  for(const role of ['Customer','Supplier','Vendor','Owner','Lender','Borrower','Payee'])makeRole(db,'PT-A',role);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM party_roles WHERE party_id=?').get('PT-A').n,7);
  assert.throws(()=>makeRole(db,'PT-A','Administrator'),/CHECK/);
  assert.throws(()=>makeRole(db,'PT-A','Customer'),/UNIQUE/);
  assert.throws(()=>makeRole(db,'PT-NONEXISTENT','Customer'),/FOREIGN KEY/);
  db.prepare("UPDATE party_roles SET status='INACTIVE' WHERE party_id=? AND role='Supplier'").run('PT-A');
  assert.equal(db.prepare('SELECT status FROM party_roles WHERE party_id=? AND role=?').get('PT-A','Supplier').status,'INACTIVE');
  assert.throws(()=>db.prepare("DELETE FROM party_roles WHERE party_id='PT-A' AND role='Supplier'").run(),/historical|delete/i);
  db.close();
});

test('second original record to same Party requires documented human verification',()=>{
  const db=fresh();makeParty(db,'PT-A','Rahim Enterprise');makeParty(db,'PT-B','Another Enterprise');
  insertLink(db,'PT-A','CUSTOMERS','CUS-01');
  insertLink(db,'PT-B','SUPPLIERS','SUP-02');
  assert.throws(()=>insertLink(db,'PT-A','SUPPLIERS','SUP-01'),/review|verification/i);
  assert.throws(()=>insertLink(db,'PT-A','SUPPLIERS','SUP-01','HUMAN_VERIFIED'),/CHECK/);
  insertLink(db,'PT-A','SUPPLIERS','SUP-01','HUMAN_VERIFIED','operator-01','2026-11-14T00:10:00Z');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM party_legacy_links WHERE party_id=?').get('PT-A').n,2);
  assert.throws(()=>insertLink(db,'PT-B','SUPPLIERS','SUP-01','HUMAN_VERIFIED','reviewer-1','2026-11-14T00:10:00Z'),/UNIQUE/);
  makeParty(db,'PT-C','Third Entity');
  assert.throws(()=>insertLink(db,'PT-C','BAD_GROUP','X'),/CHECK/);
  db.close();
});

test('legacy mappings protect source identity, orphan Parties and historical references',()=>{
  const db=fresh();makeParty(db,'PT-A','Rahim');insertLink(db,'PT-A','FINANCE_PERSONS','F-001');
  assert.throws(()=>db.prepare("UPDATE party_legacy_links SET party_id='PT-B' WHERE source_group='FINANCE_PERSONS'").run(),/immutable|FOREIGN KEY/i);
  assert.throws(()=>db.prepare("UPDATE party_legacy_links SET source_id='F-002' WHERE source_group='FINANCE_PERSONS'").run(),/immutable/i);
  assert.throws(()=>db.prepare("DELETE FROM party_legacy_links WHERE source_group='FINANCE_PERSONS'").run(),/immutable|historical|delete/i);
  assert.throws(()=>db.prepare("DELETE FROM parties WHERE party_id='PT-A'").run(),/FOREIGN KEY/);
  db.close();
});

test('review queue can store ambiguous names and missing historical source IDs without making a link',()=>{
  const db=fresh();makeParty(db,'PT-A','Rahim Enterprise');
  db.prepare(`INSERT INTO party_identity_review (review_id,source_group,source_id,candidate_party_id,reason,status,created_at)
    VALUES ('REV-1','CUSTOMERS',NULL,'PT-A','MISSING_ID','OPEN','2026-11-14T00:00:00Z')`).run();
  assert.equal(db.prepare("SELECT status FROM party_identity_review WHERE review_id='REV-1'").get().status,'OPEN');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM party_legacy_links').get().n,0);
  assert.throws(()=>db.prepare(`INSERT INTO party_identity_review (review_id,source_group,reason,status) VALUES ('REV-2','CUSTOMERS','SHARED_PHONE','AUTO_APPROVED')`).run(),/CHECK/);
});
