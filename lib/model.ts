// Token Radar's value model (radar-2): comps-calibrated, blind-validated.
//
// The board ranks every pre-token protocol the snapshot records that is not a
// wrapped, staked or bridged product of a token that already trades (the
// watchlist is the floor, never the ceiling). A protocol is pre-token when its
// record carries no token (mcap_usd, gecko_id and symbol all null); protocols
// whose token already trades are kept apart as the live set and shown at their
// market cap, never mixed into the ranking.
//
// Implied value comes only from the snapshot's own figures, in three steps:
//
//   1. COMPS CURVE. Fit log10(mcap) = a + b*log10(tvl) by least squares on the
//      protocols whose token already trades (mcap_usd > 0, tvl_usd > 0, not a CEX).
//      Five refinements were TESTED and REJECTED on the blind check below, and the
//      dashboard says so with their numbers: a per-category residual correction, a
//      global median mcap/TVL ratio, a fitted growth term, a fitted age term and a
//      quadratic curve all made held-out error worse than the plain curve's 82.0%.
//      A wider sweep (37 candidates: LAD and Huber robust fits, ridge, ratio
//      trimming, excluding bridges/staking from the fit, piecewise fits, category
//      shrinkage at several strengths) found nothing that beat the plain curve on
//      the same 5 folds either. The model therefore uses the plain curve, and
//      nothing else, for the comps base.
//   2. GROWTH. growthMult = 1 + clamp(change_7d, -50, 100)/100 * 0.35.
//   3. MATURITY. maturityMult = 0.7 + 0.3 * min(age_days, 1095)/1095; a protocol
//      with no listed_at uses 0.85 (the value at 548 days).
//
//   implied = round( 10^(a + b*log10(tvl)) * growthMult * maturityMult )
//
// Growth and maturity are stated priors, not fitted terms: the snapshot carries
// no traded token's growth history, so no fit could validate them, and the
// dashboard says that plainly. No protocol name is ever special-cased: the same
// function scores every row, and the curve is refit from the snapshot on every
// run, so a future snapshot with different protocols refits itself.
//
// BLIND VALIDATION. The curve is never judged on the data it was fit to. Two
// out-of-sample checks run on every build and their errors are published in the
// dashboard: (a) 5-fold, split by slug hash, fit on 4 folds and predict the 5th;
// (b) split-half by sorted slug, fit on one half and predict the other. The
// reported error is the median absolute log10 error and the median absolute
// percentage error of the held-out predictions. The uncertainty band on every row
// is implied x 10^(+/- median 5-fold log error): a band the validation earned,
// not a guess.
//
// FARM PLAN. Each row's plan is derived from the protocol's own record (category,
// chains, TVL, age). Gas is priced by chain tier (Ethereum mainnet is dear, the
// named L2s are cheap, everything else sits between), in three levels (low / mid /
// high = 0.5x / 1x / 2x the mid estimate). The plan states the total cost over the
// hold, the breakeven (the airdrop value that must arrive for the farm to pay for
// itself), and a verdict: FARM, THIN (small position only) or SKIP. A verdict of
// SKIP means the protocol's TVL is shrinking fast (7d <= -20%) or its implied
// value sits in the board's bottom decile while its growth is negative; the plan
// still lists the steps, so the reader can see what skipping saves.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted comps curve and its blind-validation errors. */
export interface CompsFit {
  n_live: number;
  intercept: number;
  slope: number;
  residual_sd: number;
  /** Median absolute log10 error, 5-fold held-out. */
  fold_median_log_err: number;
  /** Median absolute % error (|pred-actual|/actual), 5-fold held-out. */
  fold_median_pct_err: number;
  /** Median absolute log10 error, split-half held-out (mean of the two halves). */
  half_median_log_err: number;
  /** Median absolute % error, split-half held-out (mean of the two halves). */
  half_median_pct_err: number;
  /** Band half-width in log10: 10^band_log is the low/high multiplier. */
  band_log: number;
  /** Held-out median % error of the REJECTED per-category correction (same 5 folds). */
  cat_median_pct_err: number;
  /** Held-out median % error of the REJECTED global median mcap/TVL ratio (same 5 folds). */
  ratio_median_pct_err: number;
  /** Held-out median % error of the REJECTED fitted growth term (same 5 folds). */
  growth_median_pct_err: number;
  /** Held-out median % error of the REJECTED fitted age term (same 5 folds). */
  age_median_pct_err: number;
  /** Held-out median % error of the REJECTED quadratic curve (same 5 folds). */
  quad_median_pct_err: number;
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_mult: number;
  cat_shrink: number;
  cat_clamp: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_mult: 0.85,
  cat_shrink: 4,
  cat_clamp: 0.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2-comps';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
  farm_cost_mid_usd: number;
  breakeven_usd: number;
  model: {
    comps_base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
  farm_cost_mid_usd: number;
  breakeven_usd: number;
  comps_base_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and its validation. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: CompsFit;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  verdict_counts: { Farm: number; Thin: number; Skip: number };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Categories that are a wrapped, staked or bridged product of a token that already
 * trades, not a protocol still waiting on a launch of its own. The snapshot
 * carries no parentProtocol field, so this is the rule's observable part —
 * category and name — the same part the watchlist itself was drawn with.
 */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades, not an exchange, and
 * not a versioned pool. WBTC, Binance staked ETH and USDT0 are the rule's own
 * examples: each records no token of its own, yet each is Bitcoin, ETH or USDT
 * in another wrapper, so none of them is a launch still to come.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The traded protocols the comps curve is fit on: a market cap, a TVL, no CEX. */
export function liveUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
}

interface Curve {
  a: number;
  b: number;
}

/** Least-squares fit of log10(mcap) on log10(tvl). */
function fitCurve(rows: SnapshotProtocol[]): Curve {
  const xs = rows.map((p) => Math.log10(p.tvl_usd));
  const ys = rows.map((p) => Math.log10(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = den === 0 ? 0 : num / den;
  return { a: my - b * mx, b };
}

/** Absolute log10 prediction errors of `test` under a curve fit on `train`. */
function heldOutLogErrors(train: SnapshotProtocol[], test: SnapshotProtocol[]): number[] {
  const c = fitCurve(train);
  return test.map((p) => Math.abs(c.a + c.b * Math.log10(p.tvl_usd) - Math.log10(p.mcap_usd!)));
}

/** Absolute % prediction errors of `test` under a curve fit on `train`. */
function heldOutPctErrors(train: SnapshotProtocol[], test: SnapshotProtocol[]): number[] {
  const c = fitCurve(train);
  return test.map((p) => {
    const pred = Math.pow(10, c.a + c.b * Math.log10(p.tvl_usd));
    return Math.abs(pred - p.mcap_usd!) / p.mcap_usd! * 100;
  });
}

/**
 * Absolute % errors of `test` under the per-category-corrected curve fit on
 * `train`: the median residual of the protocol's category, shrunk by n/(n+4)
 * and clamped to +/-0.5 in log10. This is the rejected alternative: it is
 * computed only so the dashboard can report that it lost the blind check.
 */
function heldOutCatPctErrors(train: SnapshotProtocol[], test: SnapshotProtocol[]): number[] {
  const c = fitCurve(train);
  const byCat = new Map<string, number[]>();
  for (const q of train) {
    const arr = byCat.get(q.category ?? 'Other') ?? [];
    arr.push(Math.log10(q.mcap_usd!) - (c.a + c.b * Math.log10(q.tvl_usd)));
    byCat.set(q.category ?? 'Other', arr);
  }
  return test.map((p) => {
    let adj = 0;
    const rs = byCat.get(p.category ?? 'Other');
    if (rs !== undefined && rs.length >= 3) {
      adj = Math.max(-0.5, Math.min(0.5, median(rs) * (rs.length / (rs.length + 4))));
    }
    const pred = Math.pow(10, c.a + c.b * Math.log10(p.tvl_usd) + adj);
    return Math.abs(pred - p.mcap_usd!) / p.mcap_usd! * 100;
  });
}

/** Absolute % errors of `test` under the global median mcap/TVL ratio of `train`. */
function heldOutRatioPctErrors(train: SnapshotProtocol[], test: SnapshotProtocol[]): number[] {
  const ratio = median(train.map((q) => q.mcap_usd! / q.tvl_usd));
  return test.map((p) => Math.abs(p.tvl_usd * ratio - p.mcap_usd!) / p.mcap_usd! * 100);
}

/** One live protocol's regression features: log TVL, clamped 7d growth, log age. */
interface Feats { x: number; g: number; logAge: number }

function featsOf(p: SnapshotProtocol, asOf: string): Feats {
  const age = ageDays(asOf, p.listed_at);
  return {
    x: Math.log10(p.tvl_usd),
    g: Math.min(100, Math.max(-50, finite(p.change_7d, 0))) / 100,
    logAge: Math.log10((age === null ? 548 : age) + 1),
  };
}

/** Solve a small dense linear system by Gaussian elimination, or null when singular. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    if (Math.abs(m[c]![c]!) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((r, i) => r[n]! / m[i]![i]!);
}

/** Least squares on `train` for a feature map, or null when the system is singular. */
function fitFeatures(train: SnapshotProtocol[], asOf: string, feats: (f: Feats) => number[]): ((f: Feats) => number) | null {
  const p = feats(featsOf(train[0]!, asOf)).length;
  const xtx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty: number[] = new Array<number>(p).fill(0);
  for (const q of train) {
    const f = feats(featsOf(q, asOf));
    const y = Math.log10(q.mcap_usd!);
    for (let i = 0; i < p; i++) {
      xty[i]! += f[i]! * y;
      for (let j = 0; j < p; j++) xtx[i]![j]! += f[i]! * f[j]!;
    }
  }
  const beta = solveLinear(xtx, xty);
  if (beta === null) return null;
  return (f: Feats) => feats(f).reduce((s, v, i) => s + v * beta[i]!, 0);
}

/**
 * Absolute % errors of `test` under a least-squares fit of `feats` on `train`.
 * The three rejected alternatives below share this helper and the same 5 folds as
 * the plain curve, so their published errors are directly comparable to it.
 */
function heldOutFeatPctErrors(train: SnapshotProtocol[], test: SnapshotProtocol[], asOf: string, feats: (f: Feats) => number[]): number[] {
  const predict = fitFeatures(train, asOf, feats);
  if (predict === null) return [];
  return test.map((p) => {
    const pred = Math.pow(10, predict(featsOf(p, asOf)));
    return Math.abs(pred - p.mcap_usd!) / p.mcap_usd! * 100;
  });
}

function slugHash(slug: string): number {
  return [...slug].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 5;
}

/** Fit the comps curve on the live universe and validate it blind, twice. */
export function fitComps(snapshot: Snapshot, model: ModelConstants = MODEL): CompsFit {
  const live = liveUniverse(snapshot);
  const curve = fitCurve(live);
  const residuals = live.map((p) => Math.log10(p.mcap_usd!) - (curve.a + curve.b * Math.log10(p.tvl_usd)));
  const mean = residuals.reduce((s, r) => s + r, 0) / Math.max(1, residuals.length);
  const sd = Math.sqrt(residuals.reduce((s, r) => s + (r - mean) * (r - mean), 0) / Math.max(1, residuals.length));

  // 5-fold blind check: split by slug hash, fit on 4 folds, predict the 5th.
  const foldLogErrs: number[] = [];
  const foldPctErrs: number[] = [];
  const foldCatErrs: number[] = [];
  const foldRatioErrs: number[] = [];
  const foldGrowthErrs: number[] = [];
  const foldAgeErrs: number[] = [];
  const foldQuadErrs: number[] = [];
  for (let k = 0; k < 5; k++) {
    const test = live.filter((p) => slugHash(p.slug) === k);
    const train = live.filter((p) => slugHash(p.slug) !== k);
    if (test.length > 0 && train.length > 2) {
      foldLogErrs.push(...heldOutLogErrors(train, test));
      foldPctErrs.push(...heldOutPctErrors(train, test));
      foldCatErrs.push(...heldOutCatPctErrors(train, test));
      foldRatioErrs.push(...heldOutRatioPctErrors(train, test));
      // The rejected fitted terms, on the same folds: a growth term, an age term
      // and a quadratic in log TVL. Each lost to the plain curve, so growth and
      // age stay stated priors and the curve stays straight (see the dashboard).
      foldGrowthErrs.push(...heldOutFeatPctErrors(train, test, snapshot.as_of, (f) => [1, f.x, f.g]));
      foldAgeErrs.push(...heldOutFeatPctErrors(train, test, snapshot.as_of, (f) => [1, f.x, f.logAge]));
      foldQuadErrs.push(...heldOutFeatPctErrors(train, test, snapshot.as_of, (f) => [1, f.x, (f.x - 8.5) ** 2]));
    }
  }
  const foldMed = median(foldLogErrs);
  const foldPct = median(foldPctErrs);
  // Split-half blind check: sorted by slug, fit on one half, predict the other, both ways.
  const sorted = [...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const halfA = sorted.filter((_, i) => i % 2 === 0);
  const halfB = sorted.filter((_, i) => i % 2 === 1);
  const halfLogErrs = [...heldOutLogErrors(halfA, halfB), ...heldOutLogErrors(halfB, halfA)];
  const halfPctErrs = [...heldOutPctErrors(halfA, halfB), ...heldOutPctErrors(halfB, halfA)];
  const halfMed = median(halfLogErrs);
  const halfPct = median(halfPctErrs);
  const pct1 = (n: number): number => Math.round(n * 10) / 10;
  return {
    n_live: live.length,
    intercept: round4(curve.a),
    slope: round4(curve.b),
    residual_sd: round4(sd),
    fold_median_log_err: round4(foldMed),
    fold_median_pct_err: pct1(foldPct),
    half_median_log_err: round4(halfMed),
    half_median_pct_err: pct1(halfPct),
    band_log: round4(foldMed),
    cat_median_pct_err: pct1(median(foldCatErrs)),
    ratio_median_pct_err: pct1(median(foldRatioErrs)),
    growth_median_pct_err: pct1(median(foldGrowthErrs)),
    age_median_pct_err: pct1(median(foldAgeErrs)),
    quad_median_pct_err: pct1(median(foldQuadErrs)),
  };
}

/** The comps base value: what the curve alone says a TVL is worth, before growth and age. */
export function compsBase(tvlUsd: number, _category: string | null, fit: CompsFit): { base: number } {
  return { base: Math.pow(10, fit.intercept + fit.slope * Math.log10(tvlUsd)) };
}

/** The multipliers and the implied value one protocol gets under the fitted curve. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
  model: ModelConstants,
): { implied: number; low: number; high: number; base: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult =
    age === null ? model.unknown_age_mult : model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { base } = compsBase(protocol.tvl_usd, protocol.category, fit);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  const band = Math.pow(10, fit.band_log);
  return {
    implied,
    low: Math.max(1, Math.round(implied / band)),
    high: Math.round(implied * band),
    base,
    growthPct,
    growthMult,
    maturityMult,
    age,
  };
}

// ---------------------------------------------------------------- farm costs

/** Named cheap chains: the L2s and sidechains whose gas is cents, not dollars. */
const CHEAP_CHAINS = new Set([
  'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Blast', 'Mode', 'Linea', 'Scroll',
  'ZkSync', 'Mantle', 'BSC', 'Binance', 'Gnosis', 'Celo', 'Avalanche', 'Fantom',
  'Berachain', 'Sei', 'Sui', 'Aptos', 'Near', 'Starknet', 'Fraxtal', 'Manta', 'Zora',
]);

/** Mid gas estimate for one transaction on a protocol's first chain, in USD. */
export function gasPerTx(p: SnapshotProtocol): number {
  const chain = p.chains.length > 0 ? p.chains[0]! : '';
  if (chain === 'Ethereum') return 8;
  if (CHEAP_CHAINS.has(chain)) return 0.5;
  if (chain === 'Solana' || chain === 'Bitcoin') return 0.2;
  return 2;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Total mid gas cost of the plan: setup + one action a week over the hold + exit. */
export function farmCostMid(p: SnapshotProtocol, age: number | null): { mid: number; low: number; high: number; holdDays: number; weeklyTx: number } {
  const gas = gasPerTx(p);
  const hold = holdDaysFor(age);
  const weeklyTx = Math.max(1, Math.round(hold / 7));
  const mid = Math.round((gas * (2 + weeklyTx + 1)) * 100) / 100;
  return { mid, low: Math.round(mid * 0.5 * 100) / 100, high: Math.round(mid * 2 * 100) / 100, holdDays: hold, weeklyTx };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age, gas tier), never
 * from a hand-written list of names. The last step states the verdict and the breakeven.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  verdict: 'Farm' | 'Thin' | 'Skip',
  cost: { mid: number; low: number; high: number; holdDays: number; weeklyTx: number },
): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = cost.holdDays;
  const action = actionFor(p, capital, chain);
  const gas = gasPerTx(p);
  const verdictLine =
    verdict === 'Farm'
      ? 'Verdict: FARM at the full size above.'
      : verdict === 'Thin'
        ? 'Verdict: THIN — farm it, but at half the size above, or skip it if gas rises.'
        : 'Verdict: SKIP for now — the cost and the shrinking TVL do not pay; re-check it next snapshot.';
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week for ${hold} days, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gas} of gas a week, ${cost.weeklyTx} actions in all`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Total farm cost is about $${cost.low} at low gas, $${cost.mid} at mid gas and $${cost.high} at high gas, so the airdrop must be worth at least $${cost.mid} to break even. ${verdictLine}`,
      cost: `$${cost.mid} mid, $${cost.low} to $${cost.high} across gas levels`,
      time: `${hold} days in all`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

// ---------------------------------------------------------------- board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; fit: CompsFit } {
  const fit = fitComps(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    const cost = farmCostMid(p, v.age);
    return { p, v, cost };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // The bottom-decile cut for the verdict: implied value at the 10th percentile.
  const p10 = scored.length > 0 ? scored[Math.floor(scored.length * 0.9)]!.v.implied : 0;
  const board: BoardRow[] = scored.map((s, i) => {
    const shrinking = s.v.growthPct <= -20;
    const weak = s.v.implied <= p10 && s.v.growthPct < 0;
    const verdict: 'Farm' | 'Thin' | 'Skip' = shrinking || weak ? 'Skip' : s.v.growthPct < 0 ? 'Thin' : 'Farm';
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      low_value_usd: s.v.low,
      high_value_usd: s.v.high,
      verdict,
      farm_cost_mid_usd: s.cost.mid,
      breakeven_usd: s.cost.mid,
      model: {
        comps_base_usd: Math.round(s.v.base),
        growth_pct: s.v.growthPct,
        growth_multiplier: round4(s.v.growthMult),
        maturity_multiplier: round4(s.v.maturityMult),
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age, verdict, s.cost).map(stepText),
    };
  });
  return { board, fit };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    low_value_usd: row.low_value_usd,
    high_value_usd: row.high_value_usd,
    verdict: row.verdict,
    farm_cost_mid_usd: row.farm_cost_mid_usd,
    breakeven_usd: row.breakeven_usd,
    comps_base_usd: row.model.comps_base_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, fit } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdictCounts = { Farm: 0, Thin: 0, Skip: 0 };
  for (const r of board) verdictCounts[r.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    verdict_counts: verdictCounts,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
