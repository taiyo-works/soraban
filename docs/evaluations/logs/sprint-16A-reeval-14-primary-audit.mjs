import { chromium } from "/home/user/soraban/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";
const BASE="http://127.0.0.1:3400"; const PLAN=process.argv[2]; const OUT=process.argv[3];
fs.mkdirSync(OUT,{recursive:true});
const routes=[["home","/"],["ops-home","/ops"],["plans","/ops/plans"],["plan-new","/ops/plans/new"],["overview",`/ops/plans/${PLAN}/overview`],["judgement",`/ops/plans/${PLAN}/judgement`],["report",`/ops/plans/${PLAN}/report`],["insp","/ops/inspections"],["insp-new","/ops/inspections/new"],["journal","/ops/journal"],["flights","/ops/flights"],["flight-new","/ops/flights/new"],["aircraft","/ops/aircraft"],["pilots","/ops/pilots"],["places","/ops/places"],["permits","/ops/permits"],["incidents","/ops/incidents"],["incident-new","/ops/incidents/new"],["more","/ops/more"],["members","/ops/members"],["about","/ops/about"],["field",`/ops/plans/${PLAN}/field`],["field-incident",`/ops/plans/${PLAN}/field/incident`],["design","/ops/design"]];
const fn=`(() => {
 const P=[31,95,224];
 const cv=document.createElement('canvas');cv.width=cv.height=1;const cx=cv.getContext('2d',{willReadFrequently:true});
 const rgba=(c)=>{cx.clearRect(0,0,1,1);cx.fillStyle='#000';cx.fillStyle=c;cx.fillRect(0,0,1,1);const d=cx.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255];};
 const isP=(c)=>{const x=rgba(c);return x[3]>0&&(x[2]-x[0])>=40&&x[2]>x[1]+10;};
 const interactiveSel='a,button,input,select,textarea,summary,label,[role=tab],[role=button],[role=link],[role=radio],[role=switch],[role=checkbox],[aria-current],[aria-selected],[aria-pressed],[tabindex]';
 const res=[];
 for(const el of document.querySelectorAll('body, body *')){const cs=getComputedStyle(el);const r=el.getBoundingClientRect();if(cs.display==='none'||cs.visibility==='hidden'||(r.width===0&&r.height===0))continue;if(el.closest('canvas,.maplibregl-map'))continue;
  const kinds=[];
  if(isP(cs.backgroundColor))kinds.push('bg');
  for(const s of ['Top','Right','Bottom','Left']){if(parseFloat(cs['border'+s+'Width'])>0&&cs['border'+s+'Style']!=='none'&&isP(cs['border'+s+'Color']))kinds.push('border-'+s)}
  if(parseFloat(cs.outlineWidth)>0&&cs.outlineStyle!=='none'&&isP(cs.outlineColor))kinds.push('outline');
  if(cs.boxShadow!=='none'&&/rgb\\(31, 95, 224\\)/.test(cs.boxShadow))kinds.push('shadow');
  if(el instanceof SVGElement){for(const p of ['fill','stroke']){if(isP(cs[p]))kinds.push('svg-'+p)}}
  if(!kinds.length)continue;
  const inter=!!el.closest(interactiveSel)||!!el.querySelector(interactiveSel)&&false;
  const desc=el.tagName.toLowerCase()+'.'+(typeof el.className==='string'?el.className.split(/\\s+/).slice(0,2).join('.'):'')+(el.getAttribute('data-testid')?'['+el.getAttribute('data-testid')+']':'')+' "'+(el.textContent||'').trim().slice(0,20)+'" '+Math.round(r.width)+'x'+Math.round(r.height);
  res.push({kinds:kinds.join(','),inter,desc});}
 return res;})()`;
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium",args:["--no-sandbox"]});
const report={};
for(const vp of [[375,812],[390,844],[1280,800]]){
 const ctx=await b.newContext({viewport:{width:vp[0],height:vp[1]},hasTouch:vp[0]<500,serviceWorkers:"block"});
 await ctx.request.post(BASE+"/api/test-auth/sign-in",{data:{authUserId:"b-manager",email:"b-manager@example.test",emailVerified:true,name:"b-manager"}});
 for(const [name,r] of routes){const p=await ctx.newPage();await p.goto(BASE+r,{waitUntil:"networkidle"}).catch(()=>{});await p.waitForTimeout(3500);await p.evaluate(()=>document.querySelectorAll("details").forEach(d=>{d.open=true}));await p.waitForTimeout(300);
  const o=await p.evaluate(fn);
  const hz=await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  report[`${vp[0]} ${name}`]={nonInteractive:o.filter(x=>!x.inter),interactiveCount:o.filter(x=>x.inter).length,hscroll:hz};
  if(["field","field-incident","home","plans"].includes(name)) await p.screenshot({path:`${OUT}/reeval-${name}-${vp[0]}.jpg`,type:"jpeg",quality:70,fullPage:false});
  await p.close()}
 await ctx.close();
}
fs.writeFileSync(OUT+"/audit.json",JSON.stringify(report,null,1));
for(const [k,v] of Object.entries(report)) console.log(k,"interactive:",v.interactiveCount,"NON-interactive primary:",v.nonInteractive.length,v.hscroll?"HSCROLL":"" ,v.nonInteractive.slice(0,4).map(x=>x.kinds+" "+x.desc).join(" | "));
await b.close();
