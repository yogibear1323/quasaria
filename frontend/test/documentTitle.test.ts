import { describe, expect, it } from "vitest";
import { DEFAULT_DOCUMENT_TITLE, titleForPath } from "../src/lib/documentTitle";
import { MERCH_TITLE } from "../src/merch/catalog";

describe("document title", () => {
  it("gives News and Markets their own titles, so leaving News cannot keep the news title", () => {
    expect(titleForPath("/news")).toBe("Stellar news · Quasaria");
    expect(titleForPath("/markets")).toBe("Markets · Quasaria");
    expect(titleForPath("/markets")).not.toBe(titleForPath("/news"));
  });
  it("covers the other app routes and falls back to the landing title", () => {
    expect(titleForPath("/")).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(titleForPath("/exchange")).toBe("Exchange · Quasaria");
    expect(titleForPath("/vault")).toBe("Yield Vault · Quasaria");
    expect(titleForPath("/buy")).toBe("Buy · Quasaria");
    expect(titleForPath("/merch")).toBe(MERCH_TITLE);
    expect(titleForPath("/nope")).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(titleForPath("/markets/")).toBe("Markets · Quasaria");
  });
});
