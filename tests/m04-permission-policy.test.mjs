import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  STAFF_PERMISSION_MODULES,
  PERMISSION_WINDOW_CODES,
  sanitizeStaffPermissions,
} from '../src/modules/auth/permission-policy.js';

// Read the immutable GAS originals rather than duplicating the list in tests.
function sourceConstant(path, name) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  const match = text.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\[[\\s\\S]*?\\n\\]);'));
  assert.ok(match, `missing original ${name}`);
  return JSON.parse(JSON.stringify(runInNewContext(match[1])));
}

test('staff role keys and edit-only metadata agree with pinned UI.gs, not navigation items', () => {
  const original = sourceConstant('../legacy/source/UI.gs', 'PERMISSION_MODULES')
    .map(({key, permissionMode}) => ({key, permissionMode: permissionMode || ''}));
  const port = STAFF_PERMISSION_MODULES
    .map(({key, permissionMode}) => ({key, permissionMode: permissionMode || ''}));
  assert.equal(port.length, 21);
  assert.deepEqual(port, original);
});

test('date-window vocabulary matches pinned Auth.gs', () => {
  const original = sourceConstant('../legacy/source/Auth.gs', 'DELETE_WINDOW_OPTIONS')
    .map(({key}) => key);
  assert.deepEqual([...PERMISSION_WINDOW_CODES], original);
});

test('malformed inputs, unknown module keys and inherited permissions grant nothing', () => {
  for (const raw of [null, undefined, 'pos', true, 4, [], {}, {unknown:{view:true}}])
    assert.deepEqual(sanitizeStaffPermissions(raw), {});
  const inherited = Object.create({pos:{view:true}});
  inherited.unknown = {view:true};
  assert.deepEqual(sanitizeStaffPermissions(inherited), {});
});

test('normal staff rights require literal true booleans rather than truthy strings', () => {
  const got = sanitizeStaffPermissions({pos:{view:true, add:'true', edit:1, delete:'disabled'}});
  assert.deepEqual(got, {
    pos:{view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited'}
  });
  assert.deepEqual(sanitizeStaffPermissions({pos:{view:'false',add:0,edit:false}}), {});
});

test('standard modules accept only source windows and default invalid delete to disabled', () => {
  assert.deepEqual(sanitizeStaffPermissions({sales:{delete:'3',backdate:'same'}}), {
    sales:{view:false,add:false,edit:false,delete:'3',backdate:'same'}
  });
  assert.deepEqual(sanitizeStaffPermissions({sales:{view:true,delete:'365',backdate:'nonsense'}}), {
    sales:{view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited'}
  });
});

test('Users/Roles management delete is boolean even when legacy unlimited is submitted', () => {
  const got = sanitizeStaffPermissions({
    users:{delete:'unlimited'},
    roles:{delete:true},
    sales:{delete:true}
  });
  assert.deepEqual(got, {
    users:{view:false,add:false,edit:false,delete:true,backdate:'unlimited'},
    roles:{view:false,add:false,edit:false,delete:true,backdate:'unlimited'},
  });
  assert.deepEqual(sanitizeStaffPermissions({users:{delete:'3'}}), {});
});

test('special edit-only rights ignore view, add, delete and backdate claims', () => {
  const got = sanitizeStaffPermissions({
    openingBalance:{edit:true,view:true,add:true,delete:'unlimited',backdate:'7'},
    settlementDiscount:{edit:'true',view:true},
  });
  assert.deepEqual(got, {
    openingBalance:{view:false,add:false,edit:true,delete:'disabled',backdate:'unlimited'}
  });
});

test('accessor properties are not evaluated when consuming untrusted maps', () => {
  const payload = {};
  Object.defineProperty(payload,'pos',{enumerable:true,get(){throw Error('module getter executed')}});
  payload.sales = {};
  Object.defineProperty(payload.sales,'view',{enumerable:true,get(){throw Error('view getter executed')}});
  assert.deepEqual(sanitizeStaffPermissions(payload), {});
});

test('source-only POS purchase price visibility is not confused with a navigation page', () => {
  assert.deepEqual(sanitizeStaffPermissions({posCost:{view:true}}), {
    posCost:{view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited'}
  });
});

test('allowed modules are ordered by source and require view permission, never edit-only or delete-only', async () => {
  const {allowedStaffModules} = await import('../src/modules/auth/permission-policy.js');
  const normalized = sanitizeStaffPermissions({
    posCost:{view:true},
    roles:{delete:true},
    settlementDiscount:{edit:true},
    sales:{view:true},
    dashboard:{add:true},
    openingBalance:{edit:true},
    pos:{view:true},
  });
  assert.deepEqual(allowedStaffModules(normalized), ['pos','sales','posCost']);
});

test('allowed module derivation rejects malformed, inherited and nonboolean view grants', async () => {
  const {allowedStaffModules} = await import('../src/modules/auth/permission-policy.js');
  assert.deepEqual(allowedStaffModules(null), []);
  assert.deepEqual(allowedStaffModules({pos:{view:'true'},dashboard:{view:true},unknown:{view:true}}),['dashboard']);
  const inherited = Object.create({pos:{view:true}});
  assert.deepEqual(allowedStaffModules(inherited),[]);
});

test('hostile Proxy traps never crash staff policy normalization or expose inherited rights', () => {
  const trap = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error('secret marker must not escape'); },
  });
  assert.deepEqual(sanitizeStaffPermissions(trap), {});
  assert.deepEqual(sanitizeStaffPermissions({sales:trap}), {});
  assert.deepEqual(sanitizeStaffPermissions({sales:{view:trap,edit:false}}), {});
});

