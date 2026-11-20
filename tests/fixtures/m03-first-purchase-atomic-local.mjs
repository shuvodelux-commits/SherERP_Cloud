/**
 * M03 FIRST PURCHASE — TEST-ONLY Workerd/D1 integration harness.
 *
 * This fixture is not imported by src/index.js, Worker, production migrations,
 * RPC, private Control Center or the application financial posting boundary.
 * SQL tables below are disposable. Tests prove an end-to-end model only.
 */
import {createHash} from 'node:crypto';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {allocateInvoicePaisa} from '../../src/modules/m08-exact-decimal-proposal.js';
// Frozen M04 session-idle policy; no password verifier needed in this probe.
const SESSION_IDLE_MS=30*60*1000;

const ID=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/u;
const MINOR=/^(?:0|[1-9][0-9]{0,8})$/u;
const MAX_TEST_PAISA=100000000n;
const error=()=>new Error('Denied: synthetic first purchase refused');
const integerMinor=value=>{
  if(typeof value!=='string'||!MINOR.test(value))
    throw new TypeError('Canonical test-only paisa required');
  const n=BigInt(value);
  if(n>MAX_TEST_PAISA)throw new RangeError('Synthetic test money bound exceeded');
  return Number(n);
};
const id=value=>{
  if(typeof value!=='string'||!ID.test(value))throw new TypeError('Invalid synthetic immutable ID');
  return value;
};
function canonical(value){
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||value.length>100||
        Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).some(x=>!x))
      throw new TypeError('Invalid dense canonical array');
    return value.map(canonical);
  }
  if(value&&typeof value==='object'){
    if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))
      throw new TypeError('Invalid canonical data record');
    const keys=Reflect.ownKeys(value).sort();
    return Object.fromEntries(keys.map(key=>{
      const desc=Object.getOwnPropertyDescriptor(value,key);
      if(typeof key!=='string'||!desc.enumerable||!Object.hasOwn(desc,'value'))
        throw new TypeError('Invalid canonical data record');
      return [key,canonical(desc.value)];
    }));
  }
  if(value===undefined||typeof value==='function'||typeof value==='symbol'||
      typeof value==='bigint'||(typeof value==='number'&&!Number.isSafeInteger(value)))
    throw new TypeError('Invalid canonical JSON intent');
  return value;
}
const fingerprint=x=>createHash('sha256')
  .update(JSON.stringify(canonical(x))).digest('hex');
const run=(DB,sql,...bind)=>DB.prepare(sql).bind(...bind).run();
const first=(DB,sql,...bind)=>DB.prepare(sql).bind(...bind).first();
const all=async(DB,sql,...bind)=>(await DB.prepare(sql).bind(...bind).all()).results.map(x=>({...x}));

