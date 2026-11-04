# Cradle

**A baby tracker you can run with one thumb.** Cradle logs feeds, sleep and diapers with one tap from whichever hand is free, and walks you through the four phases of Suzy Giordano's *12 Hours' Sleep by 12 Weeks Old*. It runs as a private page inside your own Claude account.

## Web app (shared family log)

Cradle also runs as a plain web page with a shared family database, no accounts: https://alvinrgm.github.io/cradle-app/

- Each family has a private **family link** (`…/cradle-app/#k=<family key>`). Open it on each phone, type your first name once, and add it to your Home Screen.
- Every tap is saved on the phone first and sent as soon as there's signal, so nothing is lost at 3 am in a dead zone. The other parent sees it within a few seconds.
- Tap **💬** at the top right, then tap anything, to leave a feedback note right where the problem is.
- How it's built: `web/` (shim, feedback notes, build script, service worker), `supabase/` (database and AI function). See `web/README.md`.

## Install as a Claude Artifact: one paste

Open [Claude Code](https://claude.ai/code) (web, phone or desktop) and paste this:

```
Set me up with Cradle: fetch https://raw.githubusercontent.com/alvinrgm/cradle-app/main/INSTALL.md and follow it.
```

Claude publishes your own copy and sends you the link. Open it on your phone, tell it about your baby, and a short setup guide walks you through the rest: adding it to your Home Screen, inviting your partner, and letting Claude read your notes.

You need a Claude account. That's it.

## What's in it

- **One tap.** Feed repeats the last bottle. Sleep starts and stops a timer. Diaper is pee, poop or both. Undo is always there.
- **Either hand.** Pick your free hand and the big buttons, send, close and Undo move to that side. A hand button on Today flips sides in one tap.
- **Pumping.** Run a timer or log it after, in ml or oz, total or left and right.
- **Type it like a text.** "fed 120ml 8:15", "bf L 15 min", "pump 90ml 8:15", "down 1:30". Claude sorts out anything messier.
- **The plan.** All four phases of the book, open any time, with its readiness checks shown as advice. Book rules and Cradle's own tips are labeled apart.
- **Nudges.** The Feed button shows which side to start on and turns amber when a feed is due. The Sleep button counts down to the nap window. In Phase 2, Today shows the book's four feed times.
- **Lock-screen reminders.** Add feed and bedtime reminders to your phone's calendar in one tap.
- **Health flags.** Few wet diapers, no poop in a few days, or a big drop in feeds, with a nudge to call your pediatrician.
- **Both parents.** Share the page with your partner as an editor. Same log, both phones, and every entry shows who logged it.
- **Night mode.** A dim amber screen at bedtime, plus light and dark.

## Your data is yours

Everyone who installs Cradle gets their own copy with its own private database. Only you and the people you invite can read it, and nobody else, including whoever sent you this link. Reading notes and explaining patterns run on your own Claude plan.

## Updates

When a new version is out, the app shows a banner with a line to paste into Claude Code. Your log stays put.

## Good to know

- It's a web page on your Home Screen, not an App Store app, so it can't send notifications itself. Calendar reminders cover feeds and bedtime.
- Cradle is not medical advice. The book's plan is one approach; check changes with your pediatrician.
- Health thresholds other than wet diapers are general guidance, not from a pediatric source.

## License

MIT. See [LICENSE](LICENSE).
