// 1.5.1: Huckleberry import against the real export layout (rows below are shaped exactly like
// archiewood/baby-tracker sources/huckleberry/events.csv), plus a 90-day file through the UI.
const { chromium } = require('playwright'); const fs = require('fs'); const D = __dirname;
const MOCK = fs.readFileSync(D + '/mock.js', 'utf8');
let fails = 0, passes = 0; const errs = [];
const ok = (c, m, x) => { if (c) passes++; else { fails++; console.log('FAIL:', m, x !== undefined ? JSON.stringify(x) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REAL = `"Type","Start","End","Duration","Start Condition","Start Location","End Condition","Notes"
"Sleep","2025-03-13 19:32","2025-03-14 06:57","11:24",,,,
"Feed","2025-02-20 05:08",,,"Formula","Bottle","140ml",
"Feed","2024-06-02 10:32",,,"Breast Milk","Bottle","60ml",
"Feed","2024-06-01 18:30","2024-06-01 19:04","00:34","00:14R","Breast","00:20L",
"Feed","2024-05-31 19:27","2024-05-31 19:50","00:23","00:23R","Breast",,
"Feed","2024-06-02 12:09","2024-06-02 12:15","00:06",,"Breast","00:06L",
"Feed","2024-05-10 09:06","2024-05-10 09:16","00:09","00:09R","Breast","00:00L",
"Diaper","2024-06-02 04:41",,,,,"Poo",
"Diaper","2024-05-20 05:10",,,,,"Pee:large",
"Diaper","2024-05-18 05:45",,,,,"Both",
"Diaper","2024-05-19 07:04",,"yellow",,,"Both, pee:large poo:large",
"Diaper","2024-05-15 04:30",,"yellow",,,"Both, pee:medium",
"Diaper","2024-05-11 03:40",,"yellow",,,"Poo:medium",
"Diaper","2024-05-09 23:41",,,,,"Both, pee:large poo:large","Blowout"
"Diaper","2026-09-01 16:00",,"mustard","Loose","Diaper rash","Poo:medium","Blowout"
"Growth","2024-05-16 15:18",,,"4.48kg","54.5cm","38cm",
"Growth","2025-08-09 15:28",,,"11.8lb","2.67ft.in",,
"Growth","2024-05-15 16:29",,,,"1.79ft.in",,
"Meds","2024-12-23 18:41",,,"1.5ml","Tylenol",,
"Tummy time","2024-05-31 16:02","2024-05-31 16:04","00:02",,,,
"Pump","2024-05-03 03:00",,,"100ml",,"120ml",
"Pump","2020-01-02 11:15","2020-01-02 11:45","00:30","1oz",,"2oz",
"Pump","2024-05-04 03:00",,,"90ml",,,
"Sleep","2026-09-01 13:05","2026-09-01 15:17","02:12",,"crib, nursing",,"in the pram"
"Feed","2026-09-01 14:00",,,"Mixed","Bottle","3.5oz",
"Solids","2026-09-01 12:00",,,"avocado, banana",,,
"Bath","2026-09-01 18:30",,,,,,`;
async function open(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles', hasTouch: true, isMobile: true });
  await ctx.addInitScript(`window.__cfg = ${JSON.stringify({ uid: 'u_A', name: 'M', owner: true, caps: [] })};`);
  await ctx.exposeFunction('__dbAll', () => ({})); await ctx.exposeFunction('__dbWrite', () => {});
  await ctx.addInitScript(MOCK);
  await ctx.addInitScript(`localStorage.setItem('cradle.local', JSON.stringify({ profile: { name: 'Sam', pronoun: 'he', birth_date: '2026-08-01', feeding: 'both', bottle_ml_default: 150, units: 'ml', day_start: '07:00', bedtime: '19:00', sleep_place: 'bassinet', pediatrician: { name: '', phone: '' } }, plan: { phase: 1 }, events: {}, checks: {}, flags: {} })); localStorage.setItem('cradle.prefs', JSON.stringify({ seenIntro: true, setup: { hidden: true } }));`);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + D + '/page.html'); await sleep(600); return p;
}
(async () => {
  const b = await chromium.launch();
  let p = await open(b);
  const r = await p.evaluate(t => { const r = importRows(parseCsvText(t)); return { skipped: r.skipped, w: r.weights.map(w => Math.round(w.grams)), e: r.entries.map(e => ({ t: e.type, k: e.feed && e.feed.kind, ml: (e.feed && e.feed.ml) || (e.pump && e.pump.ml), milk: e.feed && e.feed.milk, l: e.feed && e.feed.l_sec, r: e.feed && e.feed.r_sec, side: e.feed && e.feed.side, pee: e.diaper && e.diaper.pee, poop: e.diaper && e.diaper.poop, mins: e.end_at ? Math.round((e.end_at - e.start_at) / 6e4) : null, note: e.note })) }; }, REAL);
  const E = r.e;
  ok(E[0].t === 'sleep' && E[0].mins === 685, 'overnight sleep 19:32 to 06:57', E[0]);
  ok(E[1].k === 'bottle' && E[1].ml === 140 && E[1].milk === 'formula', 'formula bottle 140ml', E[1]);
  ok(E[2].ml === 60 && E[2].milk === 'breastmilk', 'breast milk bottle 60ml', E[2]);
  ok(E[3].k === 'breast' && E[3].r === 840 && E[3].l === 1200 && E[3].side === 'both' && E[3].mins === 34, 'breast R 14 + L 20', E[3]);
  ok(E[4].r === 1380 && E[4].l === 0 && E[4].side === 'R', 'breast right only', E[4]);
  ok(E[5].l === 360 && E[5].r === 0 && E[5].side === 'L', 'breast left only (blank Start Condition)', E[5]);
  ok(E[6].r === 540 && E[6].l === 0 && E[6].side === 'R', 'breast with 00:00L', E[6]);
  const dia = E.filter(e => e.t === 'diaper').map(e => [e.pee, e.poop]);
  ok(JSON.stringify(dia) === JSON.stringify([[false, true], [true, false], [true, true], [true, true], [true, true], [false, true], [true, true], [false, true]]), 'diapers Poo / Pee:large / Both / sizes / mustard + rash', dia);
  ok(E.find(e => e.t === 'diaper' && e.note === 'Blowout'), 'diaper note kept');
  const pumps = E.filter(e => e.t === 'pump').map(e => [e.ml, e.mins]);
  ok(JSON.stringify(pumps) === JSON.stringify([[220, 0], [89, 30], [90, 0]]), 'pumps: 100+120 ml, 1+2 oz, one side only', pumps);
  ok(E.find(e => e.t === 'sleep' && e.note === 'in the pram' && e.mins === 132), 'sleep with location + note');
  ok(E.find(e => e.k === 'bottle' && e.ml === 104), 'Mixed bottle 3.5oz');
  ok(JSON.stringify(r.w) === JSON.stringify([4480, 5352]), 'growth: 4.48kg and 11.8lb kept as weights', r.w);
  ok(r.skipped['growth rows without a weight'] === 1 && r.skipped['"Meds" rows'] === 1 && r.skipped['"Tummy time" rows'] === 1 && r.skipped['"Bath" rows'] === 1 && r.skipped['solid food rows'] === undefined && r.skipped['"Solids" rows'] === 1, 'skips named', r.skipped);

  // 90 days through the UI, timed
  p = await open(b);
  await p.evaluate(() => { location.hash = 'me'; }); await sleep(300);
  await p.tap('[data-act="import"]'); await sleep(300);
  await p.setInputFiles('#impFile', D + '/fixtures/huck-90d.csv'); await sleep(800);
  const prev = await p.evaluate(() => document.querySelector('#impOut').innerText);
  ok(/2342 entries to add/.test(prev) && /13 weights/.test(prev), '90-day preview', prev);
  const t0 = Date.now(); await p.tap('#impGo');
  await p.waitForFunction(() => !document.querySelector('#impGo'), null, { timeout: 120000 }).catch(() => {});
  const secs = (Date.now() - t0) / 1000;
  const n = await p.evaluate(() => ({ ev: evs().length, w: [...D().checks.values()].length, outbox: (localStorage.getItem('cradle.outbox') || '').length, local: (localStorage.getItem('cradle.local') || '').length }));
  ok(n.ev === 2342 && n.w === 13, '90 days imported', n);
  ok(secs < 30, `import took ${secs.toFixed(1)} s`, secs);
  console.log('import seconds', secs.toFixed(1), 'storage bytes', JSON.stringify(n));
  await p.evaluate(() => { location.hash = 'log'; }); await sleep(500);
  await p.screenshot({ path: D + '/t6-log-after-import.png' });
  console.log(`ERRORS: ${errs.length ? JSON.stringify(errs.slice(0, 5)) : 'none'}`);
  console.log(`passes ${passes} fails ${fails}`); await b.close();
})();
