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
const enc=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64=s=>btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64=s=>{const p='='.repeat((4-s.length%4)%4);return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+p),c=>c.charCodeAt(0));};
const fromHex=s=>Uint8Array.from(s.match(/.{2}/g)||[],x=>parseInt(x,16));
const now=()=>new Date();
const id=()=>crypto.randomUUID().replaceAll('-','');
const ref=()=>`MEM-${Date.now()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
const ticketToken=()=>id()+id();

function firestoreValue(v){
  if(v===null)return {nullValue:null};
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

let googleToken={value:null,expires:0};
function serviceAccount(env){return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);}
async function googleAccessToken(env){
  if(googleToken.value&&Date.now()<googleToken.expires-60000)return googleToken.value;
  const sa=serviceAccount(env);
  const keyPem=sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const key=await crypto.subtle.importKey('pkcs8',fromB64(keyPem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const t=Math.floor(Date.now()/1000);
  const header=b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload=b64(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:t,exp:t+3600}));
  const signature=b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(`${header}.${payload}`)));
  const assertion=`${header}.${payload}.${signature}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const d=await r.json(); if(!r.ok)throw new Error('Google access token failed');
  googleToken={value:d.access_token,expires:Date.now()+d.expires_in*1000}; return d.access_token;
}
const basePath=env=>`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
async function fs(env,path,options={}){const token=await googleAccessToken(env);const r=await fetch(basePath(env)+path,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||`Firestore ${r.status}`);return d;}
async function getDoc(env,col,docId){try{const d=await fs(env,`/${col}/${encodeURIComponent(docId)}`);return d.name?{id:docId,fields:parseFields(d.fields)}:null;}catch(e){if(String(e.message).includes('NOT_FOUND'))return null;throw e;}}
async function listDocs(env,col){const d=await fs(env,`/${col}?pageSize=300`);return (d.documents||[]).map(x=>({id:x.name.split('/').pop(),fields:parseFields(x.fields)}));}
async function setDoc(env,col,docId,data){await fs(env,`/${col}/${encodeURIComponent(docId)}`,{method:'PATCH',body:JSON.stringify({fields:docFields(data)})});}
async function createDoc(env,col,docId,data){return fs(env,`/${col}?documentId=${encodeURIComponent(docId)}`,{method:'POST',body:JSON.stringify({fields:docFields(data)})});}
async function deleteDoc(env,col,docId){await fs(env,`/${col}/${encodeURIComponent(docId)}`,{method:'DELETE'});}

// ── Field-filtered query (single field, no composite index needed) ──
async function queryDocs(env,col,field,value,limit=500){
  const token=await googleAccessToken(env);
  const r=await fetch(`${basePath(env)}:runQuery`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:firestoreValue(value)}},limit}})
  });
  const d=await r.json();
  if(!r.ok)throw new Error(d.error?.message||'Firestore query failed');
  return (d||[]).filter(x=>x.document).map(x=>({id:x.document.name.split('/').pop(),fields:parseFields(x.document.fields)}));
}

async function beginTx(env){const d=await fs(env,':beginTransaction',{method:'POST',body:JSON.stringify({options:{readWrite:{}}})});return d.transaction;}
async function batchGet(env,paths,transaction){const token=await googleAccessToken(env);const docs=paths.map(p=>`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${p}`);const r=await fetch(`${basePath(env)}:batchGet`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({documents:docs,transaction})});const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'Firestore batchGet failed');return d;}
async function commitTx(env,writes,transaction){const token=await googleAccessToken(env);const r=await fetch(`${basePath(env)}:commit`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({writes,transaction})});const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'Firestore commit failed');return d;}
const updateWrite=(env,col,docId,data)=>({update:{name:`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`,fields:docFields(data)}});

async function verifyStaff(req,env,roles=['superAdmin','manager','eventManager','doorStaff']){
  const h=req.headers.get('Authorization')||''; if(!h.startsWith('Bearer '))return null;
  try{const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));const {payload}=await jwtVerify(h.slice(7),jwks,{issuer:`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,audience:env.FIREBASE_PROJECT_ID});if(payload.admin===true||roles.includes(payload.role))return payload;return null;}catch{return null;}
}
function requireRole(user,roles){return !!user&&(user.admin===true||roles.includes(user.role));}
async function paystack(env,path,options={}){const r=await fetch(`https://api.paystack.co${path}`,{...options,headers:{Authorization:`Bearer ${env.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json();if(!r.ok||!d.status)throw new Error(d.message||'Paystack request failed');return d.data;}
async function sendBrevo(env,to,subject,html){if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)return;const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:env.BREVO_SENDER_EMAIL,name:env.BREVO_SENDER_NAME||'Memories Night Club'},to:[{email:to}],subject,html})});if(!r.ok)console.error('Brevo failed',await r.text());}

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
    queryDocs(env,'ticket_types','eventId',eventId),
    queryDocs(env,'table_packages','eventId',eventId),
    queryDocs(env,'bottles','eventId',eventId),
    queryDocs(env,'raffles','eventId',eventId),
  ]);
  return {
    event:{id:eventId,...e.fields},
    ticketTypes:tickets.filter(x=>x.fields.active!==false).map(x=>({id:x.id,...x.fields})),
    tablePackages:tables.filter(x=>x.fields.active!==false).map(x=>({id:x.id,...x.fields})),
    bottles:bottles.filter(x=>x.fields.active!==false).map(x=>({id:x.id,...x.fields})),
    raffle:raffles.find(x=>x.fields.public===true&&x.fields.enabled===true)?.fields||null,
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

async function fulfillTicket(env,reference){
  const pending=await getDoc(env,'pending_checkouts',reference);if(!pending)return {status:'failed',error:'Checkout not found.'};
  if(pending.fields.status==='issued')return {status:'issued',ticketIds:pending.fields.ticketIds||[],orderId:pending.fields.orderId};
  if(pending.fields.status==='failed')return {status:'failed',error:pending.fields.error||'Payment was not successful.'};
  const payment=await paystack(env,`/transaction/verify/${encodeURIComponent(reference)}`);
  if(payment.status!=='success')return {status:'pending'};
  if(payment.currency!=='GHS'||Number(payment.amount)!==Number(pending.fields.amountPesewas)){await setDoc(env,'pending_checkouts',reference,{...pending.fields,status:'failed',error:'amount_mismatch'});return {status:'failed',error:'Payment amount did not match. Contact support.'};}
  const tx=await beginTx(env);const got=await batchGet(env,[`pending_checkouts/${reference}`,`ticket_types/${pending.fields.ticketTypeId}`],tx);const found=got.filter(x=>x.found).map(x=>({path:x.found.name,fields:parseFields(x.found.fields)}));const fresh=found.find(x=>x.path.endsWith(`/pending_checkouts/${reference}`));const tt=found.find(x=>x.path.endsWith(`/ticket_types/${pending.fields.ticketTypeId}`));if(!fresh||!tt)throw new Error('Checkout data disappeared.');
  if(fresh.fields.status==='issued')return {status:'issued',ticketIds:fresh.fields.ticketIds||[]};
  const remaining=typeof tt.fields.remaining==='number'?tt.fields.remaining:null;if(remaining!==null&&remaining<pending.fields.quantity){await commitTx(env,[updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'failed',error:'sold_out_after_payment',refundStatus:'manual_required'})],tx);return {status:'failed',error:'Tickets sold out while payment was being confirmed. Contact support.'};}
  const ticketIds=[];const writes=[];for(let i=0;i<pending.fields.quantity;i++){const token=ticketToken();ticketIds.push(token);writes.push(updateWrite(env,'tickets',token,{customerName:pending.fields.buyerName,type:pending.fields.ticketTypeName,admitCount:pending.fields.admits||1,eventId:pending.fields.eventId,eventName:pending.fields.eventName,identityLine:pending.fields.identityLine,reference,displayCode:`MEM-${token.slice(0,6).toUpperCase()}`,status:'valid',revoked:false,cancelled:false,issuedAt:now()}));}
  const orderId=id();writes.push(updateWrite(env,'orders',orderId,{orderId,kind:'ticket',reference,eventId:pending.fields.eventId,eventName:pending.fields.eventName,ticketTypeId:pending.fields.ticketTypeId,ticketTypeName:pending.fields.ticketTypeName,quantity:pending.fields.quantity,amountPesewas:pending.fields.amountPesewas,buyerName:pending.fields.buyerName,buyerPhone:pending.fields.buyerPhone,buyerEmail:pending.fields.buyerEmail,status:'confirmed',createdAt:now()}));
  writes.push(updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'issued',ticketIds,orderId,issuedAt:now()}));
  if(remaining!==null)writes.push(updateWrite(env,'ticket_types',pending.fields.ticketTypeId,{...tt.fields,remaining:remaining-pending.fields.quantity}));
  await commitTx(env,writes,tx);
  try{await sendBrevo(env,pending.fields.buyerEmail,'Your Memories ticket is ready',`<h1>Your night is locked in.</h1><p>${pending.fields.eventName}</p><p>Reference: ${reference}</p><p>${ticketIds.map(t=>`MEM-${t.slice(0,6).toUpperCase()}`).join(', ')}</p>`);}catch{}
  return {status:'issued',ticketIds,orderId};
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
  const bottlePaths=(pending.fields.bottles||[]).map(b=>`bottles/${b.id}`);const tx=await beginTx(env);const got=await batchGet(env,[`pending_checkouts/${reference}`,`table_packages/${pending.fields.packageId}`,...bottlePaths],tx);const found=got.filter(x=>x.found).map(x=>({path:x.found.name,fields:parseFields(x.found.fields)}));const fresh=found.find(x=>x.path.endsWith(`/pending_checkouts/${reference}`));const pkg=found.find(x=>x.path.endsWith(`/table_packages/${pending.fields.packageId}`));if(!fresh||!pkg)throw new Error('Table checkout data disappeared.');if(fresh.fields.status==='issued')return {status:'issued',orderId:fresh.fields.orderId};
  if(typeof pkg.fields.remaining==='number'&&pkg.fields.remaining<1){await commitTx(env,[updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'failed',error:'table_sold_out_after_payment',refundStatus:'manual_required'})],tx);return {status:'failed',error:'The table sold out while payment was being confirmed. Contact support.'};}
  const writes=[];for(const item of pending.fields.bottles||[]){const b=found.find(x=>x.path.endsWith(`/bottles/${item.id}`));if(!b)throw new Error('Bottle disappeared.');if(typeof b.fields.remaining==='number'&&b.fields.remaining<item.quantity){await commitTx(env,[updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'failed',error:'bottle_sold_out_after_payment',refundStatus:'manual_required'})],tx);return {status:'failed',error:'A selected bottle sold out while payment was being confirmed. Contact support.'};}}
  const orderId=id();writes.push(updateWrite(env,'orders',orderId,{orderId,kind:'table',reference,eventId:pending.fields.eventId,eventName:pending.fields.eventName,packageId:pending.fields.packageId,packageName:pending.fields.packageName,bottles:pending.fields.bottles||[],amountPesewas:pending.fields.amountPesewas,buyerName:pending.fields.buyerName,buyerPhone:pending.fields.buyerPhone,buyerEmail:pending.fields.buyerEmail,status:'confirmed',createdAt:now()}));writes.push(updateWrite(env,'pending_checkouts',reference,{...fresh.fields,status:'issued',orderId,issuedAt:now()}));if(typeof pkg.fields.remaining==='number')writes.push(updateWrite(env,'table_packages',pending.fields.packageId,{...pkg.fields,remaining:pkg.fields.remaining-1}));for(const item of pending.fields.bottles||[]){const b=found.find(x=>x.path.endsWith(`/bottles/${item.id}`));if(typeof b.fields.remaining==='number')writes.push(updateWrite(env,'bottles',item.id,{...b.fields,remaining:b.fields.remaining-item.quantity}));}
  await commitTx(env,writes,tx);try{await sendBrevo(env,pending.fields.buyerEmail,'Your Memories table is confirmed',`<h1>Your table is confirmed.</h1><p>${pending.fields.eventName}</p><p>${pending.fields.packageName}</p><p>Reference: ${reference}</p>`);}catch{}
  return {status:'issued',orderId};
}

async function fulfill(env,reference){const p=await getDoc(env,'pending_checkouts',reference);if(!p)return {status:'failed',error:'Checkout not found.'};return p.fields.kind==='table'?fulfillTable(env,reference):fulfillTicket(env,reference);}

// ── Check-in (atomic) ──
async function checkin(env,token,user){
  const tx=await beginTx(env);
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
}

async function adminOverview(env){
  const [ev,tickets,orders,checks,requests]=await Promise.all([publicEvents(env),listDocs(env,'tickets'),listDocs(env,'orders'),listDocs(env,'checkins'),listDocs(env,'private_event_requests')]);
  return {events:ev,tickets:tickets.length,orders:orders.length,checkins:checks.length,privateRequests:requests.length};
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

async function handleAdminEvent(env,b,user){
  if(!requireRole(user,['superAdmin','manager','eventManager']))return {error:'Forbidden.',status:403};
  const data={name:String(b.name||'').trim(),slug:String(b.slug||b.name||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),artwork:String(b.artwork||''),date:b.date,doors:String(b.doors||'10PM'),venue:String(b.venue||'Cape Coast'),visibility:b.visibility==='public'?'public':'private',active:b.active!==false,featured:b.featured===true,ticketLines:Array.isArray(b.ticketLines)?b.ticketLines.slice(0,12).map(String):[],updatedAt:now()};
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
  const {id:ignore,...rest}=b;
  await setDoc(env,'raffles',rid,{...(existing?.fields||{}),...rest,status:b.status||'open',enabled:b.enabled!==false,public:b.public!==false,createdAt:existing?.fields?.createdAt||now(),updatedAt:now()});
  return {success:true,raffleId:rid};
}

export default {async fetch(req,env){
  const c=cors(req,env);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:c});
  const u=new URL(req.url);
  const p=u.pathname;
  try{
    // ═══ PUBLIC ROUTES ═══
    if(req.method==='GET'&&p==='/api/events')return ok(req,env,{success:true,events:await publicEvents(env)});
    if(req.method==='GET'&&p.startsWith('/api/events/')){const d=await eventBundle(env,decodeURIComponent(p.split('/').pop()));return d?ok(req,env,{success:true,...d}):fail(req,env,'Event not found.',404);}
    if(req.method==='POST'&&p==='/api/checkout/initiate'){const r=await initiateTicket(env,await req.json());return r.error?fail(req,env,r.error):ok(req,env,{success:true,...r});}
    if(req.method==='GET'&&p==='/api/checkout/status'){const reference=u.searchParams.get('reference');if(!reference)return fail(req,env,'Reference is required.');const d=await getDoc(env,'pending_checkouts',reference);if(!d)return fail(req,env,'Not found.',404);return ok(req,env,{success:true,status:d.fields.status,kind:d.fields.kind||'ticket',orderId:d.fields.orderId,eventName:d.fields.eventName,packageName:d.fields.packageName,amountPesewas:d.fields.amountPesewas,tickets:(d.fields.ticketIds||[]).map(token=>({token,ticketId:token})),error:d.fields.error});}
    if(req.method==='POST'&&p==='/api/checkout/verify'){const b=await req.json();if(!b.reference)return fail(req,env,'Reference is required.');return ok(req,env,{success:true,...await fulfill(env,b.reference)});}
    if(req.method==='POST'&&p==='/api/table-checkout/initiate'){const r=await initiateTable(env,await req.json());return r.error?fail(req,env,r.error):ok(req,env,{success:true,...r});}
    if(req.method==='GET'&&p.startsWith('/api/tickets/')){const token=decodeURIComponent(p.split('/').pop());const d=await getDoc(env,'tickets',token);if(!d)return fail(req,env,'Ticket not found.',404);const t=d.fields;const ev=await getDoc(env,'events',t.eventId);return ok(req,env,{success:true,ticket:{ticketId:token,customerName:t.customerName,type:t.type,admitCount:t.admitCount,eventId:t.eventId,eventName:t.eventName,identityLine:t.identityLine,status:t.status,revoked:t.revoked,cancelled:t.cancelled,displayCode:t.displayCode,eventDate:ev?.fields?.date,eventVenue:ev?.fields?.venue,eventDoors:ev?.fields?.doors}});}
    if(req.method==='GET'&&p.startsWith('/api/verify/')){const token=decodeURIComponent(p.split('/').pop());const d=await getDoc(env,'tickets',token);if(!d)return ok(req,env,{success:true,valid:false,message:'Ticket not found.'});const t=d.fields;return ok(req,env,{success:true,valid:t.status==='valid'&&!t.revoked&&!t.cancelled,message:t.status==='valid'?'VALID TICKET':t.status==='used'?'TICKET ALREADY USED':'TICKET NOT VALID',ticket:{eventName:t.eventName,customerName:t.customerName,status:t.status,displayCode:t.displayCode}});}
    if(req.method==='POST'&&p==='/api/private-requests'){const b=await req.json();if(!b.name||!b.phone||!b.email)return fail(req,env,'Please complete your details.');const rid=id();await setDoc(env,'private_event_requests',rid,{name:String(b.name).trim(),phone:String(b.phone).trim(),email:String(b.email).trim(),date:b.date||'',guests:Number(b.guests||0),eventType:String(b.eventType||'Private night'),message:String(b.message||'').slice(0,5000),status:'NEW',createdAt:now()});try{await sendBrevo(env,env.BREVO_SENDER_EMAIL,'New Memories private-night request',`<p>${String(b.name)}</p><p>${String(b.phone)}</p><p>${String(b.email)}</p>`);}catch{}return ok(req,env,{success:true,id:rid});}
    if(req.method==='POST'&&p==='/api/raffle/enter'){const b=await req.json();if(!b.ticketToken||!b.raffleId)return fail(req,env,'Ticket and raffle are required.');const ticket=await getDoc(env,'tickets',b.ticketToken);const raffle=await getDoc(env,'raffles',b.raffleId);if(!ticket||ticket.fields.status!=='valid'||ticket.fields.revoked||ticket.fields.cancelled)return fail(req,env,'Ticket is not eligible.');if(!raffle||raffle.fields.enabled!==true||raffle.fields.status==='drawn')return fail(req,env,'Raffle is not active.');if(raffle.fields.eventId!==ticket.fields.eventId)return fail(req,env,'Ticket is for a different event.');const digest=await crypto.subtle.digest('SHA-256',enc.encode(`${b.raffleId}:${b.ticketToken}`));const entryId=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');try{await createDoc(env,'raffle_entries',entryId,{raffleId:b.raffleId,eventId:raffle.fields.eventId,ticketId:b.ticketToken,status:'eligible',createdAt:now()});return ok(req,env,{success:true,entryId});}catch(e){if(String(e.message).includes('ALREADY_EXISTS'))return ok(req,env,{success:true,alreadyEntered:true,entryId});throw e;}}

    // ═══ PAYSTACK WEBHOOK ═══
    if(req.method==='POST'&&p==='/api/paystack/webhook'){const sig=req.headers.get('x-paystack-signature')||'';const raw=await req.text();const key=await crypto.subtle.importKey('raw',enc.encode(env.PAYSTACK_SECRET_KEY),{name:'HMAC',hash:'SHA-512'},false,['verify']);const valid=await crypto.subtle.verify('HMAC',key,fromHex(sig),enc.encode(raw));if(!valid)return text('ignored',200,c);const event=JSON.parse(raw);if(event.event==='charge.success'&&event.data?.reference)await fulfill(env,event.data.reference);return text('ok',200,c);}

    // ═══ SMS PROXY (admin only) ═══
    if(p==='/api/send-sms'&&req.method==='POST'){const user=await verifyStaff(req,env,['superAdmin','manager']);if(!user)return fail(req,env,'Unauthorized.',401);const body=await req.text();const r=await proxySms(env,'/send-sms',{method:'POST',headers:{'Content-Type':'application/json'},body});return new Response(await r.text(),{status:r.status,headers:{...cors(req,env),'Content-Type':'application/json'}});}
    if(p==='/api/balance'&&req.method==='GET'){const user=await verifyStaff(req,env,['superAdmin','manager']);if(!user)return fail(req,env,'Unauthorized.',401);const r=await proxySms(env,'/balance',{method:'GET'});return new Response(await r.text(),{status:r.status,headers:{...cors(req,env),'Content-Type':'application/json'}});}

    // ═══ CHECK-IN (doorStaff+) ═══
    if(p==='/api/checkin'&&req.method==='POST'){const user=await verifyStaff(req,env,['superAdmin','manager','doorStaff']);if(!user)return fail(req,env,'Unauthorized.',401);const b=await req.json();if(!b.token)return fail(req,env,'Ticket token is required.');return ok(req,env,{success:true,...await checkin(env,b.token,user)});}

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
    if(req.method==='POST'&&p==='/api/admin/checkin'){if(!requireRole(adminUser,['superAdmin','manager','doorStaff']))return fail(req,env,'Forbidden.',403);const b=await req.json();if(!b.token)return fail(req,env,'Ticket token is required.');return ok(req,env,{success:true,...await checkin(env,b.token,adminUser)});}
    if(req.method==='POST'&&p==='/api/admin/raffle/draw'){if(!requireRole(adminUser,['superAdmin','manager','eventManager']))return fail(req,env,'Forbidden.',403);const b=await req.json();const raffle=await getDoc(env,'raffles',b.raffleId);if(!raffle||raffle.fields.status==='drawn')return fail(req,env,'Raffle cannot be drawn.');const entries=(await listDocs(env,'raffle_entries')).filter(x=>x.fields.raffleId===b.raffleId&&x.fields.status==='eligible');if(!entries.length)return fail(req,env,'No eligible entries.');const rnd=new Uint32Array(1);crypto.getRandomValues(rnd);const winner=entries[rnd[0]%entries.length];await setDoc(env,'raffles',b.raffleId,{...raffle.fields,status:'drawn',winnerEntryId:winner.id,winnerTicketId:winner.fields.ticketId,drawnAt:now(),drawnBy:adminUser.uid||adminUser.sub});await setDoc(env,'audit_logs',id(),{action:'RAFFLE_DRAWN',actorUid:adminUser.uid||adminUser.sub,raffleId:b.raffleId,winnerEntryId:winner.id,winnerTicketId:winner.fields.ticketId,timestamp:now()});return ok(req,env,{success:true,winnerTicketId:winner.fields.ticketId});}

    return fail(req,env,'Not found.',404);
  }catch(e){console.error(e);return fail(req,env,'Something went wrong. Please try again.',500);}
}};