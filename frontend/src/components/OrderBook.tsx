import type { Book } from "../lib/demo";
import { fmt } from "../lib/format";

export default function OrderBook({ book, base, quote, onPick }: { book: Book; base: string; quote: string; onPick?: (p: number) => void }) {
  const asks = [...book.asks].slice(0, 10).reverse();
  const bids = book.bids.slice(0, 10);
  const max = Math.max(1, ...asks.map((a) => a.amount), ...bids.map((b) => b.amount));
  const mid = book.asks[0] && book.bids[0] ? (book.asks[0].price + book.bids[0].price) / 2 : book.asks[0]?.price ?? book.bids[0]?.price ?? 0;
  const spread = book.asks[0] && book.bids[0] ? ((book.asks[0].price - book.bids[0].price) / mid) * 100 : 0;
  const Row = ({ l, side }: { l: { price: number; amount: number }; side: "ask" | "bid" }) => (
    <div className={`lvl ${side}`} onClick={() => onPick?.(l.price)} style={{ cursor: onPick ? "pointer" : undefined }}>
      <div className="bar" style={{ width: `${(l.amount / max) * 100}%` }} />
      <span>{fmt(l.price, 5)}</span>
      <span>{fmt(l.amount, 0)}</span>
      <span>{fmt(l.amount * l.price, 1)}</span>
    </div>
  );
  return (
    <div className="ob">
      <div className="hdr"><span>Price ({quote})</span><span style={{ textAlign: "right" }}>Size ({base})</span><span style={{ textAlign: "right" }}>Total</span></div>
      {asks.map((a, i) => <Row key={`a${i}`} l={a} side="ask" />)}
      <div className="mid">{fmt(mid, 5)} <span className="muted" style={{ fontSize: "0.7rem" }}>spread {fmt(spread, 2)}%</span></div>
      {bids.map((b, i) => <Row key={`b${i}`} l={b} side="bid" />)}
      <div className="muted" style={{ fontSize: "0.7rem", marginTop: 8, textAlign: "center" }}>
        {book.source === "horizon" ? "Live SDEX order book · Horizon testnet" : "Demo book (Horizon unavailable or empty)"}
      </div>
    </div>
  );
}
