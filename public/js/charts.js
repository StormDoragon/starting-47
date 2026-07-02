/* Meridian — dependency-free, DPR-aware canvas charts.
   Every plotted chart ships a hover layer: a crosshair that snaps to the
   nearest data point (line/multi-line) or per-segment hit-testing (donut),
   with the same readout available from the keyboard (Tab + arrow keys). */
(function () {
  'use strict';

  function surfaceColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--surface');
    return (v && v.trim()) || '#151C2B';
  }

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

  function defaultFmt(v) {
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  /** A clean gridline step (1/2/5 × 10ⁿ) for roughly `rows` divisions. */
  function niceStep(range, rows) {
    const raw = range / (rows || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  }

  // ---- Shared tooltip (one fixed-position element, text set via textContent)
  var tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip';
      tipEl.setAttribute('role', 'status');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  /** rows: [{key: cssColor|null, label, value}] — value leads, label follows. */
  function showTip(clientX, clientY, heading, rows) {
    var el = tip();
    el.textContent = '';
    if (heading) {
      var head = document.createElement('div');
      head.className = 'tip-head';
      head.textContent = heading;
      el.appendChild(head);
    }
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'tip-row';
      if (r.key) {
        var key = document.createElement('span');
        key.className = 'tip-key';
        key.style.background = r.key;
        row.appendChild(key);
      }
      var val = document.createElement('span');
      val.className = 'tip-val';
      val.textContent = r.value;
      var lab = document.createElement('span');
      lab.className = 'tip-label';
      lab.textContent = r.label || '';
      row.appendChild(val);
      if (r.label) row.appendChild(lab);
      el.appendChild(row);
    });
    el.style.display = 'block';
    var rect = el.getBoundingClientRect();
    var x = Math.min(clientX + 14, window.innerWidth - rect.width - 8);
    var y = Math.min(clientY + 14, window.innerHeight - rect.height - 8);
    el.style.left = Math.max(4, x) + 'px';
    el.style.top = Math.max(4, y) + 'px';
  }

  function hideTip() {
    if (tipEl) tipEl.style.display = 'none';
  }

  /** Attach pointer + keyboard handlers once per canvas. */
  function bindHover(canvas, handlers) {
    if (canvas.__hoverBound) { canvas.__hoverHandlers = handlers; return; }
    canvas.__hoverBound = true;
    canvas.__hoverHandlers = handlers;
    if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
    if (!canvas.hasAttribute('role')) canvas.setAttribute('role', 'img');

    canvas.addEventListener('pointermove', function (e) {
      canvas.__hoverHandlers.move(e);
    });
    canvas.addEventListener('pointerleave', function () {
      canvas.__hoverHandlers.leave();
    });
    canvas.addEventListener('focus', function () {
      canvas.__hoverHandlers.focus();
    });
    canvas.addEventListener('blur', function () {
      canvas.__hoverHandlers.leave();
    });
    canvas.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        canvas.__hoverHandlers.step(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Escape') {
        canvas.__hoverHandlers.leave();
      }
    });
  }

  /* ---- Line / area chart. points: number[] --------------------------------
     opts: { color, axis, height, fmt, labels } — labels enables the
     crosshair tooltip (one entry per point, e.g. dates). */
  function line(canvas, points, opts) {
    opts = opts || {};
    if (!points || points.length === 0) return;
    const color = opts.color || '#D8B25A';
    const fmt = opts.fmt || defaultFmt;
    const padL = opts.axis ? 52 : 4;
    const padR = 6;
    const padT = 10;
    const padB = opts.axis ? 22 : 6;
    const surface = surfaceColor();

    const vals = points.map(Number);
    const rawMin = Math.min.apply(null, vals);
    const rawMax = Math.max.apply(null, vals);
    const { lo, hi } = niceExtent(rawMin, rawMax);

    function render(hoverIdx) {
      const { ctx, w, h } = setupCanvas(canvas, opts.height);
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const x = (i) => padL + (plotW * i) / (vals.length - 1 || 1);
      const y = (v) => padT + plotH * (1 - (v - lo) / (hi - lo || 1));

      ctx.clearRect(0, 0, w, h);

      // Grid + axis labels (solid hairlines at clean values, recessive)
      if (opts.axis) {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.fillStyle = 'rgba(155,166,182,0.75)';
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.lineWidth = 1;
        const step = niceStep(hi - lo, 4);
        for (let gv = Math.ceil(lo / step) * step; gv <= hi + step * 1e-6; gv += step) {
          const gy = y(gv);
          ctx.beginPath();
          ctx.moveTo(padL, gy);
          ctx.lineTo(w - padR, gy);
          ctx.stroke();
          ctx.fillText(fmt(gv), 6, gy + 3);
        }
        // Sparse x labels from the labels array: first / middle / last.
        if (opts.labels && opts.labels.length === vals.length && vals.length > 2) {
          const picks = [0, Math.floor((vals.length - 1) / 2), vals.length - 1];
          picks.forEach(function (i, k) {
            const t = String(opts.labels[i]);
            ctx.textAlign = k === 0 ? 'left' : k === 1 ? 'center' : 'right';
            ctx.fillText(t, x(i), h - 6);
          });
          ctx.textAlign = 'start';
        }
      }

      // Area wash
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, hexToRgba(color, 0.18));
      grad.addColorStop(1, hexToRgba(color, 0.0));
      ctx.beginPath();
      ctx.moveTo(x(0), y(vals[0]));
      for (let i = 1; i < vals.length; i++) ctx.lineTo(x(i), y(vals[i]));
      ctx.lineTo(x(vals.length - 1), padT + plotH);
      ctx.lineTo(x(0), padT + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line (2px, round joins — no decorative glow)
      ctx.beginPath();
      ctx.moveTo(x(0), y(vals[0]));
      for (let i = 1; i < vals.length; i++) ctx.lineTo(x(i), y(vals[i]));
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // End marker: filled dot with a 2px surface ring.
      function marker(i) {
        const mx = x(i), my = y(vals[i]);
        ctx.beginPath();
        ctx.arc(mx, my, 6, 0, Math.PI * 2);
        ctx.fillStyle = surface;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      marker(vals.length - 1);

      // Crosshair + hovered marker
      if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < vals.length) {
        const hx = x(hoverIdx);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, padT);
        ctx.lineTo(hx, padT + plotH);
        ctx.stroke();
        marker(hoverIdx);
      }
      return { x, y };
    }

    render(null);

    // Hover layer only when the chart is labelled (there's something to say).
    if (opts.labels && opts.labels.length === vals.length) {
      var current = null;
      function idxFromEvent(e) {
        const rect = canvas.getBoundingClientRect();
        const plotW = rect.width - padL - padR;
        const rel = (e.clientX - rect.left - padL) / (plotW || 1);
        return Math.max(0, Math.min(vals.length - 1, Math.round(rel * (vals.length - 1))));
      }
      function showAt(idx, clientX, clientY) {
        current = idx;
        render(idx);
        showTip(clientX, clientY, String(opts.labels[idx]), [
          { key: color, label: opts.seriesName || '', value: fmt(vals[idx]) },
        ]);
      }
      bindHover(canvas, {
        move: function (e) { showAt(idxFromEvent(e), e.clientX, e.clientY); },
        leave: function () { current = null; render(null); hideTip(); },
        focus: function () {
          const rect = canvas.getBoundingClientRect();
          showAt(vals.length - 1, rect.left + rect.width - 40, rect.top + 20);
        },
        step: function (dir) {
          const idx = Math.max(0, Math.min(vals.length - 1, (current == null ? vals.length - 1 : current) + dir));
          const rect = canvas.getBoundingClientRect();
          const cx = rect.left + padL + ((rect.width - padL - padR) * idx) / (vals.length - 1 || 1);
          showAt(idx, cx, rect.top + 20);
        },
      });
    }
  }

  /* ---- Multi-series overlay -----------------------------------------------
     series: [{name, points:number[], color, width}] on a SHARED x axis —
     every series must have the same length (same day axis), so positions
     align honestly. opts: { height, labels, fmt } */
  function multiLine(canvas, series, opts) {
    opts = opts || {};
    if (!series || !series.length) return;
    const fmt = opts.fmt || defaultFmt;
    const padL = 4, padR = 6, padT = 10, padB = 6;
    const n = series[0].points.length;
    let rawMin = Infinity, rawMax = -Infinity;
    series.forEach((s) => s.points.forEach((v) => { rawMin = Math.min(rawMin, v); rawMax = Math.max(rawMax, v); }));
    const { lo, hi } = niceExtent(rawMin, rawMax);

    function render(hoverIdx) {
      const { ctx, w, h } = setupCanvas(canvas, opts.height);
      const plotW = w - padL - padR, plotH = h - padT - padB;
      const x = (i) => padL + (plotW * i) / (n - 1 || 1);
      const y = (v) => padT + plotH * (1 - (v - lo) / (hi - lo || 1));
      ctx.clearRect(0, 0, w, h);
      series.forEach((s) => {
        ctx.beginPath();
        ctx.moveTo(x(0), y(s.points[0]));
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(x(i), y(s.points[i]));
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width || 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      });
      if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
        const hx = x(hoverIdx);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, padT);
        ctx.lineTo(hx, padT + plotH);
        ctx.stroke();
        const surface = surfaceColor();
        series.forEach((s) => {
          const my = y(s.points[hoverIdx]);
          ctx.beginPath(); ctx.arc(hx, my, 5.5, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill();
          ctx.beginPath(); ctx.arc(hx, my, 3.5, 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill();
        });
      }
    }

    render(null);

    if (opts.labels && opts.labels.length === n) {
      var current = null;
      function idxFromEvent(e) {
        const rect = canvas.getBoundingClientRect();
        const plotW = rect.width - padL - padR;
        const rel = (e.clientX - rect.left - padL) / (plotW || 1);
        return Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1))));
      }
      function showAt(idx, cx, cy) {
        current = idx;
        render(idx);
        // One tooltip, every series at this x.
        showTip(cx, cy, String(opts.labels[idx]), series.map(function (s) {
          return { key: s.color, label: s.name || '', value: fmt(s.points[idx]) };
        }));
      }
      bindHover(canvas, {
        move: function (e) { showAt(idxFromEvent(e), e.clientX, e.clientY); },
        leave: function () { current = null; render(null); hideTip(); },
        focus: function () {
          const rect = canvas.getBoundingClientRect();
          showAt(n - 1, rect.left + rect.width - 40, rect.top + 20);
        },
        step: function (dir) {
          const idx = Math.max(0, Math.min(n - 1, (current == null ? n - 1 : current) + dir));
          const rect = canvas.getBoundingClientRect();
          const cx = rect.left + padL + ((rect.width - padL - padR) * idx) / (n - 1 || 1);
          showAt(idx, cx, rect.top + 20);
        },
      });
    }
  }

  /* ---- Compact sparkline (stat-tile trend — no hover layer by design). */
  function spark(canvas, points, color) {
    line(canvas, points, { color: color, axis: false, height: canvas.clientHeight || 46 });
  }

  /* ---- Donut chart. segments: [{value, color, label, valueText}] ----------
     opts: { centerLabel, centerSub, height } */
  function donut(canvas, segments, opts) {
    opts = opts || {};
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    const surface = surfaceColor();

    function geometry() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width || canvas.clientWidth || 180);
      const h = opts.height || rect.height || canvas.clientHeight || 180;
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) / 2 - 8;
      return { w, h, cx, cy, R, r: R * 0.62 };
    }

    function segmentAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const g = geometry();
      const dx = clientX - rect.left - g.cx;
      const dy = clientY - rect.top - g.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Generous hit band: from the inner edge out a little past the ring.
      if (dist < g.r * 0.85 || dist > g.R + 8) return -1;
      let ang = Math.atan2(dy, dx) + Math.PI / 2; // 0 at 12 o'clock
      if (ang < 0) ang += Math.PI * 2;
      let start = 0;
      for (let i = 0; i < segments.length; i++) {
        const sweep = (segments[i].value / total) * Math.PI * 2;
        if (ang >= start && ang < start + sweep) return i;
        start += sweep;
      }
      return segments.length - 1;
    }

    function render(hoverIdx) {
      const { ctx } = setupCanvas(canvas, opts.height || canvas.clientHeight || 180);
      const g = geometry();
      ctx.clearRect(0, 0, g.w, g.h);
      let start = -Math.PI / 2;
      segments.forEach((s, i) => {
        const ang = (s.value / total) * Math.PI * 2;
        const R = i === hoverIdx ? g.R + 4 : g.R; // hovered segment lifts
        ctx.beginPath();
        ctx.moveTo(g.cx, g.cy);
        ctx.arc(g.cx, g.cy, R, start, start + ang);
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.fill();
        start += ang;
      });
      // Punch out the middle
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // 2px surface gaps between segments
      start = -Math.PI / 2;
      segments.forEach((s) => {
        const ang = (s.value / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(g.cx + Math.cos(start) * g.r, g.cy + Math.sin(start) * g.r);
        ctx.lineTo(g.cx + Math.cos(start) * (g.R + 5), g.cy + Math.sin(start) * (g.R + 5));
        ctx.strokeStyle = surface;
        ctx.lineWidth = 2;
        ctx.stroke();
        start += ang;
      });
      if (opts.centerLabel) {
        ctx.fillStyle = '#E7EAF0';
        ctx.textAlign = 'center';
        ctx.font = "600 15px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(opts.centerLabel, g.cx, g.cy + 1);
        if (opts.centerSub) {
          ctx.fillStyle = '#6A7488';
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(opts.centerSub, g.cx, g.cy + 18);
        }
        ctx.textAlign = 'start';
      }
    }

    render(null);

    var current = null;
    bindHover(canvas, {
      move: function (e) {
        const idx = segmentAt(e.clientX, e.clientY);
        if (idx === -1) {
          if (current !== null) { current = null; render(null); hideTip(); }
          return;
        }
        current = idx;
        render(idx);
        const s = segments[idx];
        const pctText = ((s.value / total) * 100).toFixed(1) + '%';
        showTip(e.clientX, e.clientY, s.label || '', [
          { key: s.color, label: pctText, value: s.valueText != null ? s.valueText : String(s.value) },
        ]);
      },
      leave: function () { current = null; render(null); hideTip(); },
      focus: function () {
        if (!segments.length) return;
        current = 0;
        render(0);
        const rect = canvas.getBoundingClientRect();
        const s = segments[0];
        showTip(rect.left + rect.width / 2, rect.top + 10, s.label || '', [
          { key: s.color, label: ((s.value / total) * 100).toFixed(1) + '%', value: s.valueText != null ? s.valueText : String(s.value) },
        ]);
      },
      step: function (dir) {
        if (!segments.length) return;
        current = ((current == null ? 0 : current) + dir + segments.length) % segments.length;
        render(current);
        const rect = canvas.getBoundingClientRect();
        const s = segments[current];
        showTip(rect.left + rect.width / 2, rect.top + 10, s.label || '', [
          { key: s.color, label: ((s.value / total) * 100).toFixed(1) + '%', value: s.valueText != null ? s.valueText : String(s.value) },
        ]);
      },
    });
  }

  window.MeridianCharts = { line, multiLine, spark, donut };
})();
