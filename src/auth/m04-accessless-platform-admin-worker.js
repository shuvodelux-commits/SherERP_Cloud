import {browserSetupConfigured} from './browser-first-admin-setup.js';
import {attachHostedPilot} from './m03-hosted-prebound-pilot.js';
import platformAuth from '../m03-private-platform-auth-worker.js';
import {hashOpaqueSessionToken} from './session-token.js';
import html from '../../frontend/platform-auth/index.html';
import css from '../../frontend/platform-auth/platform-auth.css';
import js from '../../frontend/platform-auth/platform-auth.js';

// Opt-in alternative to the Access-protected M03 entrypoint. No Access claim,
// request header, client email or cookie can replace the enrolled Google subject
// in Control D1. This is not imported by the public ERP Worker.
const WORKERS_ORIGIN=/^https:\/\/[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/;
const SUBJECT=/^[0-9]{10,128}$/;
const CLIENT=/^[a-zA-Z0-9-]{1,218}\.apps\.googleusercontent\.com$/;
const SECRET=/^[0-9a-f]{40}$/;
const FACTOR=/^[1-9][0-9]{0,6}$/;
const ISSUER='https://accounts.google.com';
const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const SETUP_PATHS=new Set(['/api/platform/setup/challenge','/api/platform/setup']);
const STATIC_PATHS=new Set(['/','/platform-auth.js','/platform-auth.css']);
const files=Object.freeze({
  '/index.html':html,'/platform-auth.js':js,'/platform-auth.css':css,
});
const headers={
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
};
const deny=()=>Response.json({error:'Administrator access denied'},{status:403,headers});
const unavailable=()=>Response.json({error:'Administrator authentication unavailable'},{status:503,headers});

function configured(env){
  return env?.PLATFORM_AUTH_MODE==='google-totp-without-access' &&
    env.PLATFORM_AUTH_SCOPE==='private-platform-auth' &&
    WORKERS_ORIGIN.test(env.PLATFORM_AUTH_ORIGIN) &&
    CLIENT.test(env.PLATFORM_CLIENT_ID) &&
    (env.PLATFORM_BROWSER_SETUP==='true'?browserSetupConfigured(env):
      SUBJECT.test(env.PLATFORM_OPERATOR_GOOGLE_SUBJECT) &&
      SECRET.test(env.PLATFORM_TOTP_SECRET) && FACTOR.test(env.PLATFORM_FACTOR_VERSION)) &&
    typeof env.CONTROL_DB?.prepare==='function' &&
    typeof env.CONTROL_DB?.batch==='function' &&
    typeof env.PLATFORM_INGRESS?.limit==='function';
}

// Permit setup only when exactly one active ticket has the preapproved
// identity. The existing Hono body limiter and token verifier handle user
// payloads, so this outer security guard never parses an unbounded body.
async function hasExactlyOneApprovedTicket(db,subject){
  const state=await db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN issuer=? AND subject=? THEN 1 ELSE 0 END),0) AS approved
    FROM platform_setup_tickets
    WHERE issued_at_ms<=${NOW} AND expires_at_ms>${NOW}
      AND revoked_at_ms IS NULL`)
    .bind(ISSUER,subject).first();
  return state?.total===1 && state.approved===1;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.origin!==env?.PLATFORM_AUTH_ORIGIN || !WORKERS_ORIGIN.test(url.origin))return deny();
    if(!configured(env))return unavailable();
    if(url.search){
      // A pasted Admin link may contain tracking/query parameters. Strip them
      // from the entry page only; never interpret a user-supplied redirect.
      // All API methods and assets retain the fail-closed query policy.
      if(request.method==='GET' && url.pathname==='/' && !request.headers.has('Origin')){
        return new Response(null,{status:302,headers:{...headers,Location:env.PLATFORM_AUTH_ORIGIN+'/'}});
      }
      return Response.json({error:'Query parameters are unsupported'},{status:400,headers});
    }
    const requestOrigin=request.headers.get('Origin');
    if((request.method==='POST'||requestOrigin!==null) && requestOrigin!==url.origin)return deny();
    // The public Admin login page has no Cloudflare Access outer throttle.
    // Limit even anonymous static/API requests before any Control D1 reads.
    try{
      // Use Cloudflare's inbound client-IP header, never user-provided XFF.
      // If unavailable, share a restrictive fallback bucket instead of bypassing.
      const clientIp=request.headers.get('CF-Connecting-IP')??'';
      const key=/^[0-9a-fA-F:.]{3,45}$/.test(clientIp)
        ?'platform-admin:'+clientIp.toLowerCase():'platform-admin:unidentified';
      const ingress=await env.PLATFORM_INGRESS.limit({key});
      if(ingress?.success!==true)return Response.json({error:'Try again in a minute'},
        {status:429,headers});
    }catch{return unavailable();}
    try{
      const admin=await env.CONTROL_DB.prepare(
        'SELECT issuer,subject FROM platform_first_superadmin WHERE singleton=1'
      ).first();
      if(env.PLATFORM_BROWSER_SETUP==='true'){
        if(SETUP_PATHS.has(url.pathname))return deny();
        if(!admin && !STATIC_PATHS.has(url.pathname) &&
          !['/api/platform/wizard','/api/platform/wizard/start','/api/platform/wizard/google',
            '/api/platform/wizard/finish'].includes(url.pathname))return deny();
      }else if(admin){
        if(admin.issuer!==ISSUER || admin.subject!==env.PLATFORM_OPERATOR_GOOGLE_SUBJECT)return deny();
      }else if(SETUP_PATHS.has(url.pathname) && request.method==='POST'){
        if(!await hasExactlyOneApprovedTicket(env.CONTROL_DB,
          env.PLATFORM_OPERATOR_GOOGLE_SUBJECT))return deny();
      }else if(request.method!=='GET' || !STATIC_PATHS.has(url.pathname)){
        return deny();
      }
    }catch{
      return unavailable();
    }
    // Existing private Hono app owns nonce-bound Google verification, TOTP,
    // D1-backed sessions, throttling, CSRF/origin checks and all privilege gates.
    const needsPilot=/^\/api\/platform\/(?:shops(?:\/|$)|support(?:\/|$)|auth\/(?:session|login)$)/.test(url.pathname);
    const platformEnv=needsPilot?await attachHostedPilot(env):env;
    return platformAuth.fetch(request,{...platformEnv,platformPageFiles:files},ctx);
  },
};