test('hostile navigation projection cannot infer rights or invoke getters and traps', async () => {
  const {allowedStaffModules} = await import('../src/modules/auth/permission-policy.js');
  const trap = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error('secret marker must not escape'); },
  });
  assert.deepEqual(allowedStaffModules(trap), []);
  assert.deepEqual(allowedStaffModules({sales:trap}), []);
});


test('source Roles bootstrap options preserve exact labeled UI module and delete-window choices', async () => {
  const policy = await import('../src/modules/auth/permission-policy.js');
  assert.equal(typeof policy.roleBootstrapOptions, 'function');
  const sourceModules = sourceConstant('../legacy/source/UI.gs','PERMISSION_MODULES')
    .map(({key,label,permissionMode})=>({key,label,permissionMode:permissionMode||''}));
  const sourceWindows = sourceConstant('../legacy/source/Auth.gs','DELETE_WINDOW_OPTIONS')
    .map(({key,label})=>({key,label}));
  const output = policy.roleBootstrapOptions();
  assert.deepEqual(Object.keys(output), ['moduleOptions','deleteWindowOptions']);
  assert.equal(sourceModules.length,21);
  assert.equal(sourceWindows.length,8);
  assert.deepEqual(output.moduleOptions, sourceModules);
  assert.deepEqual(output.deleteWindowOptions,sourceWindows);
  assert.deepEqual(output.moduleOptions.find(m=>m.key==='returns'),
    {key:'returns',label:'Sales Return',permissionMode:''});
  assert.deepEqual(output.moduleOptions.find(m=>m.key==='posCost'),
    {key:'posCost',label:'POS Purchase Price',permissionMode:''});
  for(const name of ['openingBalance','settlementDiscount'])
    assert.equal(output.moduleOptions.find(m=>m.key===name).permissionMode,'editOnly');
  const second = policy.roleBootstrapOptions();
  assert.notStrictEqual(second.moduleOptions,output.moduleOptions);
  assert.notStrictEqual(second.deleteWindowOptions,output.deleteWindowOptions);
  output.moduleOptions[0].label = 'not the frozen source';
  output.deleteWindowOptions[0].label = 'not the frozen source';
  assert.deepEqual(second.moduleOptions,sourceModules);
  assert.deepEqual(second.deleteWindowOptions,sourceWindows);
});
