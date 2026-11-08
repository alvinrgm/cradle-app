// 1.5.0: pumps visible on Today + Pumps filter, typed pump times, one-tap speech, CSV import.
const { chromium } = require('playwright'); const fs = require('fs'); const D = __dirname;
const MOCK = fs.readFileSync(D + '/mock.js', 'utf8');
let fails = 0, passes = 0; const errs = [];
const ok = (c, m, x) => { if (c) passes++; else { fails++; console.log('FAIL:', m, x !== undefined ? JSON.stringify(x) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FAKE_SR = `
  window.__srStarts = 0;
  window.webkitSpeechRecognition = class { constructor() { window.__sr = this; } start() { window.__srStarts++; setTimeout(() => this.onstart && this.onstart(), 20); setTimeout(() => {
      const say = window.__say || 'pumped 4 ounces';
      this.onresult && this.onresult({ results: [[{ transcript: say }]] });
      setTimeout(() => this.onend && this.onend(), 50); }, 100); } stop() { this.onend && this.onend(); } abort() {} };
  window.SpeechRecognition = window.webkitSpeechRecognition;`;
async function open(b, { sr = 'fake', events = {} } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles', hasTouch: true, isMobile: true });
  await ctx.addInitScript(`window.__cfg = ${JSON.stringify({ uid: 'u_A', name: 'M', owner: true, caps: [] })};`);
  await ctx.exposeFunction('__dbAll', () => ({})); await ctx.exposeFunction('__dbWrite', () => {});
  await ctx.addInitScript(MOCK);
  await ctx.addInitScript(sr === 'fake' ? FAKE_SR : 'delete window.webkitSpeechRecognition; delete window.SpeechRecognition;');
  await ctx.addInitScript(`localStorage.setItem('cradle.local', JSON.stringify({ profile: { name: 'Sam', pronoun: 'he', birth_date: '2026-09-26', feeding: 'both', bottle_ml_default: 150, units: 'ml', day_start: '00:01', bedtime: '23:58', sleep_place: 'bassinet', pediatrician: { name: '', phone: '' } }, plan: { phase: 1 }, events: ${JSON.stringify(events)}, checks: {}, flags: {} })); localStorage.setItem('cradle.prefs', JSON.stringify({ seenIntro: true, setup: { hidden: true } }));`);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + D + '/page.html'); await sleep(600); return p;
}
const pumps = p => p.evaluate(() => evs().filter(e => e.type === 'pump').map(e => ({ s: e.start_at, e: e.end_at, ml: e.pump && e.pump.ml, src: e.source })));
(async () => {
  const b = await chromium.launch();
  // ---- parser: typed pump times
  let p = await open(b);
  const P = (t, now) => p.evaluate(([t, now]) => { const r = parseShorthand(t, now); return r.entries.map(e => ({ type: e.type, s: new Date(e.start_at).toTimeString().slice(0, 5), e: e.end_at ? new Date(e.end_at).toTimeString().slice(0, 5) : null, ml: e.pump && e.pump.ml })); }, [t, now]);
  const NOW = new Date(2026, 10, 7, 3, 39).getTime();
  let r = await P('318 pump 25 minutes 120 mL', NOW); ok(r[0] && r[0].type === 'pump' && r[0].s === '03:18' && r[0].e === '03:43' && r[0].ml === 120, '"318 pump 25 minutes 120 mL" starts 3:18', r);
  r = await P('pump 120ml 315', NOW); ok(r[0] && r[0].s === '03:15' && r[0].ml === 120, '"pump 120ml 315"', r);
  r = await P('pump 120', NOW); ok(r[0] && r[0].ml === 120 && r[0].e === '03:39', '"pump 120" stays an amount, logged now', r);
  r = await P('pump 4oz 3:10', NOW); ok(r[0] && r[0].s === '03:10' && Math.round(r[0].ml) === 118, '"pump 4oz 3:10"', r);
  r = await P('pump L 60 R 45 300', NOW); ok(r[0] && r[0].s === '03:00' && r[0].ml === 105, '"pump L 60 R 45 300"', r);
  r = await P('pump 90ml 8:15', NOW); ok(r[0] && r[0].s === '20:15' && r[0].ml === 90, '"pump 90ml 8:15" = last 8:15 (pm yesterday)', r);
  r = await P('fed 150 mL 320', NOW); ok(r[0] && r[0].type === 'feed' && r[0].s === '03:20', 'feed with bare time unchanged', r);

  // ---- Today shows pumping, typed and from the sheet
  await p.fill('#say', 'pumped 120ml'); await p.press('#say', 'Enter'); await sleep(400);
  let today = await p.evaluate(() => document.querySelector('.pumpcard') && document.querySelector('.pumpcard').innerText);
  ok(today && /120 ml/.test(today) && /1 session/.test(today), 'Today pump card shows 120 ml, 1 session', today);
  await p.tap('.pumpcard [data-act="pump"]'); await sleep(400);
  ok(await p.isVisible('#pSave'), 'Log pump button opens the pump sheet');
  await p.tap('#pSave'); await sleep(500);
  today = await p.evaluate(() => document.querySelector('.pumpcard').innerText);
  ok(/2 sessions/.test(today), 'second pump counted on Today', today);
  await p.tap('.pumpcard [data-act="pumplog"]'); await sleep(500);
  const log = await p.evaluate(() => ({ hash: location.hash, pressed: (document.querySelector('[data-filter="pump"]') || {}).ariaPressed || document.querySelector('[data-filter="pump"]').getAttribute('aria-pressed'), rows: [...document.querySelectorAll('.list .li')].map(x => x.innerText.split('\n')[0]) }));
  ok(log.hash === '#log' && log.pressed === 'true' && log.rows.length === 2 && log.rows.every(x => /Pumped/.test(x)), 'pump card opens Log on the Pumps filter', log);
  await p.screenshot({ path: D + '/t5-log-pumps.png' });
  await p.evaluate(() => { location.hash = 'today'; }); await sleep(400);
  await p.screenshot({ path: D + '/t5-today-pump.png' });

  // ---- pump timer start + finish
  await p.tap('.pumpcard [data-act="pump"]'); await sleep(300); await p.tap('#pStart'); await sleep(400);
  ok(/Pumping now/.test(await p.evaluate(() => document.querySelector('.pumpcard').innerText)), 'running timer shown on card');
  await p.tap('.pumpcard [data-act="pump"]'); await sleep(300); await p.tap('#pDone'); await sleep(400);
  ok((await pumps(p)).filter(x => x.e != null).length === 3, 'timer session finished and saved', await pumps(p));

  // ---- one-tap speech
  await p.evaluate(() => { window.__say = 'pumped 4 ounces'; });
  await p.tap('.typebox .micbtn'); await sleep(500);
  const sp = await p.evaluate(() => ({ starts: window.__srStarts, n: evs().filter(e => e.type === 'pump').length, focused: document.activeElement.id }));
  ok(sp.starts === 1 && sp.n === 4, 'one mic tap listens and logs what was said', sp);
  const heardToast = await p.evaluate(() => document.querySelector('#toast').innerText);
  ok(/Heard "pumped 4 ounces" → Pumped 118 ml/.test(heardToast), 'toast shows what was heard and what was logged', heardToast);
  // refused permission falls back to the keyboard mic and remembers
  p = await open(b);
  await p.context().addInitScript("window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { setTimeout(() => { this.onerror({ error: 'not-allowed' }); this.onend(); }, 50); } stop() {} };");
  await p.reload(); await sleep(600);
  await p.tap('.typebox .micbtn'); await sleep(300);
  ok(await p.evaluate(() => document.activeElement.id === 'say' && document.querySelector('#say').placeholder.includes('keyboard') && localStorage.getItem('cradle.srOff') != null), 'refused speech falls back to keyboard mic');
  // accepts start() but never listens (seen in Home Screen apps): gives up after 5 s
  p = await open(b);
  await p.context().addInitScript("window.SpeechRecognition = window.webkitSpeechRecognition = class { start() {} stop() {} abort() {} };");
  await p.reload(); await sleep(600);
  await p.tap('.typebox .micbtn'); await sleep(1000);
  const stillOn = await p.evaluate(() => document.querySelector('#dock').classList.contains('listening'));
  const gaveUp = await p.waitForFunction(() => !document.querySelector('#dock').classList.contains('listening') && localStorage.getItem('cradle.srOff') != null && /keyboard/.test(document.querySelector('#toast').innerText), null, { timeout: 9000 }).then(() => true, () => false);
  ok(stillOn && gaveUp, 'silent speech API: listens, then stops after 5 s and says to use the keyboard mic', { stillOn, gaveUp });
  // no speech API at all
  p = await open(b, { sr: 'none' });
  await p.tap('.typebox .micbtn'); await sleep(200);
  ok(await p.evaluate(() => document.activeElement.id === 'say'), 'no speech API: keyboard mic as before');

  // ---- CSV import
  const huck = [
    'Type,Start,End,Duration,Start Condition,Start Location,End Condition,Notes',
    'Feed,2026-11-01 07:30,2026-11-01 07:50,00:20,00:12L,Breast,00:08R,',
    'Feed,2026-11-01 10:05,,,Breast Milk,Bottle,120ml,"topped up, fussy"',
    'Feed,2026-11-01 13:00,,,Formula,Bottle,4oz,',
    'Pump,2026-11-01 08:10,2026-11-01 08:30,00:20,Left 60ml,,Right 45ml,',
    'Pump,2026-11-01 14:00,2026-11-01 14:15,00:15,,,90ml,',
    'Sleep,2026-11-01 08:40,2026-11-01 10:00,01:20,Upset,Crib,Woke up child,',
    'Diaper,2026-11-01 09:00,,,,,Both,pee:large poo:small',
    'Diaper,2026-11-01 11:00,,,,,Pee,',
    'Diaper,2026-11-01 12:00,,,,,Poo,',
    'Growth,2026-11-01 09:30,,,4.53kg,,,',
    'Solids,2026-11-01 12:30,,,,,,',
    'Feed,not a date,,,,,,',
  ].join('\n');
  p = await open(b, { events: { x1: { type: 'diaper', start_at: new Date(2026, 10, 1, 11, 0, 30).getTime(), end_at: null, diaper: { pee: true, poop: false }, source: 'tap', logged_by: 'u_A', created_at: 1, updated_at: 1 } } });
  const res = await p.evaluate(t => { const r = importRows(parseCsvText(t)); const d = importDupes(r.entries); return { n: r.entries.length, fresh: d.fresh.length, dupes: d.dupes, skipped: r.skipped, fmt: r.format, e: r.entries.map(e => ({ t: e.type, k: e.feed && e.feed.kind, ml: (e.feed && e.feed.ml) || (e.pump && e.pump.ml), l: e.feed && e.feed.l_sec, r: e.feed && e.feed.r_sec, pl: e.pump && e.pump.l_ml, pr: e.pump && e.pump.r_ml, pee: e.diaper && e.diaper.pee, poop: e.diaper && e.diaper.poop, s: new Date(e.start_at).toTimeString().slice(0, 5), end: e.end_at ? new Date(e.end_at).toTimeString().slice(0, 5) : null, note: e.note })) }; }, huck);
  const E = res.e;
  ok(res.fmt === 'Huckleberry' && res.n === 9, 'Huckleberry: 9 rows read', res);
  ok(E[0].t === 'feed' && E[0].k === 'breast' && E[0].l === 720 && E[0].r === 480 && E[0].s === '07:30', 'breastfeed L 12 R 8', E[0]);
  ok(E[1].k === 'bottle' && E[1].ml === 120 && E[1].note === 'topped up, fussy', 'bottle 120ml with quoted note', E[1]);
  ok(E[2].k === 'bottle' && E[2].ml === 118, 'bottle 4oz -> 118 ml', E[2]);
  ok(E[3].t === 'pump' && E[3].pl === 60 && E[3].pr === 45 && E[3].ml === 105 && E[3].end === '08:30', 'pump L60 R45', E[3]);
  ok(E[4].t === 'pump' && E[4].ml === 90, 'pump 90ml total', E[4]);
  ok(E[5].t === 'sleep' && E[5].s === '08:40' && E[5].end === '10:00', 'sleep 8:40-10:00', E[5]);
  ok(E[6].pee && E[6].poop && E[7].pee && !E[7].poop && !E[8].pee && E[8].poop, 'diapers both / pee / poo', E.slice(6));
  ok(res.dupes === 1 && res.fresh === 8, 'existing 11:00 diaper skipped as a duplicate', res);
  ok(res.skipped['"Growth" rows'] === undefined && res.skipped['"Solids" rows'] === 1 && res.skipped['rows with no readable start time'] === 1, 'skipped rows named', res.skipped);
  // through the UI
  await p.evaluate(() => { location.hash = 'me'; }); await sleep(400);
  await p.tap('[data-act="import"]'); await sleep(400);
  fs.writeFileSync(D + '/huck-sample.csv', huck);
  await p.setInputFiles('#impFile', D + '/huck-sample.csv'); await sleep(500);
  const prev = await p.evaluate(() => document.querySelector('#impOut').innerText);
  ok(/8 entries to add/.test(prev) && /1 already in your log/.test(prev), 'import preview counts', prev);
  await p.screenshot({ path: D + '/t5-import-preview.png' });
  await p.tap('#impGo'); await sleep(800);
  const after = await p.evaluate(() => ({ n: evs().length, src: evs().filter(e => e.source === 'import').length }));
  ok(after.n === 9 && after.src === 8, 'import adds 8 entries', after);
  // re-import is all duplicates
  await p.tap('[data-act="import"]'); await sleep(400); await p.setInputFiles('#impFile', D + '/huck-sample.csv'); await sleep(500);
  ok(/Nothing new to add/.test(await p.evaluate(() => document.querySelector('#impOut').innerText)), 're-import adds nothing');
  // Cradle export round trip
  const cr = await p.evaluate(() => csv());
  const rt = await p.evaluate(t => { const r = importRows(parseCsvText(t)); return { fmt: r.format, n: r.entries.length, d: importDupes(r.entries).dupes }; }, cr);
  ok(rt.fmt === 'Cradle' && rt.n === 9 && rt.d === 9, 'Cradle export reads back, all duplicates', rt);
  const bad = await p.evaluate(() => importRows(parseCsvText('a,b\n1,2')).error);
  ok(!!bad, 'file without Type/Start gets a plain error');
  fs.unlinkSync(D + '/huck-sample.csv');
  console.log(`ERRORS: ${errs.length ? JSON.stringify(errs) : 'none'}`);
  console.log(`passes ${passes} fails ${fails}`); await b.close();
})();
