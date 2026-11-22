import { chromium } from "/home/user/soraban/node_modules/@playwright/test/index.mjs";
const BASE="http://127.0.0.1:3400"; const PLAN=process.argv[2];
const routes=["/","/ops","/ops/plans","/ops/plans/new",`/ops/plans/${PLAN}/overview`,`/ops/plans/${PLAN}/judgement`,`/ops/plans/${PLAN}/report`,`/ops/inspections`,"/ops/inspections/new","/ops/journal","/ops/flights","/ops/flights/new","/ops/aircraft","/ops/pilots","/ops/places","/ops/permits","/ops/incidents","/ops/incidents/new","/ops/more","/ops/members","/ops/about",`/ops/plans/${PLAN}/field`,"/ops/offline/today","/ops/offline/field","/ops/offline/inspection","/ops/offline/journal","/ops/offline/unavailable","/ops/sign-in","/ops/no-access","/ops/design"];
const fn = `(() => {
 const cv=document.createElement('canvas');cv.width=cv.height=1;const cx=cv.getContext('2d',{willReadFrequently:true});
 const rgba=(c)=>{cx.clearRect(0,0,1,1);cx.fillStyle='#000';cx.fillStyle=c;cx.fillRect(0,0,1,1);const d=cx.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255];};
 const rs=getComputedStyle(document.documentElement);const allowed=new Map();
 for(const sh of document.styleSheets){let rules;try{rules=sh.cssRules}catch{continue}const walk=(l)=>{for(const r of l){if(r instanceof CSSStyleRule){for(let i=0;i<r.style.length;i++){const n=r.style[i];if(n.startsWith('--sb-')){const v=rs.getPropertyValue(n).trim();if(/^(#|rgb)/i.test(v)){const c=rgba(v);allowed.set(c.slice(0,3).join(','),n)}}}}else if(r.cssRules)walk(r.cssRules)}};walk(rules)}
 allowed.set('255,255,255','white');
 const out={};
 const note=(el,p,css)=>{const c=rgba(css);if(c[3]===0)return;const k=c.slice(0,3).map(Math.round).join(',');if(allowed.has(k))return;const w=(el.closest('[data-testid]')?.getAttribute('data-testid')||'')+'<'+el.tagName.toLowerCase()+'.'+(typeof el.className==='string'?el.className.split(/\\s+/)[0]:'')+'>';const key=k+' '+p;(out[key]??=[]).length<2&&out[key].push(w)};
 for(const el of document.querySelectorAll('body, body *')){const cs=getComputedStyle(el);const r=el.getBoundingClientRect();if(cs.display==='none'||cs.visibility==='hidden'||(r.width===0&&r.height===0))continue;if(el.closest('canvas,.maplibregl-map,svg'))continue;
  const hasText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(hasText)note(el,'color',cs.color);note(el,'bg',cs.backgroundColor);
  for(const s of ['Top','Right','Bottom','Left']){if(parseFloat(cs['border'+s+'Width'])>0&&cs['border'+s+'Style']!=='none')note(el,'border',cs['border'+s+'Color'])}
  if(cs.boxShadow!=='none')for(const m of cs.boxShadow.matchAll(/(rgba?\\([^)]*\\))/g))note(el,'shadow',m[1]);}
 return out;})()`;
const b=await chromium.launch({executablePath:process.env.E2E_CHROMIUM_PATH,args:["--no-sandbox"]});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:"block"});
await ctx.request.post(BASE+"/api/test-auth/sign-in",{data:{authUserId:"b-manager",email:"b-manager@example.test",emailVerified:true,name:"b-manager"}});
for(const r of routes){const p=await ctx.newPage();await p.goto(BASE+r,{waitUntil:"networkidle"}).catch(()=>{});await p.waitForTimeout(800);const o=await p.evaluate(fn);console.log(r,JSON.stringify(o));await p.close()}
await b.close();
