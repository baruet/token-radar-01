// Launch Radar — value model for token-radar-01 v3.
// Fits a log-log model of token market cap on TVL from the snapshot's own
// trading protocols, tests extra terms against held-out error, validates it
// three ways, and prices every pre-token protocol by expected value:
// launch value (from the model) times launch odds (from the peers' record).
// No protocol name and no coefficient is hardcoded: everything below is
// fitted from the snapshot passed in.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface TermResult {
  key: string;
  label: string;
  n: number;
  cv5: number;
  baseCv5: number;
  kept: boolean;
}

export interface Validation {
  cv5: number;
  cv5n: number;
  heldA: number;
  heldAn: number;
  heldB: number;
  heldBn: number;
  walkCutoff: string;
  walkOlder: number;
  walkNewer: number;
  walkMape: number;
}

export interface Decile {
  n: number;
  medPred: number;
  medAct: number;
  medRatio: number;
}

export interface OddsCell {
  group: string;
  band: string;
  bandIdx: number;
  n: number;
  trading: number;
  raw: number;
  odds: number;
  fallback: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: string;
  age_days: number | null;
  launch_value_usd: number;
  odds: number;
  expected_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  verdict: string;
  farm_cost_mid_usd: number;
  breakeven_usd: number;
  model: string;
  farm_steps: string[];
  odds_cell: string;
  odds_n: number;
  odds_raw: number;
  farm_chain: string;
  farm_gas_usd: number;
  deposit_usd: number;
  farm_cost_low_usd: number;
  farm_cost_high_usd: number;
  watchlist: boolean;
}

export interface FitResult {
  asOf: string;
  source: string;
  total: number;
  tradingRecorded: number;
  fittedN: number;
  excludedNonPositive: number;
  preCount: number;
  watchlistCount: number;
  intercept: number;
  slope: number;
  keptTerms: string[];
  chosenCoef: number[];
  bigCategories: string[];
  growthCoef: number | null;
  ageCoef: number | null;
  quadCoef: number | null;
  catOffsets: Record<string, number>;
  terms: TermResult[];
  validation: Validation;
  calibration: Decile[];
  cells: OddsCell[];
  globalShare: number;
  bandError: number;
  bandErrorCapped: boolean;
  modelLabel: string;
  formula: string;
  rows: BoardRow[];
  verdictCounts: { Farm: number; Thin: number; Skip: number };
}

// ---- small numeric helpers -------------------------------------------------

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  if (n % 2 === 1) return s[(n - 1) / 2];
  return (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const ms = Date.parse(asOf + "T00:00:00Z") - Date.parse(listedAt + "T00:00:00Z");
  return Math.round(ms / 86400000);
}

// Ordinary least squares via Gaussian elimination with partial pivoting.
// X is an array of feature rows, y the targets. Returns the coefficients.
export function fitOLS(X: number[][], y: number[]): number[] {
  const k = X[0].length;
  const n = X.length;
  const a: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += X[r][i] * X[r][j];
      row.push(s);
    }
    let s = 0;
    for (let r = 0; r < n; r++) s += X[r][i] * y[r];
    row.push(s);
    a.push(row);
  }
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
    const tmp = a[i];
    a[i] = a[piv];
    a[piv] = tmp;
    const pv = a[i][i];
    if (pv === 0) throw new Error("fitOLS: singular design matrix");
    for (let j = i; j <= k; j++) a[i][j] /= pv;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = a[r][i];
      if (f !== 0) for (let j = i; j <= k; j++) a[r][j] -= f * a[i][j];
    }
  }
  return a.map((row) => row[k]);
}

function dot(coef: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < coef.length; i++) s += coef[i] * x[i];
  return s;
}

function logTvl(p: Protocol): number {
  return Math.log10(p.tvl_usd);
}

