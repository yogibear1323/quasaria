import type { StrategyConfig } from "../config.js";
import type { Strategy } from "../types.js";
import { DcaStrategy } from "./dca.js";
import { GridStrategy } from "./grid.js";
import { MomentumStrategy } from "./momentum.js";

export { DcaStrategy, GridStrategy, MomentumStrategy };

export function createStrategy(cfg: StrategyConfig): Strategy {
  switch (cfg.type) {
    case "grid": return new GridStrategy(cfg);
    case "dca": return new DcaStrategy(cfg);
    case "momentum": return new MomentumStrategy(cfg);
  }
}
