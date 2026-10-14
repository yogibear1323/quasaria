// Pan sources: full-page capture with sticky header + fixed tab bar hidden, plus those bars captured separately
// (the renderer scrolls the page under fixed bars, like a real scroll recording, but sub-pixel smooth).
import { chromium } from "/workspace/qworld/frontend/node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";
const OUT="/workspace/quasaria-video/autopay-sizzle/shots_earthy/pan/"; const APP="https://yogibear1323.github.io/autopay/app/?v=earthlogo-20261013";
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,reducedMotion:"reduce",colorScheme:"light"});
const p=await ctx.newPage(); const meta={};
for (const [n,r] of [["dashboard","/dashboard"],["payments","/payments"],["review","/review"]]){
  await p.goto(APP+"#"+r,{waitUntil:"networkidle"}); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
  await p.screenshot({path:`${OUT}${n}_view.png`});
  meta[n]=await p.evaluate(()=>{const tb=document.querySelector('.topbar'),tabs=document.querySelector('.tabs');
    return {top: tb? tb.getBoundingClientRect().bottom:0, tabs: tabs? innerHeight-tabs.getBoundingClientRect().top:0, h:document.documentElement.scrollHeight};});
  await p.addStyleTag({content:".topbar,.tabs{visibility:hidden !important}"});
  await p.screenshot({path:`${OUT}${n}_full.png`,fullPage:true});
  console.log(n,JSON.stringify(meta[n]));
}
writeFileSync(OUT+"meta.json",JSON.stringify(meta)); await b.close();
