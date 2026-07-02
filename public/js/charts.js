/* Meridian — dependency-free, DPR-aware canvas charts. */
(function () {
  'use strict';

  function setupCanvas(canvas, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width || canvas.clientWidth || 300);
    const h = cssHeight || rect.height || canvas.clientHeight || 160;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function hexToRgba(hex, a) {
    const m = hex.replace('#', '');
    const n = parseInt(m.length === 3 ? m.replace(/(.)/g, '$1$1') : m, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  function niceExtent(min, max) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.12;
    return { lo: min - pad, hi: max + pad };
  }

  /* Line / area chart. points: number[] */
  function line(canvas, points, opts) {
    opts = opts || {};
    if (!points || points.length === 0) return;
    const color = opts.color || '#D8B25A';
    const padL = opts.axis ? 52 : 4;
    const padR = 6;
    const padT = 10;
    const padB = opts.axis ? 22 : 6;
    const { ctx, w, h } = setupCanvas(canvas, opts.height);

    const vals = points.map(Number);
    const rawMin = Math.min.apply(null, vals);
    const rawMax = Math.max.apply(null, vals);
    const { lo, hi } = niceExtent(rawMin, rawMax);
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const x = (i) => padL + (plotW * i) / (vals.length - 1 || 1);
    const y = (v) => padT + plotH * (1 - (v - lo) / (hi - lo || 1));

    ctx.clearRect(0, 0, w, h);

    // Grid + axis labels
    if (opts.axis) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.fillStyle = 'rgba(155,166,182,0.75)';
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.lineWidth = 1;
      const rows = 4;
      for (let r = 0; r <= rows; r++) {
        const gv = lo + ((hi - lo) * r) / rows;
        const gy = y(gv);
        ctx.beginPath();
        ctx.moveTo(padL, gy);
        ctx.lineTo(w - padR, gy);
        ctx.stroke();
        const label = opts.fmt ? opts.fmt(gv) : Math.round(gv).toString();
        ctx.fillText(label, 6, gy + 3);
      }
    }

    // Area fill
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexToRgba(color, 0.28));
    grad.addColorStop(1, hexToRgba(color, 0.0));
    ctx.beginPath();
    ctx.moveTo(x(0), y(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(x(i), y(vals[i]));
    ctx.lineTo(x(vals.length - 1), padT + plotH);
    ctx.lineTo(x(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(x(0), y(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(x(i), y(vals[i]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.shadowColor = hexToRgba(color, 0.5);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // End marker
    const lx = x(vals.length - 1), ly = y(vals[vals.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(color, 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /* Multi-series overlay. series: [{points:number[], color}] normalised to a shared scale. */
  function multiLine(canvas, series, opts) {
    opts = opts || {};
    if (!series || !series.length) return;
    const padL = 4, padR = 6, padT = 10, padB = 6;
    const { ctx, w, h } = setupCanvas(canvas, opts.height);
    let rawMin = Infinity, rawMax = -Infinity;
    series.forEach((s) => s.points.forEach((v) => { rawMin = Math.min(rawMin, v); rawMax = Math.max(rawMax, v); }));
    const { lo, hi } = niceExtent(rawMin, rawMax);
    const plotW = w - padL - padR, plotH = h - padT - padB;
    ctx.clearRect(0, 0, w, h);
    series.forEach((s) => {
      const n = s.points.length;
      const x = (i) => padL + (plotW * i) / (n - 1 || 1);
      const y = (v) => padT + plotH * (1 - (v - lo) / (hi - lo || 1));
      ctx.beginPath();
      ctx.moveTo(x(0), y(s.points[0]));
      for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(s.points[i]));
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
  }

  /* Compact sparkline. */
  function spark(canvas, points, color) {
    line(canvas, points, { color: color, axis: false, height: canvas.clientHeight || 46 });
  }

  /* Donut chart. segments: [{value, color}] */
  function donut(canvas, segments, opts) {
    opts = opts || {};
    const { ctx, w, h } = setupCanvas(canvas, opts.height || canvas.clientHeight || 180);
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - 6;
    const r = R * 0.62;
    ctx.clearRect(0, 0, w, h);
    let start = -Math.PI / 2;
    segments.forEach((s) => {
      const ang = (s.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, start, start + ang);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      start += ang;
    });
    // Punch out the middle
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // Separators
    start = -Math.PI / 2;
    segments.forEach((s) => {
      const ang = (s.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(start) * r, cy + Math.sin(start) * r);
      ctx.lineTo(cx + Math.cos(start) * R, cy + Math.sin(start) * R);
      ctx.strokeStyle = 'rgba(10,13,20,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      start += ang;
    });
    if (opts.centerLabel) {
      ctx.fillStyle = '#E7EAF0';
      ctx.textAlign = 'center';
      ctx.font = "600 15px 'Iowan Old Style', Georgia, serif";
      ctx.fillText(opts.centerLabel, cx, cy + 1);
      if (opts.centerSub) {
        ctx.fillStyle = '#6A7488';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(opts.centerSub, cx, cy + 18);
      }
      ctx.textAlign = 'start';
    }
  }

  window.MeridianCharts = { line, multiLine, spark, donut };
})();
