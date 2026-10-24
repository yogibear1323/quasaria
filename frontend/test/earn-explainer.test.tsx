import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Earn from "../src/pages/Earn";
import { WalletProvider } from "../src/lib/wallet";

describe("Earnings: How earnings work", () => {
  const html = renderToStaticMarkup(<MemoryRouter><WalletProvider><Earn /></WalletProvider></MemoryRouter>);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("states the confirmed tokenomics and rates", () => {
    expect(text).toMatch(/How earnings work/);
    expect(text).toMatch(/100 billion in total, fixed, with the issuer locked/);
    expect(text).toMatch(/50 billion sits in the reward reserve and 50 billion in the treasury/);
    expect(text).toMatch(/1% per month \(12% per year\) on balances of 1M GLACIERQ and up; nothing under 1M/);
    expect(text).toMatch(/10M GLACIERQ a day, at most/);
    expect(text).toMatch(/pro rata/);
    expect(text).toMatch(/about 13\.7 years/);
    expect(text).toMatch(/0\.30% on every swap/);
  });
  it("keeps the plain disclosure and avoids APY / compounding claims", () => {
    expect(text).toMatch(/finite reserve, are not guaranteed, and the daily cap can reduce them/);
    expect(text).not.toMatch(/APY|compounded|guaranteed (return|yield)/i);
  });
});
