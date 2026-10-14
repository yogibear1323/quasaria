import { chromium } from "/workspace/stellar-dex/frontend/node_modules/playwright/index.mjs";
const B = "https://yogibear1323.github.io/quasaria";
const browser = await chromium.launch();
for (const [n,r] of [["home","/"],["lending","/lending"]]) for (const [vw,vh] of [[1920,1080],[1080,1920]]) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, colorScheme: "dark" });
  await page.goto(B + r, { waitUntil: "networkidle", timeout: 60000 }).catch(e=>null);
  await page.waitForTimeout(6000);
  const ys = await page.evaluate(()=>{const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let x;while(x=w.nextNode()){if(/bank/i.test(x.textContent)){const r=document.createRange();r.selectNodeContents(x);const b=r.getBoundingClientRect();out.push([Math.round(b.top+scrollY),Math.round(b.bottom+scrollY),x.textContent.slice(0,50)]);}}return out;});
  console.log(n, vw, JSON.stringify(ys));
  await page.close();
}
await browser.close();
