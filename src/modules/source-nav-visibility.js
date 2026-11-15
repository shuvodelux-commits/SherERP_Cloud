/**
 * Internal M03 source-faithful navigation display projection.
 *
 * NAV_ITEMS is supplied by the existing source-pinned app shell reader;
 * this module never invents or copies a menu. This is PRESENTATION ONLY.
 * Staff authorization must remain within M04's server-side D1 policy.
 */
function ownData(object,key){
  if(!object || typeof object!=='object') return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  return descriptor?.enumerable && Object.hasOwn(descriptor,'value')
    ?descriptor.value:undefined;
}

function validProfile(profile){
  if(!profile || typeof profile!=='object' || Array.isArray(profile) ||
     ![Object.prototype,null].includes(Object.getPrototypeOf(profile)))
    throw new TypeError('Invalid navigation role profile');

  // Require an explicit Administrator null, never undefined. The original
  // client considered undefined unrestricted, but malformed M04 metadata
  // must not become an implicit Administrator UI.
  const allowed=Object.getOwnPropertyDescriptor(profile,'allowedModules');
  const perms=Object.getOwnPropertyDescriptor(profile,'permissions');
  if(!allowed?.enumerable || !Object.hasOwn(allowed,'value') ||
     !perms?.enumerable || !Object.hasOwn(perms,'value'))
    throw new TypeError('Invalid navigation role profile fields');

  const modules=allowed.value,permissions=perms.value;
  if(modules!==null && (!Array.isArray(modules) ||
       modules.some(name=>typeof name!=='string')))
    throw new TypeError('Invalid navigation role modules');
  if(permissions!==null && (!permissions || typeof permissions!=='object' ||
       Array.isArray(permissions) ||
       ![Object.prototype,null].includes(Object.getPrototypeOf(permissions))))
    throw new TypeError('Invalid navigation role permissions');

  return {modules,permissions};
}

/**
 * Source behavior from javascript.html:
 * filterNavByRole_, subNavVisible_, navLandingKey_, firstReachableKey_.
 *
 * A verified M04 profile must be obtained by the trusted server before
 * calling this. Neither the supplied profile nor these UI results grant
 * RPC access or replace server authorization.
 */
export function projectSourceNavigation(navItems,profile){
  if(!Array.isArray(navItems))
    throw new TypeError('Invalid navigation items');
  const {modules,permissions}=validProfile(profile);
  const admin=modules===null;
  const contains=key=>admin || modules.includes(key);
  const hasAction=(module,action)=>admin ||
    ownData(ownData(permissions,module),action)===true;
  const special=key=>hasAction(key,'edit');
  const anyAction=item=>!!(item?.actionPermAny &&
    item.actionPermAny.some(perm=>hasAction(perm.module,perm.action)));

  function itemVisible(item){
    if(!item)return false;
    if(admin)return true;
    if(item.actionPermAny)return anyAction(item);
    if(item.specialPermKey)return special(item.specialPermKey);
    if(contains(item.key))return true;
    return (item.children || []).some(child=>{
      if(child.adminOnly)return false;
      if(child.specialPermKey)return special(child.specialPermKey);
      return contains(child.permKey || child.key);
    });
  }

  function tabVisible(child,groupKey){
    if(child.adminOnly)return admin;
    if(admin)return true;
    if(child.actionPermAny)return anyAction(child);
    if(child.specialPermKey)return special(child.specialPermKey);
    if(child.permKey)return contains(child.permKey);
    if(child.key===groupKey)return contains(groupKey);
    if(['returns','users','roles'].includes(child.key))return contains(child.key);
    return !!groupKey && contains(groupKey);
  }

  function visibleTabs(group){
    return (group.children || []).filter(child=>tabVisible(child,group.key));
  }

  function landingKey(item){
    if(!item.children)return item.key;
    const children=visibleTabs(item);
    const preferred=String(item.landingKey||'');
    if(preferred){
      const chosen=children.find(child=>child.key===preferred);
      if(chosen)return chosen.key;
    }
    return children.length?children[0].key:item.key;
  }

  // A detached copy preserves the original browser's unpruned group metadata
  // while preventing one caller from poisoning later requests.
  let source;
  try{source=structuredClone(navItems);}
  catch{throw new TypeError('Invalid navigation metadata');}
  const sidebarItems=source.filter(item=>item &&
    (item.specialPermKey?special(item.specialPermKey):itemVisible(item)));
  const groupTabs=sidebarItems.filter(item=>!!item.children)
    .map(group=>({groupKey:group.key,children:visibleTabs(group)}));
  const sidebarLandings=sidebarItems
    .map(group=>({groupKey:group.key,pageKey:landingKey(group)}));

  let firstPageKey=admin?'dashboard':'noAccess';
  for(const item of sidebarItems){
    if(!item.children){
      if(itemVisible(item)){firstPageKey=item.key;break;}
    }else{
      const kids=visibleTabs(item);
      if(kids.length){firstPageKey=kids[0].key;break;}
    }
  }

  return {sidebarItems,groupTabs,sidebarLandings,firstPageKey};
}
