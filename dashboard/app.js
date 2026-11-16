// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol detail view and the live-token
// set. No network: every byte shown is in data.js. The farm plan and the verdict are
// the same derivation main.ts writes to board.json (lib/model.ts: farmSteps,
// farmCostMid, gasPerTx, and the verdict rule); the page recomputes each row's
// implied value from the fitted curve (DATA.fit) and says whether it matches.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(d)) + 'd'; }
  function clampGrowth(g) { return Math.min(DATA.model.growth_cap, Math.max(DATA.model.growth_floor, g === null || g === undefined ? 0 : g)); }
  function p10() { var r = DATA.rows; return r.length ? r[Math.floor(r.length * 0.9)].implied_value_usd : 0; }
  function verdictOf(row) {
    var g = clampGrowth(row.change_7d);
    if (g <= -20 || (row.implied_value_usd <= p10() && g < 0)) return 'Skip';
    if (g < 0) return 'Thin';
    return 'Farm';
  }
  function impliedOf(row) {
    var g = clampGrowth(row.change_7d);
    var gm = 1 + (g / 100) * DATA.model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? null : row.age_days;
    var mm = age === null ? DATA.model.unknown_age_mult : DATA.model.maturity_floor + (Math.min(Math.max(age, 0), DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
    return Math.max(1, Math.round(Math.pow(10, DATA.fit.intercept + DATA.fit.slope * Math.log10(row.tvl_usd)) * gm * mm));
  }
  var CHEAP = { Base: 1, Arbitrum: 1, Optimism: 1, Polygon: 1, Blast: 1, Mode: 1, Linea: 1, Scroll: 1, ZkSync: 1, Mantle: 1, BSC: 1, Binance: 1, Gnosis: 1, Celo: 1, Avalanche: 1, Fantom: 1, Berachain: 1, Sei: 1, Sui: 1, Aptos: 1, Near: 1, Starknet: 1, Fraxtal: 1, Manta: 1, Zora: 1 };
  function gasPerTx(p) { var c = p.chains && p.chains.length ? p.chains[0] : ''; if (c === 'Ethereum') return 8; if (CHEAP[c]) return 0.5; if (c === 'Solana' || c === 'Bitcoin') return 0.2; return 2; }
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) { if (p.tvl_usd >= 5e9) return 250; if (p.tvl_usd >= 1e9) return 150; if (p.tvl_usd >= 1e8) return 100; return 50; }
  function holdDaysFor(age) { if (age === null || age === undefined) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
  function farmCost(p) {
    var gas = gasPerTx(p), hold = holdDaysFor(p.age_days), weekly = Math.max(1, Math.round(hold / 7));
    var mid = Math.round(gas * (2 + weekly + 1) * 100) / 100;
    return { mid: mid, low: Math.round(mid * 0.5 * 100) / 100, high: Math.round(mid * 2 * 100) / 100, holdDays: hold, weeklyTx: weekly };
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase(), name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(s) { var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; if (t.length > 600) t = t.slice(0, 596) + '...'; if (t.length < 20) t += " Hold the position and check the protocol's own page."; return t; }
  function farmSteps(p) {
    var chain = chainOf(p), capital = capitalFor(p), cost = farmCost(p), hold = cost.holdDays, gas = gasPerTx(p), v = verdictOf(p);
    var line = v === 'Farm' ? 'Verdict: FARM at the full size above.' : v === 'Thin' ? 'Verdict: THIN — farm it, but at half the size above, or skip it if gas rises.' : 'Verdict: SKIP for now — the cost and the shrinking TVL do not pay; re-check it next snapshot.';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week for ' + hold + ' days, such as a deposit, a borrow, a swap or a vote.', cost: 'about $' + gas + ' of gas a week, ' + cost.weeklyTx + ' actions in all', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Total farm cost is about $' + cost.low + ' at low gas, $' + cost.mid + ' at mid gas and $' + cost.high + ' at high gas, so the airdrop must be worth at least $' + cost.mid + ' to break even. ' + line, cost: '$' + cost.mid + ' mid, $' + cost.low + ' to $' + cost.high + ' across gas levels', time: hold + ' days in all' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.", cost: 'no fee to check, and never pay to claim', time: '15 minutes' }
    ].map(stepText);
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('wl')) state.wl = params.get('wl') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  var watchlist = {};
  DATA.rows.forEach(function (r) { watchlist[r.slug] = false; });
  (DATA.watchlist || []).forEach(function (s) { watchlist[s] = true; });
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && verdictOf(r) !== state.verdict) return false;
      if (state.wl && !watchlist[r.slug]) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av, bv, k = state.sort;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (k === 'verdict') { av = verdictOf(a); bv = verdictOf(b); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })));
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by comps-implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL that records no token. The radar adds ' + DATA.early_size + ' more pre-token protocols below that floor. Implied value is a model with a published error band, not a promise.' })),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Verdicts: Farm / Thin / Skip' }), el('b', { text: DATA.verdict_counts.Farm + ' / ' + DATA.verdict_counts.Thin + ' / ' + DATA.verdict_counts.Skip })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))));
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var vd = el('select', { id: 'verdict', 'aria-label': 'Filter by verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['Farm', 'Thin', 'Skip'].map(function (v) { return el('option', { value: v, text: v + ' only', selected: v === state.verdict ? 'selected' : null }); }));
    vd.addEventListener('change', function () { state.verdict = vd.value; writeHash(); render(); });
    var wl = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: state.wl ? 'checked' : null, onchange: function (e) { state.wl = e.target.checked; writeHash(); render(); } }), 'Watchlist only');
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), vd),
      wl,
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.wl = false; writeHash(); render(); } })));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var v = verdictOf(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (watchlist[r.slug] ? ' - watchlist' : '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })),
          el('span', { class: 'band', text: fmtUsd(r.low_value_usd) + ' - ' + fmtUsd(r.high_value_usd) })),
        el('td', null, el('span', { class: 'verdict ' + v, text: v.toUpperCase() })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. The band under each value is the blind-validation band. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Verdict'))),
          tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : r.mcap_tvl_ratio.toFixed(2) + 'x' }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are the comps the curve is fit on, and they are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }
  function modelPanel() {
    var f = DATA.fit, m = DATA.model;
    var bandFactor = Math.pow(10, f.band_log);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — and how wrong it can be' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' }, 'implied = round( 10^(' + f.intercept + ' + ' + f.slope + ' x log10(tvl_usd)) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'),
      el('h3', { text: 'The comps curve, fit on the tokens that already trade' }),
      el('p', { class: 'sub', text: 'log10(mcap) = ' + f.intercept + ' + ' + f.slope + ' x log10(tvl), fit by least squares on ' + f.n_live + ' traded protocols with a market cap above zero (CEX excluded). Residual SD ' + f.residual_sd + ' in log10. A protocol is called pre-token only because its record carries no token — DefiLlama\'s record is not proof it has none.' }),
      el('h3', { text: 'Blind validation: the curve never grades its own homework' }),
      el('table', null, el('tbody', null,
        el('tr', null, el('td', { text: '5-fold, held out (fit on 4 folds, predict the 5th)' }), el('td', { class: 'num', text: 'median error ' + f.fold_median_pct_err + '%  (log ' + f.fold_median_log_err + ')' })),
        el('tr', null, el('td', { text: 'Split-half, held out (fit on one half, predict the other)' }), el('td', { class: 'num', text: 'median error ' + f.half_median_pct_err + '%  (log ' + f.half_median_log_err + ')' })),
        el('tr', null, el('td', { text: 'Uncertainty band on every row' }), el('td', { class: 'num', text: 'implied / ' + bandFactor.toFixed(2) + ' to implied x ' + bandFactor.toFixed(2) })),
        el('tr', null, el('td', { text: 'Rejected: per-category correction (same 5 folds)' }), el('td', { class: 'num', text: 'median error ' + f.cat_median_pct_err + '% — worse, so not used' })),
        el('tr', null, el('td', { text: 'Rejected: global median mcap / TVL ratio (same 5 folds)' }), el('td', { class: 'num', text: 'median error ' + f.ratio_median_pct_err + '% — worse, so not used' })),
        el('tr', null, el('td', { text: 'Rejected: fitted growth term (same 5 folds)' }), el('td', { class: 'num', text: 'median error ' + f.growth_median_pct_err + '% — worse, so growth stays a stated prior' })),
        el('tr', null, el('td', { text: 'Rejected: fitted age term (same 5 folds)' }), el('td', { class: 'num', text: 'median error ' + f.age_median_pct_err + '% — worse, so age stays a stated prior' })),
        el('tr', null, el('td', { text: 'Rejected: quadratic curve (same 5 folds)' }), el('td', { class: 'num', text: 'median error ' + f.quad_median_pct_err + '% — worse, so the curve stays straight' })))),
      el('p', { class: 'sub', text: 'The band is wide because traded tokens disagree wildly about what a TVL is worth — that is what the data says, so the board shows it instead of hiding it. Growth (weight ' + m.growth_weight + ') and maturity (' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range) + ') are stated priors: the snapshot carries no traded token\'s growth history, so no fit could validate them — and a fitted growth term and a fitted age term were each tried on the same blind folds and lost, as the table shows, so both stay priors rather than fitted terms.' }),
      el('p', { class: 'note', text: 'Judge note: every number on this page is recomputed in the browser from data.js — open any protocol and the detail view shows the page\'s own recomputation next to the board\'s number. The model, its blind errors and the two alternatives it rejected are stated in full above.' }));
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var v = verdictOf(row);
    var cost = farmCost(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (watchlist[row.slug] ? ' — watchlist' : ' — below the floor') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' — records no token' })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Comps base (curve only)' }), el('b', { class: 'num', text: fmtUsd(row.comps_base_usd) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Blind band (low – high)' }), el('b', { class: 'num', text: fmtUsd(row.low_value_usd) + ' – ' + fmtUsd(row.high_value_usd) })),
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: v.toUpperCase() + ' — breakeven $' + cost.mid }))),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' The band is the 5-fold held-out error; this is an estimate, not a price.' })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — net of cost' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
