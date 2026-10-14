import { chromium } from "/workspace/qworld/frontend/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
const B="/workspace/earthy-vid/qx/frontend/public/brand/";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:2400,height:1200}});
for (const [f,w,h,out] of [["logo-light.svg",1024,1024,"logo.png"],["logo-lockup-light.svg",241*8,64*8,"lockup.png"]]){
  let svg=readFileSync(B+f,"utf8"); const vb=svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const H=h, W=Math.round(h*vb[2]/vb[3]);
  svg=svg.replace("<svg ",`<svg width="${f.includes('lockup')?W:w}" height="${H}" `);
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await p.locator("svg").screenshot({path:"brand/"+out,omitBackground:true});
}
await b.close();
