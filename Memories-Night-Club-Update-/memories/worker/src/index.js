import { createRemoteJWKSet, jwtVerify } from 'jose';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const text=(value,status=200,headers={})=>new Response(value,{status,headers:{'Content-Type':'text/plain',...headers}});

function cors(req,env){
  const origin=req.headers.get('Origin')||'';
  const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const allow=origin&&allowed.includes(origin)?origin:(allowed[0]||'');
  return {'Access-Control-Allow-Origin':allow,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS','Vary':'Origin'};
}
const ok=(req,env,data,status=200)=>json(data,status,cors(req,env));
const fail=(req,env,message,status=400)=>ok(req,env,{success:false,error:message},status);

// ── Best-effort abuse throttle ──
// This is a per-isolate in-memory sliding window: it resets on cold start and isn't shared
// across Cloudflare's edge locations, so it does NOT replace real protection. It's a stopgap
// against a single misbehaving client hammering one isolate, not a substitute for Cloudflare's
// account-level Rate Limiting Rules (dashboard → Security → WAF), which need account access this
// codebase's deploy process doesn't have from within the Worker itself — that's a deliberate,
// documented gap, not an oversight. See docs/COMPLETION_REPORT.md "Rate limiting" for the decision.
const rateBuckets=new Map();
function rateLimited(req,key,limit,windowMs){
  const ip=req.headers.get('CF-Connecting-IP')||req.headers.get('X-Forwarded-For')||'unknown';
  const bucketKey=`${key}:${ip}`;
  const t=Date.now();
  const fresh=(rateBuckets.get(bucketKey)||[]).filter(x=>t-x<windowMs);
  if(fresh.length>=limit){rateBuckets.set(bucketKey,fresh);return true;}
  fresh.push(t);
  rateBuckets.set(bucketKey,fresh);
  if(rateBuckets.size>5000)rateBuckets.clear(); // crude memory bound for a long-lived isolate
  return false;
}
const tooMany=(req,env)=>fail(req,env,'Too many requests. Please wait a moment and try again.',429);
const enc=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64=s=>btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64=s=>{const p='='.repeat((4-s.length%4)%4);return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+p),c=>c.charCodeAt(0));};
const fromHex=s=>Uint8Array.from(s.match(/.{2}/g)||[],x=>parseInt(x,16));
const now=()=>new Date();
const id=()=>crypto.randomUUID().replaceAll('-','');
const ref=()=>`MEM-${Date.now()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
const ticketToken=()=>id()+id();
const shortCode=()=>`MEM-${Math.floor(1000+Math.random()*9000)}`;
const MIN_TOPUP_PESEWAS=1000; // GHS 10

function firestoreValue(v){
  if(v===null||v===undefined)return {nullValue:null};
  if(v instanceof Date)return {timestampValue:v.toISOString()};
  if(typeof v==='string')return {stringValue:v};
  if(typeof v==='boolean')return {booleanValue:v};
  if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(Array.isArray(v))return {arrayValue:{values:v.map(firestoreValue)}};
  if(typeof v==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,firestoreValue(x)]))}};
  return {stringValue:String(v)};
}
function docFields(obj){return Object.fromEntries(Object.entries(obj||{}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,firestoreValue(v)]));}
function parseValue(v){
  if(!v)return null;
  if('stringValue'in v)return v.stringValue;
  if('integerValue'in v)return Number(v.integerValue);
  if('doubleValue'in v)return v.doubleValue;
  if('booleanValue'in v)return v.booleanValue;
  if('timestampValue'in v)return v.timestampValue;
  if('nullValue'in v)return null;
  if('referenceValue'in v)return v.referenceValue;
  if('arrayValue'in v)return (v.arrayValue.values||[]).map(parseValue);
  if('mapValue'in v)return parseFields(v.mapValue.fields||{});
  return null;
}
function parseFields(fields={}){return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,parseValue(v)]));}

// ── Google OAuth (scoped token cache — Firestore + Identity Toolkit need different scopes) ──
const tokenCache={};
function serviceAccount(env){return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);}
async function googleAccessToken(env,scope='https://www.googleapis.com/auth/datastore'){
  const cached=tokenCache[scope];
  if(cached&&Date.now()<cached.expires-60000)return cached.value;
  const sa=serviceAccount(env);
  const keyPem=sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const key=await crypto.subtle.importKey('pkcs8',fromB64(keyPem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const t=Math.floor(Date.now()/1000);
  const header=b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload=b64(JSON.stringify({iss:sa.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:t,exp:t+3600}));
  const signature=b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(`${header}.${payload}`)));
  const assertion=`${header}.${payload}.${signature}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const d=await r.json(); if(!r.ok)throw new Error('Google access token failed');
  tokenCache[scope]={value:d.access_token,expires:Date.now()+d.expires_in*1000}; return d.access_token;
}
const basePath=env=>`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
async function fs(env,path,options={}){const token=await googleAccessToken(env);const r=await fetch(basePath(env)+path,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok){const err=new Error(d.error?.message||`Firestore ${r.status}`);err.status=r.status;throw err;}return d;}
async function getDoc(env,col,docId){try{const d=await fs(env,`/${col}/${encodeURIComponent(docId)}`);return d.name?{id:docId,fields:parseFields(d.fields)}:null;}catch(e){if(String(e.message).includes('NOT_FOUND'))return null;throw e;}}
async function listDocs(env,col){
  let docs=[],pageToken;
  do{
    const qs=new URLSearchParams({pageSize:'300'});
    if(pageToken)qs.set('pageToken',pageToken);
    const d=await fs(env,`/${col}?${qs.toString()}`);
    docs=docs.concat((d.documents||[]).map(x=>({id:x.name.split('/').pop(),fields:parseFields(x.fields)})));
    pageToken=d.nextPageToken||null;
  }while(pageToken);
  return docs;
}
async function setDoc(env,col,docId,data){await fs(env,`/${col}/${encodeURIComponent(docId)}`,{method:'PATCH',body:JSON.stringify({fields:docFields(data)})});}
async function createDoc(env,col,docId,data){return fs(env,`/${col}?documentId=${encodeURIComponent(docId)}`,{method:'POST',body:JSON.stringify({fields:docFields(data)})});}
async function deleteDoc(env,col,docId){await fs(env,`/${col}/${encodeURIComponent(docId)}`,{method:'DELETE'});}

// ── Structured query — one or more equality filters (AND), optionally scoped to a transaction ──
async function queryWhere(env,col,filters,{limit=1000,transaction}={}){
  const token=await googleAccessToken(env);
  const fieldFilters=filters.map(f=>({fieldFilter:{field:{fieldPath:f.field},op:'EQUAL',value:firestoreValue(f.value)}}));
  const where=fieldFilters.length===1?fieldFilters[0]:{compositeFilter:{op:'AND',filters:fieldFilters}};
  const body={structuredQuery:{from:[{collectionId:col}],where,limit}};
  if(transaction)body.transaction=transaction;
  const r=await fetch(`${basePath(env)}:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){const err=new Error(d.error?.message||'Firestore query failed');err.status=r.status;throw err;}
  return (d||[]).filter(x=>x.document).map(x=>({id:x.document.name.split('/').pop(),fields:parseFields(x.document.fields)}));
}

// ── Transactions ──
async function beginTx(env){const d=await fs(env,':beginTransaction',{method:'POST',body:JSON.stringify({options:{readWrite:{}}})});return d.transaction;}
async function batchGet(env,paths,transaction){const token=await googleAccessToken(env);const docs=paths.map(p=>`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${p}`);const r=await fetch(`${basePath(env)}:batchGet`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({documents:docs,transaction})});const d=await r.json().catch(()=>([]));if(!r.ok){const err=new Error(d.error?.message||'Firestore batchGet failed');err.status=r.status;throw err;}return d;}
async function commitTx(env,writes,transaction){
  const token=await googleAccessToken(env);
  const r=await fetch(`${basePath(env)}:commit`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({writes,transaction})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){const err=new Error(d.error?.message||`Firestore commit failed (${r.status})`);err.status=r.status;throw err;}
  return d;
}
const updateWrite=(env,col,docId,data)=>({update:{name:`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`,fields:docFields(data)}});

