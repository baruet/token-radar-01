[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/baruet/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/baruet/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Launch Radar — value × odds from the peers' record, walk-forward tested, costed farm verdicts, 758/758 accounted

A token launch radar for make.fun's token-radar-01. It reads the sealed
snapshot (758 protocols as of 2026-11-14), fits a value model on the
protocols that already record a token, and ranks all 614 protocols that
record no token by expected value — model launch value × launch odds from
the peers' record — each with a concrete, costed 6-step farm plan.

## The model

Ordinary least squares on `log10(mcap_usd)` against `log10(tvl_usd)`,
fitted on the trading protocols with a positive market cap.

```
log10(mcap) = 3.0247 + 0.5223 * log10(TVL)
```

Fitted on **n = 128** trading protocols. Of the 144 protocols that record a
token, 16 were excluded from the fit (15 with market cap 0, 1 with a
negative market cap), because log10 is undefined there. No protocol name
and no coefficient is hardcoded; everything is fitted from the snapshot.

### Terms tested (kept only if the 5-fold held-out median error improves by ≥ 2 points)

| Term | Rows fitted | Base 5-fold error | Term 5-fold error | Kept? |
| --- | --- | --- | --- | --- |
| growth (change_7d) | 128 | 85.7% | 86.6% | Rejected |
| age (age_days) | 95 | 83.2% | 85.3% | Rejected |
| quadratic (logTVL^2) | 128 | 85.7% | 85.5% | Rejected |
| category offsets | 128 | 85.7% | 85.2% | Rejected |

No term qualified, so the chosen model is the base model alone. (The
category test used one offset per category with ≥ 10 trading protocols:
Lending, Dexs.)

### Validation — median absolute percentage error

| Test | Error | Detail |
| --- | --- | --- |
| 5-fold cross-validation | 85.7% | fold = index in slug order mod 5, n = 128 |
| Held-out A (every 5th, from 0) | 85.4% | test n = 26 |
| Held-out B (every 5th, from 2) | 95.9% | test n = 26 |
| Walk-forward | 88.6% | fit on listed_at ≤ 2024-02-18 (n = 48), test on newer (n = 47) |

The model is weak in absolute terms — a median error near 86% — and the
dashboard says so. The band on every row is built from that error
(launch value × (1 ± 0.857) × odds), so the uncertainty is visible next to
every claim instead of hidden.

### Calibration — trading anchors by predicted value, deciles

| Decile | n | Median predicted | Median actual | Median ratio |
| --- | --- | --- | --- | --- |
| 1 | 13 | $3.68M | $5.54M | 0.63 |
| 2 | 13 | $4.31M | $3.55M | 1.23 |
| 3 | 13 | $4.89M | $9.05M | 0.54 |
| 4 | 13 | $5.52M | $3.64M | 1.60 |
| 5 | 13 | $7.48M | $22.40M | 0.31 |
| 6 | 13 | $10.20M | $8.43M | 1.32 |
| 7 | 13 | $14.10M | $14.10M | 1.02 |
| 8 | 13 | $18.20M | $63.40M | 0.32 |
| 9 | 12 | $36.20M | $26.30M | 1.80 |
| 10 | 12 | $99.00M | $143.00M | 0.87 |

## Launch odds

Odds = the share of similar protocols that record a token (peers' record,
shrunk toward the overall share). It describes the record; it does not
predict whether or when a token is issued.

Protocols are grouped by category group (the 6 largest categories by
protocol count — Dexs, Liquid Staking, Lending, CEX, Bridge, Risk Curators —
everything else as Other) × TVL band ($5M–$20M, $20M–$100M, $100M–$1B,
$1B+). Raw share = trading protocols in the cell / all protocols in the
cell. Shrunk odds = (trading in cell + 20 × overall share) / (n in cell +
20), clamped to [0.02, 0.95]. Overall share = 144/758 = 19.0%. A cell with
fewer than 5 protocols falls back to its category-level share, then to the
overall share.

Worked example (rank 1, Binance CEX): cell CEX · $1B+, 16 peers, raw share
4/16 = 0.250, shrunk odds (4 + 20 × 0.190) / (16 + 20) = 0.217. Launch
value $635,947,898 × 0.217 = expected value $137,779,389.

## Farm method

- **Gas (assumption):** Ethereum $8.00 per action, every other chain $0.50
  per action. A protocol's farm chain is the cheapest chain in its chains
  list under this rule (Ethereum only if it is the only chain listed; when
  several non-Ethereum chains tie at $0.50, the alphabetically first).
- **Farm cost:** 4 weekly actions × gas + first-transaction gas. Mid cost
  is $2.50 on a $0.50 chain and $40 on Ethereum; low is half of mid, high
  is double mid.
- **Deposit (assumption):** farm-size deposit $150 on cheap chains, $50 on
  Ethereum (high gas). Farm verdict = full deposit, Thin = half deposit,
  Skip = $0.
- **Farmer's share (assumption):** a small farmer receives 0.1% of the
  launch value. Farmer gain = expected value × 0.001.
- **Verdict rule:** Farm if farmer gain > 3 × farm cost (mid); Thin if
  farmer gain > 1 × farm cost; otherwise Skip. Breakeven = farm cost
  (mid).
- **Verdict distribution on this board: Farm 614, Thin 0, Skip 0.**
  That is the honest outcome of the rules above, not a bug: the smallest
  launch value on the board is about $3.3M, so even the lowest-odds row
  clears 3 × the $2.50–$40 farm cost by a wide margin. The Thin/Skip
  branches exist in the code and the dashboard and would trigger on a
  snapshot where small protocols carry lower odds or lower TVL.
- **Honesty:** "records no token" means the snapshot's record carries no
  token for the protocol — it is not proof that no token exists.

## Coverage

- 758/758 protocols accounted: 614 pre-token rows on the board + 144 that
  record a token (128 fitted as anchors).
- Watchlist 40/40 covered. The board ranks by expected value descending;
  ties break by slug ascending. Implied value = expected value.

## How to run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`--input` defaults to `/input` (a directory means `<dir>/snapshot.json`).
Output dir: `--output`, else `MAKEFUN_OUTPUT_DIR`, else `/output`. Node 22
standard library only; no installs, no network at runtime. The program
writes `board.json`, `dashboard/` (index.html, app.css, app.js, data.js),
`screenshots/` and `dossier.json`, and exits non-zero if any gate check
fails (row count, ranks 1..N, implied values non-increasing, watchlist
coverage, farm-step lengths, screenshot caps, dashboard source ≤ 60,000
bytes, dossier ≤ 1.5 MiB).

## Size budget result (this build)

- Dashboard source total: 58,057 bytes (index.html 5,375 + app.css 2,996 +
  app.js 14,732 + data.js 34,954) — under the 60,000-byte budget.
- data.js: 34,954 bytes — under its 35,000-byte budget. Rows are packed
  as comma-separated strings (money in $ thousands, base36); low/high band
  and farm costs are derived in app.js from expected value, the band
  error, the farm chain and the verdict, so they are not stored per row.
- dossier.json: 699,637 bytes — under the 1.5 MiB cap.
- Two runs into different output directories are byte-identical
  (`diff -r` clean).

## Files

- `main.ts` — entrypoint: read snapshot, fit, build board, write outputs, validate.
- `lib/model.ts` — OLS fitting, term tests, the three validations,
  calibration deciles, odds cells, farm economics, farm-step templates.
- `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` —
  sortable/filterable board, per-protocol detail view (hash-deep-linkable),
  model & validation section, farm method. Palette: dark slate, light
  text, sky accent; green = Farm, amber = Thin, grey = Skip.
- `vendor/makefun-board.ts` — the kit's dossier library, copied verbatim.
- `screenshots/1-board.png`, `2-detail.png`, `3-filtered.png` — rendered
  in-session from the built dashboard at 1440×900.
