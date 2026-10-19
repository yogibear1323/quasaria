import { useEffect, useRef, useState } from "react";
import { NETWORK } from "../lib/config";
import { BUY_ASSETS, BUY_WIDGET_DISCLOSURE, COMING_SOON_LINE, IFRAME_ALLOW, IFRAME_SANDBOX, coindiscoKey, coindiscoUrl, type BuyAsset } from "../lib/coindisco";

/** Card purchase via the Coindisco aggregator widget. Lazy: the iframe only loads once the panel scrolls into view. */
export default function BuyWidget({ address, publicKey = coindiscoKey(), network = NETWORK }: { address: string | null; publicKey?: string | null; network?: "testnet" | "mainnet" }) {
  const [asset, setAsset] = useState<BuyAsset>("xlm");
  const [show, setShow] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!publicKey || show || !box.current) return;
    if (typeof IntersectionObserver === "undefined") return setShow(true);
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setShow(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(box.current);
    return () => io.disconnect();
  }, [publicKey, show]);

  return (
    <div className="card buy-widget" data-testid="buy-widget">
      {!publicKey ? (
        <div className="buy-soon" data-testid="buy-coming-soon">
          <span className="soon-badge" data-testid="soon-badge">Coming soon</span>
          <h3 style={{ margin: "10px 0 6px" }}>Card purchase</h3>
          <p style={{ margin: 0 }}>{COMING_SOON_LINE}</p>
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }} role="group" aria-label="Asset to buy">
            {(Object.keys(BUY_ASSETS) as BuyAsset[]).map((k) => (
              <button key={k} className={`chip${asset === k ? " on" : ""}`} aria-pressed={asset === k} onClick={() => setAsset(k)} data-testid={`buy-asset-${k}`}>{BUY_ASSETS[k].label}</button>
            ))}
          </div>
          <div className="buy-frame" ref={box}>
            {show && (
              <iframe key={asset} src={coindiscoUrl({ key: publicKey, asset, address, network })} title="Buy crypto with Coindisco" loading="lazy"
                sandbox={IFRAME_SANDBOX} allow={IFRAME_ALLOW} referrerPolicy="strict-origin-when-cross-origin" data-testid="buy-iframe" />
            )}
          </div>
        </>
      )}
      {network === "testnet" && (
        <p className="notice" style={{ fontSize: "0.8rem", margin: "10px 0 0" }} data-testid="buy-mainnet-only">
          Card purchases deliver <b>real mainnet</b> assets only. Quasaria is on the test network for now, so your address is not pre-filled. A purchase would not show up here.
        </p>
      )}
      <p className="muted" style={{ fontSize: "0.8rem", margin: "10px 0 0" }} data-testid="buy-widget-disclosure">{BUY_WIDGET_DISCLOSURE}</p>
    </div>
  );
}
