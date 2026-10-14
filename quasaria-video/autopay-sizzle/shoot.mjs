// Fresh app screenshots from the local vite dev server (port 5190; never 4173).
import { chromium } from "/workspace/quasaria-autopay/node_modules/playwright/index.mjs";
const OUT = "/workspace/quasaria-video/autopay-sizzle/shots/";
const APP = "http://localhost:5190/";
const M = [["connect","/connect",async p=>{await p.click("text=Freighter");await p.waitForSelector(".ok-card");}],["create","/create"],["review","/review"],
  ["done","/review",async p=>{await p.click("text=Confirm & sign");await p.waitForSelector(".done",{timeout:5000});}],
  ["dashboard","/dashboard"],["payments","/payments"],["payoff","/payoff"],["settings","/settings"],["welcome","/welcome"]];
const D = [["dealer","/dealer"],["agreement","/dealer/agreement"],["ledger","/dealer/ledger"],["onboard","/dealer/onboard"],["ddash","/dashboard"]];
const b = await chromium.launch();
const hits=[];
async function run(list, vp, dpr, tag){
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dpr, reducedMotion: "reduce", colorScheme:"dark" });
  const p = await ctx.newPage();
  for (const [n,r,act] of list){
    await p.goto(APP+"#"+r,{waitUntil:"networkidle"}); await p.evaluate(()=>document.fonts.ready);
    if(act) await act(p); await p.waitForTimeout(400);
    const txt = await p.evaluate(()=>document.body.innerText);
    if(/bank/i.test(txt)) hits.push(n+tag);
    await p.screenshot({path:`${OUT}${n}-${tag}.png`});
    await p.screenshot({path:`${OUT}${n}-${tag}-full.png`,fullPage:true});
    console.log(tag,n,txt.slice(0,90).replace(/\s+/g," "));
  }
  await ctx.close();
}
await run(M,{width:390,height:844},3,"m");
await run(D,{width:1440,height:900},1.5,"d");
await b.close(); console.log("BANK hits:",JSON.stringify(hits));
