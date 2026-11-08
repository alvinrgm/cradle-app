# Cradle

To install or update someone's copy, follow `INSTALL.md`. Two rules:

- An update always republishes to the same Artifact link, because the baby's log is tied to it.
- Personal data (baby names, birth dates, weights, logs) never goes into this repo.
- The web app (`web/`, GitHub Pages, deployed on every push to main) wraps the same `cradle.html`. Never fork the app for the web: app changes go in claude-brain `apps/cradle/src`, then copy the built file here. See `web/README.md` for families, the database and the AI function.
- Family keys are secrets: never commit one, never put one in a log or an issue.
- Tests: `tests/` holds the same phone-size test files as claude-brain `apps/cradle/qa` (copy them with each `cradle.html` update). CI (`.github/workflows/pages.yml`) runs them on every PR and push; main deploys only after they pass, then `tests/smoke.mjs` checks the live site. Run locally: `npm i --no-save playwright@1.58.0 && npx playwright install chromium && node tests/run.mjs`.
