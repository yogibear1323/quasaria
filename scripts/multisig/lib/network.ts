// Network selection with mainnet safety rails. Default is testnet; mainnet
// requires BOTH `--network mainnet` and `--i-understand`, and even then the
// tools only build UNSIGNED transactions (nothing here can sign or submit on
// mainnet).
import { Networks } from "@stellar/stellar-sdk";

export type NetworkName = "testnet" | "mainnet";

export interface NetworkCfg {
  name: NetworkName;
  passphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  friendbot?: string;
}

export const NETWORKS: Record<NetworkName, NetworkCfg> = {
  testnet: {
    name: "testnet",
    passphrase: Networks.TESTNET,
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    friendbot: "https://friendbot.stellar.org",
  },
  mainnet: {
    name: "mainnet",
    passphrase: Networks.PUBLIC,
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
  },
};

export interface NetworkOpts {
  network?: string;
  iUnderstand?: boolean;
  rpcUrl?: string;
  horizonUrl?: string;
}

const looksMainnet = (u: string) => /mainnet|horizon\.stellar\.org|pubnet|public/i.test(u) && !/testnet/i.test(u);
const looksTestnet = (u: string) => /testnet|futurenet/i.test(u);

export function resolveNetwork(o: NetworkOpts): NetworkCfg {
  const name = (o.network ?? "testnet").toLowerCase();
  if (name !== "testnet" && name !== "mainnet") throw new Error(`unknown network "${o.network}" (use testnet or mainnet)`);
  if (name === "mainnet" && !o.iUnderstand) {
    throw new Error("mainnet requires an explicit `--network mainnet --i-understand` (and still only produces UNSIGNED XDR).");
  }
  const base = NETWORKS[name];
  const cfg: NetworkCfg = { ...base, rpcUrl: o.rpcUrl ?? base.rpcUrl, horizonUrl: o.horizonUrl ?? base.horizonUrl };
  for (const u of [cfg.rpcUrl, cfg.horizonUrl]) {
    if (name === "testnet" && looksMainnet(u)) throw new Error(`refusing: testnet selected but ${u} looks like a MAINNET endpoint`);
    if (name === "mainnet" && looksTestnet(u)) throw new Error(`refusing: mainnet selected but ${u} looks like a TESTNET endpoint`);
  }
  return cfg;
}

/** Minimal surface of rpc.Server that the tools use (mockable in tests). */
export interface RpcLike {
  getNetwork(): Promise<{ passphrase: string }>;
}

/** The RPC endpoint must serve the network we think it does. */
export async function assertRpcNetwork(server: RpcLike, cfg: NetworkCfg): Promise<void> {
  const n = await server.getNetwork();
  if (n.passphrase !== cfg.passphrase) {
    throw new Error(`RPC network mismatch: expected "${cfg.passphrase}", server reports "${n.passphrase}"`);
  }
}

export function networkNameFromPassphrase(p: string): NetworkName {
  if (p === Networks.PUBLIC) return "mainnet";
  if (p === Networks.TESTNET) return "testnet";
  throw new Error(`unsupported network passphrase "${p}"`);
}
