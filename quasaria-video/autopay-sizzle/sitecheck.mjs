import { chromium } from "/workspace/quasaria-autopay/node_modules/playwright/index.mjs";
const URL=process.argv[2]||"http://127.0.0.1:8766/autopay/"; const tag=process.argv[3]||"local"; const outdir=process.argv[4]||"/workspace/quasaria-video/autopay-sizzle/prev/";
const b=await chromium.launch({args:["--autoplay-policy=no-user-gesture-required"]});
for (const [name,vp,dpr] of [["desktop",{width:1440,height:900},1],["mobile",{width:390,height:844},2]]){
  const ctx=await b.newContext({viewport:vp,deviceScaleFactor:dpr,colorScheme:"dark"}); const p=await ctx.newPage();
  const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
  await p.goto(URL,{waitUntil:"networkidle"}); await p.evaluate(()=>document.fonts.ready);
  const info=await p.evaluate(()=>{
    const secs=[...document.querySelectorAll("main > section")].map(s=>s.id||s.className);
    const vids=[...document.querySelectorAll("#watch video")].map(v=>{const r=v.getBoundingClientRect();const cs=getComputedStyle(v.closest("figure"));
      return {src:v.currentSrc||v.querySelector("source").src,shown:cs.display!=="none",w:Math.round(r.width),h:Math.round(r.height),controls:v.controls,playsinline:v.playsInline,preload:v.preload,autoplay:v.autoplay,poster:v.poster.split("/").pop()}});
    const h2=document.querySelector("#watch h2"); const cs=getComputedStyle(h2);
    return {secs,vids,navWatch:!!document.querySelector('.links a[href="#watch"]'),h2clip:cs.webkitBackgroundClip||cs.backgroundClip,bank:/bank/i.test(document.body.innerText)};});
  console.log(name,JSON.stringify(info));
  // play-one-pauses-other (desktop has both visible)
  if(name==="desktop"){
    const r=await p.evaluate(async()=>{const [a,c]=[...document.querySelectorAll("#watch video")];a.muted=true;c.muted=true;
      await a.play();await new Promise(r=>setTimeout(r,400));await c.play();await new Promise(r=>setTimeout(r,400));
      const s1={a:a.paused,c:c.paused}; await a.play(); await new Promise(r=>setTimeout(r,400)); const s2={a:a.paused,c:c.paused}; a.pause(); a.currentTime=0; c.currentTime=0; return {afterPlayTall:s1,afterPlayWide:s2};});
    console.log("pause-other",JSON.stringify(r));
  }
  await p.evaluate(()=>{document.querySelectorAll("#watch video").forEach(v=>{v.pause();v.load();});});
  await p.evaluate(()=>window.scrollTo(0,document.querySelector("#watch").offsetTop-(innerWidth>720?40:20)));
  await p.waitForTimeout(1500);
  await p.screenshot({path:`${outdir}${tag}-watch-${name}.png`});
  console.log(name,"errors",JSON.stringify(errs));
  await ctx.close();
}
await b.close();
