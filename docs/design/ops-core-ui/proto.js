/* そらばん UI 設計プロトタイプの最小の動き（外部通信なし）。見た目と操作の設計を確かめるためのもので、保存・送信はしない。 */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- ウィザード（02） ---------- */
  var wiz = $("[data-wizard]");
  if (wiz) {
    var panels = $$("[data-step]");
    var cur = 1;
    var names = { 1: "範囲", 2: "日時と高度", 3: "機体と操縦者", 4: "飛行の内容", 5: "安全と保険", 6: "連絡先と名称" };
    var show = function (n) {
      cur = Math.max(1, Math.min(6, n));
      panels.forEach(function (p) { p.hidden = Number(p.dataset.step) !== cur; });
      $$(".steps .s").forEach(function (s, i) { s.className = "s" + (i + 1 < cur ? " done" : i + 1 === cur ? " now" : ""); });
      var sn = $("#stepcount"); if (sn) sn.textContent = cur + " / 6";
      var nm = $("#stepname"); if (nm) nm.textContent = names[cur];
      $$(".stepnav a").forEach(function (a, i) { a.removeAttribute("aria-current"); a.classList.toggle("done", i + 1 < cur); if (i + 1 === cur) a.setAttribute("aria-current", "step"); });
      var next = $("#btn-next"); if (next) { next.querySelector(".lbl").textContent = cur === 6 ? "内容を確認する" : "次へ: " + names[cur + 1]; next.setAttribute("href", cur === 6 ? "03-report-confirm.html" : "#s" + (cur + 1)); }
      var prev = $("#btn-prev"); if (prev) prev.hidden = cur === 1;
      document.body.dataset.step = String(cur);
      document.dispatchEvent(new Event("stepshown"));
    };
    window.addEventListener("hashchange", function () { var m = /^#s(\d)$/.exec(location.hash); if (m) show(Number(m[1])); });
    var m0 = /^#s(\d)$/.exec(location.hash); show(m0 ? Number(m0[1]) : 1);
    $("#btn-next").addEventListener("click", function (e) { if (cur < 6) { e.preventDefault(); history.replaceState(null, "", "#s" + (cur + 1)); show(cur + 1); window.scrollTo(0, 0); } });
    $("#btn-prev").addEventListener("click", function (e) { e.preventDefault(); history.replaceState(null, "", "#s" + (cur - 1)); show(cur - 1); window.scrollTo(0, 0); });
    $$(".stepnav a").forEach(function (a, i) { a.addEventListener("click", function (e) { e.preventDefault(); history.replaceState(null, "", "#s" + (i + 1)); show(i + 1); }); });
    $$("[data-stepper]").forEach(function (st) {
      var out = $("output", st), min = Number(st.dataset.min || 0), max = Number(st.dataset.max || 99);
      $$("button", st).forEach(function (b) { b.addEventListener("click", function () { var v = Number(out.textContent) + Number(b.dataset.d); out.textContent = Math.max(min, Math.min(max, v)); }); });
    });
  }

  /* ---------- 地図の範囲選択（02） ---------- */
  var wrap = $("#mapwrap");
  if (wrap) {
    var MPP = 1.2, LAT0 = 35.5, LNG0 = 133.43;
    var over = $("#over"), base = $("#basemap");
    var W = 0, H = 0;
    var S = { ranges: [{ id: 1, type: "poly", pts: [{ x: -70, y: -105 }, { x: 62, y: -118 }, { x: 98, y: -18 }, { x: 44, y: 72 }, { x: -62, y: 56 }] }], sel: { r: 0, v: 2 }, draft: null, mode: "select", nid: 2 };
    var undo = [], redo = [];
    var snap = function () { return JSON.stringify({ ranges: S.ranges, sel: S.sel, draft: S.draft, nid: S.nid }); };
    var restore = function (j) { var o = JSON.parse(j); S.ranges = o.ranges; S.sel = o.sel; S.draft = o.draft; S.nid = o.nid; };
    var push = function () { undo.push(snap()); if (undo.length > 80) undo.shift(); redo = []; };
    var NS = "http://www.w3.org/2000/svg";
    var el = function (n, a, p) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
    var px = function (p) { return { x: W / 2 + p.x / MPP, y: H / 2 + p.y / MPP }; };
    var mm = function (x, y) { return { x: (x - W / 2) * MPP, y: (y - H / 2) * MPP }; };
    var ll = function (p) { return { lat: LAT0 - p.y / 111000, lng: LNG0 + p.x / (111000 * Math.cos(LAT0 * Math.PI / 180)) }; };
    var area = function (pts) { var a = 0; for (var i = 0; i < pts.length; i++) { var j = (i + 1) % pts.length; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; } return Math.abs(a) / 2; };
    var perim = function (pts) { var s = 0; for (var i = 0; i < pts.length; i++) { var j = (i + 1) % pts.length; s += Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y); } return s; };
    var fmt = function (n) { return Math.round(n).toLocaleString("ja-JP"); };
    var curRange = function () { return S.ranges[S.sel.r]; };

    var toast = function (msg, withUndo) {
      var t = $("#toast"); $("span", t).textContent = msg; $("button", t).hidden = !withUndo; t.hidden = false;
      clearTimeout(toast.h); toast.h = setTimeout(function () { t.hidden = true; }, 6000);
    };

    var render = function () {
      var r = wrap.getBoundingClientRect(); W = r.width; H = r.height;
      over.setAttribute("viewBox", "0 0 " + W + " " + H);
      while (over.firstChild) over.removeChild(over.firstChild);
      S.ranges.forEach(function (rg, ri) {
        var active = ri === S.sel.r;
        var g = el("g", { opacity: active ? 1 : 0.7 }, over);
        if (rg.type === "poly") {
          var pts = rg.pts.map(function (p) { var q = px(p); return q.x + "," + q.y; }).join(" ");
          el("polygon", { points: pts, fill: "none", stroke: "#fff", "stroke-width": 8, "stroke-linejoin": "round" }, g);
          el("polygon", { points: pts, fill: "rgba(235,161,92,.32)", stroke: "#262523", "stroke-width": 3, "stroke-linejoin": "round" }, g);
          if (active && S.mode === "select") {
            rg.pts.forEach(function (p, i) {
              var q = px(p), n = px(rg.pts[(i + 1) % rg.pts.length]);
              var mx = (q.x + n.x) / 2, my = (q.y + n.y) / 2;
              if (Math.hypot(q.x - n.x, q.y - n.y) > 44) {
                var mg = el("g", { "data-mid": i, style: "cursor:copy" }, g);
                el("circle", { cx: mx, cy: my, r: 22, fill: "transparent" }, mg);
                el("circle", { cx: mx, cy: my, r: 9, fill: "#fff", stroke: "#262523", "stroke-width": 2 }, mg);
                el("path", { d: "M" + (mx - 4) + " " + my + "h8M" + mx + " " + (my - 4) + "v8", stroke: "#262523", "stroke-width": 2, "stroke-linecap": "round" }, mg);
              }
            });
          }
          rg.pts.forEach(function (p, i) {
            var q = px(p), sel = active && S.sel.v === i;
            var vg = el("g", { "data-v": i, "data-r": ri, style: "cursor:grab" }, g);
            if (sel) el("circle", { cx: q.x, cy: q.y, r: 22, fill: "none", stroke: "#262523", "stroke-width": 2, "stroke-dasharray": "4 4" }, vg);
            el("circle", { cx: q.x, cy: q.y, r: 24, fill: "transparent" }, vg);
            el("circle", { cx: q.x, cy: q.y, r: 14, fill: sel ? "#EBA15C" : "#fff", stroke: "#262523", "stroke-width": 3 }, vg);
            var t = el("text", { x: q.x, y: q.y + 5, "text-anchor": "middle", "font-size": 14, "font-weight": 800, fill: "#262523" }, vg); t.textContent = i + 1;
          });
        } else {
          var c = px(rg.c), rr = rg.r / MPP;
          el("circle", { cx: c.x, cy: c.y, r: rr, fill: "rgba(235,161,92,.32)", stroke: "#fff", "stroke-width": 8 }, g);
          el("circle", { cx: c.x, cy: c.y, r: rr, fill: "rgba(235,161,92,.32)", stroke: "#262523", "stroke-width": 3, "stroke-dasharray": "10 6" }, g);
          var cg = el("g", { "data-c": ri, style: "cursor:grab" }, g);
          el("circle", { cx: c.x, cy: c.y, r: 24, fill: "transparent" }, cg);
          el("circle", { cx: c.x, cy: c.y, r: 12, fill: active ? "#EBA15C" : "#fff", stroke: "#262523", "stroke-width": 3 }, cg);
        }
      });
      if (S.draft) {
        var d = S.draft.map(px);
        if (d.length > 1) el("polyline", { points: d.map(function (q) { return q.x + "," + q.y; }).join(" "), fill: "none", stroke: "#262523", "stroke-width": 3, "stroke-dasharray": "8 5" }, over);
        d.forEach(function (q, i) {
          var vg = el("g", {}, over);
          el("circle", { cx: q.x, cy: q.y, r: 14, fill: i === d.length - 1 ? "#EBA15C" : "#fff", stroke: "#262523", "stroke-width": 3 }, vg);
          var t = el("text", { x: q.x, y: q.y + 5, "text-anchor": "middle", "font-size": 14, "font-weight": 800 }, vg); t.textContent = i + 1;
        });
      }
      stats();
    };

    var stats = function () {
      var rg = curRange();
      var nv = S.ranges.reduce(function (a, r) { return a + (r.type === "poly" ? r.pts.length : 1); }, 0);
      $("#st-ranges").textContent = S.ranges.length;
      $("#st-verts").textContent = nv;
      var A = rg ? (rg.type === "poly" ? area(rg.pts) : Math.PI * rg.r * rg.r) : 0;
      $("#st-area").textContent = fmt(A);
      $("#st-perim").textContent = rg ? fmt(rg.type === "poly" ? perim(rg.pts) : 2 * Math.PI * rg.r) : "0";
      $("#st-name").textContent = rg ? "範囲 " + (S.sel.r + 1) : "";
      var hint = { select: "頂点をドラッグで移動。辺の「＋」で頂点を足します。", draw: "地図をタップして点を打ちます。3 点以上で「完了」を押します。", circle: "地図をタップして円の中心を置きます。半径は数値で決めます。" }[S.mode];
      if (S.draft) hint = "点を " + S.draft.length + " つ打ちました。3 点以上で「完了」を押します。";
      $("#maphint").textContent = hint;
      $("#btn-done").hidden = !S.draft; $("#btn-done").disabled = !(S.draft && S.draft.length >= 3);
      $("#btn-undo").disabled = !undo.length; $("#btn-redo").disabled = !redo.length;
      var canDel = rg && rg.type === "poly" && S.sel.v != null && rg.pts.length > 3;
      $("#btn-del").hidden = !(rg && rg.type === "poly" && S.sel.v != null && S.mode === "select"); $("#btn-del").disabled = !canDel;
      $$(".tool[data-mode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)); });
      var rrow = $("#radius-row"); rrow.hidden = !(rg && rg.type === "circle");
      if (rg && rg.type === "circle") $("#radius-out").textContent = rg.r;
      var vl = $("#vlist"); vl.textContent = "";
      if (rg && rg.type === "poly") rg.pts.forEach(function (p, i) {
        var q = ll(p), row = document.createElement("div"); row.className = "ln"; row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(S.sel.v === i)); row.dataset.i = i;
        row.innerHTML = '<span class="vno">' + (i + 1) + '</span><span class="num mono">' + q.lat.toFixed(6) + ", " + q.lng.toFixed(6) + "</span>" + (S.sel.v === i ? '<span class="st now">選択中</span>' : "");
        row.style.cursor = "pointer"; vl.appendChild(row);
      });
      if (rg && rg.type === "circle") { var q2 = ll(rg.c); var rw = document.createElement("div"); rw.className = "ln"; rw.innerHTML = '<span class="vno">中</span><span class="num mono">' + q2.lat.toFixed(6) + ", " + q2.lng.toFixed(6) + '</span><span class="st info">' + rg.r + " m</span>"; vl.appendChild(rw); }
      var rl = $("#rlist"); rl.textContent = "";
      S.ranges.forEach(function (r, i) {
        var row = document.createElement("div"); row.className = "ln"; row.setAttribute("aria-selected", String(i === S.sel.r)); row.dataset.r = i;
        var a = r.type === "poly" ? area(r.pts) : Math.PI * r.r * r.r;
        row.innerHTML = '<span class="vno">' + (i + 1) + '</span><span><b>範囲 ' + (i + 1) + "</b> <span class='note'>" + (r.type === "poly" ? "多角形 " + r.pts.length + " 頂点" : "円 半径 " + r.r + " m") + '</span></span><span class="num">' + fmt(a) + " m²</span>";
        row.style.cursor = "pointer"; rl.appendChild(row);
      });
    };

    var cancelDraft = function () { S.draft = null; };
    wrap.addEventListener("pointerdown", function (e) {
      var tgt = e.target.closest ? e.target.closest("[data-v],[data-mid],[data-c]") : null;
      var rect = wrap.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (e.target.closest && e.target.closest(".map-top, .toast")) return;
      if (S.mode === "select" && tgt && tgt.hasAttribute("data-mid")) {
        push(); var rg = curRange(), i = Number(tgt.getAttribute("data-mid")), a = rg.pts[i], b = rg.pts[(i + 1) % rg.pts.length];
        rg.pts.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); S.sel.v = i + 1; render(); e.preventDefault(); return;
      }
      if (S.mode === "select" && tgt && tgt.hasAttribute("data-v")) {
        var ri = Number(tgt.getAttribute("data-r")), vi = Number(tgt.getAttribute("data-v"));
        S.sel = { r: ri, v: vi }; var before = snap(); var moved = false;
        wrap.setPointerCapture(e.pointerId);
        var mv = function (ev) {
          var rc = wrap.getBoundingClientRect(); var nx = Math.max(10, Math.min(W - 10, ev.clientX - rc.left)), ny = Math.max(10, Math.min(H - 10, ev.clientY - rc.top));
          if (!moved) { undo.push(before); redo = []; moved = true; }
          S.ranges[ri].pts[vi] = mm(nx, ny); render();
        };
        var up = function () { wrap.removeEventListener("pointermove", mv); wrap.removeEventListener("pointerup", up); };
        wrap.addEventListener("pointermove", mv); wrap.addEventListener("pointerup", up); render(); e.preventDefault(); return;
      }
      if (S.mode === "select" && tgt && tgt.hasAttribute("data-c")) { S.sel = { r: Number(tgt.getAttribute("data-c")), v: null }; render(); return; }
      if (S.mode === "draw") { push(); S.draft = (S.draft || []).concat([mm(x, y)]); render(); return; }
      if (S.mode === "circle") { push(); S.ranges.push({ id: S.nid++, type: "circle", c: mm(x, y), r: 60 }); S.sel = { r: S.ranges.length - 1, v: null }; S.mode = "select"; render(); return; }
      if (S.mode === "select") { S.sel.v = null; render(); }
    });
    $$(".tool[data-mode]").forEach(function (b) { b.addEventListener("click", function () { S.mode = b.dataset.mode; if (S.mode !== "draw") cancelDraft(); else if (!S.draft) S.draft = []; render(); }); });
    $("#btn-done").addEventListener("click", function () { if (S.draft && S.draft.length >= 3) { push(); S.ranges.push({ id: S.nid++, type: "poly", pts: S.draft }); S.sel = { r: S.ranges.length - 1, v: null }; S.draft = null; S.mode = "select"; render(); toast("範囲 " + S.ranges.length + " を追加しました", true); } });
    $("#btn-undo").addEventListener("click", function () { if (undo.length) { redo.push(snap()); restore(undo.pop()); render(); } });
    $("#btn-redo").addEventListener("click", function () { if (redo.length) { undo.push(snap()); restore(redo.pop()); render(); } });
    $("#btn-del").addEventListener("click", function () {
      var rg = curRange(); if (!rg || rg.type !== "poly" || S.sel.v == null || rg.pts.length <= 3) return;
      push(); var n = S.sel.v + 1; rg.pts.splice(S.sel.v, 1); S.sel.v = null; render(); toast("頂点 " + n + " を削除しました", true);
    });
    $("#toast button").addEventListener("click", function () { if (undo.length) { redo.push(snap()); restore(undo.pop()); render(); $("#toast").hidden = true; } });
    $("#btn-addrange").addEventListener("click", function () { S.mode = "draw"; S.draft = []; render(); });
    $("#vlist").addEventListener("click", function (e) { var r = e.target.closest(".ln"); if (r && r.dataset.i != null) { S.sel.v = Number(r.dataset.i); render(); } });
    $("#rlist").addEventListener("click", function (e) { var r = e.target.closest(".ln"); if (r) { S.sel = { r: Number(r.dataset.r), v: null }; render(); } });
    $$("#radius-row button").forEach(function (b) { b.addEventListener("click", function () { var rg = curRange(); if (rg && rg.type === "circle") { push(); rg.r = Math.max(1, Math.min(10000, rg.r + Number(b.dataset.d))); render(); } }); });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); (e.shiftKey ? $("#btn-redo") : $("#btn-undo")).click(); }
      if ((e.key === "Delete" || e.key === "Backspace") && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) $("#btn-del").click();
    });
    var place = function () { var r = wrap.getBoundingClientRect(); base.style.width = (1200 / MPP) + "px"; base.style.height = (840 / MPP) + "px"; render(); };
    window.addEventListener("resize", place); place();
    document.addEventListener("stepshown", function () { if (wrap.offsetWidth) place(); });
    window.__map = { state: S, render: render };
  }

  /* ---------- 点検（04・06 共通） ---------- */
  var insp = $("[data-insp]");
  if (insp) {
    var items = $$(".item", insp), total = items.length;
    var update = function () {
      var set = 0, bad = 0, memoMissing = 0;
      items.forEach(function (it) {
        var v = it.dataset.v || "";
        if (v) set++; if (v === "bad") { bad++; var m = $("textarea", it); if (!m || !m.value.trim()) memoMissing++; }
        var stt = $(".stt", it); if (stt) { stt.className = "stt st " + (v === "ok" ? "done" : v === "bad" ? "warn" : "todo"); stt.innerHTML = v === "ok" ? '<svg class="i"><use href="#i-check"/></svg>異常なし' : v === "bad" ? '<svg class="i"><use href="#i-alert"/></svg>異常あり' : "未選択"; }
      });
      $("#m-n").textContent = set + " / " + total; $("#m-bar").style.width = (set / total * 100) + "%";
      var left = total - set; var sub = $("#m-sub");
      sub.textContent = left ? "未選択 " + left + " 項目" + (bad ? "・異常あり " + bad + " 項目" : "") : (bad ? "異常あり " + bad + " 項目" + (memoMissing ? "（内容の記入が必要）" : "") : "全項目に異常なし");
      var sb = $("#btn-submit"); var ok = left === 0 && memoMissing === 0; sb.disabled = !ok;
      $("#submit-note").textContent = ok ? "付けた結果は項目ごとに保存されます。" : (left ? "未選択の項目があります（" + left + "）。" : "異常ありの項目に内容を書いてください。");
      var bulk = $("#btn-bulk"); if (bulk) bulk.disabled = left === 0;
    };
    items.forEach(function (it) {
      $$("input[type=radio]", it).forEach(function (r) { r.addEventListener("change", function () { it.dataset.v = r.value; update(); }); });
      var ta = $("textarea", it); if (ta) ta.addEventListener("input", update);
    });
    var bulkBtn = $("#btn-bulk");
    if (bulkBtn) bulkBtn.addEventListener("click", function () { items.forEach(function (it) { if (!it.dataset.v) { var r = $("input[value=ok]", it); r.checked = true; it.dataset.v = "ok"; } }); update(); });
    items.forEach(function (it) { var c = $("input:checked", it); if (c) it.dataset.v = c.value; });
    update();
  }

  /* ---------- 飛行（05） ---------- */
  var fl = $("[data-flight]");
  if (fl) {
    var setState = function (s) { $$(".statebox", fl).forEach(function (b) { b.hidden = b.dataset.state !== s; }); $$("[data-setstate]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.setstate === s)); }); document.body.dataset.fstate = s; var rl = $(".rail", fl.parentNode); };
    $$("[data-setstate]").forEach(function (b) { b.addEventListener("click", function () { setState(b.dataset.setstate); history.replaceState(null, "", "#" + b.dataset.setstate); }); });
    var h = location.hash.replace("#", ""); setState(["before", "air", "landed"].indexOf(h) >= 0 ? h : "air");
    var t0 = Date.now() - (12 * 60 + 34) * 1000;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var tick = function () { var s = Math.floor((Date.now() - t0) / 1000); var o = $("#elapsed"); if (o) o.textContent = Math.floor(s / 3600) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60); };
    tick(); setInterval(tick, 1000);
  }
})();

