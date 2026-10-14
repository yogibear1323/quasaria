// Scroll "recordings": viewport screenshots every 12 CSS px (fixed nav stays in place, like a real screen capture).
import { chromium } from "/workspace/qworld/frontend/node_modules/playwright/index.mjs";
const OUT="/workspace/quasaria-video/autopay-sizzle/shots_light/scroll/"; const APP="https://yogibear1323.github.io/autopay/app/?v=gold-20261011";
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,reducedMotion:"reduce",colorScheme:"light"});
const p=await ctx.newPage();
for (const [n,r] of [["dashboard","/dashboard"],["payments","/payments"],["review","/review"],["create","/create"]]){
  await p.goto(APP+"#"+r,{waitUntil:"networkidle"}); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
  const max=await p.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
  let i=0; for(let y=0;y<=max+11;y+=12){ await p.evaluate(y=>scrollTo(0,y),Math.min(y,max)); await p.waitForTimeout(60);
    await p.screenshot({path:`${OUT}${n}_${String(i).padStart(3,"0")}.png`}); i++; }
  console.log(n,max,i);
}
await b.close();