const DROP=[
 'm03_fp_seal','m03_fp_money_book','m03_fp_supplier_ledger',
 'm03_fp_payment','m03_fp_lot','m03_fp_line','m03_fp_purchase',
 'm03_fp_stock','m03_fp_bank','m03_fp_cash_session','m03_fp_supplier',
 'm03_fp_party','m03_fp_member','m03_fp_shop','m03_fp_fault'
];
const DDL=[
 `CREATE TABLE m03_fp_shop(shop_id TEXT PRIMARY KEY, cash_required INTEGER NOT NULL
    CHECK(cash_required=1)) STRICT`,
 `CREATE TABLE m03_fp_member(
    shop_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL
      CHECK(status IN ('Active','Inactive')),
    PRIMARY KEY(shop_id,user_id),
    FOREIGN KEY(shop_id) REFERENCES m03_fp_shop(shop_id)) STRICT`,
 `CREATE TABLE m03_fp_party(
    shop_id TEXT NOT NULL,party_id TEXT NOT NULL,status TEXT NOT NULL
      CHECK(status IN ('Active','Inactive')),
    PRIMARY KEY(shop_id,party_id),
    FOREIGN KEY(shop_id) REFERENCES m03_fp_shop(shop_id)) STRICT`,
 `CREATE TABLE m03_fp_supplier(
    shop_id TEXT NOT NULL,supplier_id TEXT NOT NULL,party_id TEXT NOT NULL,
    source_group TEXT NOT NULL CHECK(source_group='SUPPLIERS'),
    link_basis TEXT NOT NULL CHECK(link_basis='NEW_RECORD'),
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    PRIMARY KEY(shop_id,supplier_id),
    FOREIGN KEY(shop_id,party_id) REFERENCES m03_fp_party(shop_id,party_id)) STRICT`,
 `CREATE TABLE m03_fp_cash_session(
    shop_id TEXT NOT NULL,session_id TEXT NOT NULL,status TEXT NOT NULL
      CHECK(status IN ('Open','Closed')),
    PRIMARY KEY(shop_id,session_id),
    FOREIGN KEY(shop_id) REFERENCES m03_fp_shop(shop_id)) STRICT`,
 `CREATE TABLE m03_fp_bank(
    shop_id TEXT NOT NULL,account_id TEXT NOT NULL,status TEXT NOT NULL
      CHECK(status IN ('Active','Inactive')),
    PRIMARY KEY(shop_id,account_id),
    FOREIGN KEY(shop_id) REFERENCES m03_fp_shop(shop_id)) STRICT`,
 `CREATE TABLE m03_fp_stock(
    shop_id TEXT NOT NULL,product_id TEXT NOT NULL,
    unit_revision TEXT NOT NULL,price_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 0 AND 1000000),
    PRIMARY KEY(shop_id,product_id),
    FOREIGN KEY(shop_id) REFERENCES m03_fp_shop(shop_id)) STRICT`,
 `CREATE TABLE m03_fp_purchase(
    shop_id TEXT NOT NULL,purchase_id TEXT NOT NULL,operation_id TEXT NOT NULL,
    intent_hash TEXT NOT NULL,actor_id TEXT NOT NULL,cash_session_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,party_id TEXT NOT NULL,
    grand_paisa INTEGER NOT NULL CHECK(grand_paisa BETWEEN 0 AND 100000000),
    paid_paisa INTEGER NOT NULL CHECK(paid_paisa BETWEEN 0 AND 100000000),
    due_paisa INTEGER NOT NULL CHECK(due_paisa BETWEEN 0 AND 100000000),
    expected_lines INTEGER NOT NULL CHECK(expected_lines BETWEEN 1 AND 100),
    expected_payments INTEGER NOT NULL CHECK(expected_payments BETWEEN 0 AND 10),
    PRIMARY KEY(shop_id,purchase_id),UNIQUE(shop_id,operation_id),
    FOREIGN KEY(shop_id,supplier_id) REFERENCES m03_fp_supplier(shop_id,supplier_id),
    FOREIGN KEY(shop_id,party_id) REFERENCES m03_fp_party(shop_id,party_id),
    FOREIGN KEY(shop_id,cash_session_id)
      REFERENCES m03_fp_cash_session(shop_id,session_id),
    CHECK(grand_paisa=paid_paisa+due_paisa)) STRICT`,
 `CREATE TABLE m03_fp_line(
    shop_id TEXT NOT NULL,purchase_id TEXT NOT NULL,line_id TEXT NOT NULL,
    product_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
    price_text TEXT NOT NULL,unit_revision TEXT NOT NULL,
    allocated_paisa INTEGER NOT NULL CHECK(allocated_paisa BETWEEN 0 AND 100000000),
    PRIMARY KEY(shop_id,purchase_id,line_id),
    FOREIGN KEY(shop_id,purchase_id)
      REFERENCES m03_fp_purchase(shop_id,purchase_id),
    FOREIGN KEY(shop_id,product_id)
      REFERENCES m03_fp_stock(shop_id,product_id)) STRICT`,
 `CREATE TABLE m03_fp_lot(
    shop_id TEXT NOT NULL,purchase_id TEXT NOT NULL,line_id TEXT NOT NULL,
    product_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),
    allocated_cost_paisa INTEGER NOT NULL CHECK(allocated_cost_paisa BETWEEN 0 AND 100000000),
    PRIMARY KEY(shop_id,purchase_id,line_id),
    FOREIGN KEY(shop_id,purchase_id,line_id)
      REFERENCES m03_fp_line(shop_id,purchase_id,line_id)) STRICT`,
 `CREATE TABLE m03_fp_payment(
    shop_id TEXT NOT NULL,purchase_id TEXT NOT NULL,leg_id TEXT NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('Cash','Bank')),
    bank_account_id TEXT,
    applied_paisa INTEGER NOT NULL CHECK(applied_paisa BETWEEN 1 AND 100000000),
    PRIMARY KEY(shop_id,purchase_id,leg_id),
    FOREIGN KEY(shop_id,purchase_id)
      REFERENCES m03_fp_purchase(shop_id,purchase_id),
    FOREIGN KEY(shop_id,bank_account_id)
      REFERENCES m03_fp_bank(shop_id,account_id),
    CHECK((method='Cash' AND bank_account_id IS NULL)
       OR (method='Bank' AND bank_account_id IS NOT NULL))) STRICT`,
 `CREATE TABLE m03_fp_money_book(
    shop_id TEXT NOT NULL,purchase_id TEXT NOT NULL,leg_id TEXT NOT NULL,
    method TEXT NOT NULL,amount_paisa INTEGER NOT NULL CHECK(amount_paisa>0),
    PRIMARY KEY(shop_id,purchase_id,leg_id),
    FOREIGN KEY(shop_id,purchase_id,leg_id)
      REFERENCES m03_fp_payment(shop_id,purchase_id,leg_id)) STRICT`,
 `CREATE TABLE m03_fp_supplier_ledger(
    shop_id TEXT NOT NULL,purchase_id TEXT NOT NULL,entry_type TEXT NOT NULL
      CHECK(entry_type IN ('Purchase','Payment')),
    leg_id TEXT NOT NULL,
    debit_paisa INTEGER NOT NULL CHECK(debit_paisa>=0),
    credit_paisa INTEGER NOT NULL CHECK(credit_paisa>=0),
    PRIMARY KEY(shop_id,purchase_id,entry_type,leg_id),
    FOREIGN KEY(shop_id,purchase_id)
      REFERENCES m03_fp_purchase(shop_id,purchase_id),
    CHECK((entry_type='Purchase' AND debit_paisa>0 AND credit_paisa=0)
       OR (entry_type='Payment' AND debit_paisa=0 AND credit_paisa>0))) STRICT`,
 `CREATE TABLE m03_fp_seal(
    shop_id TEXT NOT NULL,purchase_id TEXT NOT NULL,
    line_count INTEGER NOT NULL,payment_count INTEGER NOT NULL,
    PRIMARY KEY(shop_id,purchase_id),
    FOREIGN KEY(shop_id,purchase_id)
      REFERENCES m03_fp_purchase(shop_id,purchase_id)) STRICT`,
 `CREATE TABLE m03_fp_fault(value INTEGER PRIMARY KEY CHECK(value=0)) STRICT`,
 `CREATE TRIGGER m03_fp_seal_guard BEFORE INSERT ON m03_fp_seal BEGIN
    SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM m03_fp_purchase p
      JOIN m03_fp_cash_session cs ON cs.shop_id=p.shop_id
        AND cs.session_id=p.cash_session_id AND cs.status='Open'
      WHERE p.shop_id=NEW.shop_id AND p.purchase_id=NEW.purchase_id
    ) OR
    (SELECT COUNT(*) FROM m03_fp_line
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)<>NEW.line_count
    OR (SELECT COUNT(*) FROM m03_fp_lot
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)<>NEW.line_count
    OR (SELECT COUNT(*) FROM m03_fp_payment
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)<>NEW.payment_count
    OR (SELECT COUNT(*) FROM m03_fp_money_book
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)<>NEW.payment_count
    OR (SELECT COALESCE(SUM(allocated_paisa),0) FROM m03_fp_line
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
         <>(SELECT grand_paisa FROM m03_fp_purchase
           WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
    OR (SELECT COALESCE(SUM(allocated_cost_paisa),0) FROM m03_fp_lot
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
         <>(SELECT grand_paisa FROM m03_fp_purchase
           WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
    OR (SELECT COALESCE(SUM(applied_paisa),0) FROM m03_fp_payment
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
         <>(SELECT paid_paisa FROM m03_fp_purchase
           WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
    OR (SELECT COALESCE(SUM(amount_paisa),0) FROM m03_fp_money_book
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
         <>(SELECT paid_paisa FROM m03_fp_purchase
           WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
    OR (SELECT COALESCE(SUM(debit_paisa),0) FROM m03_fp_supplier_ledger
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
         <>(SELECT grand_paisa FROM m03_fp_purchase
           WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
    OR (SELECT COALESCE(SUM(credit_paisa),0) FROM m03_fp_supplier_ledger
       WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
         <>(SELECT paid_paisa FROM m03_fp_purchase
           WHERE shop_id=NEW.shop_id AND purchase_id=NEW.purchase_id)
      THEN RAISE(ABORT,'M03_FIRST_PURCHASE_NOT_BALANCED') END;
  END`
];

