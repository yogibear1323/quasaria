import { chromium } from "/workspace/qworld/frontend/node_modules/playwright/index.mjs";
const b=await chromium.launch(); const p=await b.newPage();
await p.goto("https://yogibear1323.github.io/autopay/app/?v=gold-20261011#/overview",{waitUntil:"networkidle"});
await p.evaluate(()=>localStorage.setItem("autopay.wallet",JSON.stringify({id:"albedo",address:"GD6M7IUZBDAXTNYZQ3PLSK4EOQFTP4SUNAE44Q2ZAXUUIYRPSERLTGWI"})));
for (const h of ["#/connect","#/wallet"]) { await p.goto("https://yogibear1323.github.io/autopay/app/?v=gold-20261011"+h,{waitUntil:"networkidle"}); await p.reload({waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,3000));
console.log(h, (await p.locator("button").allInnerTexts()).join(" | ")); }
await b.close();
