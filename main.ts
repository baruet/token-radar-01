// Launch Radar — token-radar-01 v3 entrypoint.
// Reads the sealed snapshot, fits the value model (lib/model.ts), builds the
// 614-row pre-token board, writes the compact dashboard data file, copies
// the dashboard and screenshots into the output directory, and writes the
// dossier with the kit's buildDossier. Node 22 standard library only.
//
// Usage: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fitAll, sig3, b36, type Snapshot, type FitResult } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

function fail(msg: string): never {
  console.error("ERROR: " + msg);
  process.exit(1);
}

function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  let input = "/input";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) input = args[++i];
    else if (args[i] === "--output" && args[i + 1]) output = args[++i];
    else if (args[i].startsWith("--input=")) input = args[i].slice("--input=".length);
    else if (args[i].startsWith("--output=")) output = args[i].slice("--output=".length);
  }
  return { input, output };
}

// Display-name derivation for the dashboard: title-case each hyphen part.
// Must match dashboard/app.js deriveName exactly; rows whose real name
// differs from this derivation go in the NAMES override map.
const ACR = new Set(["rwa", "dao", "amm", "dex", "nft", "ai", "lp", "defi", "cex", "btc", "eth", "sol", "sui", "usd", "usdt", "usdc", "yusd", "adi", "ao", "tv", "v2", "v3", "dapp", "api", "otc", "p2p", "cdp", "lrt", "lst", "evm", "zk", "pos", "pow", "apr", "apy"]);
function deriveName(slug: string): string {
  return slug
    .split("-")
    .map((w) => {
      const m = w.match(/^(\d+)(.*)$/);
      if (m && m[2]) return m[1] + m[2][0].toUpperCase() + m[2].slice(1);
      if (ACR.has(w)) return w.toUpperCase();
      if (w.length > 3 && w.endsWith("usd")) return w.toUpperCase();
      if (w.length <= 2) return w.toUpperCase();
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function main(): void {
  const { input, output } = parseArgs();
  const snapPath = statSync(input).isDirectory() ? join(input, "snapshot.json") : input;
  if (!existsSync(snapPath)) fail("snapshot not found: " + snapPath);
  let snap: Snapshot;
  try {
    snap = JSON.parse(readFileSync(snapPath, "utf8")) as Snapshot;
  } catch (e) {
    fail("snapshot is not valid JSON: " + (e as Error).message);
  }
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist) || typeof snap.as_of !== "string") {
    fail("snapshot is missing protocols/watchlist/as_of");
  }

  const fit: FitResult = fitAll(snap);
  const rows = fit.rows;

  // ---- board.json (spec section 3 fields + implied_value_usd) -------------
  const boardRows = rows.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    mcap_usd: null,
    listed_at: r.listed_at,
    gecko_id: null,
    symbol: null,
    token_status: "pre-token",
    age_days: r.age_days,
    launch_value_usd: r.launch_value_usd,
    odds: r.odds,
    expected_value_usd: r.expected_value_usd,
    low_value_usd: r.low_value_usd,
    high_value_usd: r.high_value_usd,
    verdict: r.verdict,
    farm_cost_mid_usd: r.farm_cost_mid_usd,
    breakeven_usd: r.breakeven_usd,
    model: r.model,
    farm_steps: r.farm_steps,
    implied_value_usd: r.expected_value_usd,
  }));

  // ---- dashboard data.js (compact; see dashboard/app.js for the format) ---
  const cats = [...new Set(rows.map((r) => r.category ?? "No category"))].sort();
  const chains = [...new Set(rows.map((r) => r.farm_chain))].sort();
  const catIdx = new Map(cats.map((c, i) => [c, i]));
  const chainIdx = new Map(chains.map((c, i) => [c, i]));
  // The 6 largest categories by protocol count (ties by name), + Other.
  const catTotals = new Map<string, number>();
  for (const p of snap.protocols) catTotals.set(p.category ?? "Other", (catTotals.get(p.category ?? "Other") ?? 0) + 1);
  const topGroups = [...catTotals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 6)
    .map(([c]) => c);
  const groups7 = [...topGroups, "Other"];
  const cellIndex = new Map(fit.cells.map((c) => [`${c.group}|${c.bandIdx}`, c]));
  const cellsFlat: number[][] = [];
  for (const g of groups7) {
    for (let b = 0; b < 4; b++) {
      const cell = cellIndex.get(`${g}|${b}`);
      if (!cell) cellsFlat.push([0, 0, 0, 0]);
      else cellsFlat.push([cell.n, cell.trading, Math.round(cell.odds * 1000), cell.fallback === "cell" ? 0 : cell.fallback === "category" ? 1 : 2]);
    }
  }
  const rowStrings = rows.map((r) => {
    const chg = r.change_7d === null ? "" : String(Math.round(r.change_7d));
    const age = r.age_days === null ? "" : String(r.age_days);
    return [
      r.slug,
      b36(sig3(r.tvl_usd / 1000)),
      chg,
      age,
      b36(sig3(r.launch_value_usd / 1000)),
      b36(sig3(r.expected_value_usd / 1000)),
      r.verdict === "Farm" ? 0 : r.verdict === "Thin" ? 1 : 2,
      chainIdx.get(r.farm_chain),
      catIdx.get(r.category ?? "No category"),
      r.watchlist ? 1 : 0,
      r.chains.length,
    ].join(",");
  });
  // NAMES: "boardIndex:Real Name" entries, only where the real name differs
  // from the slug derivation (keyed by index, not slug, to save bytes).
  const nameOverrides: string[] = [];
  rows.forEach((r, i) => {
    if (deriveName(r.slug) !== r.name) nameOverrides.push(i + ":" + r.name);
  });
  const meta = {
    asOf: fit.asOf,
    // The source line is shown as visible footer text; the URL scheme is
    // dropped so no dashboard file carries an http(s) address at all.
    source: fit.source.replace("https://", ""),
    total: fit.total,
    pre: fit.preCount,
    watch: fit.watchlistCount,
    tradingRec: fit.tradingRecorded,
    fittedN: fit.fittedN,
    excluded: fit.excludedNonPositive,
    model: fit.modelLabel,
    formula: fit.formula,
    e: fit.bandErrorCapped ? 0.9 : fit.bandError,
    globalShare: fit.globalShare,
    terms: fit.terms.map((t) => [t.key, t.n, +t.baseCv5.toFixed(4), +t.cv5.toFixed(4), t.kept]),
    valid: {
      cv5: +fit.validation.cv5.toFixed(4),
      cv5n: fit.validation.cv5n,
      hA: +fit.validation.heldA.toFixed(4),
      hAn: fit.validation.heldAn,
      hB: +fit.validation.heldB.toFixed(4),
      hBn: fit.validation.heldBn,
      wCut: fit.validation.walkCutoff,
      wOld: fit.validation.walkOlder,
      wNew: fit.validation.walkNewer,
      wMape: +fit.validation.walkMape.toFixed(4),
    },
    cal: fit.calibration.map((d) => [d.n, sig3(d.medPred / 1000), sig3(d.medAct / 1000), +d.medRatio.toFixed(2)]),
    vc: [fit.verdictCounts.Farm, fit.verdictCounts.Thin, fit.verdictCounts.Skip],
  };
  const dataJs =
    "var ROWS=" + JSON.stringify(rowStrings) + ";\n" +
    "var NAMES=" + JSON.stringify(nameOverrides.join("|")) + ";\n" +
    "var CATS=" + JSON.stringify(cats) + ";\n" +
    "var CHAINS=" + JSON.stringify(chains) + ";\n" +
    "var GROUPS=" + JSON.stringify(topGroups) + ";\n" +
    "var GROUPS7=" + JSON.stringify(groups7) + ";\n" +
    "var CELLS=" + JSON.stringify(cellsFlat) + ";\n" +
    "var META=" + JSON.stringify(meta) + ";\n";

  // ---- write outputs -------------------------------------------------------
  const outDir = resolve(output);
  const dashDir = join(outDir, "dashboard");
  const shotDir = join(outDir, "screenshots");
  mkdirSync(dashDir, { recursive: true });
  mkdirSync(shotDir, { recursive: true });
  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows: boardRows }) + "\n", "utf8");
  writeFileSync(join(dashDir, "data.js"), dataJs, "utf8");
  for (const f of ["index.html", "app.css", "app.js"]) {
    copyFileSync(join("dashboard", f), join(dashDir, f));
  }
  const repoShots = readdirSync("screenshots").filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).sort();
  for (const f of repoShots) copyFileSync(join("screenshots", f), join(shotDir, f));

  // ---- validation (exit non-zero on any failure) ---------------------------
  const errors: string[] = [];
  const n = boardRows.length;
  if (n < 100 || n > 4000) errors.push(`row count ${n} outside 100-4000`);
  const ranks = boardRows.map((r) => r.rank).sort((a, b) => a - b);
  if (ranks.some((r, i) => r !== i + 1)) errors.push("ranks are not exactly 1..N");
  const implied = boardRows.map((r) => r.implied_value_usd);
  if (implied.some((v, i) => i > 0 && v > implied[i - 1])) errors.push("implied values rise with rank");
  if (new Set(implied).size === 1) errors.push("all implied values identical");
  const slugSet = new Set(boardRows.map((r) => r.slug));
  const missingWatch = snap.watchlist.filter((s) => !slugSet.has(s));
  if (missingWatch.length > 0) errors.push(`watchlist missing: ${missingWatch.join(",")}`);
  for (const r of boardRows) {
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      errors.push(`row ${r.slug}: farm_steps count ${r.farm_steps?.length}`);
      break;
    }
    const bad = r.farm_steps.find((s) => s.trim().length < 20 || s.trim().length > 600);
    if (bad !== undefined) {
      errors.push(`row ${r.slug}: farm step length ${bad.trim().length} outside 20-600`);
      break;
    }
  }
  if (repoShots.length < 3 || repoShots.length > 4) errors.push(`screenshots count ${repoShots.length}`);
  for (const f of repoShots) {
    const sz = statSync(join(shotDir, f)).size;
    if (sz > 512 * 1024) errors.push(`screenshot ${f} is ${sz} bytes (>512KiB)`);
  }
  const dashFiles = ["index.html", "app.css", "app.js", "data.js"];
  const srcBytes = dashFiles.reduce((s, f) => s + statSync(join(dashDir, f)).size, 0);
  if (srcBytes > 60000) errors.push(`dashboard source ${srcBytes} bytes (>60000)`);
  const dataJsBytes = statSync(join(dashDir, "data.js")).size;
  if (dataJsBytes > 35000) errors.push(`data.js ${dataJsBytes} bytes (>35000)`);
  for (const f of ["index.html", "app.css", "app.js"]) {
    const txt = readFileSync(join(dashDir, f), "utf8");
    if (/https?:\/\//.test(txt)) errors.push(`${f} carries an http(s) address`);
  }

  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  if (dossier.length > 1572864) errors.push(`dossier ${dossier.length} bytes (>1.5MiB)`);
  writeFileSync(join(outDir, "dossier.json"), dossier);

  if (errors.length > 0) fail(errors.join("; "));
  console.log(
    `Launch Radar: protocols=${fit.total} watchlist=${fit.watchlistCount} rows=${n} ` +
      `verdicts=Farm ${fit.verdictCounts.Farm}/Thin ${fit.verdictCounts.Thin}/Skip ${fit.verdictCounts.Skip} ` +
      `cv5=${fit.validation.cv5.toFixed(4)} srcBytes=${srcBytes} dataJsBytes=${dataJsBytes} dossierBytes=${dossier.length}`,
  );
}

main();