export async function createPurchaseTestSchema(DB){
  for(const table of DROP)await DB.prepare('DROP TABLE IF EXISTS '+table).run();
  for(const ddl of DDL)await DB.prepare(ddl).run();
  for(const table of [
    'm03_fp_purchase','m03_fp_line','m03_fp_lot','m03_fp_payment',
    'm03_fp_money_book','m03_fp_supplier_ledger','m03_fp_seal'
  ]){
    for(const op of ['UPDATE','DELETE']){
      await DB.prepare(`CREATE TRIGGER ${table}_immutable_${op.toLowerCase()}
        BEFORE ${op} ON ${table}
        BEGIN SELECT RAISE(ABORT,'M03_PURCHASE_IMMUTABLE'); END`).run();
    }
    if(table!=='m03_fp_purchase'&&table!=='m03_fp_seal')
      await DB.prepare(`CREATE TRIGGER ${table}_no_late_insert
        BEFORE INSERT ON ${table} WHEN EXISTS(
          SELECT 1 FROM m03_fp_seal seal
          WHERE seal.shop_id=NEW.shop_id AND seal.purchase_id=NEW.purchase_id
        ) BEGIN SELECT RAISE(ABORT,'M03_PURCHASE_ALREADY_SEALED'); END`).run();
  }
}

