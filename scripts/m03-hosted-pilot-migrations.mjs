#!/usr/bin/env node
/** Compose existing reviewed Control+Shop SQL into one NEW-account pilot
 * migration sequence. Never changes a database or ships generated IDs to Git.
 * The output directory is ignored; remote execution is a separate release gate.
 */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OWNER_READY_SHOP_MIGRATION_PLAN} from '../src/db/m03-owner-ready-shop-migrations.js';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const controlAuth=[
  '0001_platform_bootstrap.sql','0002_platform_sessions.sql',
  '0003_platform_first_mfa_activation.sql','0004_platform_browser_first_factor.sql'
].map(name=>['staging-migrations/platform-auth/'+name,name]);
const onboarding=[
  '0001_shop_reservations.sql','0002_shop_bindings.sql',
  '0003_owner_invitations.sql','0004_first_shop_owner.sql',
  '0005_owner_sessions.sql','0006_owner_login_challenges.sql',
  '0007_owner_gmail_approvals.sql','0008_owner_gmail_challenges.sql',
  '0011_control_center_provisioning.sql'
].map((name,index)=>['staging-migrations/platform-onboarding/'+name,
  String(index+5).padStart(4,'0')+'_hosted_'+name.slice(5)]);
export const HOSTED_CONTROL_MIGRATIONS=Object.freeze([...controlAuth,...onboarding]);

export const P2_SCHEMA_SNAPSHOT=`(
 SELECT json_group_array(json_array(type,name,tbl_name,sql)) FROM (
  SELECT type,name,tbl_name,sql FROM sqlite_schema
  WHERE name NOT GLOB 'sqlite_*' AND tbl_name<>'port_p2_shop_migrations'
  ORDER BY type,name
 )
)`;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validatePilot(input){
  if(!input||Object.keys(input).sort().join(',')!=='databaseId,databaseMarker,shopId'||
    ![input.databaseId,input.databaseMarker,input.shopId].every(v=>typeof v==='string'&&uuid.test(v))||
    new Set(Object.values(input)).size!==3)throw Error('INVALID_PILOT_IDENTITY');
  return input;
}

export async function composeHostedControlMigrations(root=ROOT){
  return Promise.all(HOSTED_CONTROL_MIGRATIONS.map(async ([source,name])=>({
    name,sql:await readFile(join(root,source),'utf8'),source
  })));
}
export async function composeHostedShopMigrations(pilot,root=ROOT){
  validatePilot(pilot);
  return Promise.all(OWNER_READY_SHOP_MIGRATION_PLAN.map(async ({name,checksum},index)=>{
    const body=await readFile(join(root,name),'utf8');
    if(createHash('sha256').update(body).digest('hex')!==checksum)
      throw Error('REVIEWED_SHOP_SQL_CHECKSUM_MISMATCH');
    const position=index+1;
    const sql=[
      '-- Reviewed original SQL: '+name,
      ...(index===0?[`CREATE TABLE port_p2_shop_migrations (
 position INTEGER PRIMARY KEY CHECK(position>0),
 name TEXT NOT NULL UNIQUE,
 checksum TEXT NOT NULL CHECK(length(checksum)=64),
 schema_snapshot TEXT NOT NULL
) STRICT;`]:[]),
      `INSERT INTO port_p2_shop_migrations(position,name,checksum,schema_snapshot)
 VALUES (${position},'${name}','${checksum}',${index===0?"''":`CASE WHEN
 (SELECT schema_snapshot FROM port_p2_shop_migrations WHERE position=${index})=${P2_SCHEMA_SNAPSHOT}
 THEN '' END`});`,
      body,
      ...(index===0?[`INSERT INTO shop_identity(singleton,shop_id,database_id,database_marker)
 VALUES (1,'${pilot.shopId}','${pilot.databaseId}','${pilot.databaseMarker}');`]:[]),
      `UPDATE port_p2_shop_migrations SET schema_snapshot=${P2_SCHEMA_SNAPSHOT}
 WHERE position=${position};`
    ].join('\n');
    return {name:String(position).padStart(4,'0')+'_hosted_shop.sql',sql,source:name,checksum};
  }));
}

export async function generateHostedPilotMigrations(pilot,dir,root=ROOT){
  const resolved=resolve(dir);
  if(!resolved.startsWith(resolve(root,'.wrangler')+'/'))throw Error('PRIVATE_DIRECTORY_REQUIRED');
  const control=await composeHostedControlMigrations(root);
  const shop=await composeHostedShopMigrations(pilot,root);
  for(const [folder,migrations] of [['control',control],['shop',shop]]){
    const path=join(resolved,folder);
    await mkdir(path,{recursive:true,mode:0o700});
    for(const migration of migrations){
      const file=join(path,migration.name);
      try{await writeFile(file,migration.sql,{flag:'wx',mode:0o600});}
      catch(error){
        if(error.code!=='EEXIST'||await readFile(file,'utf8')!==migration.sql)
          throw Error('REVIEWED_MIGRATION_OUTPUT_CONFLICT');
      }
    }
  }
  return {control:control.map(({name})=>name),shop:shop.map(({name})=>name)};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [command,input,path]=process.argv.slice(2);
  if(command!=='--generate'||!input||!path)throw Error('Usage: --generate <private-pilot.json> <.wrangler/output-dir>');
  const identity=validatePilot(JSON.parse(await readFile(resolve(input),'utf8')));
  const result=await generateHostedPilotMigrations(identity,path);
  console.log('Prepared '+result.control.length+' Control + '+result.shop.length+
    ' Shop migrations from reviewed source; NO Cloudflare writes');
}
