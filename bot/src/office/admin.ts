/** Local admin page (127.0.0.1 only): live status + pause/resume/flatten/halt/reset/kill. The public site has no write path. */
import { createServer, type Server } from "node:http";
import type { Store } from "./store.js";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Back Office admin · testnet</title><style>
body{background:#06070d;color:#eef0fa;font:13px Inter,system-ui,sans-serif;margin:24px}h1{font:600 20px "Space Grotesk",sans-serif}
.k{color:#7d84a6}table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border-bottom:1px solid #1d2135;padding:6px 8px;text-align:left}
button{background:#151935;color:#eef0fa;border:1px solid #2a2f52;border-radius:8px;padding:4px 9px;margin-right:4px;cursor:pointer}
button.red{border-color:#fb7185;color:#fecdd3}.running{color:#34d399}.paused{color:#fbbf24}.halted{color:#fb7185}pre{color:#a3a9c6;white-space:pre-wrap}
</style></head><body><h1>Back Office admin <span class="k">· TESTNET · local only</span></h1><div id="f"></div>
<p><button class="red" onclick="cmd({cmd:'kill',reason:prompt('kill reason','manual kill (admin page)')})">GLOBAL KILL (close all)</button>
<button onclick="cmd({cmd:'unkill'})">Clear kill</button> <button onclick="cmd({cmd:'pause',desk:'all'})">Pause all</button> <button onclick="cmd({cmd:'resume',desk:'all'})">Resume all</button></p>
<table id="t"></table><pre id="raw"></pre>
<script>
async function cmd(c){if(c.cmd==='kill'&&!c.reason)return;await fetch('/api/cmd',{method:'POST',headers:{'content-type':'application/json','x-office-admin':'1'},body:JSON.stringify(c)});setTimeout(load,500)}
async function load(){const s=await (await fetch('/api/status')).json();if(!s||!s.fleet){document.getElementById('f').textContent='no status yet';return}
document.getElementById('f').innerHTML='fleet <b>'+s.fleet.status+'</b> '+(s.fleet.reason||'')+' · equity '+s.fleet.equity.toFixed(2)+' · today '+s.fleet.pnlToday.toFixed(2)+' · risk '+s.fleet.riskUsedPct.toFixed(2)+'% / '+s.fleet.riskCapPct+'% · oracle '+s.market.oraclePrice+' age '+s.market.oracleAgeSec+'s ('+s.market.oracleLevel+') · mode '+s.mode+'/'+s.driftMode+' · '+s.generatedAt;
document.getElementById('t').innerHTML='<tr><th>desk</th><th>status</th><th>equity</th><th>today</th><th>open</th><th>drift</th><th>last signal</th><th></th></tr>'+s.desks.map(d=>'<tr><td>'+d.name+' <span class=k>'+d.strategy+'</span></td><td class='+d.status+'>'+d.status+' <span class=k>'+(d.reason||'')+'</span></td><td>'+d.equity.toFixed(2)+'</td><td>'+d.pnlToday.toFixed(2)+'</td><td>'+d.open.map(p=>p.side+' '+p.leverage.toFixed(1)+'x #'+p.id).join(', ')+'</td><td>'+(d.drift?d.drift.score+' '+d.drift.level:'')+'</td><td class=k>'+(d.lastSignal||'')+'</td><td>'+['pause','resume','flatten','halt','reset'].map(c=>'<button onclick="cmd({cmd:\\''+c+'\\',desk:\\''+d.id+'\\'})">'+c+'</button>').join('')+'</td></tr>').join('')}
load();setInterval(load,5000)</script></body></html>`;

export function startAdmin(store: Store, port: number, getStatus: () => unknown): Server {
  const srv = createServer((req, res) => {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return res.writeHead(403).end("local only");
    if (req.method === "GET" && req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    if (req.method === "GET" && req.url === "/api/status") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(getStatus() ?? null));
    if (req.method === "POST" && req.url === "/api/cmd") {
      if (req.headers["x-office-admin"] !== "1") return res.writeHead(403).end("missing admin header");
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const c = JSON.parse(body);
          if (!["pause", "resume", "flatten", "halt", "reset", "kill", "unkill"].includes(c.cmd)) throw new Error("bad cmd");
          store.enqueue({ ...c, by: "admin-page" });
          if (c.cmd === "kill") store.setKillFlag(String(c.reason ?? "manual kill (admin page)"));
          res.writeHead(200).end("ok");
        } catch (e) {
          res.writeHead(400).end((e as Error).message);
        }
      });
      return;
    }
    res.writeHead(404).end();
  });
  srv.listen(port, "127.0.0.1");
  return srv;
}
