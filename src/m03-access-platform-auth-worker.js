import {verifyWithJwks} from 'hono/jwt';
import platformAuth from './m03-private-platform-auth-worker.js';

const ADMIN_ORIGIN='https://admin-hisabiq.agnishuvo.workers.dev';
const ACCESS_ISSUER='https://agnishuvo.cloudflareaccess.com';
const ACCESS_KEYS=ACCESS_ISSUER+'/cdn-cgi/access/certs';
const AUDIENCE=/^[a-f0-9]{64}$/;
const EMAIL=/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+$/;
const COMPACT_ASSERTION=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const headers={
  'Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
};
const denied=()=>Response.json({error:'Access required'},{status:403,headers});
const unavailable=()=>Response.json({error:'Platform authentication unavailable'},{status:503,headers});

function authorizationCookie(headers){
  const cookies=headers.get('Cookie');
  if(!cookies||cookies.length>16384)return null;
  let token=null;
  for(const cookie of cookies.split(';')){
    const separator=cookie.indexOf('=');
    if(separator<0 || cookie.slice(0,separator).trim()!=='CF_Authorization')continue;
    if(token!==null)return null;
    token=cookie.slice(separator+1).trim();
  }
  return token;
}

async function fetchAccessKeys(){
  try{
    const response=await fetch(ACCESS_KEYS,{redirect:'error',signal:AbortSignal.timeout(3000)});
    if(!response.ok)return null;
    const {keys}=await response.json();
    return Array.isArray(keys)?keys:null;
  }catch{
    return null;
  }
}

async function isValidAccessToken(token,keys,audience,operator){
  if(!token || token.length>8192 || !COMPACT_ASSERTION.test(token))return false;
  let claims;
  try{
    claims=await verifyWithJwks(token,{
      keys,
      allowedAlgorithms:['RS256'],
      verification:{iss:ACCESS_ISSUER,aud:audience},
    });
  }catch{
    return false;
  }
  return claims.type==='app' && Number.isSafeInteger(claims.iat) &&
    Number.isSafeInteger(claims.exp) && claims.iat>=0 && claims.exp>claims.iat &&
    typeof claims.sub==='string' && !!claims.sub.trim() && claims.sub.length<=255 &&
    typeof claims.email==='string' && claims.email.toLowerCase()===operator;
}

export default {
  async fetch(request,env,ctx){
    const origin=new URL(request.url).origin;
    if(origin!==ADMIN_ORIGIN || origin!==env?.PLATFORM_AUTH_ORIGIN)return denied();
    const {PLATFORM_ACCESS_AUDIENCE:audience,PLATFORM_ACCESS_EMAIL:operator}=env;
    if(typeof audience!=='string'||!AUDIENCE.test(audience) ||
       typeof operator!=='string'||operator.length>254||!EMAIL.test(operator))return unavailable();

    // Static Assets does not forward ctx.access. Verify the signed application
    // assertion or signed browser cookie before serving assets or reaching D1.
    const assertion=request.headers.get('Cf-Access-Jwt-Assertion');
    const cookie=authorizationCookie(request.headers);
    let keys;
    let keysFetched=false;
    let assertionAccepted=false;
    let cookieAccepted=false;
    if(assertion && assertion.length<=8192 && COMPACT_ASSERTION.test(assertion)){
      keys=await fetchAccessKeys();
      keysFetched=true;
      assertionAccepted=!!keys && await isValidAccessToken(assertion,keys,audience,operator);
    }
    if(!assertionAccepted){
      if(cookie && cookie.length<=8192 && COMPACT_ASSERTION.test(cookie)){
        if(!keysFetched)keys=await fetchAccessKeys();
        cookieAccepted=!!keys && await isValidAccessToken(cookie,keys,audience,operator);
      }
    }
    if(!assertionAccepted&&!cookieAccepted){
      console.warn('platform_access_denied',{
        assertionPresent:assertion!==null,
        assertionAccepted,
        authorizationCookiePresent:cookie!==null,
        authorizationCookieAccepted:cookieAccepted,
        jwksAvailable:keysFetched?!!keys:null,
      });
      return denied();
    }
    return platformAuth.fetch(request,env,ctx);
  },
};