export async function seedPurchaseTestShop(DB,options){
  const {shopId,serial,now,userRole,cashStatus,supplierStatus,partyStatus}=options;
  id(shopId);
  const userId='USR-FIRST-'+serial;
  const token=serial.toString(16).padStart(64,'0');
  const tokenHash=await hashOpaqueSessionToken(token);
  const roleVersion=userRole==='Administrator'?null:
    (await first(DB,'SELECT auth_version FROM auth_roles WHERE role_name=?',userRole))?.auth_version;
  if(userRole!=='Administrator'&&!roleVersion)throw new Error('Test role absent');
  await run(DB,`INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,
    password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,'Active',?,?,210000)`,
    userId,'Fixture Actor '+serial,'017'+String(serial).padStart(8,'0'),
    userRole,'a'.repeat(64),'b'.repeat(48));
  await run(DB,`INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,
    role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms)
    VALUES (?,?,1,?,1,?,?,?)`,
    tokenHash,userId,roleVersion,now-1000,now-100,now+3600000);
  await run(DB,'INSERT INTO m03_fp_shop VALUES (?,1)',shopId);
  await run(DB,"INSERT INTO m03_fp_member VALUES (?,?,'Active')",shopId,userId);
  await run(DB,'INSERT INTO m03_fp_party VALUES (?,?,?)',
    shopId,'PARTY-1',partyStatus);
  await run(DB,"INSERT INTO m03_fp_supplier VALUES (?,?,?,'SUPPLIERS','NEW_RECORD',?)",
    shopId,'SUP-000001','PARTY-1',supplierStatus);
  const cashSessionId='CASH-OPEN';
  await run(DB,'INSERT INTO m03_fp_cash_session VALUES (?,?,?)',
    shopId,cashSessionId,cashStatus);
  await run(DB,"INSERT INTO m03_fp_bank VALUES (?,'BANK-A','Active')",shopId);
  for(const product of ['A','B']){
    await run(DB,`INSERT INTO m03_fp_stock VALUES (?,?,'REV-1','0.335','Active',10)`,
      shopId,product);
  }
  return {shopId,token,tokenHash,userRole,cashSessionId};
}

/** Actual M04 auth_sessions/users/roles schema, plus local test-only Shop membership. */
const CURRENT_AUTH=`SELECT u.user_id FROM auth_sessions AS ses
 JOIN auth_users AS u ON u.user_id=ses.user_id
 LEFT JOIN auth_roles AS role ON role.role_name=u.role_name
 JOIN m03_fp_member AS member ON member.user_id=u.user_id
   AND member.shop_id=? AND member.status='Active'
 JOIN m03_fp_cash_session AS cash ON cash.shop_id=member.shop_id
   AND cash.session_id=? AND cash.status='Open'
 WHERE ses.token_hash=? AND ses.revoked_at_ms IS NULL
   AND ses.created_at_ms<=? AND ses.expires_at_ms>?
   AND ses.last_activity_at_ms>? AND ses.last_activity_at_ms<=?
   AND u.status='Active' AND u.credential_state='Modern'
   AND u.auth_version=ses.user_auth_version
   AND u.credential_version=ses.credential_version
   AND (
     (u.role_name='Administrator' AND ses.role_auth_version IS NULL)
     OR (role.status='Active' AND role.auth_version=ses.role_auth_version
       AND CASE WHEN json_valid(role.permissions_json)
         THEN json_type(role.permissions_json,'$.pos.add') END='true')
   )`;
