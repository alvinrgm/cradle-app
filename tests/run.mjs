// Runs the phone-size test files against cradle.html (390x844, Pacific time). Same files as claude-brain
// apps/cradle/qa; copy them here whenever cradle.html is updated. Exit 1 if any check fails or the page throws.
// Run: npm i --no-save playwright@1.58.0 && npx playwright install chromium && node tests/run.mjs
import { copyFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
const dir = new URL("./", import.meta.url).pathname;
copyFileSync(dir + "../cradle.html", dir + "page.html");
let bad = 0;
for (const f of readdirSync(dir).filter(f => /^t\d+\.js$/.test(f)).sort()) {
  const r = spawnSync(process.execPath, [dir + f], { encoding: "utf8", timeout: 300000, env: { ...process.env, TZ: "America/Los_Angeles" } }) // the tests build expected times in Pacific, like the pages;
  const out = (r.stdout || "") + (r.stderr || "");
  const sum = (out.match(/passes \d+ fails \d+/g) || []).pop() || "no summary";
  const failed = r.status !== 0 || !/fails 0\b/.test(sum) || /ERRORS: (?!none)/.test(out) || /errs \[(?!\])/.test(out);
  console.log(`${failed ? "FAIL" : "ok  "} ${f}: ${sum}`);
  if (failed) { bad++; console.log(out.split("\n").filter(l => /FAIL|ERR|Error/.test(l)).slice(0, 20).join("\n")); }
}
rmSync(dir + "page.html", { force: true });
process.exit(bad ? 1 : 0);
