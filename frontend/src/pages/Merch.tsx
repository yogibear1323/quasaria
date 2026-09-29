import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CATEGORIES, EMAIL_RE, MERCH_CONTACT_EMAIL, PRODUCTS, fmtExample, merchImg, readNotify, saveNotify, type Category, type Product } from "../merch/catalog";

/** /merch — preview storefront. No checkout, no payments, no backend. */
export default function Merch() {
  const [cat, setCat] = useState<"all" | Category>("all");
  const [open, setOpen] = useState<Product | null>(null);
  const list = useMemo(() => (cat === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.category === cat)), [cat]);
  return (
    <div className="merch">
      <section className="m-hero card glow" aria-labelledby="m-hero-title">
        <div className="m-hero-copy">
          <div className="l-kicker">Quasaria Supply · coming soon</div>
          <h1 id="m-hero-title">Wear the <span className="grad-text">Singularity</span>.</h1>
          <p>An original merch line built around the Singularity Q: tees in black, bone, lavender and electric lime, a hoodie, embroidered caps, stickers and two mugs, with liquid-chrome type and holographic gradients. It's a preview for now. Nothing is for sale and every price is an example.</p>
          <div className="m-hero-pills">
            <span className="pill cyan">Preview · not for sale yet</span>
            <span className="pill">Example prices</span>
            <span className="pill">No payments on this site</span>
          </div>
          <div className="row m-hero-cta">
            <a className="btn" href="#m-grid" onClick={(e) => { e.preventDefault(); document.getElementById("m-grid")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }}>Browse the collection</a>
            <button className="btn ghost" onClick={() => setOpen(PRODUCTS[1])}>See the flagship tee</button>
          </div>
        </div>
        <div className="m-hero-art" aria-hidden>
          <img className="m-h1" src={merchImg("mockups/tee-02-black-back.webp")} alt="" />
          <img className="m-h2" src={merchImg("mockups/hoodie-lavender.webp")} alt="" />
          <img className="m-h3" src={merchImg("mockups/cap-bone.webp")} alt="" />
          <img className="m-h4" src={merchImg("mockups/stickers-laptop.webp")} alt="" />
        </div>
      </section>

      <div className="notice m-note" role="note">
        <b>Preview only.</b> You can't buy anything here yet: there is no checkout, no payment, and prices are examples for layout. "Notify me" saves your email <b>in this browser only</b>. Merch has nothing to do with QFX, XP or any token, and browsing it doesn't affect your testnet account.
      </div>

      <div className="m-toolbar" id="m-grid">
        <div className="tabs m-tabs" role="tablist" aria-label="Product category">
          {CATEGORIES.map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)}>{c.label}</button>
          ))}
        </div>
        <span className="muted m-count">{list.length} item{list.length === 1 ? "" : "s"}</span>
      </div>

      <div className="m-grid" data-testid="merch-grid">
        {list.map((p) => <ProductCard key={p.id} p={p} onOpen={() => setOpen(p)} />)}
      </div>

      <div className="m-how">
        {[
          ["Printed on demand", "Each item would be made when it's ordered, so there's no warehouse of unsold stock."],
          ["Original artwork", "Every design is drawn in-house from the Quasaria mark. No third-party logos."],
          ["Just merch", "Buying merch would never earn XP, badges or tokens. XP only rewards learning and trying things once."],
        ].map(([t, d]) => (
          <div className="card m-how-item" key={t}><h3>{t}</h3><p className="muted">{d}</p></div>
        ))}
      </div>

      <footer className="m-disclaimers card" aria-label="Merch disclaimers" data-testid="merch-disclaimers">
        <h2>The small print</h2>
        <ul>
          <li><b>Preview, not a shop.</b> Nothing on this page is for sale. There is no checkout, no payment processing and no orders are taken. "Coming soon" buttons do nothing.</li>
          <li><b>Example prices.</b> Prices, blanks, colours and sizes are placeholders for layout and may change or never ship.</li>
          <li><b>Mockups.</b> Product photos are computer-generated mockups of original Quasaria artwork, not photos of real stock.</li>
          <li><b>Notify me stays local.</b> Emails you enter are saved in this browser's localStorage only. They are never sent to a server, shared or used for marketing.</li>
          <li><b>No token or XP link.</b> Merch is unrelated to QFX, XP, badges or any digital asset, and confers no rights, rewards or returns. Quasaria is an unaudited, testnet-only project.</li>
          <li><b>Not affiliated.</b> Quasaria is not affiliated with or endorsed by the Stellar Development Foundation. "Stellar" is used only to describe the network the app runs on.</li>
        </ul>
      </footer>

      {open && <ProductModal p={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Swatches({ p, value, onChange, size = "sm" }: { p: Product; value: string; onChange: (id: string) => void; size?: "sm" | "lg" }) {
  if (!p.colors.length) return null;
  return (
    <div className={`m-swatches ${size}`} role="radiogroup" aria-label="Colour">
      {p.colors.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id} aria-label={c.name} title={c.name} className={value === c.id ? "on" : ""} style={{ background: c.hex }} onClick={(e) => { e.stopPropagation(); onChange(c.id); }} />
      ))}
    </div>
  );
}

