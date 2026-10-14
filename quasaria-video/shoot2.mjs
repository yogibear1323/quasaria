import { chromium } from "/workspace/stellar-dex/frontend/node_modules/playwright/index.mjs";
import fs from "fs";
const OUT = "/workspace/quasaria-video/shots";
const browser = await chromium.launch();
const B = "https://yogibear1323.github.io/quasaria";
const pages = [["home",B+"/"],["pools",B+"/pools"],["quests",B+"/quests"],["merch",B+"/merch"],["news",B+"/news"],["markets",B+"/markets"],["trade",B+"/trade"],
 ["toml","https://yogibear1323.github.io/.well-known/stellar.toml"],
 ["tx","https://stellar.expert/explorer/testnet/tx/f9fe7c2d104a5539bf66606dc06128a73c0cbde6f500115b09db321de6c1a78c"]];
for (const [n,u] of pages) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark" });
  const r = await page.goto(u, { waitUntil: "networkidle", timeout: 45000 }).catch(e=>null);
  await page.waitForTimeout(7000);
  console.log(n, r?.status(), await page.title(), await page.evaluate(()=>document.documentElement.scrollHeight));
  await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
  await page.close();
}
// logos
for (const [n,f,w,h] of [["logo","/workspace/stellar-dex/frontend/public/brand/logo.svg",1200,1200],["lockup","/workspace/stellar-dex/frontend/public/brand/logo-lockup-dark.svg",0,0]]) {
  const svg = fs.readFileSync(f,"utf8");
  const page = await browser.newPage({ viewport: { width: 2400, height: 1400 } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  const box = await page.evaluate((w)=>{const s=document.querySelector("svg"); if(w){s.setAttribute("width",w);s.setAttribute("height",w);} else {s.setAttribute("width",2000); s.removeAttribute("height");} const b=s.getBoundingClientRect(); return [b.width,b.height];}, w);
  console.log(n, box);
  await page.locator("svg").screenshot({ path: `${OUT}/${n}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
