import { chromium } from "/workspace/stellar-dex/frontend/node_modules/playwright/index.mjs";
const OUT = "/workspace/quasaria-video/sizzle/shots";
const B = "https://yogibear1323.github.io/quasaria";
const browser = await chromium.launch();
const routes = [["home","/"],["markets","/markets"],["pools","/pools"],["lending","/lending"],["quests","/quests"]];
for (const [vw,vh,tag] of [[1920,1080,"h"],[1080,1920,"v"]]) {
  for (const [n,r] of routes) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, colorScheme: "dark" });
    const resp = await page.goto(B + r, { waitUntil: "networkidle", timeout: 60000 }).catch(e=>null);
    await page.waitForTimeout(7000);
    const info = await page.evaluate(()=>[document.title, document.documentElement.scrollHeight, document.body.innerText.slice(0,300).replace(/\s+/g,' ')]);
    console.log(tag, n, resp?.status(), info.join(' | '));
    await page.screenshot({ path: `${OUT}/${n}-${tag}.png` });
    await page.screenshot({ path: `${OUT}/${n}-${tag}-full.png`, fullPage: true });
    await page.close();
  }
}
await browser.close();
