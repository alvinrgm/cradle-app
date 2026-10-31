# Cradle: install and update (instructions for Claude)

You are setting up or updating Cradle for the person you're talking to. Cradle is one HTML file, `cradle.html`, published as a private claude.ai Artifact in their own account. The baby's log lives in that Artifact's own database, **tied to its link**. Publishing to a new link starts an empty log, so an update always goes to the same link.

Keep it smooth: don't ask questions you can answer yourself, don't narrate these steps, and finish with one short message.

## 0. Check you can publish

You need the `Artifact` tool with the `capabilities` option. If you don't have it, stop and tell them in one line: "Open Claude Code at https://claude.ai/code and paste the same line there."

## 1. Get the files

Download both into your scratchpad or a temp folder:

```
curl -fsSL https://raw.githubusercontent.com/alvinrgm/cradle-app/main/cradle.html -o cradle.html
curl -fsSL https://raw.githubusercontent.com/alvinrgm/cradle-app/main/version.json -o version.json
```

If the download is blocked, `git clone --depth 1 https://github.com/alvinrgm/cradle-app` and use the files from there.

## 2. Look for an existing copy

List their artifacts (`Artifact`, `action: "list"`, `scope: "all"`) and look for one titled "Cradle".

- They asked for a **test copy**: publish a copy of `cradle.html` whose `<title>` is changed to "Cradle Test" (follow **Set up** otherwise), and never touch their existing copy. Remind them to delete it from their artifacts when they're done.
- **Someone shared their Cradle with this person** (it shows under "shared" and they aren't the owner): they're a partner, not a new install. Don't publish anything. Send them that link and tell them to open it and pick their free hand.
- None: go to **Set up**.
- One they own: go to **Update**.
- Several: ask which one holds their baby's log. Never guess.

## Set up

1. Publish with the `Artifact` tool:
   - `file_path`: the downloaded `cradle.html`
   - `icon`: "baby"
   - `description`: "Our private one-handed baby log."
   - `capabilities`: exactly the `capabilities` object from `version.json`
   - `pin`: true
2. Reply with the link and these lines, nothing more:
   - Open this link on your phone and tell it about your baby. It takes a minute.
   - A **Get set up** card then walks you through adding it to your Home Screen and inviting your partner.
   - To invite your partner: on this page, tap **Share**, add their email with **edit** access, and send. They open the link on their own phone.
   - The first time Cradle reads a typed note, it asks to use Claude. Allow it.

## Update

1. Read the live page (`Artifact`, `action: "read"`, `url` = their link). Its `<meta name="cradle-version">` is the installed version. If it matches `version.json`, tell them they're up to date and stop.
2. Publish the downloaded `cradle.html` with `url` = their link, `capabilities` from `version.json`, and `label` = "v" plus the version.
3. **Never publish an update without `url`.** That creates a new, empty copy.
4. Don't read, change or delete anything in their database. The new page reads the same data.
5. Tell them the new version and its `notes` in one line.

## Rules

- Capabilities are always exactly what `version.json` lists. With those rules only the owner and the people they share it with as editors can read or write the log. Never loosen them.
- Don't edit `cradle.html` for one person. The baby's details, free hand, and theme live in the app's Me screen.
