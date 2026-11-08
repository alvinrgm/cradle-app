const { chromium } = require('playwright'); const fs = require('fs'); const D = __dirname;
const MOCK = fs.readFileSync(D + '/mock.js', 'utf8');
let fails = 0, passes = 0; const errs = [];
const ok = (c, m, extra) => { if (c) passes++; else { fails++; console.log('FAIL:', m, extra !== undefined ? JSON.stringify(extra) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(b, { time, phase = 1, events = {}, caps = ['downloads'] } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
  await ctx.addInitScript(`window.__cfg = ${JSON.stringify({ uid: 'u_A', name: 'M', owner: true, caps })};`);
  await ctx.exposeFunction('__dbAll', () => ({})); await ctx.exposeFunction('__dbWrite', () => {});
  await ctx.addInitScript(MOCK);
  await ctx.addInitScript(`localStorage.setItem('cradle.local', JSON.stringify({ profile: { name: 'Sam', pronoun: 'he', birth_date: '2026-09-26', feeding: 'both', bottle_ml_default: 150, units: 'ml', day_start: '08:00', bedtime: '20:00', sleep_place: 'bassinet', pediatrician: { name: '', phone: '' } }, plan: { phase: ${phase} }, events: ${JSON.stringify(events)}, checks: {}, flags: {} })); localStorage.setItem('cradle.prefs', JSON.stringify({ seenIntro: true, setup: { hidden: true } }));`);
  const p = await ctx.newPage(); await p.clock.setFixedTime(new Date(time));
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + D + '/page.html'); await sleep(500); return p;
}
const at = s => new Date(s).getTime();
const ev = (type, s, e, extra) => ({ type, start_at: at(s), end_at: e ? at(e) : null, source: 'tap', deleted: false, ...extra });
(async () => {
  const b = await chromium.launch();
  // next side after a breast feed that ended on the left
  let p = await open(b, { time: '2026-10-31T13:00:00-07:00', events: {
    a: ev('feed', '2026-10-31T09:00:00-07:00', null, { feed: { kind: 'bottle', ml: 120 } }),
    b: ev('feed', '2026-10-31T11:40:00-07:00', '2026-10-31T12:00:00-07:00', { feed: { kind: 'breast', l_sec: 600, r_sec: 600, side: 'both', last_side: 'L' } }) } });
  let tile = await p.textContent('#tFeed'); ok(tile.includes('Next: Right'), 'Feed tile shows next side', tile);
  await p.click('#tFeed'); await sleep(400);
  ok(await p.evaluate(() => runningBreast() && runningBreast().feed.running_side === 'R'), 'one tap starts on the right');
  ok(!(await p.textContent('#tFeed')).includes('Next:'), 'next side hidden while feeding');
  // due now: last feed 3h10m ago, avg gap 2h40m
  p = await open(b, { time: '2026-10-31T15:10:00-07:00', events: {
    a: ev('feed', '2026-10-31T09:20:00-07:00', null, { feed: { kind: 'bottle', ml: 120 } }),
    b: ev('feed', '2026-10-31T12:00:00-07:00', null, { feed: { kind: 'bottle', ml: 120 } }) } });
  tile = await p.textContent('#tFeed'); ok(tile.includes('Due now') && await p.$('#tFeed.due'), 'Feed due now + amber', tile);
  p = await open(b, { time: '2026-10-31T14:30:00-07:00', events: {
    a: ev('feed', '2026-10-31T09:20:00-07:00', null, { feed: { kind: 'bottle', ml: 120 } }),
    b: ev('feed', '2026-10-31T12:00:00-07:00', null, { feed: { kind: 'bottle', ml: 120 } }) } });
  tile = await p.textContent('#tFeed'); ok(/Due in 10m/.test(tile), 'Feed due in 10m', tile);
  p = await open(b, { time: '2026-10-31T12:30:00-07:00', events: { a: ev('feed', '2026-10-31T12:00:00-07:00', null, { feed: { kind: 'bottle', ml: 120 } }) } });
  ok(!(await p.$('#tFeed.due')) && (await p.textContent('#tFeed')).includes('12:00'), 'not due right after a feed');
  // nap window at 5 weeks (60-75 min)
  const nap = async (mins) => { const q = await open(b, { time: '2026-10-31T13:00:00-07:00', events: { s: ev('sleep', '2026-10-31T10:00:00-07:00', new Date(at('2026-10-31T13:00:00-07:00') - mins * 60e3).toISOString()) } }); return [await q.textContent('#tSleep'), !!(await q.$('#tSleep.due')), await q.textContent('.hero')]; };
  let [s, d, hero] = await nap(30); ok(s.includes('Nap in 30m') && !d, 'nap soon at 30 min awake', s);
  ok(hero.includes('Nap window') && hero.includes('Cradle tip'), 'hero nap window labeled as Cradle tip', hero);
  [s, d] = await nap(65); ok(s.includes('Nap time') && d, 'nap window now at 65 min', s);
  [s, d] = await nap(90); ok(s.includes('Nap overdue') && d, 'nap window passed at 90 min', s);
  // no nap nudge at night
  p = await open(b, { time: '2026-10-31T21:00:00-07:00', events: { s: ev('sleep', '2026-10-31T18:00:00-07:00', '2026-10-31T19:30:00-07:00') } });
  ok(!(await p.textContent('#tSleep')).includes('Nap'), 'no nap nudge after bedtime');
  // phase 2 schedule
  p = await open(b, { time: '2026-10-31T12:05:00-07:00', phase: 2, events: { a: ev('feed', '2026-10-31T08:05:00-07:00', null, { feed: { kind: 'bottle', ml: 150 } }) } });
  const sched = await p.$$eval('.sched .slot', xs => xs.map(x => [x.className, x.textContent]));
  ok(sched.length === 4 && sched[0][0].includes('done') && sched[1][0].includes('due') && sched[1][1].includes('12:00'), 'phase 2 schedule: 8 done, 12 due', sched);
  ok(!(await (await open(b, { time: '2026-10-31T12:05:00-07:00', phase: 1 })).$('.sched')), 'no schedule in phase 1');
  // calendar file
  await p.click('[data-act="reminders"]'); await sleep(300); await p.click('#icsGo'); await sleep(400);
  const f = await p.evaluate(() => window.__saved);
  const ics = f && f.data || '';
  ok(f && f.filename.endsWith('.ics'), 'ics downloaded', f && f.filename);
  ok((ics.match(/BEGIN:VEVENT/g) || []).length === 5 && (ics.match(/RRULE:FREQ=DAILY/g) || []).length === 5 && (ics.match(/BEGIN:VALARM/g) || []).length === 5, 'ics has 4 feeds + bedtime, daily, with alarms');
  ok(/DTSTART:20261101T080000/.test(ics) && /DTSTART:20261101T120000/.test(ics) && /DTSTART:20261101T193000/.test(ics), 'ics times start tomorrow at 8, 12 and bedtime 7:30', ics.match(/DTSTART:\S+/g));
  ok(ics.split('\r\n').every(l => l.length <= 75 || l.startsWith('DESCRIPTION')), 'ics lines short');
  ok(await p.evaluate(() => !!(S.prefs.setup || {}).reminders), 'setup step ticks after adding');
  ok((await p.textContent('.sheet')).includes('Downloads'), 'after save, sheet says where the file is'); await p.screenshot({ path: D + '/ics-saved.png' });
  // phase 1 ics: day start + bedtime
  p = await open(b, { time: '2026-10-31T12:05:00-07:00', phase: 1 });
  const ics1 = await p.evaluate(() => icsText());
  ok((ics1.match(/BEGIN:VEVENT/g) || []).length === 2, 'phase 1 ics: start of day + bedtime');
  // mini dock with due state, no overflow
  p = await open(b, { time: '2026-10-31T15:10:00-07:00', events: { a: ev('feed', '2026-10-31T09:20:00-07:00', null, { feed: { kind: 'bottle', ml: 120 } }), b: ev('feed', '2026-10-31T12:00:00-07:00', null, { feed: { kind: 'bottle', ml: 120 } }) } });
  await p.evaluate(() => savePrefs({ dock: 'min' })); await sleep(200);
  ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'mini dock fits');
  await p.screenshot({ path: D + '/n1.png' });
  p = await open(b, { time: '2026-10-31T12:05:00-07:00', phase: 2, events: { a: ev('feed', '2026-10-31T08:05:00-07:00', null, { feed: { kind: 'breast', l_sec: 600, r_sec: 300, side: 'both', last_side: 'L' } }), s: ev('sleep', '2026-10-31T09:00:00-07:00', '2026-10-31T11:00:00-07:00') } });
  await p.screenshot({ path: D + '/n2.png', fullPage: false });
  await p.evaluate(() => window.scrollTo(0, 400)); await p.evaluate(() => $('#view').scrollTo(0, 420)); await sleep(200); await p.screenshot({ path: D + '/n3.png' });
  console.log('ERRORS:', errs.length ? [...new Set(errs)] : 'none');
  console.log(`passes ${passes} fails ${fails}`);
  await b.close();
})();