// Firestore transactions abort (HTTP 409) under contention by design — the caller is expected to
// retry the whole read-modify-write cycle against a fresh transaction. This wraps every
// transactional operation in the Worker so that guarantee actually holds under concurrent load.
async function withTransaction(env,fn,attempts=5){
  let lastErr;
  for(let attempt=0;attempt<attempts;attempt++){
    const tx=await beginTx(env);
    try{
      return await fn(tx);
    }catch(e){
      lastErr=e;
      if(e&&e.status===409&&attempt<attempts-1){
        const backoff=Math.min(1000,50*2**attempt)+Math.floor(Math.random()*50);
        await new Promise(res=>setTimeout(res,backoff));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
function foundFields(batchGetResult,suffix){
  const found=(batchGetResult||[]).filter(x=>x.found).map(x=>({path:x.found.name,fields:parseFields(x.found.fields)}));
  return found.find(x=>x.path.endsWith(suffix));
}

async function verifyStaff(req,env,roles=['superAdmin','manager','eventManager','doorStaff','organiser']){
  const h=req.headers.get('Authorization')||''; if(!h.startsWith('Bearer '))return null;
  try{const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));const {payload}=await jwtVerify(h.slice(7),jwks,{issuer:`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,audience:env.FIREBASE_PROJECT_ID});if(payload.admin===true||roles.includes(payload.role))return payload;return null;}catch{return null;}
}
function requireRole(user,roles){return !!user&&(user.admin===true||roles.includes(user.role));}
async function paystack(env,path,options={}){const r=await fetch(`https://api.paystack.co${path}`,{...options,headers:{Authorization:`Bearer ${env.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json();if(!r.ok||!d.status)throw new Error(d.message||'Paystack request failed');return d.data;}
async function sendBrevo(env,to,subject,html){if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)return;const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:env.BREVO_SENDER_EMAIL,name:env.BREVO_SENDER_NAME||'Memories Night Club'},to:[{email:to}],subject,html})});if(!r.ok)console.error('Brevo failed',await r.text());}

