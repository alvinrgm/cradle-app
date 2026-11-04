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
    url: "https://hvpwgqliuykzebjkejyu.supabase.co",
    key: "sb_publishable_xmdWIGrbkSc8xXy_XVpdSQ_jORvUJb8",
    pullMs: 4000
  };
  var H = window.history, LOC = window.location;
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var COLORS = ["#C2667A", "#4F7CAC", "#5E9C76", "#B07D3A", "#7E6BB0", "#3E8E9C"];

  // ---- The family key: from the link (#k=… or ?k=…) the first time, then from this phone.
  var FAMILY = (function () {
    var m = /[#&?]k=([A-Za-z0-9_-]{20,100})/.exec(LOC.hash + "&" + LOC.search);
    if (m) {
      LS.set("cradle.web.key", m[1]);
      var q = new URLSearchParams(LOC.search); q.delete("k");
      var rest = LOC.hash.replace(/^#/, "").split("&").filter(function (p) { return p && !/^k=/.test(p); }).join("&");
      H.replaceState(null, "", LOC.pathname + (q.toString() ? "?" + q : "") + (rest ? "#" + rest : ""));
    }
    return LS.get("cradle.web.key", null);
  })();
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
        err.status = r.status; err.pg = body && body.code;
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
  function noFamilyScreen(bad) {
    whenBody(function () {
      if (document.querySelector(".cw-scr")) return;
      screen("<h1>Cradle</h1><p>" + (bad ? "This family link isn't working. Ask whoever sent it for a fresh link, then open that link on this phone."
        : "Cradle is a private family log. Open it from the family link you were sent, and it will remember this phone.") + "</p>");
    });
  }

  // ---------------------------------------------------------------- user: who is tapping on this phone
  var ME = LS.get("cradle.web.me", null);
  if (ME && !ME.id) ME = null;
  var asking = null;
  function askName() {
    if (ME && ME.name) return Promise.resolve(ME);
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
          LS.set("cradle.web.me", ME); d.remove(); resolve(ME);
        }
        go.onclick = done; i.onkeydown = function (e) { if (e.key === "Enter") done(); };
        setTimeout(function () { i.focus(); }, 50);
      });
    }));
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // ---------------------------------------------------------------- db
  // store: path -> data (null = deleted). pending: path -> {data|null, n}. Both mirrored to localStorage.
  var store = {}, seq = 0, loaded = false, pending = LS.get(NS + "pending", {}) || {};
  var cache = LS.get(NS + "cache", null);
  if (cache && cache.docs) { store = cache.docs; seq = cache.seq || 0; }
  var listeners = [], gotServer = false, firstPull = null, badKey = false;
  var sync = { pending: 0, lastOk: 0, lastErr: null };
  window.__cradleSync = sync;

  function view(path) { return Object.prototype.hasOwnProperty.call(pending, path) ? pending[path].data : store[path]; }
  function clone(d) { return d == null ? d : JSON.parse(JSON.stringify(d)); }
  function persistCache() { if (!LS.set(NS + "cache", { seq: seq, docs: store })) console.warn("Cradle: cache didn't fit on this phone; the log is still saved online"); }
  function persistPending() { LS.set(NS + "pending", pending); sync.pending = Object.keys(pending).length; }
  sync.pending = Object.keys(pending).length;

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
    var since = gotServer ? Math.max(0, seq - 25) : 0;
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
      seq = Math.max(seq, r.seq || 0); gotServer = true; loaded = true; sync.lastOk = Date.now(); sync.lastErr = null;
      persistCache();
      changed = changed.filter(function (p) { return !Object.prototype.hasOwnProperty.call(pending, p); });
      if (changed.length) emit(changed);
      listeners.forEach(function (l) { if (!l.live) { l.live = true; fire(l); } });
    }, function (e) {
      sync.lastErr = e;
      if (e.code === "not_granted") { badKey = true; noFamilyScreen(true); }
      throw e;
    });
    var p = pulling;
    p.then(function () { pulling = null; }, function () { pulling = null; });
    return p;
  }

  // Send the queue, 50 at a time. A write the database refuses is dropped (so it can't jam the queue) and reported.
  var pushing = null, refusedWaiters = {};
  function push() {
    if (!FAMILY || badKey) return Promise.resolve();
    if (pushing) return pushing.then(push, push);
    var paths = Object.keys(pending).slice(0, 50);
    if (!paths.length) return Promise.resolve();
    var sent = {};
    var writes = paths.map(function (p) { sent[p] = pending[p].n; return pending[p].data == null ? { path: p, del: true } : { path: p, data: pending[p].data }; });
      // keep the exact copy we sent: a newer tap that lands mid-flight stays in the queue and isn't overwritten
    var sentData = {}; paths.forEach(function (p) { sentData[p] = pending[p].data; });
    pushing = rpc("cradle_push", { p_key: FAMILY, p_writes: writes, p_by: ME ? ME.id : null }).then(function (r) {
      paths.forEach(function (p) {
        var d = sentData[p];
        if (d == null) delete store[p]; else store[p] = d;
        if (pending[p] && pending[p].n === sent[p]) delete pending[p];   // a newer tap on the same entry stays queued
      });
      seq = Math.max(seq, (r && r.seq) || 0); sync.lastOk = Date.now(); sync.lastErr = null;
      persistPending(); persistCache();
    }, function (e) {
      sync.lastErr = e;
      if (e.code === "invalid_argument" && paths.length > 1) {
        // One bad entry in the batch: send them one by one so only that one is dropped.
        var one = paths.reduce(function (ch, p) { return ch.then(function () { return pushOne(p); }); }, Promise.resolve());
        return one;
      }
      if (e.code === "invalid_argument") return dropRefused(paths[0], e);
      if (e.code === "not_granted") { badKey = true; noFamilyScreen(true); }
      throw e;
    });
    var p = pushing;
    p.then(function () { pushing = null; }, function () { pushing = null; });
    return p.then(function () { if (Object.keys(pending).length) return push(); });
  }
  function pushOne(p) {
    if (!pending[p]) return Promise.resolve();
    var n = pending[p].n, w = pending[p].data == null ? { path: p, del: true } : { path: p, data: pending[p].data };
    return rpc("cradle_push", { p_key: FAMILY, p_writes: [w], p_by: ME ? ME.id : null }).then(function () {
      if (pending[p] && pending[p].n === n) { if (w.del) delete store[p]; else store[p] = w.data; delete pending[p]; }
      persistPending(); persistCache();
    }, function (e) { if (e.code === "invalid_argument") return dropRefused(p, e); throw e; });
  }
  function dropRefused(p, e) {
    console.error("Cradle: save refused", p, e);
    delete pending[p]; persistPending();
    emit([p]);
    (refusedWaiters[p] || []).forEach(function (f) { f(e); }); delete refusedWaiters[p];
  }
  var nTap = 0;
  function queue(path, data) {
    pending[path] = { data: data == null ? null : clone(data), n: ++nTap + "." + Date.now() };
    persistPending(); emit([path]);
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
      // Offline on open: show the cached copy if there is one; listeners without it get the error.
      listeners.forEach(function (l) { if (!l.live && cache) { l.live = true; fire(l); } else if (!l.live && l.err) l.err(Object.assign(new Error("offline"), { code: "unavailable" })); });
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
    return askName().then(function (me) {
      // Publish this phone's name so the other parent sees "Michelle" rather than "Someone".
      var path = "people/" + me.id, cur = view(path);
      if (!cur || cur.name !== me.name || cur.color !== me.color) queue(path, { name: me.name, color: me.color, at: Date.now() });
      return {
        id: function () { return Promise.resolve(me.id); },
        me: function () { return Promise.resolve({ id: me.id, name: me.name, color: me.color }); },
        profiles: function (ids) {
          var out = {};
          (ids || []).forEach(function (id) { var p = view("people/" + id); out[id] = { name: (p && p.name) || "", color: p && p.color, isMe: id === me.id }; });
          return Promise.resolve(out);
        },
        isOwner: function () { return true; },     // nothing is locked: everyone in the family can do everything
        canEdit: function () { return true; },
        rename: function (n) { me.name = String(n || "").trim().slice(0, 40) || me.name; LS.set("cradle.web.me", me); return queue(path, { name: me.name, color: me.color, at: Date.now() }); },
        familyLink: function () { return LOC.origin + LOC.pathname + "#k=" + FAMILY; },
        web: true
      };
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
  window.CradleWeb = { family: FAMILY, me: function () { return ME; }, rpc: rpc, sync: sync, push: push, pull: pull, ns: NS };

  // Feedback notes (tap anything, leave a note): loaded for everyone in a family.
  if (FAMILY) whenBody(function () {
    var sc = document.createElement("script");
    sc.src = "feedback-pins.js" + (window.CRADLE_BUILD ? "?v=" + window.CRADLE_BUILD : "");
    sc.onload = function () { askName().then(function (me) { window.CradlePins && window.CradlePins.init(me); }); };
    document.head.appendChild(sc);
  });

  if ("serviceWorker" in navigator && LOC.protocol === "https:") window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
})();
