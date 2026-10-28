// bisect.js · 游戏逻辑（经典脚本，无依赖）
(function () {
  "use strict";

  var state = null;
  var el = {};

  function $(id) { return document.getElementById(id); }

  function init(key) {
    var sc = SCENARIOS[key];
    state = {
      key: key,
      n: sc.n,
      culprit: sc.culprit,
      flaky: !!sc.flaky,
      flakyAt: sc.flakyAt || 0,
      flakyHits: 0,
      commits: makeCommits(sc.n),
      lo: 1,
      hi: sc.n,
      sel: null,
      results: {},
      flakyCells: {},
      history: [],
      flakyLog: [],
      steps: 0,
      log: [],
      done: false
    };
    $("reveal").classList.add("hidden");
    renderAll();
  }

  function renderAll() {
    renderMode();
    renderStats();
    renderBar();
    renderGrid();
    renderDetail();
    renderLog();
  }

  function renderMode() {
    var host = $("modebar");
    if (!host) return;
    var sc = SCENARIOS[state.key];
    var html = "<b>" + sc.label + "</b> · " + (sc.desc || "");
    if (state.flaky) {
      html += "<br><span style=\"color:#d29922\">⚠ 本档含 flaky commit：遇到结果不稳定时请 skip，不要据此收窄区间。</span>";
    }
    host.innerHTML = html;
  }

  function renderStats() {
    $("steps").textContent = String(state.steps);
    $("opt").textContent = String(optimalSteps(state.n));
    $("range").textContent = state.lo + "\u2013" + state.hi;
  }

  function segClass(i) {
    var r = state.results[i];
    var cls = "seg";
    if (r === "good") cls += " good";
    else if (r === "bad") cls += " bad";
    else if (state.flakyCells[i]) cls += " flaky";
    else if (i < state.lo || i > state.hi) cls += " out";
    if (i === state.sel) cls += " sel";
    return cls;
  }

  function renderBar() {
    var host = $("bar");
    var html = "";
    for (var i = 1; i <= state.n; i++) {
      html += "<div class=\"" + segClass(i) + "\" data-i=\"" + i + "\"></div>";
    }
    host.innerHTML = html;
    var segs = host.querySelectorAll(".seg");
    for (var k = 0; k < segs.length; k++) {
      segs[k].addEventListener("click", onPick);
    }
  }

  function renderGrid() {
    var host = $("grid");
    host.className = state.n >= 128 ? "grid dense" : "grid";
    var html = "";
    for (var i = 1; i <= state.n; i++) {
      var cls = "cell";
      var r = state.results[i];
      if (r === "good") cls += " good";
      else if (r === "bad") cls += " bad";
      else if (state.flakyCells[i]) cls += " flaky";
      else if (i < state.lo || i > state.hi) cls += " out";
      if (i === state.sel) cls += " sel";
      html += "<div class=\"" + cls + "\" data-i=\"" + i + "\" title=\"" + esc(state.commits[i - 1].msg) + "\">" + i + "</div>";
    }
    host.innerHTML = html;
    var cells = host.querySelectorAll(".cell");
    for (var k = 0; k < cells.length; k++) {
      cells[k].addEventListener("click", onPick);
    }
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function renderDetail() {
    var host = $("detail");
    var btn = $("run");
    if (state.done) {
      host.innerHTML = "<em>已找到凶手，本轮结束。点「重开」再来一次。</em>";
      btn.disabled = true;
      return;
    }
    if (!state.sel) {
      host.innerHTML = "<em>还没选。点上面任意格子。</em>";
      btn.disabled = true;
      return;
    }
    var c = state.commits[state.sel - 1];
    host.innerHTML = [
      "commit " + c.i + " · " + c.sha,
      "author: " + c.author + " · day " + c.day,
      "msg: " + esc(c.msg),
      "范围: " + state.lo + "\u2013" + state.hi
    ].join("<br>");
    btn.disabled = false;
  }

  function renderLog() {
    var host = $("log");
    var html = "";
    for (var i = state.log.length - 1; i >= 0; i--) {
      html += "<li>" + esc(state.log[i]) + "</li>";
    }
    host.innerHTML = html;
  }

  function onPick(ev) {
    if (state.done) return;
    var i = Number(ev.currentTarget.getAttribute("data-i"));
    if (state.results[i] || state.flakyCells[i]) {
      state.log.push("commit " + i + " 已经判过了，重复测不会让区间变小");
      renderLog();
      return;
    }
    state.sel = i;
    renderAll();
  }

  function runTest() {
    if (state.done || !state.sel) return;
    var i = state.sel;
    if (i < state.lo || i > state.hi) {
      state.log.push("第 " + (state.steps + 1) + " 次: commit " + i + " 已在范围外，白跑一次");
      state.steps += 1;
      renderAll();
      return;
    }
    if (state.flaky && i === state.flakyAt) {
      state.flakyHits += 1;
      state.flakyCells[i] = true;
      state.flakyLog.push(i);
      state.log.push("commit " + i + " => 结果不稳定（flaky）。不计步、不计入区间 → 换个点再测，这就是 skip");
      state.sel = null;
      renderAll();
      return;
    }
    var verdict;
    {
      verdict = i >= state.culprit ? "bad" : "good";
      state.log.push("第 " + (state.steps + 1) + " 次: commit " + i + " => " + (verdict === "bad" ? "BAD（复现）" : "GOOD"));
    }
    state.steps += 1;
    state.results[i] = verdict;
    if (verdict === "bad") state.hi = Math.min(state.hi, i);
    else state.lo = Math.max(state.lo, i + 1);
    state.history.push({ i: i, verdict: verdict, lo: state.lo, hi: state.hi });
    state.sel = null;
    if (state.lo >= state.hi) { state.done = true; state.sel = state.lo; state.results[state.lo] = "bad"; reveal(); }
    renderAll();
  }

  function reveal() {
    var opt = optimalSteps(state.n);
    var card = $("card");
    card.innerHTML = [
      "凶手是 commit <b>" + state.lo + "</b>（" + shasum(state.lo) + "）",
      "<br>你用了 <b>" + state.steps + "</b> 次测试；最优下界 <b>" + opt + "</b> 次。",
      "<br>" + (state.steps <= opt ? "达标 —— 你踩在下界上。" : "多了 " + (state.steps - opt) + " 次：不是错，是慢。"),
      "<br><span style=\"color:#8b949e\">截图这句就够：你用 " + state.steps + " 次找到 " + state.n + " 个 commit 里的凶手；最优 " + opt + " 次。</span>"
    ].join("");
    var line = "BISECT · " + state.n + " 个 commit / 我用 " + state.steps + " 次找到凶手 / 最优 " + opt + " 次";
    $("cardtext").textContent = line;
    var btn = $("copy");
    if (btn) {
      btn.onclick = function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(line).then(function () { btn.textContent = "已复制"; }, function () { btn.textContent = "复制失败，请手选"; });
        } else { btn.textContent = "此浏览器不支持自动复制"; }
      };
    }
    $("path").innerHTML = buildCompare();
    $("reveal").classList.remove("hidden");
  }

  function optimalTrace() {
    var lo = 1, hi = state.n, out = [], step = 0;
    while (lo < hi) {
      step += 1;
      var mid = Math.floor((lo + hi) / 2);
      var bad = mid >= state.culprit;
      if (bad) hi = mid; else lo = mid + 1;
      out.push({ i: mid, verdict: bad ? "bad" : "good", lo: lo, hi: hi });
    }
    return out;
  }

  function vLabel(v) {
    if (v === "bad") return "BAD";
    if (v === "good") return "GOOD";
    return "flaky·skip";
  }

  function buildCompare() {
    var mine = state.history || [];
    var best = optimalTrace();
    var rows = Math.max(mine.length, best.length);
    var html = "<table class=\"cmp\"><thead><tr><th>#</th><th>你的路径</th><th>最优路径</th></tr></thead><tbody>";
    var lagAt = -1;
    for (var r = 0; r < rows; r++) {
      var m = mine[r], b = best[r];
      var mRem = m ? (m.hi - m.lo + 1) : null;
      var bRem = b ? (b.hi - b.lo + 1) : null;
      var cls = "";
      if (mRem !== null && bRem !== null && mRem > bRem && lagAt < 0) { lagAt = r + 1; cls = " class=\"lag\""; }
      html += "<tr" + cls + "><td>" + (r + 1) + "</td>";
      html += "<td>" + (m ? ("test " + m.i + " → " + vLabel(m.verdict) + " · 剩 " + mRem) : "—") + "</td>";
      html += "<td>" + (b ? ("test " + b.i + " → " + vLabel(b.verdict) + " · 剩 " + bRem) : "—") + "</td>";
      html += "</tr>";
    }
    html += "</tbody></table>";
    if (lagAt > 0) {
      html += "<p class=\"cmpline\">你在<b>第 " + lagAt + " 步</b>开始落后（剩余候选比最优多）。二分是紧的，落后之后追不回来。</p>";
    } else {
      html += "<p class=\"cmpline ok\">全程踩着最优下界，没有一步浪费。</p>";
    }
    if (state.flakyLog && state.flakyLog.length) {
      html += "<p class=\"cmpline\">flaky 点：" + state.flakyLog.join("、") + "（已 skip，不计步）</p>";
    }
    return html;
  }

  function buildPath(opt) {
    var lines = [];
    lines.push("你的路径（" + state.steps + " 步）");
    for (var i = 0; i < state.log.length; i++) lines.push("  " + state.log[i]);
    lines.push("");
    lines.push("最优路径（" + opt + " 步，二分）");
    var lo = 1, hi = state.n, step = 0;
    while (lo < hi) {
      step += 1;
      var mid = Math.floor((lo + hi) / 2);
      var bad = mid >= state.culprit;
      lines.push("  " + step + ". test " + mid + " => " + (bad ? "BAD" : "GOOD") + "  [" + lo + "-" + hi + "]");
      if (bad) hi = mid; else lo = mid + 1;
    }
    lines.push("  => commit " + lo + " 是凶手");
    return lines.join("\n");
  }

  function bind() {
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (ev) {
        var t = ev.currentTarget;
        for (var k = 0; k < tabs.length; k++) tabs[k].classList.remove("active");
        t.classList.add("active");
        init(t.getAttribute("data-key"));
      });
    }
    $("run").addEventListener("click", runTest);
    $("reset").addEventListener("click", function () { init(state.key); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") runTest();
    });
  }

  // ---- v0.2：外部可驱动接口 + autoplay + 版本指纹 ----
  window.BISECT = {
    state: function () { return state; },
    reset: function (key) { init(key || "64"); },
    pick: function (i) {
      var n = Number(i);
      if (state.done) return false;
      if (!isFinite(n) || n < 1 || n > state.n) return false;   // step-5: 越界 guard
      if (state.results[n] || state.flakyCells[n]) return false; // 已判过
      state.sel = n; renderAll(); return true;
    },
    test: function () { runTest(); },
    push: function (ev) {
      if (!ev || !ev.type) return false;
      if (ev.type === "pick") { window.BISECT.pick(ev.index); return true; }
      if (ev.type === "test") { runTest(); return true; }
      if (ev.type === "reset") { init(ev.key || "64"); return true; }
      return false;
    }
  };

  function nextMid() {
    if (state.done) return null;
    var mid = Math.floor((state.lo + state.hi) / 2);
    if (!state.flakyCells[mid] && !state.results[mid]) return mid;
    // 标准二分点刚好是 flaky 或已判过 → 在区间内另找一个未判过的点
    for (var d = 1; d <= state.n; d++) {
      var up = mid + d, dn = mid - d;
      if (up <= state.hi && !state.flakyCells[up] && !state.results[up]) return up;
      if (dn >= state.lo && !state.flakyCells[dn] && !state.results[dn]) return dn;
    }
    return null;
  }

  function startAutoplay() {
    if (state.done) return;
    var mid = nextMid();
    if (mid === null) { document.title = "STUCK"; return; }
    var before = state.steps;
    state.sel = mid;
    renderAll();
    setTimeout(function () {
      runTest();
      if (state.done) {
        document.title = "DONE " + state.steps + "/" + optimalSteps(state.n);
        return;
      }
      if (state.steps === before) { state.flakyCells[mid] = true; }
      startAutoplay();
    }, 620);
  }

  function loadVersion() {
    var el = document.getElementById("ver");
    if (!el) return;
    fetch("./version.txt", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (t) {
        var v = (t || "").trim().split("\n")[0];
        el.textContent = v ? v : "version.txt 未找到";
      })
      .catch(function () { el.textContent = "版本读取失败"; });
  }

  bind();
  init("64");
  loadVersion();
  if (new URLSearchParams(location.search).get("autoplay") === "1") {
    setTimeout(startAutoplay, 300);
  }
})();