/**
 * M10 Run 5 — fully fabricated, local SQLite relationship recovery.
 * Does NOT implement original ERP tables, perform historical import or access D1.
 */
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const BAD='M10 synthetic link recovery rejected';
const inventory=JSON.parse(readFileSync(
  new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const groups=[
  ['SUPPLIERS','SUP-000001'],
  ['PURCHASES','PUR-000001'],
  ['STOCK_LOTS','LOT-000001'],
  ['CUSTOMERS','CUS-000001'],
  ['SALES','SAL-000001'],
  ['SALE_ITEMS','SIT-000001'],
  ['PRODUCTS','PRD-000001'],
  ['SALE_ITEM_LOTS','SLT-000001'],
  ['SALES_RETURN_ITEMS','SRI-000001']
];
const configured=new Set(inventory.tables.map(item=>item.sheetKey));
if(groups.some(([group])=>!configured.has(group)))throw new Error(BAD);
const idByGroup=new Map(groups);
const shops=['SHOP-ALPHA','SHOP-BETA'];
const edgesByGroup=[
  ['PURCHASES','supplier','SUPPLIERS'],
  ['STOCK_LOTS','purchase','PURCHASES'],
  ['SALES','customer','CUSTOMERS'],
  ['SALE_ITEMS','sale','SALES'],
  ['SALE_ITEMS','product','PRODUCTS'],
  ['SALE_ITEM_LOTS','sale_item','SALE_ITEMS'],
  ['SALE_ITEM_LOTS','lot','STOCK_LOTS'],
  ['SALES_RETURN_ITEMS','original_sale_item','SALE_ITEMS']
];
const expectedNodes=shops.flatMap(shop=>groups.map(([sourceGroup,legacyId])=>({
  shop,sourceGroup,legacyId,retired:0
})));
const expectedEdges=shops.flatMap(shop=>edgesByGroup.map(
  ([childGroup,relation,parentGroup])=>({
    childShop:shop,childGroup,childId:idByGroup.get(childGroup),relation,
    parentShop:shop,parentGroup,parentId:idByGroup.get(parentGroup)
  })
));
const faults=new Set([null,'restore-orphan-parent','restore-orphan-child',
  'restore-parent-id-drift','restore-wrong-parent','restore-cross-shop',
  'restore-retired-parent','backup-wrong-parent','restore-fk-off',
  'restore-fk-removed']);
const DDL=`
CREATE TABLE IF NOT EXISTS m10_ref_nodes(
  shop_id TEXT NOT NULL, source_group TEXT NOT NULL, legacy_id TEXT NOT NULL,
  retired INTEGER NOT NULL CHECK(retired IN (0,1)),
  PRIMARY KEY(shop_id,source_group,legacy_id)
);
CREATE TABLE IF NOT EXISTS m10_ref_links(
  child_shop TEXT NOT NULL, child_group TEXT NOT NULL,
  child_id TEXT NOT NULL, relation TEXT NOT NULL,
  parent_shop TEXT NOT NULL, parent_group TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  CHECK(child_shop=parent_shop),
  PRIMARY KEY(child_shop,child_group,child_id,relation),
  FOREIGN KEY(child_shop,child_group,child_id)
    REFERENCES m10_ref_nodes(shop_id,source_group,legacy_id),
  FOREIGN KEY(parent_shop,parent_group,parent_id)
    REFERENCES m10_ref_nodes(shop_id,source_group,legacy_id)
)`;
function database(path){
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(DDL);
  return db;
}
function nodeRows(db){
  return db.prepare(`SELECT shop_id AS shop,source_group AS sourceGroup,
    legacy_id AS legacyId,retired FROM m10_ref_nodes
    ORDER BY shop_id,source_group,legacy_id`).all();
}
function edgeRows(db){
  return db.prepare(`SELECT child_shop AS childShop,child_group AS childGroup,
    child_id AS childId,relation,parent_shop AS parentShop,
    parent_group AS parentGroup,parent_id AS parentId FROM m10_ref_links
    ORDER BY child_shop,child_group,child_id,relation`).all();
}
function insertSource(db){
  const node=db.prepare(`INSERT INTO m10_ref_nodes
    (shop_id,source_group,legacy_id,retired) VALUES(?,?,?,?)`);
  const link=db.prepare(`INSERT INTO m10_ref_links
    (child_shop,child_group,child_id,relation,parent_shop,parent_group,parent_id)
    VALUES(?,?,?,?,?,?,?)`);
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const n of expectedNodes)
      node.run(n.shop,n.sourceGroup,n.legacyId,n.retired);
    for(const e of expectedEdges)
      link.run(e.childShop,e.childGroup,e.childId,e.relation,
        e.parentShop,e.parentGroup,e.parentId);
    db.exec('COMMIT');
  }catch{
    db.exec('ROLLBACK');
    throw new Error(BAD);
  }
}
function structure(db){
  return JSON.stringify({
    schema:db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all(),
    links:db.prepare('PRAGMA foreign_key_list(m10_ref_links)').all()
  });
}
const nodeKey=n=>JSON.stringify([n.shop,n.sourceGroup,n.legacyId]);
const edgeKey=e=>JSON.stringify([e.childShop,e.childGroup,e.childId,e.relation]);
function inspect(db,stage,expectedSchema,add){
  const nodes=nodeRows(db),edges=edgeRows(db);
  const actualNodes=new Map(nodes.map(n=>[nodeKey(n),n]));
  const originalNodes=new Map(expectedNodes.map(n=>[nodeKey(n),n]));
  const actualEdges=new Map(edges.map(e=>[edgeKey(e),e]));
  const originalEdges=new Map(expectedEdges.map(e=>[edgeKey(e),e]));
  for(const [key,n] of originalNodes){
    const got=actualNodes.get(key);
    if(!got)add(stage+'_NODE_MISSING');
    else if(got.retired!==n.retired)add(stage+'_NODE_DRIFT');
  }
  for(const key of actualNodes.keys())
    if(!originalNodes.has(key))add(stage+'_NODE_UNEXPECTED');
  for(const [key,edge] of originalEdges){
    const got=actualEdges.get(key);
    if(!got)add(stage+'_EDGE_MISSING');
    else if(JSON.stringify(got)!==JSON.stringify(edge))
      add(stage+'_REFERENCE_DRIFT');
  }
  for(const key of actualEdges.keys())
    if(!originalEdges.has(key))add(stage+'_EDGE_UNEXPECTED');
  for(const edge of edges){
    const child=actualNodes.get(nodeKey({
      shop:edge.childShop,sourceGroup:edge.childGroup,legacyId:edge.childId
    }));
    const parent=actualNodes.get(nodeKey({
      shop:edge.parentShop,sourceGroup:edge.parentGroup,legacyId:edge.parentId
    }));
    if(!child)add(stage+'_ORPHAN_CHILD');
    if(!parent)add(stage+'_ORPHAN_PARENT');
    else if(parent.retired===1)add(stage+'_RETIRED_PARENT');
    if(edge.childShop!==edge.parentShop)add(stage+'_CROSS_SHOP_EDGE');
  }
  if(structure(db)!==expectedSchema)add(stage+'_FK_SCHEMA_MISMATCH');
  if(db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1)
    add(stage+'_FK_ENFORCEMENT_OFF');
  const integrity=db.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||integrity[0].integrity_check!=='ok')
    add(stage+'_INTEGRITY_FAILURE');
  if(db.prepare('PRAGMA foreign_key_check').all().length)
    add(stage+'_FOREIGN_KEY_VIOLATION');

  // Test enforcement by trying to insert an invalid parent reference.
  // SAVEPOINT rollback is unconditional, even when enforcement is absent.
  db.exec('SAVEPOINT m10_ref_probe');
  try{
    let rejected=false;
    try{
      db.prepare(`INSERT INTO m10_ref_links
        (child_shop,child_group,child_id,relation,parent_shop,parent_group,parent_id)
        VALUES(?,?,?,?,?,?,?)`).run(
        shops[0],'PURCHASES',idByGroup.get('PURCHASES'),
        'm10-foreign-key-probe',shops[0],'SUPPLIERS','SUP-NONEXISTENT');
    }catch{rejected=true;}
    if(!rejected)add(stage+'_FK_PROBE_NOT_ENFORCED');
  }finally{
    db.exec('ROLLBACK TO SAVEPOINT m10_ref_probe');
    db.exec('RELEASE SAVEPOINT m10_ref_probe');
  }
}
function withoutForeignKeys(db,work){
  db.exec('PRAGMA foreign_keys=OFF');
  try{work();}finally{db.exec('PRAGMA foreign_keys=ON');}
}
function wrongExistingParent(db){
  db.prepare(`UPDATE m10_ref_links SET parent_group=?,parent_id=?
    WHERE child_shop=? AND child_group=? AND relation=?`)
    .run('PURCHASES',idByGroup.get('PURCHASES'),
      shops[0],'SALE_ITEMS','sale');
}
function mutate(db,fault){
  switch(fault){
    case 'backup-wrong-parent':case 'restore-wrong-parent':
      wrongExistingParent(db);break;
    case 'restore-orphan-parent':
      withoutForeignKeys(db,()=>db.prepare(`UPDATE m10_ref_links
        SET parent_id=? WHERE child_shop=? AND child_group=? AND relation=?`)
        .run('SUP-MISSING',shops[0],'PURCHASES','supplier'));break;
    case 'restore-orphan-child':
      withoutForeignKeys(db,()=>db.prepare(`DELETE FROM m10_ref_nodes
        WHERE shop_id=? AND source_group=?`).run(shops[0],'SALE_ITEMS'));break;
    case 'restore-parent-id-drift':
      withoutForeignKeys(db,()=>db.prepare(`UPDATE m10_ref_nodes
        SET legacy_id=? WHERE shop_id=? AND source_group=?`)
        .run('SUP-DRIFT',shops[0],'SUPPLIERS'));break;
    case 'restore-cross-shop':
      db.exec('PRAGMA ignore_check_constraints=ON');
      try{
        db.prepare(`UPDATE m10_ref_links SET parent_shop=?
          WHERE child_shop=? AND child_group=? AND relation=?`)
          .run(shops[1],shops[0],'PURCHASES','supplier');
      }finally{db.exec('PRAGMA ignore_check_constraints=OFF');}
      break;
    case 'restore-retired-parent':
      db.prepare(`UPDATE m10_ref_nodes SET retired=1
        WHERE shop_id=? AND source_group=?`).run(shops[0],'SUPPLIERS');
      break;
    case 'restore-fk-off':
      db.exec('PRAGMA foreign_keys=OFF');break;
    case 'restore-fk-removed':
      withoutForeignKeys(db,()=>{
        db.exec(`BEGIN IMMEDIATE;
          ALTER TABLE m10_ref_links RENAME TO m10_ref_links_old;
          CREATE TABLE m10_ref_links(
            child_shop TEXT NOT NULL, child_group TEXT NOT NULL,
            child_id TEXT NOT NULL, relation TEXT NOT NULL,
            parent_shop TEXT NOT NULL, parent_group TEXT NOT NULL,
            parent_id TEXT NOT NULL,
            CHECK(child_shop=parent_shop),
            PRIMARY KEY(child_shop,child_group,child_id,relation));
          INSERT INTO m10_ref_links SELECT * FROM m10_ref_links_old;
          DROP TABLE m10_ref_links_old;
          COMMIT;`);
      });break;
    default:throw new Error(BAD);
  }
}
/** Run ONLY isolated synthetic SQLite; never touches genuine source or D1. */
export async function runM10SyntheticLinkRestore({fault=null}={}){
  if(!faults.has(fault))throw new Error(BAD);
  let dir,db;
  try{
    const issues=new Map();
    const add=code=>issues.set(code,(issues.get(code)||0)+1);
    dir=await mkdtemp(join(tmpdir(),'m10-synthetic-reference-'));
    db=database(':memory:');
    const expectedSchema=structure(db);
    insertSource(db);
    inspect(db,'SOURCE',expectedSchema,add);
    const backupPath=join(dir,'backup.sqlite');
    await backup(db,backupPath);
    db.close();db=null;
    const saved=database(backupPath);
    try{
      if(fault==='backup-wrong-parent')mutate(saved,fault);
      inspect(saved,'BACKUP',expectedSchema,add);
    }finally{saved.close();}
    const restorePath=join(dir,'restored.sqlite');
    await copyFile(backupPath,restorePath);
    const restored=database(restorePath);
    try{
      if(fault?.startsWith('restore-'))mutate(restored,fault);
      inspect(restored,'RESTORE',expectedSchema,add);
    }finally{restored.close();}
    const ordered=[...issues].sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_LOCAL_SYNTHETIC_REFERENCE_RESTORE',
      groupsExercised:groups.length,shopsExercised:shops.length,
      nodesExpected:expectedNodes.length,edgesExpected:expectedEdges.length,
      candidateSyntheticReferenceRestore:ordered.length===0,
      authorizesRealImport:false,authorizesRemoteD1Write:false,
      authorizesCutover:false,productionReady:false,issues:ordered,
      limitations:'Synthetic reference graph is not historical source, operational D1 schema, accounting reconciliation, authenticated backup custody or production approval'
    };
  }catch{
    throw new Error(BAD);
  }finally{
    try{db?.close();}catch{}
    if(dir)await rm(dir,{recursive:true,force:true});
  }
}
