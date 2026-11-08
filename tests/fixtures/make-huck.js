// Writes a Huckleberry-shaped export (header and per-type column use match a real public export,
// archiewood/baby-tracker sources/huckleberry/events.csv; values here are generated, not anyone's data).
const days = +(process.argv[2] || 90), out = [];
const q = v => v == null || v === "" ? "" : `"${v}"`;
const pad = n => String(n).padStart(2, "0");
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const hm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
let seed = 3; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const row = (...c) => out.push(c.map(q).join(","));
const start = new Date(2026, 10, 7, 0, 0); start.setDate(start.getDate() - days);
for (let d = 0; d < days; d++) {
  const day = new Date(start.getTime() + d * 864e5);
  for (let h = 1; h < 24; h += 3) {
    const t = new Date(day.getTime() + (h * 60 + Math.floor(rnd() * 40)) * 6e4);
    if (rnd() < 0.5) { const r = 5 + Math.floor(rnd() * 15), l = Math.floor(rnd() * 15), e = new Date(t.getTime() + (r + l) * 6e4); row("Feed", fmt(t), fmt(e), hm(r + l), `${hm(r)}R`, "Breast", l ? `${hm(l)}L` : "", ""); }
    else row("Feed", fmt(t), "", "", rnd() < 0.5 ? "Breast Milk" : "Formula", "Bottle", rnd() < 0.3 ? `${(3 + Math.floor(rnd() * 3)) }.0oz` : `${60 + 10 * Math.floor(rnd() * 8)}ml`, "");
    const dt = new Date(t.getTime() + 20 * 6e4), k = rnd();
    row("Diaper", fmt(dt), "", k > 0.6 ? "yellow" : "", "", "", k < 0.4 ? "Pee:large" : k < 0.6 ? "Pee" : k < 0.8 ? "Both, pee:large poo:small" : "Poo:medium", k > 0.95 ? "Blowout" : "");
    const st = new Date(t.getTime() + 45 * 6e4), len = 30 + Math.floor(rnd() * 90), en = new Date(st.getTime() + len * 6e4);
    row("Sleep", fmt(st), fmt(en), hm(len), "", "", "", "");
  }
  for (const h of [6, 14, 22]) { const t = new Date(day.getTime() + h * 36e5); if (rnd() < 0.7) row("Pump", fmt(t), rnd() < 0.2 ? fmt(new Date(t.getTime() + 20 * 6e4)) : "", rnd() < 0.2 ? "00:20" : "", `${50 + 10 * Math.floor(rnd() * 5)}ml`, "", rnd() < 0.15 ? "" : `${50 + 10 * Math.floor(rnd() * 5)}ml`, ""); }
  if (d % 7 === 0) row("Growth", fmt(new Date(day.getTime() + 15 * 36e5)), "", "", `${(3.4 + d * 0.025).toFixed(2)}kg`, `${(50 + d * 0.1).toFixed(1)}cm`, "38cm", "");
  if (d % 10 === 0) row("Meds", fmt(new Date(day.getTime() + 9 * 36e5)), "", "", "1drops", "Vitamin D", "", "");
  if (d % 3 === 0) row("Tummy time", fmt(new Date(day.getTime() + 11 * 36e5)), fmt(new Date(day.getTime() + 11 * 36e5 + 3e5)), "00:05", "", "", "", "");
}
out.reverse(); // Huckleberry lists newest first
console.log(`"Type","Start","End","Duration","Start Condition","Start Location","End Condition","Notes"\n` + out.join("\n"));
