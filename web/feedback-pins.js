// Feedback notes for Cradle on the web (ported from Gainsboard's tester pins). Loaded by cradle-shim.js for everyone
// who opens Cradle from a family link. Notes go to the cradle.pins table (via public.cradle_pin_* functions), tied to
// the family, so Alvin can read them and fix things.
//
// The 💬 button turns note mode on. The next tap doesn't press anything: it picks the thing under the finger (snapped
// to the card or button it belongs to), opens a note box, and saves the note with where it was (tab, log day, open
// sheet), the element's text and position, the screen size and the app version. Notes come back as numbered dots on
// the same screen. "Notes" lists them all; fixed ones say what changed.
(function () {
  "use strict";
  var LAYER = "data-gb-pins";
  var SNAP = "button,a,input,textarea,select,label,[data-ex],[data-act],[data-tab],[role=button],h1,h2,h3,h4,img,canvas,li";
  var ANCHORS = ["data-ex", "data-tab", "data-act", "data-day", "id"];
  var BLOCK = ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click", "dblclick", "contextmenu", "submit", "focusin"];

  var me, admin = false, pins = [], picking = false, root, btn, list, dots, sheet, raf = 0, hidden = false;

  // ---------- screen key
  function g(name) { try { return Function("return typeof " + name + " === 'undefined' ? undefined : " + name)(); } catch (e) { return undefined; } }
  function topSheet() {
    var vw = innerWidth, vh = innerHeight, best = null;
    document.querySelectorAll("body > *, body > * > *").forEach(function (el) {
      if (el.closest("[" + LAYER + "]") || el.closest(".tabbar")) return;
      var cs = getComputedStyle(el);
      if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return;
      var r = el.getBoundingClientRect();
      if (r.width * r.height < vw * vh * 0.35) return;
      best = el;
    });
    if (!best) return "";
    var h = best.querySelector("h1,h2,h3");
    return (best.id || (best.className && String(best.className).split(" ")[0]) || best.tagName.toLowerCase()) + (h ? ":" + h.textContent.trim().slice(0, 40) : "");
  }
  function screenKey() {
    var st = g("S") || {}, route = st.route || (location.hash || "#today").slice(1).split("?")[0] || "today";
    var parts = ["tab=" + route];
    if (route === "log" && st.logDay) parts.push("day=" + new Date(st.logDay).toISOString().slice(0, 10));
    var sh = document.querySelector(".sheet.open h2, .sheet[open] h2, dialog[open] h2, .sheet h2");
    var shTop = topSheet();
    if (sh && sh.offsetParent !== null) parts.push("sheet=" + sh.textContent.trim().slice(0, 40)); else if (shTop) parts.push("sheet=" + shTop);
    return parts.join("|").slice(0, 300);
  }
  function screenLabel(key) {
    return key.split("|").map(function (p) { return p.replace(/^tab=/, "").replace(/^day=/, "").replace(/^sheet=/, "sheet ").replace(/^step=/, "step "); }).join(" · ");
  }

  // ---------- selectors
  function q(v) { return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  function nth(e) { return Array.prototype.indexOf.call(e.parentElement ? e.parentElement.children : [], e) + 1; }
  function only(sel, el) { try { var a = document.querySelectorAll(sel); return a.length === 1 && a[0] === el; } catch (e) { return false; } }
  function step(e) { return e.tagName.toLowerCase() + ":nth-child(" + nth(e) + ")"; }
  function anchorOf(e) {
    for (var i = 0; i < ANCHORS.length; i++) { var a = ANCHORS[i], v = e.getAttribute(a); if (v) return a === "id" ? "#" + CSS.escape(v) : "[" + a + "=" + q(v) + "]"; }
    return null;
  }
  function selectorOf(el) {
    var chain = [];
    for (var e = el; e && e !== document.body; e = e.parentElement) chain.push(e);
    for (var i = 0; i < chain.length; i++) {
      var a = anchorOf(chain[i]);
      if (!a) continue;
      var tail = chain.slice(0, i).reverse().map(step);
      var s = [a].concat(tail).join(" > ");
      if (only(s, el)) return s;
      var outer = null;
      for (var j = i + 1; j < chain.length && !outer; j++) outer = anchorOf(chain[j]);
      if (outer && only(outer + " " + s, el)) return outer + " " + s;
    }
    return ["body"].concat(chain.reverse().map(function (c) {
      var cls = Array.prototype.find.call(c.classList, function (k) { return /^[a-zA-Z][\w-]*$/.test(k); });
      return c.tagName.toLowerCase() + (cls ? "." + cls : "") + ":nth-child(" + nth(c) + ")";
    })).join(" > ");
  }
  function textOf(el) {
    var t = (el.value || el.placeholder || el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("alt") || "");
    return String(t).replace(/\s+/g, " ").trim().slice(0, 120);
  }
  function find(p) {
    var el = null;
    try { el = document.querySelector(p.selector); } catch (e) {}
    if (el && (!p.element_text || textOf(el) === p.element_text)) return el;
    // the selector drifted (list order changed): fall back to the same kind of element with the same text
    if (p.element_text) {
      var tag = (p.selector.split(">").pop().trim().match(/^[a-z0-9]+/) || [])[0];
      var c = tag ? document.querySelectorAll(tag) : [];
      for (var i = 0; i < c.length; i++) if (!c[i].closest("[" + LAYER + "]") && textOf(c[i]) === p.element_text) return c[i];
    }
    return el;
  }

  // ---------- data
  function api(name, args) { return window.CradleWeb.rpc(name, Object.assign({ p_key: window.CradleWeb.family }, args)); }
  function load() {
    return api("cradle_pins", {}).then(function (r) { pins = Array.isArray(r) ? r : []; paint(); label(); }, function () {});
  }

  // ---------- show or hide all dots (kept on this phone)
  function lsKey() { return "cradle.pins.dotsHidden"; }
  function readPref() { try { hidden = localStorage.getItem(lsKey()) === "1"; } catch (e) {} }
  function setHidden(on) {
    hidden = !!on;
    try { localStorage.setItem(lsKey(), hidden ? "1" : "0"); } catch (e) {}
    paint(); label();
    var sw = sheet && sheet.querySelector(".gbp-sw");
    if (sw) sw.setAttribute("aria-checked", String(!hidden));
  }

  // ---------- UI
  function css() {
    return '<style>[' + LAYER + '] *{box-sizing:border-box;font-family:var(--sans,system-ui,-apple-system,sans-serif)}' +
      '.gbp-btn{position:fixed;right:12px;top:calc(46px + env(safe-area-inset-top,0px));z-index:2147483000;height:36px;min-width:36px;padding:0 10px;border-radius:20px;border:1px solid var(--line,#EDE6DC);background:color-mix(in oklab,var(--card,#fff) 85%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:var(--ink,#2B2733);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;gap:4px;box-shadow:0 2px 8px rgb(0 0 0 / .12);cursor:pointer;opacity:.9}' +
      '.gbp-btn.on{background:#ef4444;border-color:#ef4444;color:#fff}.gbp-list{right:54px;font-size:12px;font-weight:600}.gbp-btn.on{opacity:1}' +
      '.gbp-hint{position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top,0px));z-index:2147483000;background:#ef4444;color:#fff;border-radius:999px;padding:8px 14px;font:600 13px system-ui;box-shadow:0 2px 10px rgb(0 0 0 / .3)}' +
      '.gbp-dot{position:fixed;z-index:2147482999;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#ef4444;color:#fff;font:700 12px/26px system-ui;text-align:center;border:2px solid #fff;box-shadow:0 2px 8px rgb(0 0 0 / .4);cursor:pointer}' +
      '.gbp-dot.done{background:#22c55e}' +
      '.gbp-hl{position:fixed;z-index:2147482998;border:2px solid #ef4444;border-radius:8px;pointer-events:none;background:rgb(239 68 68 / .08)}' +
      '.gbp-scrim{position:fixed;inset:0;z-index:2147483001;background:rgb(0 0 0 / .4)}' +
      '.gbp-sheet{position:fixed;inset-inline:0;bottom:0;z-index:2147483001;overscroll-behavior:contain;background:var(--card,#fff);color:var(--ink,#2B2733);border-top:1px solid var(--line,#EDE6DC);border-radius:18px 18px 0 0;padding:0 16px calc(16px + env(safe-area-inset-bottom,0px));max-height:85vh;max-height:85dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;box-shadow:0 -8px 30px rgb(0 0 0 / .4)}' +
      '.gbp-sheet>*{max-width:560px;margin-inline:auto}.gbp-top{position:sticky;top:0;z-index:1;background:inherit;display:flex;justify-content:flex-end;align-items:center;height:44px;margin-inline:-16px;padding:0 12px;max-width:none}' +
      '.gbp-top::before{content:"";position:absolute;left:50%;top:6px;width:36px;height:5px;margin-left:-18px;border-radius:999px;background:var(--line,#EDE6DC)}.gbp-top{position:sticky}' +
      '.gbp-x{width:32px;height:32px;border-radius:50%;border:0;background:var(--bg,#FBF6EF);color:var(--sub,#6B6476);font:600 18px/32px system-ui;cursor:pointer}' +
      '.gbp-sheet h3{font:800 18px system-ui;margin:0 0 6px}.gbp-sheet small{display:block;color:var(--sub,#6B6476);font-size:12px;margin-bottom:10px}' +
      '.gbp-sheet textarea{width:100%;min-height:96px;font:16px system-ui;padding:10px;border-radius:10px;border:1px solid var(--line,#EDE6DC);background:var(--bg,#FBF6EF);color:inherit}' +
      '.gbp-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.gbp-row button{flex:1;min-height:44px;border-radius:12px;border:1px solid var(--line,#EDE6DC);background:transparent;color:inherit;font:600 15px system-ui;cursor:pointer}' +
      '.gbp-row button.go{background:var(--ink,#2B2733);color:var(--bg,#FBF6EF);border:0}.gbp-err{color:#f87171;font-size:13px;min-height:1em}' +
      '.gbp-item{border:1px solid var(--line,#EDE6DC);border-radius:12px;padding:10px;margin-top:8px}.gbp-item b{display:block;font-size:14px}.gbp-item span{color:var(--sub,#6B6476);font-size:12px}' +
      '.gbp-tog{display:flex;align-items:center;gap:12px;border:1px solid var(--line,#EDE6DC);border-radius:12px;padding:10px 12px;margin:4px 0 6px;min-height:52px;cursor:pointer}.gbp-tog b{flex:1;font-size:15px;font-weight:600}.gbp-tog b small{margin:2px 0 0;font-weight:400}' +
      '.gbp-sw{position:relative;flex:none;width:51px;height:31px;border-radius:999px;border:0;padding:0;background:var(--fill,#3f3f46);transition:background .2s;cursor:pointer}.gbp-sw::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgb(0 0 0 / .3);transition:transform .2s}' +
      '.gbp-sw[aria-checked=true]{background:#34c759}.gbp-sw[aria-checked=true]::after{transform:translateX(20px)}' +
      '.gbp-item .st{float:right;margin-left:8px;font-weight:700;font-size:11px;text-transform:uppercase}.gbp-item .st.open{color:#ef4444}.gbp-item .st.resolved{color:#22c55e}.gbp-item b{overflow-wrap:anywhere}.gbp-item .fix{display:block;margin-top:6px;color:#22c55e;font-size:13px}' +
      '.gbp-sec{font:700 12px system-ui;text-transform:uppercase;letter-spacing:.06em;color:var(--sub,#6B6476);margin:16px 0 0}</style>';
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function mount() {
    root = el("div"); root.setAttribute(LAYER, ""); root.innerHTML = css();
    btn = el("button", "gbp-btn"); btn.type = "button";
    btn.addEventListener("click", function () { setPicking(!picking); });
    var hold; // long-press the button for the list
    btn.addEventListener("pointerdown", function () { hold = setTimeout(function () { hold = "fired"; setPicking(false); openList(); }, 550); });
    btn.addEventListener("pointerup", function () { if (hold !== "fired") clearTimeout(hold); });
    list = el("button", "gbp-btn gbp-list"); list.type = "button"; list.textContent = "Notes";
    list.addEventListener("click", function () { setPicking(false); openList(); });
    dots = el("div"); root.appendChild(dots); root.appendChild(list); root.appendChild(btn);
    document.body.appendChild(root);
    label();
    addEventListener("scroll", schedule, true); addEventListener("resize", schedule);
    new MutationObserver(function (m) { if (m.some(function (x) { return !root.contains(x.target); })) schedule(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "style"] });
  }
  function label() {
    var open = pins.filter(function (p) { return p.status === "open"; }).length;
    btn.classList.toggle("on", picking);
    btn.innerHTML = picking ? "✕ Cancel" : "💬" + (open ? " " + open : "");
    btn.setAttribute("aria-label", picking ? "Cancel feedback" : "Leave a feedback note");
    btn.title = "Tap, then tap the thing your note is about.";
    list.textContent = hidden ? "Notes · dots off" : "Notes";
    list.style.display = picking ? "none" : "";
  }

  // ---------- pin mode
  function setPicking(on) {
    picking = on; label();
    var hint = root.querySelector(".gbp-hint");
    if (on && !hint) { hint = el("div", "gbp-hint", "Tap the thing your note is about"); root.appendChild(hint); }
    if (!on && hint) hint.remove();
    BLOCK.forEach(function (t) { if (on) addEventListener(t, guard, { capture: true, passive: false }); else removeEventListener(t, guard, true); });
  }
  // Touch screens: blocking the touch stops the browser from ever sending a click, so the pin is placed on pointerup
  // (a tap that didn't move more than a few px; a scroll ends in pointercancel instead), and the rest is swallowed.
  var downAt = null;
  function guard(ev) {
    if (ev.target.closest && ev.target.closest("[" + LAYER + "]")) return;
    // let a finger still scroll the page (touchstart/pointerdown pass), but no press, focus or click gets through
    if (ev.cancelable && ev.type !== "touchstart" && ev.type !== "pointerdown") ev.preventDefault();
    ev.stopPropagation(); ev.stopImmediatePropagation();
    if (ev.type === "pointerdown") { downAt = { x: ev.clientX, y: ev.clientY }; return; }
    if (ev.type !== "pointerup" || !downAt) return;
    var moved = Math.abs(ev.clientX - downAt.x) + Math.abs(ev.clientY - downAt.y); downAt = null;
    if (moved > 12) return; // that was a scroll, not a tap
    var x = ev.clientX, y = ev.clientY;
    var hit = (document.elementsFromPoint(x, y) || []).find(function (n) { return !n.closest("[" + LAYER + "]"); }) || ev.target;
    var t = hit.closest(SNAP) || hit;
    var r = t.getBoundingClientRect();
    var frac = function (v, a, len) { return len > 0 ? Math.round(Math.min(1, Math.max(0, (v - a) / len)) * 1000) / 1000 : 0.5; };
    // keep swallowing the click the browser may still send for this tap, then leave pin mode
    setTimeout(function () { setPicking(false); }, 350);
    picking = false; label();
    var hint = root.querySelector(".gbp-hint"); if (hint) hint.remove();
    compose({
      view: screenKey(), selector: selectorOf(t), element_text: textOf(t),
      box: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      point: { fx: frac(x, r.left, r.width), fy: frac(y, r.top, r.height) },
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 }
    }, r);
  }

  function closeSheet() { if (sheet) { if (sheet._scrim) sheet._scrim.remove(); sheet.remove(); sheet = null; } var h = root.querySelector(".gbp-hl"); if (h) h.remove(); }
  // Every notes panel opens through here: a grab bar and × on top, a tap outside closes it,
  // and it drags down to close like an iOS sheet (from the top bar, or anywhere once scrolled to the top).
  function show(html) {
    // Close only on a tap that starts on the scrim. The tap that dropped the pin lands its click here right after
    // the sheet opens (the scrim now covers that spot), and that stray click must not close the new note.
    var scrim = el("div", "gbp-scrim"), opened = Date.now(), downOn = false;
    scrim.addEventListener("pointerdown", function () { downOn = Date.now() - opened > 300; });
    scrim.addEventListener("click", function () { if (downOn) closeSheet(); downOn = false; });
    root.appendChild(scrim);
    sheet = el("div", "gbp-sheet", '<div class="gbp-top"><button type="button" class="gbp-x" data-x="close" aria-label="Close">×</button></div>' + html);
    sheet._scrim = scrim; root.appendChild(sheet);
    sheet.querySelectorAll('[data-x="close"]').forEach(function (b) { b.onclick = closeSheet; });
    swipeDown(sheet);
    return sheet;
  }
  function swipeDown(sh) {
    var g = null;
    sh.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1 || e.target.closest("textarea,input")) { g = null; return; }
      var t = e.touches[0];
      g = { y0: t.clientY, x0: t.clientX, t0: Date.now(), top: t.clientY - sh.getBoundingClientRect().top < 56, live: false, d: 0 };
    }, { passive: true });
    sh.addEventListener("touchmove", function (e) {
      if (!g) return;
      var t = e.touches[0], dy = t.clientY - g.y0, dx = t.clientX - g.x0;
      if (!g.live) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) && (g.top || sh.scrollTop <= 0)) { g.live = true; sh.style.transition = "none"; }
        else { g = null; return; }
      }
      if (e.cancelable) e.preventDefault();
      g.d = Math.max(0, dy); sh.style.transform = "translateY(" + g.d + "px)";
    }, { passive: false });
    function end() {
      if (!g || !g.live) { g = null; return; }
      var d = g.d, v = d / Math.max(1, Date.now() - g.t0); g = null;
      sh.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1)";
      if (d > Math.min(140, sh.offsetHeight * 0.3) || (v > 0.5 && d > 30)) { sh.style.transform = "translateY(110%)"; setTimeout(function () { if (sheet === sh) closeSheet(); }, 230); }
      else sh.style.transform = "";
    }
    sh.addEventListener("touchend", end); sh.addEventListener("touchcancel", end);
  }
  function compose(d, r) {
    closeSheet();
    var hl = el("div", "gbp-hl"); hl.style.cssText += ";left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px"; root.appendChild(hl);
    show('<div><h3>Note on this</h3><small>' + esc(d.element_text || "this spot") + " · " + esc(screenLabel(d.view)) + '</small>' +
      '<textarea placeholder="What\'s wrong, confusing or missing here?"></textarea><div class="gbp-err"></div>' +
      '<div class="gbp-row"><button type="button" data-x="cancel">Cancel</button><button type="button" class="go" data-x="save">Save note</button></div></div>');
    var ta = sheet.querySelector("textarea"); setTimeout(function () { ta.focus(); }, 50);
    sheet.querySelector('[data-x="cancel"]').onclick = closeSheet;
    sheet.querySelector('[data-x="save"]').onclick = function () {
      var msg = ta.value.trim(); if (!msg) { ta.focus(); return; }
      var b = this; b.disabled = true; b.textContent = "Saving…";
      var row = Object.assign({}, d, { message: msg, by_id: me && me.id, by_name: me && me.name, app_version: appVersion(), user_agent: navigator.userAgent.slice(0, 400) });
      api("cradle_pin_add", { p: row }).then(function (r2) {
        pins.push(r2); closeSheet(); paint(); label(); flash("Thanks! Alvin will see this note.");
      }, function (e) {
        b.disabled = false; b.textContent = "Save note";
        sheet.querySelector(".gbp-err").textContent = navigator.onLine ? "Couldn't save the note. Try again in a moment." : "You're offline. Your note is still here; try again when connected.";
      });
    };
  }

  // ---------- dots
  function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; paint(); }); }
  function covered(e, x, y) {
    var top = (document.elementsFromPoint(x, y) || []).find(function (n) { return !n.closest("[" + LAYER + "]"); });
    return !!top && top !== e && !e.contains(top) && !top.contains(e);
  }
  function paint() {
    if (!dots) return;
    if (hidden) { dots.innerHTML = ""; return; }
    var key = screenKey(), html = "", n = 0;
    pins.forEach(function (p, i) {
      if (p.view !== key) return;
      var e = find(p); if (!e) return;
      var r = e.getBoundingClientRect(); if (!r.width && !r.height) return;
      var pt = p.point || { fx: 0.5, fy: 0.5 }, x = r.left + r.width * pt.fx, y = r.top + r.height * pt.fy;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight || covered(e, x, y)) return; // scrolled away or under a sticky bar
      n++;
      html += '<div class="gbp-dot' + (p.status === "resolved" ? " done" : "") + '" data-i="' + i + '" style="left:' + x + "px;top:" + y + 'px">' + (i + 1) + "</div>";
    });
    dots.innerHTML = html;
    dots.querySelectorAll(".gbp-dot").forEach(function (d) { d.onclick = function () { openPin(pins[+d.dataset.i], +d.dataset.i); }; });
  }

  // ---------- one pin, and the list
  function itemHtml(p, i) {
    return '<div class="gbp-item"><span class="st ' + p.status + '">' + (p.status === "open" ? "open" : "fixed") + '</span><b>' + (i + 1) + ". " + esc(p.message) + '</b>' +
      "<span>" + esc(p.element_text || "") + " · " + esc(screenLabel(p.view)) + " · " + new Date(p.created_at).toLocaleDateString() + (p.by_id === (me && me.id) ? "" : p.by_name ? " · " + esc(p.by_name) : "") + "</span>" +
      (p.status === "resolved" ? '<span class="fix">✓ ' + esc(p.resolved_note || "Fixed") + (p.resolved_at ? " · " + new Date(p.resolved_at).toLocaleDateString() : "") + "</span>" : "") + "</div>";
  }
  function openPin(p, i) {
    closeSheet();
    var mine = p.by_id === (me && me.id);
    show("<div>" + itemHtml(p, i) + '<div class="gbp-err"></div><div class="gbp-row">' +
      '<button type="button" data-x="close">Close</button>' +
      (admin && p.status === "open" ? '<button type="button" class="go" data-x="fix">Mark fixed</button>' : "") +
      (mine && p.status === "open" ? '<button type="button" data-x="del">Delete</button>' : "") + "</div></div>");
    var del = sheet.querySelector('[data-x="del"]');
    if (del) del.onclick = function () {
      api("cradle_pin_delete", { p_id: p.id }).then(function () { pins.splice(i, 1); closeSheet(); paint(); label(); },
        function () { sheet.querySelector(".gbp-err").textContent = "Couldn't delete it right now. Try again in a moment."; });
    };
  }
  function openList() {
    closeSheet();
    var rows = pins.map(function (p, i) { return { p: p, i: i }; }).reverse();
    var open = rows.filter(function (x) { return x.p.status === "open"; }), done = rows.filter(function (x) { return x.p.status !== "open"; });
    var todo = [];
    var sec = function (t, list) { return list.length ? '<p class="gbp-sec">' + t + " · " + list.length + "</p>" + list.map(function (x) { return itemHtml(x.p, x.i); }).join("") : ""; };
    show("<div><h3>" + "Feedback notes" + "</h3><small>" + open.length + " open · " + done.length + " fixed. Notes from everyone in your family. Fixed notes say what changed.</small>" +
      '<label class="gbp-tog"><b>Show dots on screens<small>Each note shows as a numbered dot where you left it. Turning this off keeps your notes.</small></b>' +
      '<button type="button" role="switch" class="gbp-sw" aria-label="Show dots on screens" aria-checked="' + !hidden + '"></button></label>' +
      (todo.length ? '<div class="gbp-row"><button type="button" class="go" data-x="bulk">Mark ' + todo.length + " fixed from release notes</button></div>" : "") +
      (pins.length ? sec("Open", open) + sec("Fixed", done) : "<small>No notes yet. Tap 💬, then tap anything that\u2019s wrong, confusing or missing.</small>") +
      '<div class="gbp-err"></div><div class="gbp-row"><button type="button" data-x="close">Close</button><button type="button" data-x="reload">Refresh</button></div></div>');
    sheet.querySelector('[data-x="reload"]').onclick = function () { load().then(openList); };
    sheet.querySelector(".gbp-sw").onclick = function (e) { e.preventDefault(); setHidden(!hidden); };
  }
  function appVersion() { var m = document.querySelector('meta[name="cradle-version"]'); return (m && m.content) || window.CRADLE_VERSION || null; }
  function flash(t) {
    var d = el("div", "gbp-hint", esc(t)); d.style.background = "#22c55e"; root.appendChild(d); setTimeout(function () { d.remove(); }, 2600);
  }

  window.CradlePins = {
    init: function (person) {
      if (root) return;
      me = person;
      readPref(); mount(); load();
      setInterval(function () { if (!sheet && !document.hidden) load(); }, 60000);
    }
  };
})();
