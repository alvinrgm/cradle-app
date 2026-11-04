# Changelog

## 1.3.0
- Cradle also runs as a web app with a shared family database: open the family link on each phone, type your name once, no account. Every tap is saved on the phone first and sent as soon as there's signal; the other parent sees it within a few seconds.
- Feedback notes on the web app: tap 💬, then tap anything, and leave a note right where the problem is.
- Fixed: a save that didn't confirm (signal dropped mid-tap) was only retried the next time Cradle was opened. It now retries every 20 seconds while the app is open.
- Fixed: retrying an old unsent save could overwrite a newer edit your partner made to the same entry.
- Fixed: only the newest 1,000 entries loaded, so after a couple of months older days, totals and the CSV export silently lost entries.
- Fixed: typing "bf R" logged a left-side feed with no time. It now logs the right side.
- Typing "around 3" reads as 3 o'clock.

## 1.2.0
- Mic button next to the type box (and on the slim button row). It opens the keyboard on the box, so one more tap on the keyboard's mic lets you say an entry like "pump 120 15 minutes" or "fed 150 bottle". Web pages can't start dictation themselves, so the keyboard's mic key is the second tap.
- After "Add to my calendar", a sheet explains where the file was saved and how to open it on iPhone, Android or a computer.
- Fixed: a sheet that opened right after another one closed could disappear a moment later.

## 1.1.0
- The Feed button shows which breast to start on next ("Next: Right").
- The Feed button turns amber with "Due in 10m" or "Due now" when a feed is due, from the baby's own gaps (or the book's times in Phase 2).
- The Sleep button counts down to the nap window and flags when it's passed. Wake windows by age are general guidance and labeled as a Cradle tip.
- Phase 2 and later: Today shows the book's four feed times, ticks off the ones logged, and highlights the next.
- Calendar reminders: add daily feed and bedtime reminders to your phone's calendar for real lock-screen alerts. Also in the setup guide and Me.
- Saves that are refused (view-only access, full storage) are taken back off the screen instead of showing as logged.

## 1.0.0
- One-tap Feed, Sleep and Diaper buttons sized for one thumb. The free-hand setting moves the controls to that side, and a hand button on Today flips sides in one tap.
- The bottom buttons collapse to a slim row to show more of the day.
- Pumping: a timer or a quick entry, ml or oz, total or left and right. Type "pump 90ml 8:15", "pump L 60 R 45", or just "pump" to start the timer.
- Type entries like a text ("fed 120ml 8:15", "pee and poop", "down 1:30"). Claude reads anything looser.
- The four phases of *12 Hours' Sleep by 12 Weeks Old*, all open at any time, with the book's readiness checks as advice. Book rules and Cradle's own tips are labeled apart.
- Choose he, she or they for your baby, and the app's wording follows.
- Health flags (fewer than 6 wet diapers, no poop in 3 days, a big drop in feeds) that point you to your pediatrician.
- Shared log: invite a partner as an editor and every entry shows who logged it.
- Light, dark, and a dim amber night mode at bedtime. CSV export.
- A setup guide on first run: Home Screen, inviting your partner, and letting Claude read notes.
