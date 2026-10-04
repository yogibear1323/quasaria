/** /perps/chart — live XLM-PERP/USD chart for anyone weighing a perps trade (lazy-loaded route). */
import { Link } from "react-router-dom";
import XlmChart, { XLM_CHART_LABEL } from "../components/XlmChart";

export default function XlmChartPage() {
  return (
    <div className="xc-page" data-testid="xlm-chart-page">
      <header className="xc-pagehead">
        <div>
          <div className="xc-kicker">Perps · live chart</div>
          <h1>XLM-PERP / USD</h1>
          <p>
            What the XLM perp market looks like right now: candles and volume from Coinbase (Kraken as backup), the last candle updating live, plus the
            on-chain oracle price and the vault's mark price that Perps positions actually settle against.
          </p>
        </div>
        <div className="xc-ctas">
          <Link to="/perps" className="btn" data-testid="xlm-chart-trade">Trade on Perps →</Link>
          <Link to="/back-office?view=demo" className="btn ghost" data-testid="xlm-chart-demo">Try a demo</Link>
        </div>
      </header>
      <p className="xc-label" data-testid="xlm-chart-label">{XLM_CHART_LABEL}</p>
      <XlmChart />
    </div>
  );
}
