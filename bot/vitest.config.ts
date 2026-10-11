import { defineConfig } from "vitest/config";

// Unit tests run the fleet on a fake clock: the stale-data breaker uses only the (fake) on-chain oracle timestamp there;
// heartbeat handling is covered directly in test/staleBreaker.test.ts.
export default defineConfig({ test: { env: { OFFICE_FEED_HEARTBEAT: "" } } });
