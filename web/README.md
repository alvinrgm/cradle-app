# Cradle on the web

```
Browser: web/dist/index.html = cradle.html (unchanged) + cradle-shim.js loaded first
  └─ cradle-shim.js answers window.claude.use(...)
       ├─ db        → public.cradle_pull / cradle_push (Supabase RPC), local queue + cache in localStorage, poll every 4 s
       ├─ user      → a first name typed once per phone (people/<id> doc), no accounts
       ├─ sample    → supabase/functions/cradle-ai (Gemini, family key check, 60 calls per family per day)
       └─ downloads → share sheet / file download
  └─ feedback-pins.js → 💬 notes pinned to the screen (public.cradle_pin_*)
Host: GitHub Pages from web/dist, built by web/build.mjs on every push to main (.github/workflows/pages.yml)
Database: Supabase project ihspmvetqecczybtncji, schema `cradle` (not exposed to the API; RPC functions only)
```

## Families

There are no accounts. A family is a row in `cradle.households` holding the SHA-256 hash of a random key; the key
itself lives only in the family link. To add a family (SQL editor, or Claude with the Supabase connector):

```sql
-- generate the key locally: node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
insert into cradle.households (key_hash, label) values (extensions.digest('<key>', 'sha256'), '<label>');
```

The link is `https://alvinrgm.github.io/cradle-app/?k=<key>`. Anyone with the link can read and add to that family's
log, so send it only to the family. To cut off a leaked link, give the family a new key:
`update cradle.households set key_hash = extensions.digest('<new key>', 'sha256') where label = '<label>';`

## Data

- `cradle.docs`: one row per app document (`baby/profile`, `plan/current`, `events/<id>`, `checks/<id>`, `flags/<id>`,
  `feedback/<id>`, `people/<id>`, `data/users/<person>/prefs`). Deletes stay as tombstones so other phones see them.
- `cradle.pins`: feedback notes. Read them with `select * from cradle.admin_pins;` and mark one fixed with
  `update cradle.pins set status = 'resolved', resolved_note = 'Fixed in 1.x: …', resolved_at = now() where id = …;`
  (the family sees the note in their Notes list).

## Release

1. Change the app in claude-brain `apps/cradle/src`, bump `APP_VERSION` + `meta cradle-version`, run `./build.sh` and the QA in `apps/cradle/qa`.
2. Copy `apps/cradle/index.html` here as `cradle.html`, bump `version.json`, add a CHANGELOG entry.
3. `node web/build.mjs` must pass (it checks the versions match). Push to main: GitHub Pages deploys it.

## People in a family (1.4.0)

Each person has their own key, made when they open a one-time invite link (`?join=<code>`, 7 days). Invite and remove
people in the app under Me, then Family. The family's setup key (the `households` row) still opens the log but is
never shown in the app; use it only to make a family's first invite:

```sql
-- make the code on your own machine, store only its hash
insert into cradle.invites (code_hash, household_id, for_name, expires_at)
select extensions.digest('<code>', 'sha256'), id, '<first name>', now() + interval '14 days' from cradle.households where label = '<label>';
```

Send `https://alvinrgm.github.io/cradle-app/?join=<code>`. See who's in each family: `select * from cradle.admin_members`.
