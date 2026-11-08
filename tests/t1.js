const { chromium } = require('playwright'); const fs = require('fs'); const D = __dirname;
const MOCK = fs.readFileSync(D + '/mock.js', 'utf8');
let store = {}; const pages = []; let fails = 0, passes = 0; const errs = [];
const ok = (c, m, extra) => { if (c) passes++; else { fails++; console.log('FAIL:', m, extra !== undefined ? JSON.stringify(extra) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(b, cfg, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles', ...opts });
  await ctx.exposeFunction('__dbAll', () => JSON.parse(JSON.stringify(store)));
  await ctx.exposeFunction('__dbWrite', async (p, d) => { if (d === null) delete store[p]; else store[p] = d; for (const pg of pages) pg.evaluate(([p, d]) => window.__dbPush && window.__dbPush(p, d), [p, d]).catch(() => {}); });
  await ctx.addInitScript(`window.__cfg = ${JSON.stringify(cfg)};`); await ctx.addInitScript(MOCK);
  const p = await ctx.newPage(); pages.push(p);
  p.on('pageerror', e => errs.push(cfg.uid + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(cfg.uid + ' console: ' + m.text()); });
  await p.goto('file://' + D + '/page.html'); await sleep(700); return p;
}
const evs = p => p.evaluate(() => evs().map(e => ({ id: e.id, type: e.type, s: e.start_at, e: e.end_at, by: e.logged_by, label: evLabel(e), feed: e.feed, pump: e.pump, diaper: e.diaper })));
const say = async (p, t) => { await p.fill('#say', t); await p.click('#sayBtn'); await sleep(350); };
(async () => {
  const b = await chromium.launch();
  // ---- A: owner onboards through the shared db
  const A = await open(b, { uid: 'u_A', name: 'Michelle', owner: true });
  ok(await A.$('[data-ob="next"]'), 'onboarding shows on empty db');
  await A.click('[data-ob="next"]'); await A.fill('#pName', 'Rosie'); await A.selectOption('#pPron', 'she'); await A.fill('#pBorn', '2026-09-20');
  await A.click('[data-ob="next"]'); await A.click('[data-ob="finish"]'); await sleep(600);
  ok(store['baby/profile'] && store['baby/profile'].name === 'Rosie' && store['baby/profile'].pronoun === 'she', 'profile saved to db', store['baby/profile']);
  ok(store['plan/current'] && store['plan/current'].phase === 1, 'plan saved to db', store['plan/current']);
  if (await A.$('#introGo')) { await A.click('#introGo'); await sleep(300); }
  // ---- B: partner opens same log
  const B = await open(b, { uid: 'u_B', name: 'Partner', owner: false });
  ok(!(await B.$('[data-ob="next"]')), 'partner skips onboarding');
  ok(!!(await B.$('#introGo')), 'partner gets welcome + hand picker');
  if (await B.$('#introGo')) { await B.click('#introGo'); await sleep(300); }
  ok((await B.textContent('#view')).includes('Rosie'), 'partner sees baby name');
  const setupB = await B.textContent('#view');
  ok(!setupB.includes('Invite your partner'), 'partner does not see invite step');
  ok((await A.textContent('#view')).includes('Invite your partner'), 'owner sees invite step');
  // A logs a bottle with one tap; B sees it
  await A.click('#tFeed'); await sleep(500);
  let e = Object.entries(store).filter(([k]) => k.startsWith('events/'));
  ok(e.length === 1 && e[0][1].type === 'feed' && e[0][1].logged_by === 'u_A', 'A one-tap feed in db', e);
  await sleep(300);
  ok((await evs(B)).length === 1, 'B sees A feed');
  // B starts sleep, A ends it
  await B.click('#tSleep'); await sleep(500);
  ok((await evs(A)).some(x => x.type === 'sleep' && x.e == null), 'A sees running sleep from B');
  await A.click('#tSleep'); await sleep(600);
  const sl = (await evs(B)).find(x => x.type === 'sleep');
  ok(sl && sl.e != null && sl.by === 'u_B', 'A ended B sleep; B sees end', sl);
  // diaper both
  await B.click('#tDiaper'); await sleep(300); await B.click('#dBoth').catch(async () => { const bs = await B.$$('.diaperbtns button'); await bs[2].click(); }); await sleep(400);
  ok((await evs(A)).some(x => x.type === 'diaper' && x.diaper.pee && x.diaper.poop), 'diaper both synced');
  // undo via toast
  await A.click('#tFeed'); await sleep(400); const before = (await evs(A)).length;
  const undo = await A.$('#toastActs button:last-child'); if (undo) await undo.click(); await sleep(400);
  ok((await evs(B)).length === before - 1, 'undo removes for both', [(await evs(B)).length, before]);
  // edit + delete
  const fid = (await evs(A)).find(x => x.type === 'feed').id;
  await A.evaluate(id => openEdit(id), fid); await sleep(300); await A.fill('#eMl', '95'); await A.click('#eSave'); await sleep(400);
  ok(store['events/' + fid].feed.ml === 95, 'edit amount saved', store['events/' + fid].feed);
  await A.evaluate(id => openEdit(id), fid); await sleep(300); await A.click('#eDel'); await sleep(400);
  ok(store['events/' + fid].deleted === true && !(await evs(B)).some(x => x.id === fid), 'soft delete hides for both');
  // prefs private per user
  await A.evaluate(() => savePrefs({ hand: 'left' })); await sleep(300);
  ok(store['data/users/u_A/prefs'] && store['data/users/u_A/prefs'].hand === 'left', 'A prefs saved under own user path');
  ok(await B.evaluate(() => S.prefs.hand) !== 'left', 'B hand unaffected');
  // offline: writes fail, outbox keeps, replay after recovery
  await A.evaluate(() => { window.__fail = 'unavailable'; }); await A.click('#tDiaper'); await sleep(300); const pb = await A.$$('.diaperbtns button'); await pb[0].click(); await sleep(2500);
  const ob = await A.evaluate(() => Object.keys(outbox.all()));
  ok(ob.length === 1, 'failed write kept in outbox', ob);
  ok((await evs(A)).filter(x => x.type === 'diaper').length === 2, 'offline entry still shows locally');
  await A.evaluate(() => { window.__fail = null; }); await A.reload(); await sleep(1200);
  ok(Object.keys(store).filter(k => k.startsWith('events/') && store[k].type === 'diaper').length === 2, 'outbox replayed after reload', Object.keys(store));
  ok((await A.evaluate(() => Object.keys(outbox.all()))).length === 0, 'outbox cleared');
  // read-only viewer
  const nB = (await evs(B)).length; await B.evaluate(() => { window.__fail = 'not_granted'; }); await B.click('#tFeed'); await sleep(600);
  ok((await evs(B)).length === nB, 'refused entry taken back off the screen');
  ok((await B.evaluate(() => Object.keys(outbox.all()))).length === 0, 'refused entry not queued for retry');
  ok((await B.textContent('#toast')).includes('edit access'), 'view-only gets clear message', await B.textContent('#toast'));
  await B.evaluate(() => { window.__fail = null; });
  // pump timer started by A, finished by B by typing
  await say(A, 'pump'); await sleep(300);
  ok((await B.textContent('#view')).includes('Pumping'), 'B sees pumping banner');
  await say(B, 'pump 4oz'); await sleep(300);
  const pu = (await evs(A)).filter(x => x.type === 'pump');
  ok(pu.length === 1 && pu[0].e != null && Math.abs(pu[0].pump.ml - 118) <= 1, 'B finished A pump with 4oz', pu);
  // demo mode must not write to db
  const n0 = Object.keys(store).length; await A.evaluate(() => setDemo(true)); await sleep(300); await A.click('#tFeed'); await sleep(300); await A.evaluate(() => setDemo(false)); await sleep(300);
  ok(Object.keys(store).length === n0, 'demo writes nothing to db');
  // csv via downloads
  await A.evaluate(() => exportCsv()); await sleep(300);
  const saved = await A.evaluate(() => window.__saved);
  ok(saved && saved.filename.includes('rosie') && saved.data.split('\n').length >= 4, 'csv download', saved && saved.filename);
  // wipe
  await A.evaluate(() => { location.hash = 'me'; }); await sleep(300);
  console.log('ERRORS:', errs.length ? errs : 'none');
  console.log(`passes ${passes} fails ${fails}`);
  await b.close();
})();