// Median absolute percentage error of a fitted model on a set of rows.
function mapeMedian(coef: number[], rows: Protocol[], feat: (p: Protocol) => number[]): number {
  const errs = rows.map((p) => {
    const pred = Math.pow(10, dot(coef, feat(p)));
    return Math.abs(pred - (p.mcap_usd as number)) / (p.mcap_usd as number);
  });
  return median(errs);
}

// 5-fold cross-validation: fold = index in slug order mod 5.
function cv5(feat: (p: Protocol) => number[], rows: Protocol[]): number {
  const errs: number[] = [];
  for (let f = 0; f < 5; f++) {
    const test = rows.filter((_p, i) => i % 5 === f);
    const train = rows.filter((_p, i) => i % 5 !== f);
    const coef = fitOLS(train.map(feat), train.map((p) => Math.log10(p.mcap_usd as number)));
    for (const p of test) {
      const pred = Math.pow(10, dot(coef, feat(p)));
      errs.push(Math.abs(pred - (p.mcap_usd as number)) / (p.mcap_usd as number));
    }
  }
  return median(errs);
}

// ---- odds ------------------------------------------------------------------

const BANDS = ["$5M–$20M", "$20M–$100M", "$100M–$1B", "$1B+"];

export function tvlBand(tvl: number): number {
  if (tvl < 20000000) return 0;
  if (tvl < 100000000) return 1;
  if (tvl < 1000000000) return 2;
  return 3;
}

function shrink(trading: number, n: number, globalShare: number): number {
  const o = (trading + 20 * globalShare) / (n + 20);
  return Math.min(0.95, Math.max(0.02, o));
}

// ---- farm economics --------------------------------------------------------

export function farmChain(chains: string[]): string {
  if (chains.length === 0) return "Ethereum";
  const nonEth = chains.filter((c) => c !== "Ethereum");
  if (nonEth.length === 0) return "Ethereum";
  return [...nonEth].sort()[0];
}

export function gasUsd(chain: string): number {
  return chain === "Ethereum" ? 8 : 0.5;
}