function ProductCard({ p, onOpen }: { p: Product; onOpen: () => void }) {
  const first = Object.keys(p.mockups)[0];
  const [color, setColor] = useState(first);
  return (
    <article className="card m-card" data-testid={`merch-card-${p.id}`}>
      <button className="m-card-img" onClick={onOpen} aria-label={`View ${p.name}`}>
        <img src={p.mockups[color] ?? p.mockups[first]} alt={`${p.name} mockup${p.colors.length ? `, ${p.colors.find((c) => c.id === color)?.name}` : ""}`} loading="lazy" width={900} height={900} />
        {p.badge && <span className="m-badge">{p.badge}</span>}
        <span className="m-soon">Coming soon</span>
      </button>
      <div className="m-card-body">
        <h3>{p.name}</h3>
        <p className="muted">{p.tagline}</p>
        <div className="m-card-meta">
          <Swatches p={p} value={color} onChange={setColor} />
          <span className="m-sizes muted">{p.sizes.length > 1 ? `${p.sizes[0]}–${p.sizes[p.sizes.length - 1]}` : p.sizes[0]}</span>
        </div>
        <div className="m-card-foot">
          <div className="m-price"><b className="mono">{fmtExample(p.examplePrice)}</b><span className="m-example">example price</span></div>
          <button className="btn small ghost" onClick={onOpen}>Details</button>
        </div>
      </div>
    </article>
  );
}