/* ---------- v3 追加: 縮むヘッダー・ボトムシート・触覚（対応端末のみ） ---------- */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  /* 縮むヘッダー: 大きなタイトルが画面から出たら、上の帯に小さなタイトルを出す */
  var bar = $(".topbar"), h1 = $(".title h1:not(.sr)") || $(".stepname b");
  if (bar && h1 && "IntersectionObserver" in window) {
    var t = document.createElement("span"); t.className = "ttl"; t.setAttribute("aria-hidden", "true"); t.textContent = h1.textContent; bar.appendChild(t);
    new IntersectionObserver(function (e) { document.body.classList.toggle("scrolled", !e[0].isIntersecting && e[0].boundingClientRect.top < 0); }, { rootMargin: "-56px 0px 0px 0px" }).observe(h1);
  } else if (bar) {
    window.addEventListener("scroll", function () { document.body.classList.toggle("scrolled", window.scrollY > 8); }, { passive: true });
  }
  /* ボトムシート: <dialog class="sheet"> を [data-sheet="id"] で開き、[data-close] か背景で閉じる */
  $$("[data-sheet]").forEach(function (b) { b.addEventListener("click", function (e) { e.preventDefault(); var d = document.getElementById(b.dataset.sheet); if (d && d.showModal) d.showModal(); }); });
  $$("dialog.sheet").forEach(function (d) {
    $$("[data-close]", d).forEach(function (b) { b.addEventListener("click", function () { d.close(); }); });
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
  });
  /* 触覚: 離陸・着陸などの確定操作だけ。Vibration API は非対応の端末（iOS Safari 等）では何も起きない。音・振動に頼らず、画面の変化でも伝える */
  $$("[data-haptic], [data-setstate]").forEach(function (b) { b.addEventListener("click", function () { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} }); });
})();
