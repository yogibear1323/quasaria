import { chromium } from "/workspace/qworld/frontend/node_modules/playwright/index.mjs";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1280,height:800}});
await p.goto("https://yogibear1323.github.io/autopay/app/?cb="+Date.now(),{waitUntil:"networkidle"}); await p.waitForTimeout(2500);
await p.screenshot({path:"/tmp/ap.png"}); await b.close();
