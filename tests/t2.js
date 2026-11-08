const { chromium } = require('playwright'); const fs = require('fs'); const D = __dirname;
const MOCK = fs.readFileSync(D + '/mock.js', 'utf8');
let fails = 0, passes = 0; const errs = [];
const ok = (c, m, extra) => { if (c) passes++; else { fails++; console.log('FAIL:', m, extra !== undefined ? JSON.stringify(extra) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = s => new Date(s).getTime();
async function open(b, { time, caps = [], units = 'ml', tz = 'America/Los_Angeles', vp = { width: 390, height: 844 }, profile = true, route } = {}) {
  const ctx = await b.newContext({ viewport: vp, timezoneId: tz });
  await ctx.addInitScript(`window.__cfg = ${JSON.stringify({ uid: 'u_A', name: 'M', owner: true, caps })};`);
  await ctx.exposeFunction('__dbAll', () => ({})); await ctx.exposeFunction('__dbWrite', () => {});
  await ctx.addInitScript(MOCK);
  if (route) await ctx.route('https://raw.githubusercontent.com/**', route);
  if (profile) await ctx.addInitScript(`localStorage.setItem('cradle.local', JSON.stringify({ profile: { name: 'Sam', pronoun: 'he', birth_date: '2026-09-20', feeding: 'both', bottle_ml_default: 150, units: '${units}', day_start: '08:00', bedtime: '20:00', sleep_place: 'bassinet', pediatrician: { name: '', phone: '' } }, plan: { phase: 1 }, events: {}, checks: {}, flags: {} })); localStorage.setItem('cradle.prefs', JSON.stringify({ seenIntro: true }));`);
  const p = await ctx.newPage();
  if (time) await p.clock.setFixedTime(new Date(time));
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + D + '/page.html'); await sleep(500); return p;
}
const parse = (p, t) => p.evaluate(t => { const r = parseShorthand(t); return { entries: r.entries.map(e => ({ type: e.type, s: e.start_at && new Date(e.start_at).toString().slice(4, 21), e: e.end_at && new Date(e.end_at).toString().slice(4, 21), feed: e.feed, pump: e.pump, diaper: e.diaper, spit: e.spit })), unclear: r.unclear }; }, t);
(async () => {
  const b = await chromium.launch();
  // ---------- parser at a fixed afternoon time
  let p = await open(b, { time: '2026-10-31T15:00:00-07:00' });
  const cases = [
    ['fed 120ml 8:15', r => r.entries[0].type === 'feed' && r.entries[0].feed.ml === 120 && r.entries[0].s.includes('Oct 31 2026 08:15')],
    ['fed 120', r => r.entries[0].feed.ml === 120 && r.entries[0].s.includes('15:00')],
    ['bottle 90 at 11', r => r.entries[0].feed.ml === 90 && r.entries[0].s.includes('11:00')],
    ['fed 4oz', r => Math.abs(r.entries[0].feed.ml - 118) <= 1],
    ['fed 120 at 11pm', r => r.entries[0].s.includes('Oct 30 2026 23:00')],
    ['bf L 15 min', r => r.entries[0].feed.kind === 'breast' && r.entries[0].feed.l_sec === 900],
    ['bf L 10 R 12', r => r.entries[0].feed.l_sec === 600 && r.entries[0].feed.r_sec === 720],
    ['breast R 20m at 2pm', r => r.entries[0].feed.r_sec === 1200 && r.entries[0].s.includes('14:00')],
    ['pee', r => r.entries[0].diaper.pee && !r.entries[0].diaper.poop],
    ['poop', r => r.entries[0].diaper.poop && !r.entries[0].diaper.pee],
    ['pee and poop', r => r.entries[0].diaper.pee && r.entries[0].diaper.poop && r.entries.length === 1],
    ['wet diaper 2:30', r => r.entries[0].diaper.pee && r.entries[0].s.includes('14:30')],
    ['down 1:30', r => r.entries[0].type === 'sleep' && r.entries[0].s.includes('13:30') && !r.entries[0].e],
    ['down 1:30, up 2:45', r => r.entries.length === 2 && r.entries[1].type === 'wake'],
    ['slept 1-3', r => r.entries[0].type === 'sleep' && r.entries[0].s.includes('13:00') && r.entries[0].e.includes('15:00')],
    ['nap 12:10 to 1:40', r => r.entries[0].s.includes('12:10') && r.entries[0].e.includes('13:40')],
    ['spit up', r => r.entries[0].type === 'spit' && !r.entries[0].spit.forceful],
    ['projectile vomit', r => r.entries[0].spit.forceful],
    ['note rash on cheek', r => r.entries[0].type === 'note'],
    ['pump 90ml 8:15', r => r.entries[0].type === 'pump' && r.entries[0].pump.ml === 90 && r.entries[0].s.includes('08:15')],
    ['pump L 60 R 45', r => r.entries[0].pump.l_ml === 60 && r.entries[0].pump.r_ml === 45 && r.entries[0].pump.ml === 105],
    ['pumped 5oz', r => r.entries[0].type === 'pump' && Math.abs(r.entries[0].pump.ml - 148) <= 1],
    ['pump 120ml 20 min', r => r.entries[0].pump.ml === 120 && r.entries[0].e.includes('15:00') && r.entries[0].s.includes('14:40')],
    ['fed 90 pumped milk', r => r.entries[0].type === 'feed' && r.entries[0].feed.milk === 'breastmilk'],
    ['fed 120ml 8:15, pee', r => r.entries.length === 2],
    ['formula 60', r => r.entries[0].feed.ml === 60 && r.entries[0].feed.milk === 'formula'],
    ['fed 150 at 830', r => r.entries[0].feed.ml === 150 && r.entries[0].s.includes('08:30')],
    ['blah blah', r => r.entries.length === 0 && r.unclear.length === 1],
    ['fed 120 9pm', r => r.entries[0].s.includes('Oct 30 2026 21:00')],
  ];
  for (const [t, f] of cases) { const r = await parse(p, t); let good = false; try { good = f(r); } catch {} ok(good, 'parse: ' + t, r); }
  // ---------- oz profile
  p = await open(b, { time: '2026-10-31T15:00:00-07:00', units: 'oz' });
  let r = await parse(p, 'fed 4'); ok(r.entries[0] && Math.abs(r.entries[0].feed.ml - 118) <= 1, 'oz: fed 4 = 4 oz', r);
  r = await parse(p, 'pump 3'); ok(r.entries[0] && Math.abs(r.entries[0].pump.ml - 89) <= 1, 'oz: pump 3 = 3 oz', r);
  ok((await p.evaluate(() => fmtVol(118))).includes('oz'), 'oz display', await p.evaluate(() => fmtVol(118)));
  await p.click('[data-chip="pump"]'); await sleep(300);
  ok((await p.textContent('#sheet')).includes('oz'), 'pump sheet starts in oz for oz profile');
  // ---------- day boundary: 00:10 belongs to the previous day (day starts 08:00)
  p = await open(b, { time: '2026-11-01T00:10:00-07:00' });
  const ds = await p.evaluate(() => new Date(dayStartOf(Date.now())).toString().slice(4, 21));
  ok(ds.includes('Oct 31 2026 08:00'), 'day start at 00:10 is previous 08:00', ds);
  ok(await p.evaluate(() => document.documentElement.classList.contains('night')), 'night mode on after bedtime');
  // DST: Nov 1 2026 02:00 PT clocks go back
  p = await open(b, { time: '2026-11-01T09:00:00-08:00' });
  const ds2 = await p.evaluate(() => new Date(dayStartOf(Date.now())).toString().slice(4, 21));
  ok(ds2.includes('Nov 01 2026 08:00'), 'DST day start', ds2);
  ok(!(await p.evaluate(() => document.documentElement.classList.contains('night'))), 'day mode at 9am');
  // ---------- breast timer + forgot-to-stop
  p = await open(b, { time: '2026-10-31T10:00:00-07:00' });
  await p.evaluate(() => startBreast('L')); await sleep(400);
  await p.clock.setFixedTime(new Date('2026-10-31T11:40:00-07:00')); await sleep(200);
  await p.evaluate(() => openFeed({ id: runningBreast().id })); await sleep(300);
  ok((await p.textContent('#sheet')).includes('Forgot to stop'), 'breast running >90 min warns');
  await p.click('#doneBreast'); await sleep(300);
  ok(await p.evaluate(() => !runningBreast() && feeds().slice(-1)[0].feed.l_sec >= 5900), 'breast done records ~100 min left', await p.evaluate(() => feeds().slice(-1)[0].feed));
  // sleep forgot-to-stop
  await p.evaluate(() => createEvent(baseEvent('sleep', { start_at: Date.now() - 4 * 3600e3, end_at: null }))); await sleep(200);
  await p.evaluate(() => openSleep()); await sleep(300);
  ok((await p.textContent('#sheet')).includes('Forgot to stop'), 'day sleep >3.5h warns');
  // ---------- health flags
  p = await open(b, { time: '2026-10-31T15:00:00-07:00' });
  await p.evaluate(() => { const now = Date.now(); for (let i = 0; i < 6; i++) createEvent(baseEvent('feed', { start_at: now - (i + 1) * 4.5 * 3600e3, feed: { kind: 'bottle', ml: 120 } }), { silent: true }); createEvent(baseEvent('diaper', { start_at: now - 3600e3, diaper: { pee: true, poop: false } }), { silent: true }); createEvent(baseEvent('diaper', { start_at: now - 5 * 3600e3, diaper: { pee: true, poop: false } }), { silent: true }); });
  await sleep(300);
  const flags = await p.evaluate(() => healthFlags().map(f => f.key));
  ok(flags.includes('wet'), 'low wet diapers flagged', flags);
  ok((await p.textContent('#view')).includes('wet diaper'), 'flag shown on Today');
  // ---------- update banner
  p = await open(b, { time: '2026-10-31T15:00:00-07:00', route: rt => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '9.0.1', notes: 'Test notes.' }) }) });
  await sleep(500);
  ok((await p.textContent('#view')).includes('Cradle 9.0.1 is out'), 'update banner shows when newer');
  await p.click('[data-act="upd-later"]'); await sleep(200);
  ok(!(await p.textContent('#view')).includes('9.0.1 is out'), 'update banner dismissible');
  p = await open(b, { time: '2026-10-31T15:00:00-07:00', route: rt => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '1.0.0' }) }) });
  await sleep(500); ok(!(await p.textContent('#view')).includes('is out'), 'no banner when same version');
  // ---------- Claude fallback for unclear text
  p = await open(b, { time: '2026-10-31T15:00:00-07:00', caps: ['sample'] });
  await p.evaluate(() => { window.__sampleRes = { entries: [{ type: 'feed', time: '14:00', kind: 'bottle', ml: 100 }, { type: 'sleep', time: '14:30', end: null }], unclear: [] }; });
  await p.fill('#say', 'ate around 2 then crashed'); await p.click('#sayBtn'); await sleep(600);
  const ev2 = await p.evaluate(() => evs().map(e => e.type));
  ok(ev2.includes('feed') && ev2.includes('sleep'), 'Claude fallback logs entries', ev2);
  // ---------- render matrix: every view x theme x hand x dock x night, no errors, no sideways scroll
  p = await open(b, { time: '2026-10-31T15:00:00-07:00' });
  await p.evaluate(() => setDemo(true)); await sleep(300);
  let bad = [];
  for (const theme of ['light', 'dark']) for (const hand of ['right', 'left']) for (const dock of ['full', 'min']) for (const night of ['off', 'on']) {
    await p.evaluate(o => savePrefs(o), { theme, hand, dock, night }); await sleep(80);
    for (const route of ['today', 'log', 'plan', 'me']) {
      await p.evaluate(r => { location.hash = r; }, route); await sleep(120);
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      if (w > 390) bad.push([theme, hand, dock, night, route, w]);
    }
  }
  ok(bad.length === 0, 'no horizontal overflow anywhere', bad.slice(0, 5));
  // every sheet opens and closes
  await p.evaluate(() => { location.hash = 'today'; }); await sleep(200);
  for (const fn of ['openFeed()', 'openFeed({kind:"breast"})', 'openSleep()', 'openDiaper()', 'openSpit()', 'openPump()', 'openAddPast()', 'openWeight()', 'openChecks()', 'openCall()', 'openProfile()', 'openPeople()', 'openFeedback()', 'openWipe()', 'openIntro()', 'openSetupGuide()', 'openSetup("home")', 'openSetup("partner")', 'openSetup("claude")', 'openStartPhase(2)', 'openDoctor(2)']) {
    try { await p.evaluate(f => eval(f), fn); await sleep(150); const w = await p.evaluate(() => [document.documentElement.scrollWidth, $('#sheet').scrollWidth, $('#sheet').clientWidth]); if (w[0] > 390 || w[1] > w[2] + 1) bad.push([fn, w]); await p.evaluate(() => closeSheet()); await sleep(250); }
    catch (e) { bad.push([fn, e.message.slice(0, 80)]); }
  }
  ok(bad.length === 0, 'all sheets open without overflow', bad);
  // small phone
  p = await open(b, { time: '2026-10-31T15:00:00-07:00', vp: { width: 320, height: 568 } });
  await p.evaluate(() => setDemo(true)); await sleep(300);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 320, 'fits a 320px phone', sw);
  console.log('ERRORS:', errs.length ? [...new Set(errs)] : 'none');
  console.log(`passes ${passes} fails ${fails}`);
  await b.close();
})();
