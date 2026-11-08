(() => {
  const cfg = window.__cfg || {};
  let store = null; const L = [];
  const ready = (async () => { store = await window.__dbAll(); })();
  const snapDoc = p => ({ exists: store[p] != null, id: p.split("/").pop(), data: () => store[p] == null ? undefined : JSON.parse(JSON.stringify(store[p])) });
  const snapCol = p => ({ docs: Object.keys(store).filter(k => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")).map(k => ({ id: k.slice(p.length + 1), data: () => JSON.parse(JSON.stringify(store[k])) })) });
  const fire = l => { try { l.cb(l.k === "doc" ? snapDoc(l.path) : snapCol(l.path)); } catch (e) { console.error("listener", e); } };
  window.__dbPush = (p, d) => { if (!store) return; if (d === null) delete store[p]; else store[p] = d; L.forEach(fire); };
  const W = async (p, d) => { if (window.__fail) { const e = new Error("fail"); e.code = window.__fail; throw e; } await window.__dbWrite(p, d === null ? null : JSON.parse(JSON.stringify(d))); };
  const doc = p => ({
    onSnapshot(cb, err) { const l = { k: "doc", path: p, cb }; L.push(l); ready.then(() => fire(l)); return () => {}; },
    set: d => W(p, d), delete: () => W(p, null), get: async () => { await ready; return snapDoc(p); },
  });
  const col = p => { const q = { orderBy: () => q, limit: () => q, where: () => q, onSnapshot(cb) { const l = { k: "col", path: p, cb }; L.push(l); ready.then(() => fire(l)); return () => {}; }, doc: id => doc(p + "/" + id) }; return q; };
  const db = { doc, collection: col };
  const user = { id: async () => cfg.uid, me: async () => ({ id: cfg.uid, name: cfg.name }), profiles: async ids => Object.fromEntries(ids.map(i => [i, { name: i === "u_A" ? "Michelle" : i === "u_B" ? "Partner" : "" }])), isOwner: () => !!cfg.owner, canEdit: () => true };
  const sample = async () => ({ text: "ok" }); sample.json = async () => (window.__sampleRes || { entries: [], unclear: [] }); sample.limits = async () => ({});
  const downloads = { save: async o => { window.__saved = o; } };
  const caps = { db, user, sample, downloads };
  window.claude = { use: async n => (cfg.caps || ["db", "user", "sample", "downloads"]).includes(n) ? caps[n] : null };
})();