const authorized=async(DB,shopId,cashSessionId,tokenHash,now)=>
  first(DB,CURRENT_AUTH+' LIMIT 1',shopId,cashSessionId,tokenHash,
    now,now,now-SESSION_IDLE_MS,now);

/** INSERT...SELECT rechecks M04 authorization and M02 same-Shop Party at SQL execution time. */
const INSERT_HEADER=`INSERT INTO m03_fp_purchase
  (shop_id,purchase_id,operation_id,intent_hash,actor_id,cash_session_id,
   supplier_id,party_id,grand_paisa,paid_paisa,due_paisa,expected_lines,expected_payments)
  SELECT ?,?,?,?,auth.user_id,?,supplier.supplier_id,supplier.party_id,
    ?,?,?,?,?
  FROM (${CURRENT_AUTH}) AS auth
  JOIN m03_fp_supplier AS supplier ON supplier.shop_id=?
    AND supplier.supplier_id=? AND supplier.status='Active'
    AND supplier.source_group='SUPPLIERS' AND supplier.link_basis='NEW_RECORD'
  JOIN m03_fp_party AS party ON party.shop_id=supplier.shop_id
    AND party.party_id=supplier.party_id AND party.status='Active'`;

async function existing(DB,shopId,opId){
  return first(DB,'SELECT * FROM m03_fp_purchase WHERE shop_id=? AND operation_id=?',
    shopId,opId);
}
function validate(raw){
  canonical(raw);
  const expected=['shopId','token','operationId','purchaseId','supplierId',
    'cashSessionId','roundingMode','lines','payments'];
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    Reflect.ownKeys(raw).length!==expected.length||
    Reflect.ownKeys(raw).some(k=>!expected.includes(k)))
    throw new TypeError('Exact local test purchase intent required');
  for(const key of ['shopId','operationId','purchaseId','supplierId','cashSessionId'])
    id(raw[key]);
  if(typeof raw.token!=='string'||!/^[a-f0-9]{64}$/.test(raw.token)||
      raw.roundingMode!=='HALF_UP'||!Array.isArray(raw.lines)||
      raw.lines.length<1||raw.lines.length>100||
      !Array.isArray(raw.payments)||raw.payments.length>10)
    throw new TypeError('Invalid local test Shop, token or source financial intent');
  for(const x of raw.lines){
    if(!x||typeof x!=='object'||Object.keys(x).sort().join(',')!==
      'id,quantity,unitPrice,unitRevision')throw new TypeError('Bad source line');
    id(x.id);id(x.unitRevision);
    if(!/^(?:[1-9][0-9]{0,3})$/.test(x.quantity))
      throw new TypeError('Only exact integer Pcs supported in this local proof');
  }
  for(const x of raw.payments){
    if(!x||typeof x!=='object')throw new TypeError('Bad synthetic payment');
    id(x.id);
    if(!['Cash','Bank'].includes(x.method))throw new TypeError('Unsupported payment');
    if((x.method==='Cash'&&Object.hasOwn(x,'bankAccountId'))||
       (x.method==='Bank'&&(!Object.hasOwn(x,'bankAccountId')||
           !ID.test(x.bankAccountId))))
      throw new TypeError('Invalid synthetic Bank/Cash account');
    integerMinor(x.amountPaisa);
    if(x.amountPaisa==='0')throw new TypeError('Zero-value payment leg unsupported');
  }
  return raw;
}

