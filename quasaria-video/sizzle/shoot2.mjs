import { chromium } from "/workspace/stellar-dex/frontend/node_modules/playwright/index.mjs";
const OUT = "/workspace/quasaria-video/sizzle/shots";
const B = "https://yogibear1323.github.io/quasaria";
const browser = await chromium.launch();
for (const [n,r] of [["home","/"],["markets","/markets"],["pools","/pools"],["lending","/lending"],["quests","/quests"],["trade","/trade"]]) {
  for (const [vw,vh,tag] of [[1920,1080,"h"],[1080,1920,"v"]]) {
    if (n!=="trade" && tag==="v") continue;
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, colorScheme: "dark" });
    await page.goto(B + r, { waitUntil: "networkidle", timeout: 60000 }).catch(e=>null);
    await page.waitForTimeout(6000);
    const txt = await page.evaluate(()=>document.body.innerText);
    const m = txt.match(/.{0,40}bank.{0,40}/gi);
    console.log(n, tag, "bank matches:", m ? JSON.stringify(m) : "none");
    if (n==="trade") { await page.screenshot({ path: `${OUT}/trade-${tag}.png` }); await page.screenshot({ path: `${OUT}/trade-${tag}-full.png`, fullPage:true }); }
    await page.close();
  }
}
await browser.close();