// Direct server-to-server SMS send (distinct from the admin-gated /api/send-sms proxy route —
// this is never reachable from the browser, only called from within Worker business logic after
// a real state change). Payload shape ({to,message}) follows this SMS worker's other endpoints'
// convention but is NOT independently verified against a live SMS_WORKER_URL from this codebase's
// test environment — see docs/COMPLETION_REPORT.md.
async function sendSms(env,to,message){
  if(!env.SMS_WORKER_URL||!to)return;
  try{
    const r=await fetch(`${env.SMS_WORKER_URL.replace(/\/$/,'')}/send-sms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to,message})});
    if(!r.ok)console.error('SMS send failed',r.status,await r.text().catch(()=>''));
  }catch(e){console.error('SMS send threw',e);}
}
const moneyStr=pesewas=>`GHS ${(Number(pesewas||0)/100).toFixed(0)}`;

// ── Identity Toolkit (staff role management) ──
async function identityLookupByEmail(env,email){
  const token=await googleAccessToken(env,'https://www.googleapis.com/auth/identitytoolkit');
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:lookup`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({email:[email]})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error?.message||'Identity Toolkit lookup failed');
  return (d.users||[])[0]||null;
}
async function identitySetCustomClaims(env,localId,claims){
  const token=await googleAccessToken(env,'https://www.googleapis.com/auth/identitytoolkit');
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:update`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({localId,customAttributes:JSON.stringify(claims)})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error?.message||'Identity Toolkit update failed');
  return d;
}
const STAFF_ROLES=['superAdmin','manager','eventManager','doorStaff','organiser'];
async function setRole(env,b,user){
  if(!requireRole(user,['superAdmin']))return {error:'Forbidden.',status:403};
  const email=String(b?.email||'').trim().toLowerCase();
  const role=String(b?.role||'');
  if(!email||!STAFF_ROLES.includes(role))return {error:'A valid email and role are required.'};
  const account=await identityLookupByEmail(env,email);
  if(!account)return {error:'No account with that email. They must sign up (or be created in Firebase Auth) first.',status:404};
  const claims={role,admin:role==='superAdmin'};
  await identitySetCustomClaims(env,account.localId,claims);
  await setDoc(env,'users',account.localId,{email,role,admin:claims.admin,updatedAt:now()});
  await setDoc(env,'audit_logs',id(),{action:'ROLE_SET',actorUid:user.uid||user.sub,targetUid:account.localId,targetEmail:email,role,timestamp:now()});
  return {success:true,uid:account.localId,email,role};
}

// ── SMS proxy ──
async function proxySms(env,path,init={}){
  if(!env.SMS_WORKER_URL)throw new Error('SMS_WORKER_URL not configured');
  const r=await fetch(`${env.SMS_WORKER_URL.replace(/\/$/,'')}${path}`,init);
  const body=await r.text();
  return new Response(body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}

async function publicEvents(env){const docs=await listDocs(env,'events');return docs.map(x=>({id:x.id,...x.fields})).filter(e=>e.visibility==='public'&&e.active!==false).sort((a,b)=>new Date(a.date)-new Date(b.date));}
async function eventBundle(env,eventId){
  const e=await getDoc(env,'events',eventId);
  if(!e||e.fields.visibility!=='public'||e.fields.active===false)return null;
  const [tickets,tables,bottles,raffles]=await Promise.all([
    queryWhere(env,'ticket_types',[{field:'eventId',value:eventId}]),
    queryWhere(env,'table_packages',[{field:'eventId',value:eventId}]),
    queryWhere(env,'bottles',[{field:'eventId',value:eventId}]),
    queryWhere(env,'raffles',[{field:'eventId',value:eventId}]),
  ]);
  return {
    event:{id:eventId,...e.fields},
    ticketTypes:tickets.filter(x=>x.fields.active!==false).map(x=>({id:x.id,...x.fields})),
    tablePackages:tables.filter(x=>x.fields.active!==false).map(x=>({id:x.id,...x.fields})),
    bottles:bottles.filter(x=>x.fields.active!==false).map(x=>({id:x.id,...x.fields})),
    // Whitelisted, never a raw spread: raffles also carry winnerTicketId (a secure ticket token)
    // and drawnBy (a staff uid) once drawn — neither may ever reach a public response.
    raffle:(x=>x?{
      id:x.id,
      prize:x.fields.prize||'',
      title:x.fields.title||'',
      description:x.fields.description||'',
      status:x.fields.status||'open',
      cap:Number(x.fields.cap)>0?Number(x.fields.cap):20,
      spotsTaken:Number(x.fields.spotsTaken||0),
      winnerDisplay:x.fields.status==='drawn'?{name:x.fields.winnerDisplayName||'Winner',code:x.fields.winnerDisplayCode||''}:null,
    }:null)(raffles.find(x=>x.fields.public===true&&x.fields.enabled===true)),
  };
}
function allowedOrigin(callbackUrl,env){try{const origin=new URL(callbackUrl).origin;return (env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).includes(origin);}catch{return false;}}

async function initiateTicket(env,b){
  const {eventId,ticketTypeId,quantity,buyerName,buyerPhone,buyerEmail,identityLine,callbackUrl}=b||{};
  if(!eventId||!ticketTypeId||!buyerName||!buyerPhone||!buyerEmail)return {error:'Please complete your details.'};
  const qty=Number(quantity);if(!Number.isInteger(qty)||qty<1||qty>6)return {error:'Quantity must be between 1 and 6.'};
  if(!allowedOrigin(callbackUrl,env))return {error:'Invalid callback URL.'};
  const [ev,tt]=await Promise.all([getDoc(env,'events',eventId),getDoc(env,'ticket_types',ticketTypeId)]);
  if(!ev||!tt||ev.fields.active===false||ev.fields.visibility!=='public'||tt.fields.eventId!==eventId||tt.fields.active!==true)return {error:'This ticket is no longer available.'};
  if(typeof tt.fields.remaining==='number'&&tt.fields.remaining<qty)return {error:'Not enough tickets remaining.'};
  const amount=Number(tt.fields.pricePesewas||0)*qty;if(amount<=0)return {error:'Invalid ticket price.'};
  const reference=ref();
  await setDoc(env,'pending_checkouts',reference,{reference,kind:'ticket',eventId,eventName:ev.fields.name||'',ticketTypeId,ticketTypeName:tt.fields.name||'Ticket',admits:Number(tt.fields.admits||1),quantity:qty,amountPesewas:amount,buyerName,buyerPhone,buyerEmail,identityLine:identityLine||'FULLY ACTIVE.',status:'pending',createdAt:now()});
  try{const p=await paystack(env,'/transaction/initialize',{method:'POST',body:JSON.stringify({email:buyerEmail,amount,reference,callback_url:callbackUrl,metadata:{kind:'ticket',eventId,ticketTypeId,quantity:qty}})});return {reference,authorizationUrl:p.authorization_url};}
  catch(e){await setDoc(env,'pending_checkouts',reference,{reference,kind:'ticket',eventId,status:'failed',error:'payment_initialization_failed',failedAt:now()});throw e;}
}

// A ticket order takes a raffle spot only once it is fully paid, only while the event's raffle
// is open, and only if the cap has not already been reached — the check happens inside the same
// transaction as ticket issuance so two orders racing for the last spot can't both take it.
// Returns null (grant nothing) or {raffleId, fields, cap, spotsTaken} for the caller to build the
// entry + counter writes against the actual ticket id(s) it ends up issuing.
async function openRaffleForEvent(env,tx,eventId){
  const raffles=await queryWhere(env,'raffles',[{field:'eventId',value:eventId}],{transaction:tx});
  const raffle=raffles.find(r=>r.fields.enabled===true&&r.fields.status==='open');
  if(!raffle)return null;
  const cap=Number(raffle.fields.cap)>0?Number(raffle.fields.cap):20;
  const spotsTaken=Number(raffle.fields.spotsTaken||0);
  if(spotsTaken>=cap)return null;
  return {raffleId:raffle.id,fields:raffle.fields,cap,spotsTaken};
}
function raffleSpotWrites(env,raffle,eventId,ticketId,orderId){
  if(!raffle)return [];
  const nextTaken=raffle.spotsTaken+1;
  return [
    updateWrite(env,'raffle_entries',id(),{raffleId:raffle.raffleId,eventId,ticketId,orderId,status:'eligible',createdAt:now()}),
    updateWrite(env,'raffles',raffle.raffleId,{...raffle.fields,spotsTaken:nextTaken,status:nextTaken>=raffle.cap?'closed':'open',updatedAt:now()}),
  ];
}

async function fulfillTicket(env,reference){
  const pending=await getDoc(env,'pending_checkouts',reference);if(!pending)return {status:'failed',error:'Checkout not found.'};
  if(pending.fields.status==='issued')return {status:'issued',ticketIds:pending.fields.ticketIds||[],orderId:pending.fields.orderId};
  if(pending.fields.status==='failed')return {status:'failed',error:pending.fields.error||'Payment was not successful.'};
  const payment=await paystack(env,`/transaction/verify/${encodeURIComponent(reference)}`);
  if(payment.status!=='success')return {status:'pending'};
  if(payment.currency!=='GHS'||Number(payment.amount)!==Number(pending.fields.amountPesewas)){await setDoc(env,'pending_checkouts',reference,{...pending.fields,status:'failed',error:'amount_mismatch'});return {status:'failed',error:'Payment amount did not match. Contact support.'};}
  return withTransaction(env,async tx=>{
    const got=await batchGet(env,[`pending_checkouts/${reference}`,`ticket_types/${pending.fields.ticketTypeId}`],tx);
    const fresh=foundFields(got,`/pending_checkouts/${reference}`);
    const tt=foundFields(got,`/ticket_types/${pending.fields.ticketTypeId}`);
    if(!fresh||!tt)throw new Error('Checkout data disappeared.');
    if(fresh.fields.status==='issued')return {status:'issued',ticketIds:fresh.fields.ticketIds||[]};
    const remaining=typeof tt.fields.remaining==='number'?tt.fields.remaining:null;
    if(remaining!==null&&remaining<pending.fields.quantity){await commitTx(env,[updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'failed',error:'sold_out_after_payment',refundStatus:'manual_required'})],tx);return {status:'failed',error:'Tickets sold out while payment was being confirmed. Contact support.'};}
    const orderId=id();
    const raffle=await openRaffleForEvent(env,tx,pending.fields.eventId);
    const inDraw=!!raffle;
    const ticketIds=[];const writes=[];
    for(let i=0;i<pending.fields.quantity;i++){const token=ticketToken();ticketIds.push(token);writes.push(updateWrite(env,'tickets',token,{customerName:pending.fields.buyerName,type:pending.fields.ticketTypeName,admitCount:pending.fields.admits||1,eventId:pending.fields.eventId,eventName:pending.fields.eventName,identityLine:pending.fields.identityLine,reference,displayCode:`MEM-${token.slice(0,6).toUpperCase()}`,status:'valid',revoked:false,cancelled:false,inDraw,issuedAt:now()}));}
    writes.push(...raffleSpotWrites(env,raffle,pending.fields.eventId,ticketIds[0],orderId));
    writes.push(updateWrite(env,'orders',orderId,{orderId,kind:'ticket',reference,eventId:pending.fields.eventId,eventName:pending.fields.eventName,ticketTypeId:pending.fields.ticketTypeId,ticketTypeName:pending.fields.ticketTypeName,quantity:pending.fields.quantity,amountPesewas:pending.fields.amountPesewas,buyerName:pending.fields.buyerName,buyerPhone:pending.fields.buyerPhone,buyerEmail:pending.fields.buyerEmail,status:'confirmed',inDraw,createdAt:now()}));
    writes.push(updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'issued',ticketIds,orderId,issuedAt:now()}));
    if(remaining!==null)writes.push(updateWrite(env,'ticket_types',pending.fields.ticketTypeId,{...tt.fields,remaining:remaining-pending.fields.quantity}));
    await commitTx(env,writes,tx);
    try{await sendBrevo(env,pending.fields.buyerEmail,'Your Memories ticket is ready',`<h1>Your night is locked in.</h1><p>${pending.fields.eventName}</p><p>Reference: ${reference}</p><p>${ticketIds.map(t=>`MEM-${t.slice(0,6).toUpperCase()}`).join(', ')}</p>`);}catch{}
    return {status:'issued',ticketIds,orderId};
  });
}

async function initiateTable(env,b){
  const {eventId,packageId,name,phone,email,callbackUrl,bottles=[]}=b||{};if(!eventId||!packageId||!name||!phone||!email)return {error:'Please complete your details.'};if(!allowedOrigin(callbackUrl,env))return {error:'Invalid callback URL.'};
  const [ev,pkg]=await Promise.all([getDoc(env,'events',eventId),getDoc(env,'table_packages',packageId)]);
  if(!ev||!pkg||ev.fields.active===false||pkg.fields.eventId!==eventId||pkg.fields.active!==true)return {error:'This table is unavailable.'};
  const chosen=Array.isArray(bottles)?bottles.map(x=>({id:x.id,quantity:Number(x.quantity||0)})).filter(x=>Number.isInteger(x.quantity)&&x.quantity>0):[];
  let amount=Number(pkg.fields.pricePesewas||0);const bottleItems=[];
  for(const item of chosen){const btl=await getDoc(env,'bottles',item.id);if(!btl||btl.fields.eventId!==eventId||btl.fields.active===false)return {error:'A selected bottle is unavailable.'};if(typeof btl.fields.remaining==='number'&&btl.fields.remaining<item.quantity)return {error:`Not enough ${btl.fields.name||'bottle'} remaining.`};amount+=Number(btl.fields.pricePesewas||0)*item.quantity;bottleItems.push({id:item.id,name:btl.fields.name,quantity:item.quantity,unitPricePesewas:Number(btl.fields.pricePesewas||0)});}
  if(amount<=0)return {error:'Invalid table price.'};
  const reference=ref();
  await setDoc(env,'pending_checkouts',reference,{reference,kind:'table',eventId,eventName:ev.fields.name||'',packageId,packageName:pkg.fields.name||'',bottles:bottleItems,amountPesewas:amount,buyerName:name,buyerPhone:phone,buyerEmail:email,status:'pending',createdAt:now()});
  const p=await paystack(env,'/transaction/initialize',{method:'POST',body:JSON.stringify({email,amount,reference,callback_url:callbackUrl,metadata:{kind:'table',eventId,packageId,bottles:bottleItems}})});return {reference,authorizationUrl:p.authorization_url};
}

async function fulfillTable(env,reference){
  const pending=await getDoc(env,'pending_checkouts',reference);if(!pending)return {status:'failed',error:'Checkout not found.'};if(pending.fields.status==='issued')return {status:'issued',orderId:pending.fields.orderId};if(pending.fields.status==='failed')return {status:'failed',error:pending.fields.error||'Payment failed.'};
  const payment=await paystack(env,`/transaction/verify/${encodeURIComponent(reference)}`);if(payment.status!=='success')return {status:'pending'};if(payment.currency!=='GHS'||Number(payment.amount)!==Number(pending.fields.amountPesewas)){await setDoc(env,'pending_checkouts',reference,{...pending.fields,status:'failed',error:'amount_mismatch'});return {status:'failed',error:'Payment amount did not match. Contact support.'};}
  const bottlePaths=(pending.fields.bottles||[]).map(b=>`bottles/${b.id}`);
  return withTransaction(env,async tx=>{
    const got=await batchGet(env,[`pending_checkouts/${reference}`,`table_packages/${pending.fields.packageId}`,...bottlePaths],tx);
    const fresh=foundFields(got,`/pending_checkouts/${reference}`);
    const pkg=foundFields(got,`/table_packages/${pending.fields.packageId}`);
    if(!fresh||!pkg)throw new Error('Table checkout data disappeared.');
    if(fresh.fields.status==='issued')return {status:'issued',orderId:fresh.fields.orderId};
    if(typeof pkg.fields.remaining==='number'&&pkg.fields.remaining<1){await commitTx(env,[updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'failed',error:'table_sold_out_after_payment',refundStatus:'manual_required'})],tx);return {status:'failed',error:'The table sold out while payment was being confirmed. Contact support.'};}
    for(const item of pending.fields.bottles||[]){const b=foundFields(got,`/bottles/${item.id}`);if(!b)throw new Error('Bottle disappeared.');if(typeof b.fields.remaining==='number'&&b.fields.remaining<item.quantity){await commitTx(env,[updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'failed',error:'bottle_sold_out_after_payment',refundStatus:'manual_required'})],tx);return {status:'failed',error:'A selected bottle sold out while payment was being confirmed. Contact support.'};}}
    const writes=[];
    const orderId=id();writes.push(updateWrite(env,'orders',orderId,{orderId,kind:'table',reference,eventId:pending.fields.eventId,eventName:pending.fields.eventName,packageId:pending.fields.packageId,packageName:pending.fields.packageName,bottles:pending.fields.bottles||[],amountPesewas:pending.fields.amountPesewas,buyerName:pending.fields.buyerName,buyerPhone:pending.fields.buyerPhone,buyerEmail:pending.fields.buyerEmail,status:'confirmed',createdAt:now()}));
    writes.push(updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'issued',orderId,issuedAt:now()}));
    if(typeof pkg.fields.remaining==='number')writes.push(updateWrite(env,'table_packages',pending.fields.packageId,{...pkg.fields,remaining:pkg.fields.remaining-1}));
    for(const item of pending.fields.bottles||[]){const b=foundFields(got,`/bottles/${item.id}`);if(typeof b.fields.remaining==='number')writes.push(updateWrite(env,'bottles',item.id,{...b.fields,remaining:b.fields.remaining-item.quantity}));}
    await commitTx(env,writes,tx);
    try{await sendBrevo(env,pending.fields.buyerEmail,'Your Memories table is confirmed',`<h1>Your table is confirmed.</h1><p>${pending.fields.eventName}</p><p>${pending.fields.packageName}</p><p>Reference: ${reference}</p>`);}catch{}
    return {status:'issued',orderId};
  });
}

// ── Installment / partial ticket payments ──
// One installment_plans doc holds the full price and running total paid, keyed by the buyer's
// phone so they can find it again on a return visit. Every top-up is a normal Paystack charge
// tied back to the plan via a pending_checkouts entry (kind:'installment_topup'), reusing the
// same idempotent verify/fulfill machinery as ticket & table checkout. The ticket is only issued
// once the running total reaches the full price; the transaction below re-checks ticket_type
// stock at that moment, exactly like fulfillTicket does for a normal purchase.
async function startInstallment(env,b){
  const {eventId,ticketTypeId,quantity,buyerName,buyerPhone,buyerEmail,identityLine,depositPesewas,callbackUrl}=b||{};
  if(!eventId||!ticketTypeId||!buyerName||!buyerPhone||!buyerEmail)return {error:'Please complete your details.'};
  const qty=Number(quantity);if(!Number.isInteger(qty)||qty<1||qty>6)return {error:'Quantity must be between 1 and 6.'};
  if(!allowedOrigin(callbackUrl,env))return {error:'Invalid callback URL.'};
  const [ev,tt]=await Promise.all([getDoc(env,'events',eventId),getDoc(env,'ticket_types',ticketTypeId)]);
  if(!ev||!tt||ev.fields.active===false||ev.fields.visibility!=='public'||tt.fields.eventId!==eventId||tt.fields.active!==true)return {error:'This ticket is no longer available.'};
  if(new Date(ev.fields.date).getTime()<=Date.now())return {error:'This event has already happened.'};
  if(typeof tt.fields.remaining==='number'&&tt.fields.remaining<qty)return {error:'Not enough tickets remaining.'};
  const totalPesewas=Number(tt.fields.pricePesewas||0)*qty;if(totalPesewas<=0)return {error:'Invalid ticket price.'};
  const deposit=Number(depositPesewas);
  if(!Number.isInteger(deposit)||deposit<MIN_TOPUP_PESEWAS)return {error:'Minimum payment is GHS 10.'};
  if(deposit>totalPesewas)return {error:'Payment cannot exceed the ticket price.'};
  // Short human-typeable code (like a ticket reference) rather than an opaque id — the buyer
  // only has their phone number and this code to find the plan again on a return visit.
  let planId;
  for(let attempt=0;attempt<5;attempt++){
    const candidate=shortCode();
    try{
      await createDoc(env,'installment_plans',candidate,{eventId,eventName:ev.fields.name||'',ticketTypeId,ticketTypeName:tt.fields.name||'Ticket',admits:Number(tt.fields.admits||1),quantity:qty,totalPesewas,paidPesewas:0,buyerName,buyerPhone,buyerEmail,identityLine:identityLine||'FULLY ACTIVE.',status:'active',payments:[],createdAt:now(),updatedAt:now()});
      planId=candidate;
      break;
    }catch(e){ if(!String(e.message).includes('ALREADY_EXISTS'))throw e; }
  }
  if(!planId)return {error:'Could not start a payment plan right now. Please try again.'};
  return startInstallmentTopup(env,planId,deposit,callbackUrl,buyerEmail);
}
async function startInstallmentTopup(env,planId,amountPesewas,callbackUrl,buyerEmail){
  const reference=ref();
  await setDoc(env,'pending_checkouts',reference,{reference,kind:'installment_topup',planId,amountPesewas,buyerEmail,status:'pending',createdAt:now()});
  try{
    const p=await paystack(env,'/transaction/initialize',{method:'POST',body:JSON.stringify({email:buyerEmail,amount:amountPesewas,reference,callback_url:callbackUrl,metadata:{kind:'installment_topup',planId}})});
    return {reference,authorizationUrl:p.authorization_url,planId};
  }catch(e){
    await setDoc(env,'pending_checkouts',reference,{reference,kind:'installment_topup',planId,amountPesewas,status:'failed',error:'payment_initialization_failed',failedAt:now()});
    throw e;
  }
}
async function topupInstallment(env,b){
  const {planId,amountPesewas,callbackUrl}=b||{};
  if(!planId)return {error:'planId is required.'};
  if(!allowedOrigin(callbackUrl,env))return {error:'Invalid callback URL.'};
  const plan=await getDoc(env,'installment_plans',planId);
  if(!plan)return {error:'Payment plan not found.'};
  const forfeited=await maybeForfeitPlan(env,plan);
  if(forfeited)return {error:'This payment plan was forfeited because the event date has passed.'};
  if(plan.fields.status!=='active')return {error:plan.fields.status==='completed'?'This plan is already fully paid.':'This payment plan is no longer active.'};
  const remaining=Number(plan.fields.totalPesewas)-Number(plan.fields.paidPesewas||0);
  const amount=Number(amountPesewas);
  if(!Number.isInteger(amount)||amount<MIN_TOPUP_PESEWAS)return {error:'Minimum payment is GHS 10.'};
  if(amount>remaining)return {error:'Payment cannot exceed the remaining balance.'};
  return startInstallmentTopup(env,planId,amount,callbackUrl,plan.fields.buyerEmail);
}
async function maybeForfeitPlan(env,plan){
  if(plan.fields.status!=='active')return plan.fields.status==='forfeited';
  const ev=await getDoc(env,'events',plan.fields.eventId);
  if(ev&&new Date(ev.fields.date).getTime()<=Date.now()){
    await setDoc(env,'installment_plans',plan.id,{...plan.fields,status:'forfeited',updatedAt:now()});
    return true;
  }
  return false;
}
function planSummary(p){return {planId:p.id,eventId:p.fields.eventId,eventName:p.fields.eventName,ticketTypeName:p.fields.ticketTypeName,quantity:p.fields.quantity,totalPesewas:p.fields.totalPesewas,paidPesewas:p.fields.paidPesewas,status:p.fields.status};}
async function lookupInstallments(env,{phone,code}){
  if(code){const p=await getDoc(env,'installment_plans',code.toUpperCase());return p&&p.fields.status!=='completed'?[planSummary(p)]:[];}
  const plans=await queryWhere(env,'installment_plans',[{field:'buyerPhone',value:phone}]);
  return plans.filter(p=>p.fields.status!=='completed').map(planSummary);
}
async function fulfillInstallment(env,reference){
  const pending=await getDoc(env,'pending_checkouts',reference);if(!pending)return {status:'failed',error:'Checkout not found.'};
  if(pending.fields.status==='issued')return {status:'issued',kind:'installment',planId:pending.fields.planId,ticketIds:pending.fields.ticketIds||[],planComplete:pending.fields.planComplete===true};
  if(pending.fields.status==='failed')return {status:'failed',error:pending.fields.error||'Payment was not successful.'};
  const payment=await paystack(env,`/transaction/verify/${encodeURIComponent(reference)}`);
  if(payment.status!=='success')return {status:'pending'};
  if(payment.currency!=='GHS'||Number(payment.amount)!==Number(pending.fields.amountPesewas)){await setDoc(env,'pending_checkouts',reference,{...pending.fields,status:'failed',error:'amount_mismatch'});return {status:'failed',error:'Payment amount did not match. Contact support.'};}
  const planId=pending.fields.planId;
  return withTransaction(env,async tx=>{
    const got=await batchGet(env,[`pending_checkouts/${reference}`,`installment_plans/${planId}`],tx);
    const fresh=foundFields(got,`/pending_checkouts/${reference}`);
    const plan=foundFields(got,`/installment_plans/${planId}`);
    if(!fresh||!plan)throw new Error('Installment plan data disappeared.');
    if(fresh.fields.status==='issued')return {status:'issued',kind:'installment',planId,ticketIds:fresh.fields.ticketIds||[],planComplete:fresh.fields.planComplete===true};
    if(plan.fields.status==='forfeited'){
      await commitTx(env,[updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'failed',error:'plan_forfeited',refundStatus:'manual_required'})],tx);
      return {status:'failed',error:'This payment plan was forfeited. Contact support.'};
    }
    // topupInstallment() already refuses a top-up against a completed plan, but a stray charge
    // (a race with the completing payment, or a retried request) can still reach here — the
    // payment is real money already taken, so record it and stay complete rather than crediting
    // it toward a second ticket.
    if(plan.fields.status==='completed'){
      await commitTx(env,[updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'issued',planComplete:true,ticketIds:plan.fields.ticketIds||[],orderId:plan.fields.orderId,issuedAt:now()}),updateWrite(env,'installment_plans',planId,{...plan.fields,paidPesewas:Number(plan.fields.paidPesewas||0)+Number(fresh.fields.amountPesewas||0),payments:[...(plan.fields.payments||[]),{reference,amountPesewas:fresh.fields.amountPesewas,paidAt:now(),note:'overpayment_after_completion'}],updatedAt:now()})],tx);
      return {status:'issued',kind:'installment',planId,ticketIds:plan.fields.ticketIds||[],planComplete:false};
    }
    const paidPesewas=Number(plan.fields.paidPesewas||0)+Number(fresh.fields.amountPesewas||0);
    const payments=[...(plan.fields.payments||[]),{reference,amountPesewas:fresh.fields.amountPesewas,paidAt:now()}];
    const writes=[];
    let planComplete=false,ticketIds=[],orderId=null;
    if(paidPesewas>=plan.fields.totalPesewas){
      const ttGot=await batchGet(env,[`ticket_types/${plan.fields.ticketTypeId}`],tx);
      const tt=foundFields(ttGot,`/ticket_types/${plan.fields.ticketTypeId}`);
      const remaining=tt&&typeof tt.fields.remaining==='number'?tt.fields.remaining:null;
      if(remaining!==null&&remaining<plan.fields.quantity){
        writes.push(updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'failed',error:'sold_out_after_payment',refundStatus:'manual_required'}));
        writes.push(updateWrite(env,'installment_plans',planId,{...plan.fields,paidPesewas,payments,updatedAt:now()}));
        await commitTx(env,writes,tx);
        return {status:'failed',error:'Tickets sold out while your final payment was being confirmed. Contact support.'};
      }
      planComplete=true;
      orderId=id();
      const raffle=await openRaffleForEvent(env,tx,plan.fields.eventId);
      const inDraw=!!raffle;
      for(let i=0;i<plan.fields.quantity;i++){const token=ticketToken();ticketIds.push(token);writes.push(updateWrite(env,'tickets',token,{customerName:plan.fields.buyerName,type:plan.fields.ticketTypeName,admitCount:plan.fields.admits||1,eventId:plan.fields.eventId,eventName:plan.fields.eventName,identityLine:plan.fields.identityLine,reference,displayCode:`MEM-${token.slice(0,6).toUpperCase()}`,status:'valid',revoked:false,cancelled:false,inDraw,issuedAt:now()}));}
      writes.push(...raffleSpotWrites(env,raffle,plan.fields.eventId,ticketIds[0],orderId));
      writes.push(updateWrite(env,'orders',orderId,{orderId,kind:'ticket',reference,eventId:plan.fields.eventId,eventName:plan.fields.eventName,ticketTypeId:plan.fields.ticketTypeId,ticketTypeName:plan.fields.ticketTypeName,quantity:plan.fields.quantity,amountPesewas:plan.fields.totalPesewas,buyerName:plan.fields.buyerName,buyerPhone:plan.fields.buyerPhone,buyerEmail:plan.fields.buyerEmail,status:'confirmed',inDraw,paidInInstallments:true,planId,createdAt:now()}));
      if(remaining!==null)writes.push(updateWrite(env,'ticket_types',plan.fields.ticketTypeId,{...tt.fields,remaining:remaining-plan.fields.quantity}));
      writes.push(updateWrite(env,'installment_plans',planId,{...plan.fields,paidPesewas,payments,status:'completed',ticketIds,orderId,updatedAt:now()}));
    }else{
      writes.push(updateWrite(env,'installment_plans',planId,{...plan.fields,paidPesewas,payments,updatedAt:now()}));
    }
    writes.push(updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'issued',planComplete,ticketIds,orderId,issuedAt:now()}));
    await commitTx(env,writes,tx);
    // One SMS per successful top-up, sent only from this freshly-committed branch — a duplicate
    // call for the same Paystack reference (webhook + client poll both landing) hits the
    // fresh.fields.status==='issued' early-return above and never reaches here twice.
    const continueLink=`${(env.PUBLIC_SITE_URL||'').replace(/\/$/,'')}/installment.html?code=${planId}`;
    try{
      if(planComplete){
        const ticketLink=`${(env.PUBLIC_SITE_URL||'').replace(/\/$/,'')}/ticket.html?token=${ticketIds[0]}`;
        await sendSms(env,plan.fields.buyerPhone,`MEMORIES NIGHT CLUB\nPaid in full — your ticket for ${plan.fields.eventName} is ready.\nOpen: ${ticketLink}`);
        await sendBrevo(env,plan.fields.buyerEmail,'Your Memories ticket is ready',`<h1>Payment plan complete.</h1><p>${plan.fields.eventName}</p><p>${ticketIds.map(t=>`MEM-${t.slice(0,6).toUpperCase()}`).join(', ')}</p>`);
      }else{
        const remaining=Number(plan.fields.totalPesewas)-paidPesewas;
        await sendSms(env,plan.fields.buyerPhone,`MEMORIES NIGHT CLUB\n${moneyStr(fresh.fields.amountPesewas)} received for your ticket.\nBalance: ${moneyStr(remaining)}.\nContinue payment: ${continueLink}`);
      }
    }catch{}
    return {status:'issued',kind:'installment',planId,ticketIds,planComplete,orderId};
  });
}
// Proactive sweep — belt-and-suspenders alongside the lazy check in topupInstallment, so a plan
// whose buyer never comes back to top up (or check status) still gets marked forfeited.
async function forfeitStalePlans(env){
  const active=await queryWhere(env,'installment_plans',[{field:'status',value:'active'}]);
  let forfeited=0;
  for(const plan of active){
    const ev=await getDoc(env,'events',plan.fields.eventId);
    if(ev&&new Date(ev.fields.date).getTime()<=Date.now()){
      await setDoc(env,'installment_plans',plan.id,{...plan.fields,status:'forfeited',updatedAt:now()});
      forfeited++;
    }
  }
  return {checked:active.length,forfeited};
}

async function fulfill(env,reference){
  const p=await getDoc(env,'pending_checkouts',reference);if(!p)return {status:'failed',error:'Checkout not found.'};
  if(p.fields.kind==='table')return fulfillTable(env,reference);
  if(p.fields.kind==='installment_topup')return fulfillInstallment(env,reference);
  return fulfillTicket(env,reference);
}

// ── Check-in (atomic, retried on contention) ──
async function checkin(env,token,user){
  return withTransaction(env,async tx=>{
    const got=await batchGet(env,[`tickets/${token}`],tx);
    const f=got.find(x=>x.found)?.found;
    if(!f)return {valid:false,message:'Ticket not found.'};
    const t=parseFields(f.fields);
    if(t.revoked||t.cancelled)return {valid:false,message:'This ticket has been cancelled.',ticket:t};
    if(t.status==='used')return {valid:false,message:'TICKET ALREADY USED',ticket:t};
    const when=now();
    await commitTx(env,[
      updateWrite(env,'tickets',token,{...t,status:'used',checkedInAt:when,checkedInBy:user.uid||user.sub}),
      updateWrite(env,'checkins',id(),{ticketId:token,eventId:t.eventId,checkedInAt:when,checkedInBy:user.uid||user.sub}),
    ],tx);
    return {valid:true,message:'ENTRY CONFIRMED',ticket:{...t,status:'used'}};
  });
}

async function adminOverview(env){
  const [ev,tickets,orders,checks,requests]=await Promise.all([publicEvents(env),listDocs(env,'tickets'),listDocs(env,'orders'),listDocs(env,'checkins'),listDocs(env,'private_event_requests')]);
  const revenuePesewas=orders.filter(o=>o.fields.status==='confirmed').reduce((s,o)=>s+Number(o.fields.amountPesewas||0),0);
  return {events:ev,tickets:tickets.length,orders:orders.length,checkins:checks.length,privateRequests:requests.length,revenuePesewas};
}

// ── Site settings — single source of truth for contact info the public site displays ──
const DEFAULT_SETTINGS={phone:'',email:'',instagram:'@memoriesnightclub.gh',whatsapp:'',venue:'Cape Coast',doorsLine:'10PM',address:''};
async function getSettings(env){
  const d=await getDoc(env,'settings','site');
  return {...DEFAULT_SETTINGS,...(d?.fields||{})};
}
async function updateSettings(env,b,user){
  if(!requireRole(user,['superAdmin','manager']))return {error:'Forbidden.',status:403};
  const allowed=['phone','email','instagram','whatsapp','venue','doorsLine','address'];
  const data={};
  for(const k of allowed){if(b[k]!==undefined)data[k]=String(b[k]).trim().slice(0,200);}
  data.updatedAt=now();
  const existing=await getDoc(env,'settings','site');
  await setDoc(env,'settings','site',{...(existing?.fields||{}),...data});
  await setDoc(env,'audit_logs',id(),{action:'SETTINGS_UPDATED',actorUid:user.uid||user.sub,fields:Object.keys(data),timestamp:now()});
  return {success:true};
}
async function adminCatalog(env){
  const [events,tickets,tables,bottles]=await Promise.all([listDocs(env,'events'),listDocs(env,'ticket_types'),listDocs(env,'table_packages'),listDocs(env,'bottles')]);
  const names=Object.fromEntries(events.map(e=>[e.id,e.fields.name||e.id]));
  return {
    ticketTypes:tickets.map(x=>({id:x.id,eventName:names[x.fields.eventId],...x.fields})),
    tablePackages:tables.map(x=>({id:x.id,eventName:names[x.fields.eventId],...x.fields})),
    bottles:bottles.map(x=>({id:x.id,eventName:names[x.fields.eventId],...x.fields})),
  };
}
async function adminRaffles(env){const [rs,events,entries]=await Promise.all([listDocs(env,'raffles'),listDocs(env,'events'),listDocs(env,'raffle_entries')]);const names=Object.fromEntries(events.map(e=>[e.id,e.fields.name||e.id]));return {raffles:rs.map(r=>({id:r.id,eventName:names[r.fields.eventId],entryCount:entries.filter(x=>x.fields.raffleId===r.id).length,...r.fields}))};}

// ── Private-night requests — accept/decline/note workflow ──
async function updatePrivateRequest(env,requestId,b,user){
  if(!requireRole(user,['superAdmin','manager','eventManager']))return {error:'Forbidden.',status:403};
  const existing=await getDoc(env,'private_event_requests',requestId);
  if(!existing)return {error:'Request not found.',status:404};
  const validStatuses=['NEW','ACCEPTED','DECLINED'];
  const status=validStatuses.includes(b.status)?b.status:existing.fields.status;
  const note=b.note!==undefined?String(b.note).slice(0,2000):(existing.fields.note||'');
  const when=now();
  await setDoc(env,'private_event_requests',requestId,{...existing.fields,status,note,updatedAt:when,updatedBy:user.uid||user.sub});
  await setDoc(env,'audit_logs',id(),{action:'PRIVATE_REQUEST_UPDATED',actorUid:user.uid||user.sub,requestId,status,timestamp:when});
  if(status!==existing.fields.status&&(status==='ACCEPTED'||status==='DECLINED')){
    const line=status==='ACCEPTED'
      ?`MEMORIES NIGHT CLUB\nGood news — we've got your private night. We'll be in touch to confirm details.`
      :`MEMORIES NIGHT CLUB\nWe can't hold that date for a private night, sorry. Reach out and we'll find another.`;
    try{if(existing.fields.phone)await sendSms(env,existing.fields.phone,line);}catch{}
    try{if(existing.fields.email)await sendBrevo(env,existing.fields.email,status==='ACCEPTED'?'Your Memories private night is confirmed':'About your Memories private night request',`<p>${line.split('\n').join('<br>')}</p>`);}catch{}
  }
  return {success:true};
}

// ── Installment plans — admin visibility (read-only; every state change still goes through the
// same transactional fulfillInstallment/maybeForfeitPlan paths, never a direct admin write) ──
async function adminInstallments(env){
  const plans=await listDocs(env,'installment_plans');
  return {plans:plans.map(p=>({id:p.id,...p.fields})).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))};
}

async function handleAdminEvent(env,b,user){
  if(!requireRole(user,['superAdmin','manager','eventManager']))return {error:'Forbidden.',status:403};
  const data={name:String(b.name||'').trim(),slug:String(b.slug||b.name||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),artwork:String(b.artwork||''),date:b.date,doors:String(b.doors||'10PM'),venue:String(b.venue||'Cape Coast'),visibility:b.visibility==='public'?'public':'private',active:b.active!==false,featured:b.featured===true,ticketLines:Array.isArray(b.ticketLines)?b.ticketLines.slice(0,12).map(String):[],organiserId:b.organiserId?String(b.organiserId).trim():null,updatedAt:now()};
  if(!data.name||!data.date)return {error:'Name and date are required.'};
  const eventId=b.id||id();
  const existing=await getDoc(env,'events',eventId);
  await setDoc(env,'events',eventId,{...(existing?.fields||{}),...data,createdAt:existing?.fields?.createdAt||now()});
  return {success:true,eventId};
}
async function deleteEvent(env,eventId,user){
  if(!requireRole(user,['superAdmin']))return {error:'Forbidden.',status:403};
  await deleteDoc(env,'events',eventId);
  return {success:true};
}

// ── Admin catalog CRUD ──
async function adminUpsertCatalog(env,collection,b,user){
  if(!requireRole(user,['superAdmin','manager','eventManager']))return {error:'Forbidden.',status:403};
  if(!b.eventId)return {error:'eventId is required.'};
  const docId=b.id||id();
  const allowed={
    ticket_types:['eventId','name','pricePesewas','admits','remaining','active','description'],
    table_packages:['eventId','name','pricePesewas','remaining','active','description','capacity'],
    bottles:['eventId','name','pricePesewas','remaining','active','category'],
  }[collection];
  if(!allowed)return {error:'Unknown collection.'};
  const data={};
  for(const k of allowed){if(b[k]!==undefined)data[k]=b[k];}
  data.eventId=b.eventId;
  if(b.remaining===undefined&&b.total!==undefined){data.remaining=Number(b.total);}
  data.updatedAt=now();
  const existing=await getDoc(env,collection,docId);
  await setDoc(env,collection,docId,{...(existing?.fields||{}),...data,createdAt:existing?.fields?.createdAt||now()});
  return {success:true,id:docId};
}
async function adminDeleteCatalog(env,collection,docId,user){
  if(!requireRole(user,['superAdmin','manager','eventManager']))return {error:'Forbidden.',status:403};
  await deleteDoc(env,collection,docId);
  return {success:true};
}

async function createRaffle(env,b,user){
  if(!requireRole(user,['superAdmin','manager','eventManager']))return {error:'Forbidden.',status:403};
  if(!b.eventId||!b.prize)return {error:'eventId and prize are required.'};
  const rid=b.id||id();
  const existing=await getDoc(env,'raffles',rid);
  const cap=Number(b.cap);
  // status and spotsTaken are server-managed (they move only as tickets fill the cap, or the
  // draw runs) — this endpoint never lets a client jump the count or reopen a closed raffle.
  const data={
    eventId:b.eventId,
    title:String(b.title||''),
    prize:String(b.prize),
    description:String(b.description||''),
    cap:Number.isInteger(cap)&&cap>0?cap:(existing?.fields?.cap||20),
    enabled:b.enabled!==false,
    public:b.public!==false,
    spotsTaken:existing?.fields?.spotsTaken||0,
    status:existing?.fields?.status||'open',
  };
  await setDoc(env,'raffles',rid,{...(existing?.fields||{}),...data,createdAt:existing?.fields?.createdAt||now(),updatedAt:now()});
  return {success:true,raffleId:rid};
}

// Turns a full legal name into a privacy-safe public display ("Jeffery E.") — never expose the
// raw ticket token or the buyer's full details on a public page.
function safeWinnerName(customerName){
  const parts=String(customerName||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length)return 'Winner';
  const first=parts[0];
  const lastInitial=parts[1]?.[0];
  return lastInitial?`${first} ${lastInitial}.`:first;
}

// ── Raffle draw (atomic, retried on contention) ──
async function drawRaffle(env,b,user){
  if(!requireRole(user,['superAdmin','manager','eventManager']))return {error:'Forbidden.',status:403};
  const raffleId=b?.raffleId;
  if(!raffleId)return {error:'raffleId is required.'};
  try{
    const result=await withTransaction(env,async tx=>{
      const got=await batchGet(env,[`raffles/${raffleId}`],tx);
      const f=foundFields(got,`/raffles/${raffleId}`);
      if(!f)throw Object.assign(new Error('Raffle not found.'),{clientError:true});
      if(f.fields.status==='drawn')throw Object.assign(new Error('This raffle has already been drawn.'),{clientError:true});
      const entries=await queryWhere(env,'raffle_entries',[{field:'raffleId',value:raffleId},{field:'status',value:'eligible'}],{transaction:tx});
      if(!entries.length)throw Object.assign(new Error('No eligible entries.'),{clientError:true});
      const rnd=new Uint32Array(1);crypto.getRandomValues(rnd);
      const winner=entries[rnd[0]%entries.length];
      // Pull the winner's ticket (name/code — safe to show publicly) and their order (phone — for
      // the SMS only, never returned to any client) inside the same transaction.
      const winnerGot=await batchGet(env,[`tickets/${winner.fields.ticketId}`,...(winner.fields.orderId?[`orders/${winner.fields.orderId}`]:[])],tx);
      const winnerTicket=foundFields(winnerGot,`/tickets/${winner.fields.ticketId}`);
      const winnerOrder=winner.fields.orderId?foundFields(winnerGot,`/orders/${winner.fields.orderId}`):null;
      const winnerDisplayName=safeWinnerName(winnerTicket?.fields.customerName);
      const winnerDisplayCode=winnerTicket?.fields.displayCode||'';
      const when=now();
      // The raffles doc is client-readable (public site reads it directly from Firestore, per
      // firestore.rules `resource.data.public == true`), so it must NEVER carry the raw
      // winnerTicketId — that ticket-doc ID doubles as the ticket's bearer token
      // (`allow get: if true` on /tickets/{id}), so leaking it here would let anyone open the
      // winner's ticket. Only the privacy-safe display name/code go on the public doc; the raw
      // IDs live on the (admin-only, write:false-to-clients) raffle_entries + audit_logs docs.
      await commitTx(env,[
        updateWrite(env,'raffles',raffleId,{...f.fields,status:'drawn',winnerDisplayName,winnerDisplayCode,drawnAt:when}),
        updateWrite(env,'raffle_entries',winner.id,{...winner.fields,status:'won'}),
        updateWrite(env,'audit_logs',id(),{action:'RAFFLE_DRAWN',actorUid:user.uid||user.sub,raffleId,eventId:f.fields.eventId,eligibleEntryCount:entries.length,winnerEntryId:winner.id,winnerTicketId:winner.fields.ticketId,drawnBy:user.uid||user.sub,timestamp:when}),
      ],tx);
      return {winnerTicketId:winner.fields.ticketId,winnerDisplayName,winnerDisplayCode,winnerPhone:winnerOrder?.fields.buyerPhone,eventName:f.fields.eventId};
    });
    try{
      if(result.winnerPhone)await sendSms(env,result.winnerPhone,`MEMORIES NIGHT CLUB\nYou won the raffle! ${result.winnerDisplayName}, ticket ${result.winnerDisplayCode}.\nSee you at the door.`);
    }catch{}
    return {success:true,winnerTicketId:result.winnerTicketId,winnerDisplayName:result.winnerDisplayName};
  }catch(e){
    if(e.clientError)return {error:e.message,status:400};
    throw e;
  }
}

// ── Organiser view — scoped strictly to events where events/{id}.organiserId === their uid ──
// Read-only: the only write an organiser is ever granted is their own event's check-in, gated
// separately by requireRole(['organiser',...]) on /api/checkin — nothing here lets them touch
// price, artwork, lines, or the raffle configuration.
async function organiserOverview(env,user){
  const uid=user.uid||user.sub;
  const events=(await listDocs(env,'events')).filter(e=>e.fields.organiserId===uid);
  const results=[];
  for(const e of events){
    const [orders,checkins,plans,raffles]=await Promise.all([
      queryWhere(env,'orders',[{field:'eventId',value:e.id}]),
      queryWhere(env,'checkins',[{field:'eventId',value:e.id}]),
      queryWhere(env,'installment_plans',[{field:'eventId',value:e.id}]),
      queryWhere(env,'raffles',[{field:'eventId',value:e.id}]),
    ]);
    const confirmed=orders.filter(o=>o.fields.status==='confirmed');
    const ticketOrders=confirmed.filter(o=>o.fields.kind==='ticket');
    const tableOrders=confirmed.filter(o=>o.fields.kind==='table');
    const byType={};
    for(const o of ticketOrders){const name=o.fields.ticketTypeName||'Ticket';byType[name]=(byType[name]||0)+Number(o.fields.quantity||0);}
    const activePlans=plans.filter(p=>p.fields.status==='active');
    const moneyOwingPesewas=activePlans.reduce((s,p)=>s+Math.max(0,Number(p.fields.totalPesewas||0)-Number(p.fields.paidPesewas||0)),0);
    const raffle=raffles.find(r=>r.fields.enabled===true)||raffles[0]||null;
    results.push({
      eventId:e.id,eventName:e.fields.name,date:e.fields.date,visibility:e.fields.visibility,active:e.fields.active,
      ticketsSold:ticketOrders.reduce((s,o)=>s+Number(o.fields.quantity||0),0),
      ticketsSoldByType:byType,
      tablesSold:tableOrders.length,
      revenuePesewas:confirmed.reduce((s,o)=>s+Number(o.fields.amountPesewas||0),0),
      moneyOwingPesewas,
      partialOrdersCount:activePlans.length,
      checkins:checkins.length,
      raffle:raffle?{prize:raffle.fields.prize,cap:Number(raffle.fields.cap)>0?Number(raffle.fields.cap):20,spotsTaken:Number(raffle.fields.spotsTaken||0),status:raffle.fields.status,winnerDisplay:raffle.fields.status==='drawn'?{name:raffle.fields.winnerDisplayName||'Winner',code:raffle.fields.winnerDisplayCode||''}:null}:null,
    });
  }
  return {events:results};
}

export default {
  async fetch(req,env){
  const c=cors(req,env);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:c});
  const u=new URL(req.url);
  const p=u.pathname;
  try{
    // ═══ PUBLIC ROUTES ═══
    if(req.method==='GET'&&p==='/api/events')return ok(req,env,{success:true,events:await publicEvents(env)});
    if(req.method==='GET'&&p.startsWith('/api/events/')){const d=await eventBundle(env,decodeURIComponent(p.split('/').pop()));return d?ok(req,env,{success:true,...d}):fail(req,env,'Event not found.',404);}
    if(req.method==='GET'&&p==='/api/settings')return ok(req,env,{success:true,settings:await getSettings(env)});
    if(req.method==='POST'&&p==='/api/checkout/initiate'){if(rateLimited(req,'checkout-initiate',20,60000))return tooMany(req,env);const r=await initiateTicket(env,await req.json());return r.error?fail(req,env,r.error):ok(req,env,{success:true,...r});}
    if(req.method==='GET'&&p==='/api/checkout/status'){
      const reference=u.searchParams.get('reference');if(!reference)return fail(req,env,'Reference is required.');
      const d=await getDoc(env,'pending_checkouts',reference);if(!d)return fail(req,env,'Not found.',404);
      const out={success:true,status:d.fields.status,kind:d.fields.kind||'ticket',orderId:d.fields.orderId,eventName:d.fields.eventName,packageName:d.fields.packageName,amountPesewas:d.fields.amountPesewas,tickets:(d.fields.ticketIds||[]).map(token=>({token,ticketId:token})),error:d.fields.error};
      if(d.fields.kind==='installment_topup'&&d.fields.planId){
        const plan=await getDoc(env,'installment_plans',d.fields.planId);
        if(plan)Object.assign(out,{planId:d.fields.planId,planStatus:plan.fields.status,paidPesewas:plan.fields.paidPesewas,totalPesewas:plan.fields.totalPesewas,eventName:plan.fields.eventName,planComplete:d.fields.planComplete===true||plan.fields.status==='completed'});
      }
      return ok(req,env,out);
    }
    if(req.method==='POST'&&p==='/api/checkout/verify'){if(rateLimited(req,'checkout-verify',30,60000))return tooMany(req,env);const b=await req.json();if(!b.reference)return fail(req,env,'Reference is required.');return ok(req,env,{success:true,...await fulfill(env,b.reference)});}
    if(req.method==='POST'&&p==='/api/table-checkout/initiate'){if(rateLimited(req,'table-checkout-initiate',20,60000))return tooMany(req,env);const r=await initiateTable(env,await req.json());return r.error?fail(req,env,r.error):ok(req,env,{success:true,...r});}
    if(req.method==='POST'&&p==='/api/installments/start'){if(rateLimited(req,'installments-start',20,60000))return tooMany(req,env);const r=await startInstallment(env,await req.json());return r.error?fail(req,env,r.error):ok(req,env,{success:true,...r});}
    if(req.method==='POST'&&p==='/api/installments/topup'){if(rateLimited(req,'installments-topup',20,60000))return tooMany(req,env);const r=await topupInstallment(env,await req.json());return r.error?fail(req,env,r.error):ok(req,env,{success:true,...r});}
    if(req.method==='GET'&&p==='/api/installments/lookup'){const phone=(u.searchParams.get('phone')||'').trim();const code=(u.searchParams.get('code')||'').trim();if(!phone&&!code)return fail(req,env,'A phone number or order code is required.');return ok(req,env,{success:true,plans:await lookupInstallments(env,{phone,code})});}
    if(req.method==='GET'&&p.startsWith('/api/tickets/')){const token=decodeURIComponent(p.split('/').pop());const d=await getDoc(env,'tickets',token);if(!d)return fail(req,env,'Ticket not found.',404);const t=d.fields;const ev=await getDoc(env,'events',t.eventId);return ok(req,env,{success:true,ticket:{ticketId:token,customerName:t.customerName,type:t.type,admitCount:t.admitCount,eventId:t.eventId,eventName:t.eventName,identityLine:t.identityLine,status:t.status,revoked:t.revoked,cancelled:t.cancelled,displayCode:t.displayCode,inDraw:t.inDraw===true,eventDate:ev?.fields?.date,eventVenue:ev?.fields?.venue,eventDoors:ev?.fields?.doors,eventArtwork:ev?.fields?.artwork||''}});}
    if(req.method==='GET'&&p.startsWith('/api/verify/')){const token=decodeURIComponent(p.split('/').pop());const d=await getDoc(env,'tickets',token);if(!d)return ok(req,env,{success:true,valid:false,message:'Ticket not found.'});const t=d.fields;return ok(req,env,{success:true,valid:t.status==='valid'&&!t.revoked&&!t.cancelled,message:t.status==='valid'?'VALID TICKET':t.status==='used'?'TICKET ALREADY USED':'TICKET NOT VALID',ticket:{eventName:t.eventName,customerName:t.customerName,status:t.status,displayCode:t.displayCode}});}
    if(req.method==='POST'&&p==='/api/private-requests'){if(rateLimited(req,'private-requests',10,60000))return tooMany(req,env);const b=await req.json();if(!b.name||!b.phone||!b.email)return fail(req,env,'Please complete your details.');const rid=id();await setDoc(env,'private_event_requests',rid,{name:String(b.name).trim(),phone:String(b.phone).trim(),email:String(b.email).trim(),date:b.date||'',guests:Number(b.guests||0),eventType:String(b.eventType||'Private night'),message:String(b.message||'').slice(0,5000),status:'NEW',createdAt:now()});try{await sendBrevo(env,env.BREVO_SENDER_EMAIL,'New Memories private-night request',`<p>${String(b.name)}</p><p>${String(b.phone)}</p><p>${String(b.email)}</p>`);}catch{}return ok(req,env,{success:true,id:rid});}

    // ═══ PAYSTACK WEBHOOK ═══
    if(req.method==='POST'&&p==='/api/paystack/webhook'){const sig=req.headers.get('x-paystack-signature')||'';const raw=await req.text();const key=await crypto.subtle.importKey('raw',enc.encode(env.PAYSTACK_SECRET_KEY),{name:'HMAC',hash:'SHA-512'},false,['verify']);const valid=await crypto.subtle.verify('HMAC',key,fromHex(sig),enc.encode(raw));if(!valid)return text('ignored',200,c);const event=JSON.parse(raw);if(event.event==='charge.success'&&event.data?.reference)await fulfill(env,event.data.reference);return text('ok',200,c);}

    // ═══ SMS PROXY (admin only) ═══
    if(p==='/api/send-sms'&&req.method==='POST'){const user=await verifyStaff(req,env,['superAdmin','manager']);if(!user)return fail(req,env,'Unauthorized.',401);if(rateLimited(req,'send-sms',30,60000))return tooMany(req,env);const body=await req.text();const r=await proxySms(env,'/send-sms',{method:'POST',headers:{'Content-Type':'application/json'},body});return new Response(await r.text(),{status:r.status,headers:{...cors(req,env),'Content-Type':'application/json'}});}
    if(p==='/api/balance'&&req.method==='GET'){const user=await verifyStaff(req,env,['superAdmin','manager']);if(!user)return fail(req,env,'Unauthorized.',401);const r=await proxySms(env,'/balance',{method:'GET'});return new Response(await r.text(),{status:r.status,headers:{...cors(req,env),'Content-Type':'application/json'}});}

    // ═══ CHECK-IN (doorStaff+) ═══
    if(p==='/api/checkin'&&req.method==='POST'){const user=await verifyStaff(req,env,['superAdmin','manager','doorStaff']);if(!user)return fail(req,env,'Unauthorized.',401);if(rateLimited(req,'checkin',60,60000))return tooMany(req,env);const b=await req.json();if(!b.token)return fail(req,env,'Ticket token is required.');return ok(req,env,{success:true,...await checkin(env,b.token,user)});}

    // ═══ ADMIN ROUTES ═══
    const adminUser=p.startsWith('/api/admin/')?await verifyStaff(req,env):null;
    if(p.startsWith('/api/admin/')&&!adminUser)return fail(req,env,'Unauthorized.',401);

    if(req.method==='GET'&&p==='/api/admin/overview')return ok(req,env,{success:true,...await adminOverview(env)});
    if(req.method==='GET'&&p==='/api/admin/events')return ok(req,env,{success:true,events:(await listDocs(env,'events')).map(x=>({id:x.id,...x.fields})).sort((a,b)=>new Date(a.date)-new Date(b.date))});
    if(req.method==='POST'&&p==='/api/admin/events'){const r=await handleAdminEvent(env,await req.json(),adminUser);return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);}
    if(req.method==='DELETE'&&p.startsWith('/api/admin/events/')){const r=await deleteEvent(env,decodeURIComponent(p.split('/').pop()),adminUser);return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);}

    if(req.method==='GET'&&p==='/api/admin/catalog')return ok(req,env,{success:true,...await adminCatalog(env)});

    // Catalog CRUD — tickets, tables, bottles
    for(const col of ['ticket-types','table-packages','bottles']){
      const firestoreCol={ 'ticket-types':'ticket_types','table-packages':'table_packages','bottles':'bottles' }[col];
      if(req.method==='POST'&&p===`/api/admin/${col}`){
        const r=await adminUpsertCatalog(env,firestoreCol,await req.json(),adminUser);
        return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);
      }
      if(req.method==='DELETE'&&p.startsWith(`/api/admin/${col}/`)){
        const r=await adminDeleteCatalog(env,firestoreCol,decodeURIComponent(p.split('/').pop()),adminUser);
        return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);
      }
    }

    if(req.method==='GET'&&p==='/api/admin/raffles')return ok(req,env,{success:true,...await adminRaffles(env)});
    if(req.method==='POST'&&p==='/api/admin/raffles'){const r=await createRaffle(env,await req.json(),adminUser);return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);}
    if(req.method==='GET'&&p==='/api/admin/requests'){if(!requireRole(adminUser,['superAdmin','manager','eventManager']))return fail(req,env,'Forbidden.',403);const rs=(await listDocs(env,'private_event_requests')).map(x=>({id:x.id,...x.fields}));return ok(req,env,{success:true,requests:rs});}
    if(req.method==='POST'&&p.startsWith('/api/admin/requests/')){const requestId=decodeURIComponent(p.split('/').pop());const r=await updatePrivateRequest(env,requestId,await req.json(),adminUser);return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);}
    if(req.method==='POST'&&p==='/api/admin/checkin'){if(!requireRole(adminUser,['superAdmin','manager','doorStaff']))return fail(req,env,'Forbidden.',403);if(rateLimited(req,'admin-checkin',60,60000))return tooMany(req,env);const b=await req.json();if(!b.token)return fail(req,env,'Ticket token is required.');return ok(req,env,{success:true,...await checkin(env,b.token,adminUser)});}
    if(req.method==='POST'&&p==='/api/admin/raffle/draw'){if(rateLimited(req,'raffle-draw',10,60000))return tooMany(req,env);const r=await drawRaffle(env,await req.json(),adminUser);return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);}
    if(req.method==='POST'&&p==='/api/admin/set-role'){const r=await setRole(env,await req.json(),adminUser);return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);}
    if(req.method==='GET'&&p==='/api/admin/organiser/overview'){if(!requireRole(adminUser,['organiser','superAdmin']))return fail(req,env,'Forbidden.',403);return ok(req,env,{success:true,...await organiserOverview(env,adminUser)});}
    if(req.method==='GET'&&p==='/api/admin/installments'){if(!requireRole(adminUser,['superAdmin','manager']))return fail(req,env,'Forbidden.',403);return ok(req,env,{success:true,...await adminInstallments(env)});}
    if(req.method==='POST'&&p==='/api/admin/installments/resend-sms'){
      if(!requireRole(adminUser,['superAdmin','manager']))return fail(req,env,'Forbidden.',403);
      const b=await req.json();const plan=await getDoc(env,'installment_plans',b.planId||'');
      if(!plan)return fail(req,env,'Plan not found.',404);
      const remaining=Number(plan.fields.totalPesewas)-Number(plan.fields.paidPesewas||0);
      const continueLink=`${(env.PUBLIC_SITE_URL||'').replace(/\/$/,'')}/installment.html?code=${plan.id}`;
      await sendSms(env,plan.fields.buyerPhone,plan.fields.status==='completed'?`MEMORIES NIGHT CLUB\nYour ticket for ${plan.fields.eventName} is ready.\nOrder: ${plan.id}`:`MEMORIES NIGHT CLUB\nBalance on your ticket: GHS ${(remaining/100).toFixed(0)}.\nContinue payment: ${continueLink}`);
      await setDoc(env,'audit_logs',id(),{action:'INSTALLMENT_SMS_RESENT',actorUid:adminUser.uid||adminUser.sub,planId:plan.id,timestamp:now()});
      return ok(req,env,{success:true});
    }
    if(req.method==='POST'&&p==='/api/admin/settings'){const r=await updateSettings(env,await req.json(),adminUser);return r.error?fail(req,env,r.error,r.status||400):ok(req,env,r);}

    return fail(req,env,'Not found.',404);
  }catch(e){console.error(e);return fail(req,env,'Something went wrong. Please try again.',500);}
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil(forfeitStalePlans(env).catch(e=>console.error('forfeitStalePlans failed',e)));
  },
};

export { checkin, fulfillTicket, fulfillTable, fulfillInstallment, drawRaffle, startInstallment, topupInstallment, withTransaction, listDocs, queryWhere, forfeitStalePlans, setRole, organiserOverview, initiateTicket, initiateTable, startInstallmentTopup, requireRole, getSettings, updateSettings, updatePrivateRequest, adminInstallments, rateLimited };
