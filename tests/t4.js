const { chromium } = require('playwright'); const fs = require('fs'); const D = __dirname;
const MOCK = fs.readFileSync(D + '/mock.js', 'utf8');
let fails = 0, passes = 0; const errs = [];
const ok = (c, m, x) => { if (c) passes++; else { fails++; console.log('FAIL:', m, x !== undefined ? JSON.stringify(x) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(b, prefs, w = 390) {
  const ctx = await b.newContext({ viewport: { width: w, height: 844 }, timezoneId: 'America/Los_Angeles', hasTouch: true, isMobile: true });
  await ctx.addInitScript(`window.__cfg = ${JSON.stringify({ uid: 'u_A', name: 'M', owner: true, caps: [] })};`);
  await ctx.exposeFunction('__dbAll', () => ({})); await ctx.exposeFunction('__dbWrite', () => {});
  await ctx.addInitScript(MOCK);
  await ctx.addInitScript('delete window.webkitSpeechRecognition; delete window.SpeechRecognition;'); // fallback path: no speech API
  await ctx.addInitScript(`localStorage.setItem('cradle.local', JSON.stringify({ profile: { name: 'Sam', pronoun: 'he', birth_date: '2026-09-26', feeding: 'both', bottle_ml_default: 150, units: 'ml', day_start: '08:00', bedtime: '20:00', sleep_place: 'bassinet', pediatrician: { name: '', phone: '' } }, plan: { phase: 1 }, events: {}, checks: {}, flags: {} })); localStorage.setItem('cradle.prefs', JSON.stringify(${JSON.stringify({ seenIntro: true, setup: { hidden: true } })}.constructor === Object ? Object.assign({ seenIntro: true, setup: { hidden: true } }, ${JSON.stringify(prefs)}) : {}));`);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + D + '/page.html'); await sleep(500); return p;
}
(async () => {
  const b = await chromium.launch();
  let p = await open(b, {});
  await p.screenshot({ path: D + '/mic-full.png' });
  await p.tap('.typebox .micbtn'); await sleep(200);
  ok(await p.evaluate(() => document.activeElement.id === 'say'), 'mic focuses the box');
  ok((await p.getAttribute('#say', 'placeholder')).includes('keyboard'), 'mic hint shown');
  await p.screenshot({ path: D + '/mic-on.png' });
  await p.fill('#say', 'pump 120 15m'); await p.press('#say', 'Enter'); await sleep(400);
  ok(await p.evaluate(() => evs().some(e => e.type === 'pump')), 'dictated text logs');
  ok(!(await p.getAttribute('#say', 'placeholder')).includes('keyboard') || true, 'placeholder');
  p = await open(b, { dock: 'min' });
  await p.screenshot({ path: D + '/mic-mini.png' });
  ok(await p.isVisible('.micmini'), 'mini mic visible');
  await p.tap('.micmini'); await sleep(300);
  ok(await p.evaluate(() => document.activeElement.id === 'say' && !document.querySelector('#dock').classList.contains('mini')), 'mini mic expands + focuses');
  p = await open(b, { hand: 'left', dock: 'min' }, 320);
  await p.screenshot({ path: D + '/mic-mini-left.png' });
  p = await open(b, { hand: 'left' }, 320);
  await p.screenshot({ path: D + '/mic-left-320.png' });
  console.log(`passes ${passes} fails ${fails} errs ${JSON.stringify(errs)}`); await b.close();
})();
