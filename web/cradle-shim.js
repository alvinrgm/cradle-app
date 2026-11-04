// Cradle on the web: answers the app's window.claude.use("db" | "user" | "sample" | "downloads") calls, so the same
// cradle.html runs unchanged outside claude.ai (same idea as Gainsboard's supabase-shim.js).
//
// No accounts. A family opens Cradle from its private family link (…/cradle-app/#k=<family key>). The key is kept on
// the phone and sent with every call; the database only answers calls that carry a known key.
//   db        -> public.cradle_pull / cradle_push (Supabase). One shared log per family.
//                Every save lands in a queue on the phone first (localStorage), so a tap at 3 am with no signal is never
//                lost: the queue is sent as soon as there's a connection, and retried every few seconds until it is.
//                The last copy of the log is cached on the phone, so the app opens instantly and works offline.
//                The other parent's taps arrive within a few seconds (pull every 4 s while the app is on screen).
//   user      -> "who is this": a name picked once per phone (no sign-in), shown next to every entry.
//   sample    -> the cradle-ai edge function (reads messy notes). Missing or failing: the app falls back to its parser.
//   downloads -> saves a file (CSV export, calendar reminders) through the share sheet or a download.
(function () {
  "use strict";
  var CFG = {
    url: "https://ihspmvetqecczybtncji.supabase.co",
    key: "sb_publishable_JDptpLqx29t6fgTQqXgJaQ_mWWfhTny",
    pullMs: 4000
  };
  var H = window.history, LOC = window.location;
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var COLORS = ["#C2667A", "#4F7CAC", "#5E9C76", "#B07D3A", "#7E6BB0", "#3E8E9C"];

  // ---- The family key. It stays in the address as ?k=… (moved there from #k=…, since the app uses the # for its
  // tabs), so "Add to Home Screen" saves an icon that still knows the family: on iPhone the Home Screen app gets its
  // own storage, separate from Safari's, and only the address carries over.
  // A new key from a link is only trusted once the server knows it: a mistyped link must not replace a good key.
  var JOIN = (/[#&?]join=([A-Za-z0-9_-]{20,100})/.exec(LOC.search + "&" + LOC.hash) || [])[1] || null;
  var GOOD = LS.get("cradle.web.key", null), PREV = null;
  var FAMILY = JOIN ? null : (function () {
    var m = /[#&?]k=([A-Za-z0-9_-]{20,100})/.exec(LOC.search + "&" + LOC.hash), k = m ? m[1] : GOOD;
    if (m && GOOD && m[1] !== GOOD) PREV = GOOD;
    if (!GOOD && m) LS.set("cradle.web.key", m[1]);
    if (k) {
      var q = new URLSearchParams(LOC.search); q.set("k", k);
      var rest = LOC.hash.replace(/^#/, "").split("&").filter(function (p) { return p && !/^k=/.test(p); }).join("&");
      H.replaceState(null, "", LOC.pathname + "?" + q + (rest ? "#" + rest : ""));
    }
    return k;
  })();
  function keyWorks() { if (FAMILY && LS.get("cradle.web.key", null) !== FAMILY) LS.set("cradle.web.key", FAMILY); PREV = null; }
  var NS = FAMILY ? "cradle.web." + FAMILY.slice(0, 8) + "." : "cradle.web.none.";

  function rpc(name, args, opts) {
    return fetch(CFG.url + "/rest/v1/rpc/" + name, {
      method: "POST", keepalive: !!(opts && opts.keepalive), cache: "no-store",
      headers: { apikey: CFG.key, Authorization: "Bearer " + CFG.key, "Content-Type": "application/json" },
      body: JSON.stringify(args)
    }).then(function (r) {
      return r.text().then(function (t) {
        var body = null; try { body = t ? JSON.parse(t) : null; } catch (e) { body = t; }
        if (r.ok) return body;
        var err = new Error((body && body.message) || ("HTTP " + r.status));
        err.status = r.status; err.pg = body && body.code; err.hint = body && body.hint;
        // 28000: the family key isn't known (link mistyped, or the family was removed). 22023/23xxx/54000: the database
        // refused this exact write. Anything else (5xx, 429, network): try again later.
        err.code = err.pg === "28000" ? "not_granted" : (/^(22|23|54)/.test(err.pg || "") ? "invalid_argument" : "unavailable");
        throw err;
      });
    }, function (e) { var err = new Error("offline"); err.code = "unavailable"; err.cause = e; throw err; });
  }

  // ---------------------------------------------------------------- screens the shim owns
  function whenBody(fn) { if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn); }
  var STYLE = "<style>.cw-scr{position:fixed;inset:0;z-index:2147483600;display:grid;place-content:center;justify-items:center;gap:16px;padding:24px;text-align:center;" +
    "background:var(--bg,#FBF7F2);color:var(--ink,#2B2433);font:16px/1.45 system-ui,-apple-system,sans-serif}" +
    ".cw-scr h1{margin:0;font:700 30px/1.1 system-ui,-apple-system,sans-serif}.cw-scr p{margin:0;max-width:320px;color:var(--sub,#6B6476)}" +
    ".cw-scr input{width:min(300px,80vw);min-height:50px;border-radius:14px;border:1px solid var(--line,#EDE6DC);padding:0 14px;font:18px system-ui;background:var(--card,#fff);color:inherit;text-align:center}" +
    ".cw-scr button{min-height:50px;min-width:min(300px,80vw);border-radius:25px;border:0;background:var(--ink,#2B2733);color:var(--bg,#fff);font:600 17px system-ui;cursor:pointer}" +
    ".cw-scr .cw-chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}.cw-scr .cw-chips button{min-width:0;min-height:40px;padding:0 16px;background:transparent;color:inherit;border:1px solid var(--line,#EDE6DC);font-weight:500}" +
    "@media (prefers-color-scheme:dark){.cw-scr{background:var(--bg,#16131A);color:var(--ink,#F1ECF4)}.cw-scr p{color:var(--ink-2,#B5ADBD)}}</style>";
  function screen(html) {
    var d = document.createElement("div"); d.className = "cw-scr"; d.setAttribute("data-cradle-web", ""); d.innerHTML = STYLE + html;
    document.body.appendChild(d); return d;
  }
  function noFamilyScreen(bad, removed) {
    whenBody(function () {
      if (removed) {
        // Someone in the family took this phone out (lost phone, or a phone being given away). Forget the key.
        LS.del("cradle.web.key"); LS.del(NS + "me");
        [].forEach.call(document.querySelectorAll(".cw-scr"), function (x) { x.remove(); });
        screen("<h1>Cradle</h1><p>This phone was removed from the family's log. To use it again, ask your partner to send you a new invite from Cradle (Me, then Family).</p>");
        return;
      }
      if (bad && PREV) {
        // A new link didn't work but this phone already had a family: keep using it.
        try { sessionStorage.setItem("cradle.web.badlink", "1"); } catch (e) {}
        LOC.replace(LOC.pathname + "?k=" + PREV + (LOC.hash || ""));
        return;
      }
      [].forEach.call(document.querySelectorAll(".cw-scr"), function (x) { x.remove(); });
      var d = screen("<h1>Cradle</h1><p>" + (bad ? "This family link isn't working. Ask whoever sent it for a fresh link, then open it or paste it here."
        : "Cradle is a private family log. Open the family link you were sent, or paste it here.") + "</p>" +
        '<input id="cwLink" placeholder="Paste your family link" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" id="cwOpen">Open</button>');
      d.querySelector("#cwOpen").onclick = function () {
        var m = /k=([A-Za-z0-9_-]{20,100})/.exec(d.querySelector("#cwLink").value);
        if (!m) { d.querySelector("#cwLink").focus(); return; }
        LS.del("cradle.web.key"); LOC.replace(LOC.pathname + "?k=" + m[1]);
      };
    });
  }
  (function badLinkNote() {
    var flag = null; try { flag = sessionStorage.getItem("cradle.web.badlink"); sessionStorage.removeItem("cradle.web.badlink"); } catch (e) {}
    if (flag) whenBody(function () {
      var n = document.createElement("div"); n.setAttribute("data-cradle-web", "");
      n.style.cssText = "position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:2147483600;background:#2B2733;color:#fff;border-radius:14px;padding:10px 14px;font:600 14px system-ui;max-width:90vw;text-align:center";
      n.textContent = "That link didn't work, so Cradle is still showing your family's log."; document.body.appendChild(n);
      setTimeout(function () { n.remove(); }, 6000);
    });
  })();

  // ---------------------------------------------------------------- user: who is tapping on this phone
  // A person who joined by invite is known to the server (their own key), so their name comes from there. Someone on
  // the family's setup key types a name once, as before. Kept per family, so a second family on this phone is separate.
  var ME = LS.get(NS + "me", null) || LS.get("cradle.web.me", null);
  if (ME && !ME.id) ME = null;
  var FAM = LS.get(NS + "family", null);   // last known {me, baby, members}
  function saveMe(m) { ME = m; LS.set(NS + "me", m); }
  function colorFor(id) { return COLORS[Math.abs(hash(String(id))) % COLORS.length]; }
  var famReq = null;
  function loadFamily() {
    if (!FAMILY) return Promise.reject(new Error("no family"));
    return (famReq = rpc("cradle_family", { p_key: FAMILY }).then(function (f) {
      FAM = f; LS.set(NS + "family", f);
      if (f.me) saveMe({ id: f.me.id, name: f.me.name, color: f.me.color || colorFor(f.me.id), member: true });
      return f;
    }, function (e) {
      if (e.code === "not_granted") { badKey = true; noFamilyScreen(true, e.hint === "removed"); }
      throw e;
    }));
  }
  var asking = null;
  function askName() {
    if (ME && ME.name) return Promise.resolve(ME);
    if (FAM && FAM.me) { saveMe({ id: FAM.me.id, name: FAM.me.name, color: FAM.me.color || colorFor(FAM.me.id), member: true }); return Promise.resolve(ME); }
    if (asking) return asking;
    return (asking = new Promise(function (resolve) {
      whenBody(function () {
        var d = screen("<h1>Who's this?</h1><p>Your name shows next to the feeds and naps you log, so you both know who did what. No account needed.</p>" +
          '<input id="cwName" maxlength="40" autocomplete="given-name" placeholder="Your first name" enterkeyhint="done">' +
          '<button type="button" id="cwGo">Continue</button>');
        var i = d.querySelector("#cwName"), go = d.querySelector("#cwGo");
        function done() {
          var n = i.value.trim(); if (!n) { i.focus(); return; }
          var id = (ME && ME.id) || "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
          ME = { id: id, name: n.slice(0, 40), color: COLORS[Math.abs(hash(id)) % COLORS.length] };
          saveMe(ME); d.remove(); resolve(ME);
        }
        go.onclick = done; i.onkeydown = function (e) { if (e.key === "Enter") done(); };
        setTimeout(function () { i.focus(); }, 50);
      });
    }));
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // ---------------------------------------------------------------- db
  // store: path -> data (the server's copy). pending: path -> {data|null, n, ifAbsent}: taps not yet confirmed.
  // Each queued tap has its own localStorage key (NS + "q." + path), so two tabs on one phone never overwrite each
  // other's queue; a tab picks up the other tab's taps from `storage` events and before every send.
  var QP = NS + "q.";
  var store = {}, seq = 0, loaded = false, pending = {};
  var cache = LS.get(NS + "cache", null);
  if (cache && cache.docs) { store = cache.docs; seq = cache.seq || 0; }
  var listeners = [], gotServer = false, firstPull = null, badKey = false;
  var sync = { pending: 0, lastOk: 0, lastErr: null };
  window.__cradleSync = sync;

  function readQueue() {
    var found = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i); if (!k || k.indexOf(QP) !== 0) continue;
        var v = LS.get(k, null); if (v && v.n) found[k.slice(QP.length)] = v;
      }
    } catch (e) {}
    var old = LS.get(NS + "pending", null);   // a queue saved by the first build, as one object
    if (old) { Object.keys(old).forEach(function (p) { if (!found[p]) { found[p] = old[p]; LS.set(QP + p, old[p]); } }); LS.del(NS + "pending"); }
    return found;
  }
  function mergeQueue() {
    var disk = readQueue(), changed = [];
    Object.keys(disk).forEach(function (p) { disk[p].disk = true; if (!pending[p] || pending[p].n !== disk[p].n) { pending[p] = disk[p]; changed.push(p); } });
    Object.keys(pending).forEach(function (p) { if (!disk[p] && pending[p].disk) { delete pending[p]; changed.push(p); } });   // sent by the other tab
    noteSync();
    return changed;
  }
  pending = readQueue(); Object.keys(pending).forEach(function (p) { pending[p].disk = true; });
  window.addEventListener("storage", function (e) {
    if (e.key && e.key.indexOf(QP) === 0) { var c = mergeQueue(); if (c.length) emit(c); }
  });
  function view(path) { return Object.prototype.hasOwnProperty.call(pending, path) ? pending[path].data : store[path]; }
  function clone(d) { return d == null ? d : JSON.parse(JSON.stringify(d)); }
  function persistCache() {
    if (LS.set(NS + "cache", { seq: seq, docs: store })) return;
    // Too big for this phone's storage: keep everything except entries older than 90 days, so it still opens offline.
    var cut = Date.now() - 90 * 864e5, slim = {};
    Object.keys(store).forEach(function (p) { var d = store[p]; if (p.indexOf("events/") !== 0 || !d || !(d.start_at < cut)) slim[p] = d; });
    if (!LS.set(NS + "cache", { seq: seq, docs: slim, partial: true })) { LS.del(NS + "cache"); console.warn("Cradle: offline copy didn't fit on this phone; the log is still saved online"); }
  }
  function qput(p, entry) {
    pending[p] = entry; entry.disk = LS.set(QP + p, entry);
    if (!entry.disk) console.error("Cradle: phone storage is full; this tap is kept in memory until it's sent", p);
    noteSync();
  }
  function qdone(p, n) {
    // Only clear it if it's still the copy we sent (a newer tap on the same entry, from this tab or another, stays).
    var disk = LS.get(QP + p, null);
    if (disk && disk.n !== n) { pending[p] = disk; noteSync(); return; }
    if (pending[p] && pending[p].n !== n) return;
    delete pending[p]; LS.del(QP + p); noteSync();
  }
  function noteSync() {
    sync.pending = Object.keys(pending).length;
    try { window.dispatchEvent(new Event("cradle-sync")); } catch (e) {}
  }

  function docSnap(path) {
    var d = view(path);
    return { exists: d != null, id: path.split("/").pop(), ref: { path: path }, data: function () { return d == null ? undefined : clone(d); } };
  }
  function colSnap(l) {
    var pre = l.path + "/", seen = {}, rows = [];
    function take(p) {
      if (seen[p] || p.indexOf(pre) !== 0 || p.slice(pre.length).indexOf("/") !== -1) return;
      seen[p] = 1; var d = view(p); if (d != null) rows.push({ id: p.slice(pre.length), d: d });
    }
    Object.keys(store).forEach(take); Object.keys(pending).forEach(take);
    (l.where || []).forEach(function (w) {
      rows = rows.filter(function (r) {
        var v = r.d[w[0]];
        switch (w[1]) { case "==": return v === w[2]; case "!=": return v !== w[2]; case "<": return v < w[2]; case "<=": return v <= w[2];
          case ">": return v > w[2]; case ">=": return v >= w[2]; case "in": return (w[2] || []).indexOf(v) !== -1; default: return true; }
      });
    });
    if (l.order) {
      var f = l.order[0], dir = l.order[1] === "desc" ? -1 : 1;
      rows.sort(function (a, b) { var x = a.d[f], y = b.d[f]; return (x == null) - (y == null) || (x < y ? -dir : x > y ? dir : 0); });
    }
    if (l.limit) rows = rows.slice(0, l.limit);
    var docs = rows.map(function (r) { return { id: r.id, ref: { path: pre + r.id }, data: function () { return clone(r.d); } }; });
    return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (fn) { docs.forEach(fn); } };
  }
  function fire(l) { try { l.cb(l.kind === "doc" ? docSnap(l.path) : colSnap(l)); } catch (e) { console.error("Cradle listener", e); } }
  function touches(l, path) {
    if (l.kind === "doc") return l.path === path;
    var pre = l.path + "/"; return path.indexOf(pre) === 0 && path.slice(pre.length).indexOf("/") === -1;
  }
  function emit(paths) {
    listeners.forEach(function (l) { if (l.live && paths.some(function (p) { return touches(l, p); })) fire(l); });
  }

  // Pull what changed. Overlaps the last few numbers so a save that was mid-flight on the server is never skipped.
  var pulling = null;
  function pull() {
    if (!FAMILY || badKey) return Promise.resolve();
    if (pulling) return pulling;
    var since = gotServer ? seq : 0;
    pulling = rpc("cradle_pull", { p_key: FAMILY, p_since: since }).then(function (r) {
      var changed = [];
      if (!gotServer) {
        // First full copy from the server replaces whatever the phone had cached.
        var next = {}; (r.docs || []).forEach(function (x) { next[x.path] = x.deleted ? null : x.data; });
        Object.keys(store).concat(Object.keys(next)).forEach(function (p) { if (JSON.stringify(store[p]) !== JSON.stringify(next[p])) changed.push(p); });
        Object.keys(next).forEach(function (p) { if (next[p] == null) delete next[p]; });
        store = next;
      } else {
        (r.docs || []).forEach(function (x) {
          var d = x.deleted ? null : x.data;
          if (JSON.stringify(store[x.path]) === JSON.stringify(d)) return;
          if (d == null) delete store[x.path]; else store[x.path] = d;
          changed.push(x.path);
        });
      }
      var moved = (r.seq || 0) !== seq || !gotServer;
      seq = Math.max(seq, r.seq || 0); gotServer = true; loaded = true; sync.lastOk = Date.now(); sync.lastErr = null; keyWorks();
      if (changed.length || moved) persistCache();
      noteSync();
      changed = changed.filter(function (p) { return !Object.prototype.hasOwnProperty.call(pending, p); });
      if (changed.length) emit(changed);
      listeners.forEach(function (l) { if (!l.live) { l.live = true; fire(l); } });
    }, function (e) {
      sync.lastErr = e; noteSync();
      if (e.code === "not_granted") { badKey = true; noFamilyScreen(true, e.hint === "removed"); }
      throw e;
    });
    var p = pulling;
    p.then(function () { pulling = null; }, function () { pulling = null; });
    return p;
  }

  // Send the queue, 50 at a time. A write the database refuses outright is dropped (so it can't jam the queue) and
  // reported. A write the database skips because the other phone's copy is newer is dropped quietly; the next pull
  // brings the newer copy.
  var pushing = null, refusedWaiters = {};
  function wireOf(p) {
    var e = pending[p];
    if (e.data == null) return { path: p, del: true };
    return e.ifAbsent ? { path: p, data: e.data, if_absent: true } : { path: p, data: e.data };
  }
  function push() {
    if (!FAMILY || badKey) return Promise.resolve();
    if (pushing) return pushing.then(push, push);
    mergeQueue();
    var paths = Object.keys(pending).slice(0, 50);
    if (!paths.length) return Promise.resolve();
    var sent = {}, sentData = {};
    var writes = paths.map(function (p) { sent[p] = pending[p].n; sentData[p] = pending[p].data; return wireOf(p); });
    pushing = rpc("cradle_push", { p_key: FAMILY, p_writes: writes, p_by: ME ? ME.id : null }).then(function (r) {
      var skipped = (r && r.rejected) || [], back = [];
      paths.forEach(function (p) {
        if (skipped.indexOf(p) === -1) { if (sentData[p] == null) delete store[p]; else store[p] = sentData[p]; }
        else back.push(p);
        qdone(p, sent[p]);
      });
      sync.lastOk = Date.now(); sync.lastErr = null; keyWorks();
      persistCache(); noteSync();
      if (back.length) { emit(back); pull().catch(function () {}); try { window.dispatchEvent(new CustomEvent("cradle-skipped", { detail: back })); } catch (e) {} }
    }, function (e) {
      sync.lastErr = e; noteSync();
      if (e.code === "invalid_argument" && paths.length > 1)
        return paths.reduce(function (ch, p) { return ch.then(function () { return pushOne(p); }); }, Promise.resolve());
      if (e.code === "invalid_argument") return dropRefused(paths[0], e);
      if (e.code === "not_granted") { badKey = true; noFamilyScreen(true, e.hint === "removed"); }
      throw e;
    });
    var p = pushing;
    p.then(function () { pushing = null; }, function () { pushing = null; });
    return p.then(function () { if (Object.keys(pending).length && !sync.lastErr) return push(); });
  }
  function pushOne(p) {
    if (!pending[p]) return Promise.resolve();
    var n = pending[p].n, d = pending[p].data;
    return rpc("cradle_push", { p_key: FAMILY, p_writes: [wireOf(p)], p_by: ME ? ME.id : null }).then(function (r) {
      if (!((r && r.rejected) || []).length) { if (d == null) delete store[p]; else store[p] = d; }
      qdone(p, n); persistCache(); sync.lastErr = null; noteSync();
    }, function (e) { if (e.code === "invalid_argument") return dropRefused(p, e); throw e; });
  }
  function dropRefused(p, e) {
    console.error("Cradle: save refused", p, e);
    if (pending[p]) qdone(p, pending[p].n);
    emit([p]);
    (refusedWaiters[p] || []).forEach(function (f) { f(e); }); delete refusedWaiters[p];
  }
  var nTap = 0;
  function queue(path, data) {
    // Creating the baby's profile or plan (first-time setup) must never replace one the family already has.
    var creating = (path === "baby/profile" || path === "plan/current") && view(path) == null;
    qput(path, { data: data == null ? null : clone(data), n: (++nTap) + "." + Date.now() + "." + Math.random().toString(36).slice(2, 6), ifAbsent: creating || undefined });
    emit([path]);
    // Resolves once the server has it, or once it is safely queued on this phone (offline / server busy): the queue
    // keeps retrying. Rejects only when the database refuses this write outright.
    return new Promise(function (resolve, reject) {
      (refusedWaiters[path] = refusedWaiters[path] || []).push(function (e) { reject(Object.assign(new Error("Couldn't save that entry"), { code: "invalid_argument", cause: e })); });
      push().then(resolve, function () { resolve(); });
    });
  }

  var started = false;
  function startSync() {
    if (started) return; started = true;
    var tick = function () { if (document.hidden) return; push().catch(function () {}); pull().catch(function () {}); };
    setInterval(tick, CFG.pullMs);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); else push().catch(function () {}); });
    window.addEventListener("online", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("pagehide", function () { if (Object.keys(pending).length) push().catch(function () {}); });
    firstPull = push().catch(function () {}).then(pull);
    firstPull.catch(function () {
      // Offline on open: listeners already have the cached copy. With no cached copy, report the error and keep
      // waiting: an empty log would look like a brand-new family and invite setting the baby up again.
      listeners.forEach(function (l) { if (!l.live && l.err) l.err(Object.assign(new Error("offline"), { code: "unavailable" })); });
    });
  }

  function listen(l) {
    listeners.push(l);
    if (cache || loaded) { l.live = true; setTimeout(function () { fire(l); }, 0); }
    else if (firstPull) firstPull.catch(function () { if (!l.live && l.err) l.err(Object.assign(new Error("offline"), { code: "unavailable" })); });
    return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
  }
  function docRef(path) {
    return {
      path: path, id: path.split("/").pop(),
      onSnapshot: function (cb, err) { return listen({ kind: "doc", path: path, cb: cb, err: err }); },
      get: function () { return (loaded || cache ? Promise.resolve() : (firstPull || Promise.resolve()).catch(function () {})).then(function () { return docSnap(path); }); },
      set: function (d) { return queue(path, d == null ? {} : d); },
      update: function (patch) { return queue(path, Object.assign({}, view(path) || {}, patch)); },
      delete: function () { return queue(path, null); }
    };
  }
  function colRef(path, spec) {
    spec = spec || {};
    var q = {
      path: path,
      orderBy: function (f, dir) { return colRef(path, Object.assign({}, spec, { order: [f, dir || "asc"] })); },
      limit: function (n) { return colRef(path, Object.assign({}, spec, { limit: n })); },
      where: function (f, op, v) { return colRef(path, Object.assign({}, spec, { where: (spec.where || []).concat([[f, op, v]]) })); },
      onSnapshot: function (cb, err) { return listen({ kind: "col", path: path, cb: cb, err: err, order: spec.order, limit: spec.limit, where: spec.where }); },
      get: function () { return (loaded || cache ? Promise.resolve() : (firstPull || Promise.resolve()).catch(function () {})).then(function () { return colSnap({ path: path, order: spec.order, limit: spec.limit, where: spec.where }); }); },
      doc: function (id) { return docRef(path + "/" + id); },
      add: function (d) { var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); return queue(path + "/" + id, d).then(function () { return docRef(path + "/" + id); }); }
    };
    return q;
  }
  var DB = { doc: docRef, collection: function (p) { return colRef(p); } };

  // ---------------------------------------------------------------- user
  function makeUser() {
    // Ask the server who this key belongs to. Offline, use what this phone last knew (and ask for a name only if it
    // never knew one).
    var known = ME && ME.name ? Promise.resolve() : null;
    var fam = loadFamily().catch(function () {});
    return (known ? Promise.race([fam, new Promise(function (r) { setTimeout(r, 1500); })]) : fam).then(askName).then(function (me) {
      // Publish this phone's name so the other parent sees "Michelle" rather than "Someone".
      var path = "people/" + me.id, cur = view(path);
      if (!cur || cur.name !== me.name || cur.color !== me.color) queue(path, { name: me.name, color: me.color, at: Date.now() });
      function inviteLink(code) { return LOC.origin + LOC.pathname + "?join=" + code; }
      return {
        id: function () { return Promise.resolve(me.id); },
        me: function () { return Promise.resolve({ id: me.id, name: me.name, color: me.color }); },
        profiles: function (ids) {
          var out = {};
          (ids || []).forEach(function (id) {
            var p = view("people/" + id), m = FAM && (FAM.members || []).filter(function (x) { return x.id === id; })[0];
            out[id] = { name: (m && m.name) || (p && p.name) || "", color: (p && p.color) || (m && m.color), isMe: id === me.id };
          });
          return Promise.resolve(out);
        },
        isOwner: function () { return true; },     // nothing is locked: everyone in the family can do everything
        canEdit: function () { return true; },
        rename: function (n) {
          me.name = String(n || "").trim().slice(0, 40) || me.name; saveMe(me);
          if (me.member) rpc("cradle_rename", { p_key: FAMILY, p_name: me.name }).catch(function () {});
          return queue(path, { name: me.name, color: me.color, at: Date.now() });
        },
        // The family: [{id, name, color, me, last_seen, joined}]. Offline: the last list this phone saw.
        family: function () {
          return loadFamily().then(function (f) { return f; }, function (e) { if (FAM) return Object.assign({ stale: true }, FAM); throw e; });
        },
        // A one-time invite link for one person (7 days). Each person gets their own key when they open it.
        invite: function (name) {
          return rpc("cradle_invite", { p_key: FAMILY, p_name: name || null }).then(function (r) { return { link: inviteLink(r.code), expires_at: r.expires_at }; });
        },
        remove: function (id) { return rpc("cradle_remove", { p_key: FAMILY, p_member: id }).then(function () { return loadFamily(); }); },
        familyLink: function () { return null; },   // personal keys are never shared; use invite()
        web: true
      };
    });
  }

  // ---------------------------------------------------------------- joining by invite (?join=CODE)
  function joinScreen() {
    whenBody(function () {
      var d = screen('<h1 id="cwJh">Opening your invite…</h1><p id="cwJp"></p>' +
        '<input id="cwName" maxlength="40" autocomplete="given-name" placeholder="Your first name" enterkeyhint="go" hidden>' +
        '<button type="button" id="cwGo" hidden>Join</button><button type="button" id="cwBack" hidden>Open your family\'s log</button>');
      var h = d.querySelector("#cwJh"), p = d.querySelector("#cwJp"), i = d.querySelector("#cwName"), go = d.querySelector("#cwGo"), back = d.querySelector("#cwBack");
      function bad(why) {
        h.textContent = why === "used" ? "This invite was already used" : why === "expired" ? "This invite has expired" : "This invite link isn't working";
        p.textContent = "Invites work once, for 7 days. Ask whoever sent it to make a new one in Cradle (Me, then Family).";
        i.hidden = go.hidden = true;
        if (GOOD) { back.hidden = false; back.onclick = function () { LOC.replace(LOC.pathname + "?k=" + GOOD); }; }
      }
      function load() {
        rpc("cradle_invite_info", { p_code: JOIN }).then(function (r) {
          if (!r || !r.ok) return bad(r && r.why);
          var baby = r.baby || "the baby";
          h.textContent = r.by ? r.by + " invited you to " + baby + "'s log" : "Join " + baby + "'s log";
          p.textContent = "Cradle is one shared log of feeds, sleep and diapers. Type your first name and you're in. No account needed.";
          i.hidden = go.hidden = false; if (r.for_name) i.value = r.for_name; setTimeout(function () { i.focus(); }, 50);
        }, function () {
          h.textContent = "No connection"; p.textContent = "Joining needs signal once. Try again when you're online.";
          go.hidden = false; go.textContent = "Try again"; go.onclick = function () { go.hidden = true; go.textContent = "Join"; go.onclick = join; load(); };
        });
      }
      function join() {
        var n = i.value.trim(); if (!n) { i.focus(); return; }
        go.disabled = true; go.textContent = "Joining…";
        var id0 = "j" + Date.now();
        rpc("cradle_join", { p_code: JOIN, p_name: n, p_color: colorFor(id0) }).then(function (r) {
          LS.set("cradle.web.key", r.key);
          var ns = "cradle.web." + r.key.slice(0, 8) + ".";
          LS.set(ns + "me", { id: r.me.id, name: r.me.name, color: r.me.color || colorFor(r.me.id), member: true });
          LOC.replace(LOC.pathname + "?k=" + r.key);
        }, function (e) {
          go.disabled = false; go.textContent = "Join";
          if (e.code === "not_granted") return bad(e.hint);
          p.textContent = "Couldn't join just now. Check your signal and tap Join again.";
        });
      }
      go.onclick = join; i.onkeydown = function (e) { if (e.key === "Enter") join(); };
      load();
    });
  }

  // ---------------------------------------------------------------- sample (AI read of messy notes)
  function makeSample() {
    function call(body) {
      return fetch(CFG.url + "/functions/v1/cradle-ai", {
        method: "POST", headers: { apikey: CFG.key, Authorization: "Bearer " + CFG.key, "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ key: FAMILY }, body))
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw Object.assign(new Error(j.error || "Couldn't read that right now. Try again in a minute."), { code: r.status === 429 ? "rate_limited" : "unavailable" });
          return j;
        });
      });
    }
    var sample = function (prompt, opts) { return call({ prompt: String(prompt), mode: "text" }).then(function (j) { return { text: j.text || "" }; }); };
    sample.json = function (prompt, opts) { return call({ prompt: String(prompt), mode: "json" }).then(function (j) { return j.json; }); };
    sample.limits = function () { return Promise.resolve({}); };
    return sample;
  }

  // ---------------------------------------------------------------- downloads
  var DL = {
    save: function (o) {
      var name = (o && (o.filename || o.name)) || "cradle.txt", data = o && o.data;
      var type = /\.csv$/i.test(name) ? "text/csv" : /\.ics$/i.test(name) ? "text/calendar" : "text/plain";
      var blob = data instanceof Blob ? data : new Blob([data == null ? "" : data], { type: type });
      var file = null; try { file = new File([blob], name, { type: blob.type || type }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|ipod|android/i.test(navigator.userAgent)) {
        return navigator.share({ files: [file], title: name }).catch(function (e) { if (e && e.name === "AbortError") throw Object.assign(new Error("declined"), { code: "declined" }); throw e; });
      }
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return Promise.resolve();
    }
  };

  // ---------------------------------------------------------------- wiring
  var made = {};
  window.claude = {
    use: function (name) {
      if (made[name]) return made[name];
      if (JOIN) { if (!made.__join) { made.__join = 1; joinScreen(); } return (made[name] = new Promise(function () {})); }
      if (!FAMILY) { noFamilyScreen(false); return (made[name] = new Promise(function () {})); }   // waits on the "open your link" screen
      var p;
      if (name === "db") { startSync(); p = Promise.resolve(DB); }
      else if (name === "user") p = makeUser();
      else if (name === "sample") p = Promise.resolve(makeSample());
      else if (name === "downloads") p = Promise.resolve(DL);
      else p = Promise.reject(new Error("Not available: " + name));
      return (made[name] = p);
    }
  };
  window.CradleWeb = { family: FAMILY, join: JOIN, me: function () { return ME; }, members: function () { return FAM; }, rpc: rpc, sync: sync, push: push, pull: pull, ns: NS };

  // Feedback notes (tap anything, leave a note): loaded for everyone in a family.
  if (FAMILY) whenBody(function () {
    var sc = document.createElement("script");
    sc.src = "feedback-pins.js" + (window.CRADLE_BUILD ? "?v=" + window.CRADLE_BUILD : "");
    sc.onload = function () { askName().then(function (me) { window.CradlePins && window.CradlePins.init(me); }); };
    document.head.appendChild(sc);
  });

  if ("serviceWorker" in navigator && LOC.protocol === "https:") window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
})();
