import { chromium } from "/workspace/quasaria-autopay/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
const B="/workspace/quasaria-autopay/shared/brand/";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:2000,height:1000}});
for (const [f,w,h,out] of [["logo.svg",1024,1024,"logo.png"],["logo-lockup-dark.svg",241*8,64*8,"lockup.png"]]){
  const svg=readFileSync(B+f,"utf8").replace("<svg ",`<svg width="${w}" height="${h}" `);
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await p.locator("svg").screenshot({path:"shots/"+out,omitBackground:true});
}
await b.close();
