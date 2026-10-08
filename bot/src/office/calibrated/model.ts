/**
 * Fast calibrated scoring layer (layer 2). Scores the snapshot once per candle and returns ONE probability per
 * fixed-outcome question. It advises only: it has no access to state, sizing, limits or orders.
 *
 * The model file is produced by research/quant/analyze_gate.py: per question a standardised logistic regression or a
 * small gradient-boosted tree ensemble, followed by an isotonic calibration map (piecewise linear, clipped) fit on a
 * later, disjoint calibration slice.
 */
import { readFileSync } from "node:fs";
import { FEATURES, type Feature, type Snapshot } from "./snapshot.js";

export const QUESTIONS = ["regime", "direction", "pressure", "setup_long", "setup_short", "risk"] as const;
export type Question = (typeof QUESTIONS)[number];
/** What each question asks (outcome resolved on the next `horizonBars` bars). */
export const QUESTION_TEXT: Record<Question, string> = {
  regime: "Choice: trending (efficiency ratio of the next T bars >= 0.30) vs ranging",
  direction: "Choice: close T bars ahead above (up) or below (down) the decision close",
  pressure: "Yes/no: net buying pressure (CLV x volume) over the next T/2 bars",
  setup_long: "Score: a long with this desk's stop/target closes in profit after fees",
  setup_short: "Score: a short with this desk's stop/target closes in profit after fees",
  risk: "Choice: calm (next-T realised vol <= 1.25x trailing) vs stressed",
};

interface QuestionBase {
  mean: number[]; // feature standardisation
  scale: number[];
  iso: { x: number[]; y: number[] }; // isotonic calibration map
}
export interface LogitQuestion extends QuestionBase { kind: "logit"; coef: number[]; intercept: number }
/** gradient-boosted trees (sklearn HistGradientBoosting export): node arrays per tree. */
export interface GbtTree { f: number[]; t: number[]; l: number[]; r: number[]; v: number[]; leaf: number[]; ml: number[] }
export interface GbtQuestion extends QuestionBase { kind: "gbt"; baseline: number; trees: GbtTree[] }
export type QuestionModel = LogitQuestion | GbtQuestion;
export interface CalibratedModel {
  schema: "quasaria-calibrated-model@1";
  trainedAt: string;
  trainWindow: { from: string; to: string };
  timeframeSec: number;
  horizonBars: number;
  geometry: { tpAtr: number; slAtr: number };
  features: string[];
  questions: Record<Question, QuestionModel>;
  thresholds: { setup: number; direction: number; regime: number; pressure: number; risk: number };
  weights: { setup: number; direction: number; pressure: number; regime: number; risk: number };
  sizing: { fixedRiskPct: number; kellyFraction: number; kellyCapPct: number };
  calibration: { verified: boolean; note: string; brier: Record<string, number> };
  gate: { passed: boolean; summary: string };
}

export type Probabilities = Record<Question, number>;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
/** isotonic map: linear interpolation between thresholds, clipped at the ends (sklearn out_of_bounds="clip"). */
export function isoMap(x: number, xs: number[], ys: number[]) {
  if (!xs.length) return x;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  const w = xs[hi] === xs[lo] ? 0 : (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + w * (ys[hi] - ys[lo]);
}

export function validateModel(m: CalibratedModel): CalibratedModel {
  if (m.schema !== "quasaria-calibrated-model@1") throw new Error("calibrated model: bad schema");
  if (m.features.join() !== FEATURES.join()) throw new Error("calibrated model: feature list does not match the state engine");
  for (const q of QUESTIONS) {
    const qm = m.questions[q];
    if (!qm || qm.mean.length !== FEATURES.length || qm.scale.length !== FEATURES.length) throw new Error(`calibrated model: question ${q} malformed`);
    if (qm.kind === "logit" && qm.coef.length !== FEATURES.length) throw new Error(`calibrated model: question ${q} coef length`);
    if (qm.kind === "gbt" && !(qm.trees.length > 0)) throw new Error(`calibrated model: question ${q} has no trees`);
    if (qm.kind !== "logit" && qm.kind !== "gbt") throw new Error(`calibrated model: question ${q} unknown kind`);
  }
  return m;
}
export const loadModel = (path: string) => validateModel(JSON.parse(readFileSync(path, "utf8")) as CalibratedModel);

export function rawScore(qm: QuestionModel, f: Record<Feature, number>) {
  const x = FEATURES.map((k, i) => (f[k] - qm.mean[i]) / (qm.scale[i] || 1));
  if (qm.kind === "logit") return sigmoid(x.reduce((z, xi, i) => z + qm.coef[i] * xi, qm.intercept));
  let z = qm.baseline;
  for (const tr of qm.trees) {
    let n = 0;
    while (!tr.leaf[n]) {
      const xi = x[tr.f[n]];
      n = Number.isNaN(xi) ? (tr.ml[n] ? tr.l[n] : tr.r[n]) : xi <= tr.t[n] ? tr.l[n] : tr.r[n];
    }
    z += tr.v[n];
  }
  return sigmoid(z);
}

/** One calibrated probability per question. Pure. */
export function score(m: CalibratedModel, s: Snapshot): Probabilities {
  const out = {} as Probabilities;
  for (const q of QUESTIONS) {
    const qm = m.questions[q];
    out[q] = Math.min(0.999, Math.max(0.001, isoMap(rawScore(qm, s.features), qm.iso.x, qm.iso.y)));
  }
  return out;
}
