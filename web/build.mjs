// Builds the hosted web app into web/dist from the same cradle.html the Claude Artifact uses.
// cradle.html is never edited for the web: this wraps it in a full page, loads web/cradle-shim.js ahead of the app (it
// answers the app's window.claude.use(...) calls with the family database), and turns off the "paste this into
// Claude Code" update banner (the web copy updates itself on every push to main).
// Run: node web/build.mjs   (no dependencies)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, rmSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const out = root + "web/dist/";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let html = readFileSync(root + "cradle.html", "utf8");
const must = [[/const UPDATE_URL = [^;\n]+;/, 'const UPDATE_URL = "";']];
for (const [re, to] of must) {
  if (!re.test(html)) { console.error("build: anchor not found:", re); process.exit(1); }
  html = html.replace(re, to);
}

const VERSION = JSON.parse(readFileSync(root + "version.json", "utf8")).version;
const PAGE_VERSION = (html.match(/<meta name="cradle-version" content="([^"]+)"/) || [])[1];
if (PAGE_VERSION !== VERSION) { console.error(`build: cradle.html is ${PAGE_VERSION} but version.json says ${VERSION}`); process.exit(1); }
const BUILD = (process.env.GITHUB_SHA || String(Date.now())).slice(0, 12);

const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Cradle">
<meta name="robots" content="noindex">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-180.png">
<script>window.CRADLE_BUILD = "${BUILD}"; window.CRADLE_VERSION = "${VERSION}";</script>
<script src="cradle-shim.js?v=${BUILD}"></script>
`;
// cradle.html is a fragment (<title>, <meta>, <style>, body markup, <script>): the host page supplies <html>/<body>.
const cut = html.lastIndexOf("</style>", html.indexOf("<script")) + "</style>".length;
if (cut < 8) { console.error("build: couldn't find the end of the page's styles"); process.exit(1); }
writeFileSync(out + "index.html", head + html.slice(0, cut) + "\n</head>\n<body>\n" + html.slice(cut) + "\n</body>\n</html>\n");

for (const f of ["cradle-shim.js", "feedback-pins.js"]) copyFileSync(root + "web/" + f, out + f);
copyFileSync(root + "version.json", out + "version.json");
cpSync(root + "web/public/", out, { recursive: true });
writeFileSync(out + "sw.js", readFileSync(root + "web/public/sw.js", "utf8").replace("__BUILD__", BUILD));
writeFileSync(out + ".nojekyll", "");
console.log("build: web/dist ready (" + VERSION + ", " + BUILD + ")");
