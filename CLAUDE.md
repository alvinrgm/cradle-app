# Cradle

To install or update someone's copy, follow `INSTALL.md`. Two rules:

- An update always republishes to the same Artifact link, because the baby's log is tied to it.
- Personal data (baby names, birth dates, weights, logs) never goes into this repo.
- The web app (`web/`, GitHub Pages, deployed on every push to main) wraps the same `cradle.html`. Never fork the app for the web: app changes go in claude-brain `apps/cradle/src`, then copy the built file here. See `web/README.md` for families, the database and the AI function.
- Family keys are secrets: never commit one, never put one in a log or an issue.