function ProductModal({ p, onClose }: { p: Product; onClose: () => void }) {
  const colorIds = Object.keys(p.mockups);
  const [color, setColor] = useState(colorIds[0]);
  const gallery = useMemo(() => [...colorIds.map((c) => ({ src: p.mockups[c], alt: `${p.name} — ${p.colors.find((x) => x.id === c)?.name ?? "mockup"}`, color: c, art: false, light: false })), ...p.extras.map((x) => ({ ...x, color: "", art: !!x.art, light: !!x.light }))], [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(0);
  const [size, setSize] = useState(p.sizes.length === 1 ? p.sizes[0] : "");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState<"" | "ok" | "bad">(readNotify().some((n) => n.product === p.id) ? "ok" : "");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !(e.target instanceof HTMLInputElement)) setIdx((i) => (i + 1) % gallery.length);
      if (e.key === "ArrowLeft" && !(e.target instanceof HTMLInputElement)) setIdx((i) => (i - 1 + gallery.length) % gallery.length);
      if (e.key === "Tab" && dialogRef.current) {
        const f = dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, a[href]");
        if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const ov = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ov; prev?.focus?.(); };
  }, [onClose, gallery.length]);

  const pickColor = (c: string) => { setColor(c); const i = gallery.findIndex((g) => g.color === c); if (i >= 0) setIdx(i); };
  const cur = gallery[idx];
  const submit = (e: FormEvent) => { e.preventDefault(); setSaved(saveNotify(email, p.id) ? "ok" : "bad"); };
  const mailto = MERCH_CONTACT_EMAIL && `mailto:${MERCH_CONTACT_EMAIL}?subject=${encodeURIComponent(`Notify me: ${p.name}`)}&body=${encodeURIComponent(`Please let me know when the ${p.name} is available.`)}`;

  return (
    <div className="m-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="m-modal card" role="dialog" aria-modal="true" aria-labelledby="m-modal-title" ref={dialogRef} data-testid="merch-modal">
        <button className="m-close" onClick={onClose} ref={closeRef} aria-label="Close">×</button>
        <div className="m-gallery">
          <div className={`m-main ${cur.art ? "art" : ""} ${cur.light ? "light" : ""}`}>
            <img key={cur.src} src={cur.src} alt={cur.alt} />
            {gallery.length > 1 && <>
              <button className="m-nav prev" onClick={() => setIdx((idx - 1 + gallery.length) % gallery.length)} aria-label="Previous image">‹</button>
              <button className="m-nav next" onClick={() => setIdx((idx + 1) % gallery.length)} aria-label="Next image">›</button>
            </>}
          </div>
          <div className="m-thumbs" role="list">
            {gallery.map((g, i) => (
              <button key={g.src} role="listitem" className={`${i === idx ? "on" : ""} ${g.art ? "art" : ""} ${g.light ? "light" : ""}`} onClick={() => { setIdx(i); if (g.color) setColor(g.color); }} aria-label={`Show ${g.alt}`} aria-current={i === idx}>
                <img src={g.src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
        <div className="m-info">
          {p.badge && <span className="pill cyan">{p.badge}</span>}
          <h2 id="m-modal-title">{p.name}</h2>
          <p className="muted">{p.tagline}</p>
          <div className="m-price big"><b className="mono">{fmtExample(p.examplePrice)}</b><span className="m-example">example price · not for sale yet</span></div>

          {p.colors.length > 0 && <div className="m-field"><div className="m-label">Colour <span className="muted">{p.colors.find((c) => c.id === color)?.name}</span></div><Swatches p={p} value={color} onChange={pickColor} size="lg" /></div>}
          <div className="m-field">
            <div className="m-label">Size</div>
            <div className="m-sizes-pick" role="radiogroup" aria-label="Size">
              {p.sizes.map((s) => <button key={s} type="button" role="radio" aria-checked={size === s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>{s}</button>)}
            </div>
          </div>

          <ul className="m-details">{p.details.map((d) => <li key={d}>{d}</li>)}</ul>

          <button className="btn block m-buy" disabled aria-disabled="true" title="The store isn't open yet">Coming soon</button>

          <form className="m-notify" onSubmit={submit} noValidate>
            <label htmlFor="m-email" className="m-label">Notify me when it launches</label>
            <div className="m-notify-row">
              <input id="m-email" className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); if (saved === "bad") setSaved(""); }} aria-invalid={saved === "bad"} aria-describedby="m-notify-msg" />
              <button className="btn" type="submit" disabled={!email.trim()}>Notify me</button>
            </div>
            <div id="m-notify-msg" className={`m-notify-msg ${saved}`} role="status" aria-live="polite">
              {saved === "ok" ? "Saved in this browser only. Nothing was sent anywhere, so check back here for the launch." : saved === "bad" ? "That doesn't look like an email address." : "Stored locally on this device. No account, no newsletter, no server."}
            </div>
            {mailto && EMAIL_RE.test(MERCH_CONTACT_EMAIL) && <a className="m-mailto" href={mailto}>Or email us to be notified</a>}
          </form>
        </div>
      </div>
    </div>
  );
}