function fmtMoney(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fmtGas(v: number): string {
  return String(v);
}

// The six farm-step templates (section 2.6 of the spec). The dashboard's
// app.js carries the same six templates and renders them from the same
// parameters, so the rendered steps match board.json exactly.
export function buildFarmSteps(p: {
  name: string;
  chain: string;
  deposit: number;
  gas: number;
  low: number;
  mid: number;
  high: number;
  verdict: string;
}): string[] {
  const reason =
    p.verdict === "Farm"
      ? "farm it at the size above"
      : p.verdict === "Thin"
        ? "farm it, but at half the size above, or skip it if gas rises"
        : "the cost does not pay; re-check it next snapshot";
  const steps: string[] = [];
  steps.push(
    "Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.",
  );
  if (p.verdict === "Skip") {
    steps.push(
      `Do not deposit into ${p.name} for now: the expected gain does not cover the cost. Cost: $0. Time: 5 minutes to note it and move on.`,
    );
    steps.push(
      `Re-check ${p.name} next snapshot: if its TVL grows or a points program appears, farm it then. Cost: no fee to check. Time: 10 minutes.`,
    );
  } else {
    steps.push(
      `Deposit $${p.deposit} into ${p.name}'s main product on ${p.chain} and keep the position. Cost: $${p.deposit} of capital and about $${fmtGas(p.gas)} of gas. Time: 15 minutes to set up.`,
    );
    steps.push(
      `Make one qualifying action each week for 30 days, such as a deposit, a borrow, a swap or a vote. Cost: about $${fmtGas(p.gas)} of gas a week, 4 actions in all. Time: 10 minutes a week.`,
    );
  }
  if (p.verdict === "Skip") {
    steps.push(
      `Keep the wallet ready with $${fmtGas(p.gas)} of gas on ${p.chain} so you can start within a day if it qualifies. Cost: $${fmtGas(p.gas)} of gas held ready. Time: 5 minutes.`,
    );
  } else {
    steps.push(
      `Hold the position for at least 30 days so the activity is counted in more than one snapshot. Cost: the $${p.deposit} stays in the position. Time: 30 days.`,
    );
  }
  steps.push(
    `Total farm cost is about $${fmtMoney(p.low)} at low gas, $${fmtMoney(p.mid)} at mid gas and $${fmtMoney(p.high)} at high gas, so the airdrop must be worth at least $${fmtMoney(p.mid)} to break even. Verdict: ${p.verdict.toUpperCase()} — ${reason}. Cost: $${fmtMoney(p.mid)} mid, $${fmtMoney(p.low)} to $${fmtMoney(p.high)} across gas levels. Time: 30 days in all.`,
  );
  steps.push(
    "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log. Cost: no fee to check, and never pay to claim. Time: 15 minutes.",
  );
  return steps;
}

// ---- the full fit ----------------------------------------------------------

export function fitAll(snap: Snapshot): FitResult {
  const asOf = snap.as_of;
  const protocols = [...snap.protocols].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const watchSet = new Set(snap.watchlist);
  const tradingRecorded = protocols.filter((p) => p.mcap_usd !== null).length;
  // Fit only on protocols with a positive market cap and positive TVL:
  // log10 is undefined at 0, and one record carries a negative mcap.
  const trading = protocols.filter((p) => (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0);
  const fittedN = trading.length;
  const excludedNonPositive = tradingRecorded - fittedN;
  const pre = protocols.filter((p) => p.mcap_usd === null);

  const y = trading.map((p) => Math.log10(p.mcap_usd as number));
  const baseFeat = (p: Protocol): number[] => [1, logTvl(p)];
  const baseCoef = fitOLS(trading.map(baseFeat), y);
  const intercept = baseCoef[0];
  const slope = baseCoef[1];
  const baseCv5 = cv5(baseFeat, trading);

  // Category offsets: only categories with >= 10 trading protocols.
  const catCounts = new Map<string, number>();
  for (const p of trading) {
    if (p.category) catCounts.set(p.category, (catCounts.get(p.category) ?? 0) + 1);
  }
  const bigCategories = [...catCounts.entries()]
    .filter(([, n]) => n >= 10)
    .map(([c]) => c)
    .sort();
  const catFeat = (p: Protocol): number[] => {
    const v: number[] = [1, logTvl(p)];
    for (const c of bigCategories) v.push(p.category === c ? 1 : 0);
    return v;
  };

  // Term tests: keep a term only if it improves the 5-fold held-out median
  // absolute percentage error by at least 2 percentage points, measured on
  // the same fitting rows as the base model on that subset.
  const terms: TermResult[] = [];
  const growthFeat = (p: Protocol): number[] => [1, logTvl(p), p.change_7d ?? 0];
  const growthRows = trading.filter((p) => p.change_7d !== null);
  const growthCv5 = cv5(growthFeat, growthRows);
  const growthBase = cv5(baseFeat, growthRows);
  terms.push({ key: "growth", label: "growth (change_7d)", n: growthRows.length, cv5: growthCv5, baseCv5: growthBase, kept: growthBase - growthCv5 >= 0.02 });

  const ageRows = trading.filter((p) => p.listed_at !== null);
  const ageFeat = (p: Protocol): number[] => [1, logTvl(p), ageDays(asOf, p.listed_at) ?? 0];
  const ageCv5 = cv5(ageFeat, ageRows);
  const ageBase = cv5(baseFeat, ageRows);
  terms.push({ key: "age", label: "age (age_days)", n: ageRows.length, cv5: ageCv5, baseCv5: ageBase, kept: ageBase - ageCv5 >= 0.02 });

  const quadFeat = (p: Protocol): number[] => [1, logTvl(p), logTvl(p) * logTvl(p)];
  const quadCv5 = cv5(quadFeat, trading);
  terms.push({ key: "quadratic", label: "quadratic (logTVL^2)", n: trading.length, cv5: quadCv5, baseCv5: baseCv5, kept: baseCv5 - quadCv5 >= 0.02 });

  const catCv5 = cv5(catFeat, trading);
  terms.push({ key: "category", label: "category offsets", n: trading.length, cv5: catCv5, baseCv5: baseCv5, kept: baseCv5 - catCv5 >= 0.02 });

  // Chosen model = base + kept terms (fit on the full trading set; the age
  // term, if kept, would be fit on the age subset — here none are kept).
  const keptTerms = terms.filter((t) => t.kept).map((t) => t.key);
  let chosenFeat: (p: Protocol) => number[] = baseFeat;
  let chosenCoef = baseCoef;
  let chosenRows = trading;
  let growthCoef: number | null = null;
  let ageCoef: number | null = null;
  let quadCoef: number | null = null;
  const catOffsets: Record<string, number> = {};
  if (keptTerms.length > 0) {
    // Build the combined feature vector in a fixed order: base, growth,
    // age, quadratic, then one offset per big category.
    chosenFeat = (p: Protocol): number[] => {
      const v: number[] = [1, logTvl(p)];
      if (keptTerms.includes("growth")) v.push(p.change_7d ?? 0);
      if (keptTerms.includes("age")) v.push(ageDays(asOf, p.listed_at) ?? 0);
      if (keptTerms.includes("quadratic")) v.push(logTvl(p) * logTvl(p));
      if (keptTerms.includes("category")) for (const c of bigCategories) v.push(p.category === c ? 1 : 0);
      return v;
    };
    chosenRows = keptTerms.includes("age") && !keptTerms.includes("growth") ? ageRows : trading;
    chosenCoef = fitOLS(chosenRows.map(chosenFeat), chosenRows.map((p) => Math.log10(p.mcap_usd as number)));
    let idx = 2;
    if (keptTerms.includes("growth")) growthCoef = chosenCoef[idx++];
    if (keptTerms.includes("age")) ageCoef = chosenCoef[idx++];
    if (keptTerms.includes("quadratic")) quadCoef = chosenCoef[idx++];
    if (keptTerms.includes("category")) {
      for (const c of bigCategories) catOffsets[c] = chosenCoef[idx++];
    }
  }

  const predictLaunch = (p: Protocol): number => {
    const v = Math.pow(10, dot(chosenCoef, chosenFeat(p)));
    return Math.round(v);
  };

  // ---- validation ---------------------------------------------------------
  const held = (testIdx: Set<number>): { mape: number; n: number } => {
    const test = trading.filter((_p, i) => testIdx.has(i));
    const train = trading.filter((_p, i) => !testIdx.has(i));
    const coef = fitOLS(train.map(chosenFeat), train.map((p) => Math.log10(p.mcap_usd as number)));
    return { mape: mapeMedian(coef, test, chosenFeat), n: test.length };
  };
  const heldA = held(new Set(trading.map((_p, i) => i).filter((i) => i % 5 === 0)));
  const heldB = held(new Set(trading.map((_p, i) => i).filter((i) => i % 5 === 2)));

  const listed = trading.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at as string) < (b.listed_at as string) ? -1 : 1);
  const walkCutoff = listed[Math.floor(listed.length / 2)].listed_at as string;
  const older = trading.filter((p) => p.listed_at !== null && (p.listed_at as string) <= walkCutoff);
  const newer = trading.filter((p) => p.listed_at !== null && (p.listed_at as string) > walkCutoff);
  const walkCoef = fitOLS(older.map(chosenFeat), older.map((p) => Math.log10(p.mcap_usd as number)));
  const walkMape = mapeMedian(walkCoef, newer, chosenFeat);

  const validation: Validation = {
    cv5: cv5(chosenFeat, chosenRows),
    cv5n: chosenRows.length,
    heldA: heldA.mape,
    heldAn: heldA.n,
    heldB: heldB.mape,
    heldBn: heldB.n,
    walkCutoff,
    walkOlder: older.length,
    walkNewer: newer.length,
    walkMape,
  };

  // Calibration deciles by predicted mcap (10 groups over the fitted set).
  const byPred = [...trading].sort((a, b) => predictLaunch(a) - predictLaunch(b));
  const calibration: Decile[] = [];
  const per = Math.floor(byPred.length / 10);
  const rem = byPred.length % 10;
  let pos = 0;
  for (let d = 0; d < 10; d++) {
    const size = per + (d < rem ? 1 : 0);
    const grp = byPred.slice(pos, pos + size);
    pos += size;
    calibration.push({
      n: grp.length,
      medPred: Math.round(median(grp.map(predictLaunch))),
      medAct: Math.round(median(grp.map((p) => p.mcap_usd as number))),
      medRatio: median(grp.map((p) => predictLaunch(p) / (p.mcap_usd as number))),
    });
  }

  // ---- odds ---------------------------------------------------------------
  const globalShare = tradingRecorded / protocols.length;
  const catTotals = new Map<string, number>();
  for (const p of protocols) {
    const g = p.category ?? "Other";
    catTotals.set(g, (catTotals.get(g) ?? 0) + 1);
  }
  const topGroups = [...catTotals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 6)
    .map(([c]) => c);
  const groupOf = (p: Protocol): string =>
    p.category !== null && topGroups.includes(p.category) ? p.category : "Other";

  interface CellAcc {
    n: number;
    trading: number;
  }
  const cellAcc = new Map<string, CellAcc>();
  const catAcc = new Map<string, CellAcc>();
  for (const p of protocols) {
    const g = groupOf(p);
    const key = g + "|" + tvlBand(p.tvl_usd);
    const c = cellAcc.get(key) ?? { n: 0, trading: 0 };
    c.n++;
    if (p.mcap_usd !== null) c.trading++;
    cellAcc.set(key, c);
    const ca = catAcc.get(g) ?? { n: 0, trading: 0 };
    ca.n++;
    if (p.mcap_usd !== null) ca.trading++;
    catAcc.set(g, ca);
  }
  const cells: OddsCell[] = [];
  for (const [key, acc] of [...cellAcc.entries()].sort()) {
    const [group, bandIdxStr] = key.split("|");
    const bandIdx = Number(bandIdxStr);
    let odds: number;
    let fallback = "cell";
    if (acc.n >= 5) {
      odds = shrink(acc.trading, acc.n, globalShare);
    } else {
      const ca = catAcc.get(group) as CellAcc;
      if (ca.n >= 5) {
        odds = shrink(ca.trading, ca.n, globalShare);
        fallback = "category";
      } else {
        odds = globalShare;
        fallback = "global";
      }
    }
    cells.push({
      group,
      band: BANDS[bandIdx],
      bandIdx,
      n: acc.n,
      trading: acc.trading,
      raw: acc.n === 0 ? 0 : acc.trading / acc.n,
      odds,
      fallback,
    });
  }
  const cellOf = (p: Protocol): OddsCell => {
    const g = groupOf(p);
    const b = tvlBand(p.tvl_usd);
    const found = cells.find((c) => c.group === g && c.bandIdx === b);
    if (!found) throw new Error("odds cell missing for " + p.slug);
    return found;
  };

  // ---- board rows ---------------------------------------------------------
  const bandError = validation.cv5;
  const bandErrorCapped = bandError >= 1;
  const e = bandErrorCapped ? 0.9 : bandError;

  const modelLabel =
    keptTerms.length === 0
      ? "log-log TVL"
      : "log-log TVL + " + keptTerms.join(" + ");
  const formula =
    keptTerms.length === 0
      ? `log10(mcap) = ${intercept.toFixed(4)} + ${slope.toFixed(4)} * log10(TVL)`
      : `log10(mcap) = ${chosenCoef[0].toFixed(4)} + ${chosenCoef[1].toFixed(4)} * log10(TVL)` +
        (growthCoef !== null ? ` + ${growthCoef.toFixed(4)} * change_7d` : "") +
        (ageCoef !== null ? ` + ${ageCoef.toFixed(6)} * age_days` : "") +
        (quadCoef !== null ? ` + ${quadCoef.toFixed(4)} * log10(TVL)^2` : "") +
        (Object.keys(catOffsets).length > 0
          ? " + category offsets " + Object.entries(catOffsets).map(([c, v]) => `${c} ${v.toFixed(4)}`).join(", ")
          : "");

  const rowsUnranked: BoardRow[] = pre.map((p) => {
    const launch = predictLaunch(p);
    const cell = cellOf(p);
    const odds = cell.odds;
    const expected = Math.round(launch * odds);
    const low = Math.round(launch * (1 - e) * odds);
    const high = Math.round(launch * (1 + e) * odds);
    const chain = farmChain(p.chains);
    const gas = gasUsd(chain);
    const mid = 5 * gas;
    const lowCost = mid / 2;
    const highCost = mid * 2;
    const farmerGain = expected * 0.001;
    const verdict = farmerGain > 3 * mid ? "Farm" : farmerGain > 1 * mid ? "Thin" : "Skip";
    const deposit = verdict === "Farm" ? (chain === "Ethereum" ? 50 : 150) : verdict === "Thin" ? (chain === "Ethereum" ? 25 : 75) : 0;
    const steps = buildFarmSteps({
      name: p.name,
      chain,
      deposit,
      gas,
      low: lowCost,
      mid,
      high: highCost,
      verdict,
    });
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: null,
      listed_at: p.listed_at,
      gecko_id: null,
      symbol: null,
      token_status: "pre-token",
      age_days: ageDays(asOf, p.listed_at),
      launch_value_usd: launch,
      odds,
      expected_value_usd: expected,
      low_value_usd: low,
      high_value_usd: high,
      verdict,
      farm_cost_mid_usd: mid,
      breakeven_usd: mid,
      model: modelLabel,
      farm_steps: steps,
      odds_cell: `${cell.group} · ${cell.band}`,
      odds_n: cell.n,
      odds_raw: cell.raw,
      farm_chain: chain,
      farm_gas_usd: gas,
      deposit_usd: deposit,
      farm_cost_low_usd: lowCost,
      farm_cost_high_usd: highCost,
      watchlist: watchSet.has(p.slug),
    };
  });

  rowsUnranked.sort((a, b) => b.expected_value_usd - a.expected_value_usd || (a.slug < b.slug ? -1 : 1));
  rowsUnranked.forEach((r, i) => {
    r.rank = i + 1;
  });

  const verdictCounts = { Farm: 0, Thin: 0, Skip: 0 };
  for (const r of rowsUnranked) verdictCounts[r.verdict as "Farm" | "Thin" | "Skip"]++;

  return {
    asOf,
    source: snap.source,
    total: protocols.length,
    tradingRecorded,
    fittedN,
    excludedNonPositive,
    preCount: pre.length,
    watchlistCount: snap.watchlist.length,
    intercept,
    slope,
    keptTerms,
    chosenCoef,
    bigCategories,
    growthCoef,
    ageCoef,
    quadCoef,
    catOffsets,
    terms,
    validation,
    calibration,
    cells,
    globalShare,
    bandError,
    bandErrorCapped,
    modelLabel,
    formula,
    rows: rowsUnranked,
    verdictCounts,
  };
}

// Round to 3 significant figures (for the compact dashboard data file).
export function sig3(v: number): number {
  if (v === 0) return 0;
  const d = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 2);
  return Math.round(v / d) * d;
}

export function b36(v: number): string {
  return Math.round(v).toString(36);
}
