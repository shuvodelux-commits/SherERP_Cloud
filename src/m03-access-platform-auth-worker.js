import platformAuth from './m03-private-platform-auth-worker.js';
import html from '../frontend/platform-auth/index.html';
import css from '../frontend/platform-auth/platform-auth.css';
import js from '../frontend/platform-auth/platform-auth.js';

// Instance origin comes only from trusted Worker config, not request headers.
// P1 supports exact, private workers.dev hostnames; custom domains need a separate review.
const WORKERS_ORIGIN=/^https:\/\/[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/;
const AUDIENCE=/^[a-f0-9]{64}$/;
const EMAIL=/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+$/;
const headers={
  'Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
};
const denied=()=>Response.json({error:'Access required'},{status:403,headers});
const unavailable=()=>Response.json({error:'Platform authentication unavailable'},{status:503,headers});
const platformPageFiles=Object.freeze({
  '/index.html':html,
  '/platform-auth.css':css,
  '/platform-auth.js':js,
});

export default {
  async fetch(request,env,ctx){
    const origin=new URL(request.url).origin;
    const approvedOrigin=env?.PLATFORM_AUTH_ORIGIN;
    if(typeof approvedOrigin!=='string' || !WORKERS_ORIGIN.test(approvedOrigin) ||
       origin!==approvedOrigin)return denied();
    const {PLATFORM_ACCESS_AUDIENCE:audience,PLATFORM_ACCESS_EMAIL:operator}=env;
    if(typeof audience!=='string'||!AUDIENCE.test(audience) ||
       typeof operator!=='string'||operator.length>254||!EMAIL.test(operator))return unavailable();

    const access=ctx?.access;
    if(access?.aud!==audience || typeof access.getIdentity!=='function')return denied();
    let identity;
    try{
      identity=await access.getIdentity();
    }catch{
      return denied();
    }
    if(typeof identity?.email!=='string'||identity.email.toLowerCase()!==operator)return denied();
    return platformAuth.fetch(request,{...env,platformPageFiles},ctx);
  },
};
