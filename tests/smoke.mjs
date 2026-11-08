// Live smoke check after a deploy: opens the site at phone size until it serves the version in version.json,
// then checks the app starts with no uncaught errors and none of our files failed to load. No family key is used,
// so it never touches anyone's log. Run: node tests/smoke.mjs [url]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const url = process.argv[2] || "https://alvinrgm.github.io/cradle-app/";
const want = JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8")).version;
let live = null;
for (let i = 0; i < 30; i++) {
  try { live = (await (await fetch(url + "version.json?t=" + Date.now(), { cache: "no-store" })).json()).version; } catch {}
  if (live === want) break;
  await new Promise(r => setTimeout(r, 10000));
}
if (live !== want) { console.error(`smoke: live version.json is ${live}, expected ${want}`); process.exit(1); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = [], missing = [];
p.on("pageerror", e => errs.push(e.message));
p.on("response", r => { if (r.url().startsWith(url) && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
await p.goto(url + "?smoke=" + Date.now(), { waitUntil: "load" });
await p.waitForTimeout(4000);
const page = await p.evaluate(() => ({ v: typeof APP_VERSION !== "undefined" ? APP_VERSION : null, text: document.body.innerText.slice(0, 200) }));
await b.close();
const ok = page.v === want && !errs.length && !missing.length && page.text.trim().length > 0;
console.log(JSON.stringify({ want, live, page: page.v, errs, missing }));
process.exit(ok ? 0 : 1);