export async function submitLocalFirstPurchase(DB,raw,{now,injectLateFailure=false,beforeBatch}={}){
  const data=validate(raw);
  if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Trusted test time required');
  const tokenHash=await hashOpaqueSessionToken(data.token);
  if(!tokenHash)throw error();
  const quote=allocateInvoicePaisa({
    lines:data.lines.map(x=>({id:x.id,quantity:x.quantity,unitPrice:x.unitPrice})),
    discount:'0',roundingMode:data.roundingMode
  });
  const grand=integerMinor(quote.grandPaisa);
  if(grand<=0)throw error();
  const paid=data.payments.reduce((sum,x)=>sum+integerMinor(x.amountPaisa),0);
  if(paid>grand)throw new RangeError('Payment exceeds approved invoice grand');
  const due=grand-paid;
  const intentHash=fingerprint({
    shopId:data.shopId,operationId:data.operationId,purchaseId:data.purchaseId,
    supplierId:data.supplierId,cashSessionId:data.cashSessionId,
    actorTokenDigest:tokenHash,roundingMode:data.roundingMode,
    lines:data.lines,payments:data.payments
  });
  // Current-authority read can protect replay replies, never a substitution
  // for the SQL-time auth gate inside INSERT_HEADER below.
  if(!await authorized(DB,data.shopId,data.cashSessionId,tokenHash,now))
    throw error();
  const old=await existing(DB,data.shopId,data.operationId);
  if(old){
    if(old.intent_hash!==intentHash||old.purchase_id!==data.purchaseId)
      throw new Error('Changed intent conflict');
    if(!(await first(DB,'SELECT 1 AS ok FROM m03_fp_seal WHERE shop_id=? AND purchase_id=?',
      data.shopId,data.purchaseId)))
      throw error();
    return {state:'replay',purchaseId:old.purchase_id,
      grandPaisa:String(old.grand_paisa),paidPaisa:String(old.paid_paisa),
      duePaisa:String(old.due_paisa)};
  }
  const authParams=[
    data.shopId,data.cashSessionId,tokenHash,
    now,now,now-SESSION_IDLE_MS,now
  ];
  const statements=[
    DB.prepare(INSERT_HEADER).bind(
      data.shopId,data.purchaseId,data.operationId,intentHash,
      data.cashSessionId,grand,paid,due,quote.lines.length,data.payments.length,
      ...authParams,data.shopId,data.supplierId
    )
  ];
  for(const line of quote.lines){
    const source=data.lines.find(x=>x.id===line.id);
    const quantity=Number(source.quantity);
    statements.push(DB.prepare(`INSERT INTO m03_fp_line
      (shop_id,purchase_id,line_id,product_id,quantity,price_text,
       unit_revision,allocated_paisa)
      SELECT purchase.shop_id,purchase.purchase_id,?,stock.product_id,?,
        stock.price_text,stock.unit_revision,?
      FROM m03_fp_purchase AS purchase
      JOIN m03_fp_stock AS stock ON stock.shop_id=purchase.shop_id
        AND stock.product_id=? AND stock.status='Active'
        AND stock.unit_revision=? AND stock.price_text=?
      WHERE purchase.shop_id=? AND purchase.operation_id=?`
    ).bind(line.id,quantity,integerMinor(line.netPaisa),
      source.id,source.unitRevision,source.unitPrice,
      data.shopId,data.operationId));
    statements.push(DB.prepare(`UPDATE m03_fp_stock SET quantity=quantity+?
      WHERE shop_id=? AND product_id=? AND status='Active'
        AND EXISTS(SELECT 1 FROM m03_fp_line l
          WHERE l.shop_id=? AND l.purchase_id=? AND l.line_id=?)`
    ).bind(quantity,data.shopId,source.id,
      data.shopId,data.purchaseId,line.id));
    statements.push(DB.prepare(`INSERT INTO m03_fp_lot
      SELECT line.shop_id,line.purchase_id,line.line_id,line.product_id,
        line.quantity,line.allocated_paisa
      FROM m03_fp_line line
      WHERE line.shop_id=? AND line.purchase_id=? AND line.line_id=?`
    ).bind(data.shopId,data.purchaseId,line.id));
  }
  statements.push(DB.prepare(`INSERT INTO m03_fp_supplier_ledger
    SELECT shop_id,purchase_id,'Purchase','HEADER',grand_paisa,0
    FROM m03_fp_purchase WHERE shop_id=? AND operation_id=?`
  ).bind(data.shopId,data.operationId));
  for(const leg of data.payments){
    const amount=integerMinor(leg.amountPaisa);
    const bankId=leg.method==='Bank'?leg.bankAccountId:null;
    statements.push(DB.prepare(`INSERT INTO m03_fp_payment
      (shop_id,purchase_id,leg_id,method,bank_account_id,applied_paisa)
      SELECT purchase.shop_id,purchase.purchase_id,?,?,?,?
      FROM m03_fp_purchase AS purchase
      WHERE purchase.shop_id=? AND purchase.operation_id=?
        AND (?='Cash' OR EXISTS(
          SELECT 1 FROM m03_fp_bank bank WHERE bank.shop_id=purchase.shop_id
           AND bank.account_id=? AND bank.status='Active'
        ))`
    ).bind(leg.id,leg.method,bankId,amount,
      data.shopId,data.operationId,leg.method,bankId));
    statements.push(DB.prepare(`INSERT INTO m03_fp_money_book
      SELECT p.shop_id,p.purchase_id,p.leg_id,p.method,p.applied_paisa
      FROM m03_fp_payment AS p
      WHERE p.shop_id=? AND p.purchase_id=? AND p.leg_id=?`
    ).bind(data.shopId,data.purchaseId,leg.id));
    statements.push(DB.prepare(`INSERT INTO m03_fp_supplier_ledger
      SELECT p.shop_id,p.purchase_id,'Payment',p.leg_id,0,p.applied_paisa
      FROM m03_fp_payment AS p
      WHERE p.shop_id=? AND p.purchase_id=? AND p.leg_id=?`
    ).bind(data.shopId,data.purchaseId,leg.id));
  }
  statements.push(DB.prepare(`INSERT INTO m03_fp_seal VALUES (?,?,?,?)`
  ).bind(data.shopId,data.purchaseId,quote.lines.length,data.payments.length));
  if(injectLateFailure)statements.push(DB.prepare(
    'INSERT INTO m03_fp_fault VALUES (1)'));
  // Trusted Node test hook only: model SQL-time revocation/closure after JS
  // preflight; this is NOT accepted from any Worker request or production API.
  if(beforeBatch!==undefined){
    if(typeof beforeBatch!=='function')throw new TypeError('Test hook must be callable');
    await beforeBatch(DB);
  }
  try{
    await DB.batch(statements);
  }catch(err){
    const winner=await existing(DB,data.shopId,data.operationId);
    if(winner&&winner.intent_hash===intentHash&&winner.purchase_id===data.purchaseId&&
       await authorized(DB,data.shopId,data.cashSessionId,tokenHash,now))
      return {state:'replay',purchaseId:winner.purchase_id,
        grandPaisa:String(winner.grand_paisa),paidPaisa:String(winner.paid_paisa),
        duePaisa:String(winner.due_paisa)};
    throw error();
  }
  const posted=await existing(DB,data.shopId,data.operationId);
  if(!posted)throw error();
  return {state:'inserted',purchaseId:posted.purchase_id,
    grandPaisa:String(posted.grand_paisa),paidPaisa:String(posted.paid_paisa),
    duePaisa:String(posted.due_paisa)};
}

