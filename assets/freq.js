/* One simulated trading day seen at several sampling frequencies.
   Efficient log-price: random walk with a U-shaped intraday volatility.
   Observed price: efficient price + i.i.d. bid-ask noise.
   Grid: 2,340 ten-second observations = 09:30 to 16:00. */
(function () {
  "use strict";
  var fig = document.getElementById("freq");
  var canvas = document.getElementById("freq-canvas");
  if (!fig || !canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var rvOut = document.getElementById("freq-rv");
  var buttons = Array.prototype.slice.call(fig.querySelectorAll("button[data-step]"));
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---- simulate (fixed seed, so every visitor sees the same day) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20140102);
  function gauss() {
    var u = 0, v = 0;
    while (u === 0) u = rand();
    v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  var N = 2340;               // 10-second steps in a 6.5-hour session
  var dailyVol = 0.012;       // 1.2% daily volatility of the efficient price
  var noiseSd = 0.0002;       // bid-ask noise, in log points
  var shape = [], sumShape = 0, i;
  for (i = 0; i < N; i++) {
    var u = i / (N - 1);
    var s = 1 + 1.6 * Math.pow(2 * u - 1, 2);   // U-shape: busy open and close
    shape.push(s); sumShape += s * s;
  }
  var scale = dailyVol / Math.sqrt(sumShape);
  var eff = 0, logp = new Array(N + 1);
  logp[0] = Math.log(100);
  for (i = 0; i < N; i++) {
    eff += scale * shape[i] * gauss();
    logp[i + 1] = Math.log(100) + eff + noiseSd * gauss();
  }

  function realisedVar(step) {
    var rv = 0;
    for (var k = step; k <= N; k += step) {
      var r = logp[k] - logp[k - step];
      rv += r * r;
    }
    return rv * 1e4;          // in %^2
  }

  var lo = Infinity, hi = -Infinity;
  for (i = 0; i <= N; i++) { if (logp[i] < lo) lo = logp[i]; if (logp[i] > hi) hi = logp[i]; }
  var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;

  // ---- drawing ----
  var W = 0, H = 0, dpr = 1;
  var AXIS = 22;              // px reserved for the time axis

  function tokens() {
    var cs = getComputedStyle(document.documentElement);
    return {
      trace: cs.getPropertyValue("--trace").trim() || "#AEB6C3",
      accent: cs.getPropertyValue("--accent").trim() || "#1C4E89",
      muted: cs.getPropertyValue("--muted").trim() || "#5A6475",
      rule: cs.getPropertyValue("--rule").trim() || "#D9DEE6",
      surface: cs.getPropertyValue("--surface").trim() || "#FFFFFF",
      mono: cs.getPropertyValue("--f-mono").trim() || "monospace"
    };
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function x(k) { return (k / N) * (W - 1) + 0.5; }
  function y(v) { return 4 + (1 - (v - lo) / (hi - lo)) * (H - AXIS - 8); }

  function draw(step, progress) {
    var t = tokens();
    ctx.clearRect(0, 0, W, H);

    // time axis: session runs 09:30 (k=0) to 16:00 (k=N); 360 steps per hour
    var base = H - AXIS + 0.5;
    ctx.strokeStyle = t.rule; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(W, base); ctx.stroke();
    ctx.fillStyle = t.muted;
    ctx.font = "11px " + t.mono;
    ctx.textBaseline = "top";
    var hours = W < 520 ? [10, 12, 14, 16] : [10, 11, 12, 13, 14, 15, 16];
    hours.forEach(function (h) {
      var k = (h - 9.5) * 360, xx = x(k);
      ctx.beginPath(); ctx.moveTo(xx, base); ctx.lineTo(xx, base + 4); ctx.stroke();
      var label = (h < 10 ? "0" : "") + h + ":00";
      var w = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(Math.max(xx - w / 2, 0), W - w), base + 7);
    });

    // the full 10-second path, faint
    ctx.strokeStyle = t.trace; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var k = 0; k <= N; k++) { var px = x(k), py = y(logp[k]); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();

    // what an econometrician sampling every `step` observations sees
    var last = Math.floor(N * progress);
    ctx.strokeStyle = t.accent; ctx.lineWidth = step === 1 ? 1.25 : 1.9;
    ctx.lineJoin = "round";
    ctx.beginPath();
    var j;
    for (j = 0; j <= last; j += step) { j ? ctx.lineTo(x(j), y(logp[j])) : ctx.moveTo(x(j), y(logp[j])); }
    ctx.stroke();

    if (N / step <= 80) {
      ctx.fillStyle = t.surface; ctx.strokeStyle = t.accent; ctx.lineWidth = 1.5;
      for (j = 0; j <= last; j += step) {
        ctx.beginPath(); ctx.arc(x(j), y(logp[j]), 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }

  // ---- state + animation ----
  var current = 30, anim = null, cycle = null, userPicked = false;

  function select(step, animate) {
    current = step;
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.step === step)); });
    if (rvOut) rvOut.textContent = realisedVar(step).toFixed(2) + " %²";
    if (anim) cancelAnimationFrame(anim);
    if (!animate || reduce.matches) { draw(step, 1); return; }
    var t0 = null, dur = 900;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      draw(step, 1 - Math.pow(1 - p, 3));
      if (p < 1) anim = requestAnimationFrame(frame);
    }
    anim = requestAnimationFrame(frame);
  }

  function startCycle() {
    if (cycle || userPicked || reduce.matches) return;
    cycle = setInterval(function () {
      if (document.hidden) return;
      var steps = buttons.map(function (b) { return +b.dataset.step; });
      var next = steps[(steps.indexOf(current) + 1) % steps.length];
      select(next, true);
    }, 3400);
  }
  function stopCycle() { if (cycle) { clearInterval(cycle); cycle = null; } }

  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      userPicked = true; stopCycle();
      select(+b.dataset.step, true);
    });
  });

  // redraw on resize and on theme change
  var redraw = function () { resize(); draw(current, 1); };
  if (window.ResizeObserver) new ResizeObserver(redraw).observe(canvas);
  else window.addEventListener("resize", redraw);
  var dark = window.matchMedia("(prefers-color-scheme: dark)");
  if (dark.addEventListener) dark.addEventListener("change", redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (reduce.addEventListener) reduce.addEventListener("change", function () { reduce.matches ? stopCycle() : startCycle(); });

  resize();
  select(current, false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
  startCycle();
})();