export async function inspectPurchaseTestShop(DB,shopId){
  id(shopId);
  const purchase=await all(DB,`SELECT purchase_id,grand_paisa,paid_paisa,due_paisa
    FROM m03_fp_purchase WHERE shop_id=? ORDER BY purchase_id`,shopId);
  const lines=await all(DB,`SELECT line_id,price_text,allocated_paisa
    FROM m03_fp_line WHERE shop_id=? ORDER BY line_id`,shopId);
  const stock=await all(DB,`SELECT product_id,quantity
    FROM m03_fp_stock WHERE shop_id=? ORDER BY product_id`,shopId);
  const lots=await all(DB,`SELECT product_id,quantity,allocated_cost_paisa
    FROM m03_fp_lot WHERE shop_id=? ORDER BY product_id`,shopId);
  const supplierLedger=await all(DB,`SELECT entry_type,debit_paisa,credit_paisa
    FROM m03_fp_supplier_ledger WHERE shop_id=?
    ORDER BY entry_type,leg_id`,shopId);
  const moneyBook=await all(DB,`SELECT method,amount_paisa
    FROM m03_fp_money_book WHERE shop_id=? ORDER BY method`,shopId);
  const seal=await all(DB,`SELECT line_count,payment_count
    FROM m03_fp_seal WHERE shop_id=?`,shopId);
  return {purchase,lines,stock,lots,supplierLedger,moneyBook,seal};
}
