/* Meridian — live investor dashboard. Polls /api/portfolio and updates the
   KPIs, allocation donut, combined performance chart and per-pool sparklines.
   All values originate from the stored performance-tick series on the server. */
(function () {
  'use strict';

  var initEl = document.getElementById('dash-init');
  if (!initEl || !window.MeridianCharts) return;
  var cfg = {};
  try { cfg = JSON.parse(initEl.textContent); } catch (e) { cfg = {}; }
  var interval = Math.max(2000, cfg.tickIntervalMs || 5000);

  var usd = function (cents) {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  };
  var pct = function (frac) {
    return (frac > 0 ? '+' : '') + (frac * 100).toFixed(2) + '%';
  };

  var combinedCanvas = document.querySelector('[data-dash-combined]');
  var donutCanvas = document.querySelector('[data-dash-donut]');
  var legendEl = document.querySelector('[data-dash-legend]');

  var last = {};        // remember last value per key to animate direction
  var lastData = null;  // last payload, for redraw on resize

  function flash(el, oldVal, newVal) {
    if (oldVal === undefined || oldVal === newVal) return;
    el.classList.remove('up', 'down');
    // Force reflow so the animation re-triggers.
    void el.offsetWidth;
    el.classList.add(newVal > oldVal ? 'up' : 'down');
    setTimeout(function () { el.classList.remove('up', 'down'); }, 600);
  }

  function setLive(key, text, numeric) {
    document.querySelectorAll('[data-live="' + key + '"]').forEach(function (el) {
      el.textContent = text;
      if (typeof numeric === 'number') flash(el, last[key], numeric);
    });
    if (typeof numeric === 'number') last[key] = numeric;
  }

  function render(data) {
    lastData = data;

    // KPIs
    setLive('totalValue', usd(data.totalValueCents), data.totalValueCents);
    setLive('totalGain', (data.totalGainCents >= 0 ? '+' : '') + usd(data.totalGainCents));
    setLive('totalGainPct', pct(data.totalGainPct));

    // Colour the gain figures
    document.querySelectorAll('[data-live="totalGain"],[data-live="totalGainPct"]').forEach(function (el) {
      el.classList.toggle('text-up', data.totalGainCents >= 0);
      el.classList.toggle('text-down', data.totalGainCents < 0);
    });

    // Combined performance line
    if (combinedCanvas && data.combined && data.combined.length) {
      window.MeridianCharts.line(
        combinedCanvas,
        data.combined.map(function (p) { return p.valueCents / 100; }),
        { color: '#D8B25A', axis: true, height: combinedCanvas.clientHeight || 280,
          fmt: function (v) { return '$' + Math.round(v).toLocaleString('en-US'); } }
      );
    }

    // Allocation donut
    if (donutCanvas && data.allocation && data.allocation.length) {
      window.MeridianCharts.donut(
        donutCanvas,
        data.allocation.map(function (a) { return { value: a.valueCents, color: a.accent }; }),
        { centerLabel: usd(data.totalValueCents), centerSub: 'total', height: donutCanvas.clientHeight || 170 }
      );
    }

    // Allocation legend weights
    if (legendEl && data.allocation) {
      legendEl.innerHTML = data.allocation.map(function (a) {
        return '<div class="flex justify-between items-center" style="padding:6px 0;border-bottom:1px solid var(--line)">' +
          '<span class="legend-item"><span class="swatch" style="background:' + a.accent + '"></span>' + a.name + '</span>' +
          '<span class="mono small">' + (a.weight * 100).toFixed(1) + '%</span></div>';
      }).join('');
    }

    // Per-pool sparklines + values
    (data.perPool || []).forEach(function (pool) {
      var canvas = document.querySelector('[data-dash-pool="' + pool.poolId + '"]');
      if (canvas && pool.series && pool.series.length) {
        window.MeridianCharts.spark(canvas, pool.series.map(function (p) { return p.valueCents / 100; }), pool.accent);
      }
      var latest = pool.series && pool.series.length ? pool.series[pool.series.length - 1].valueCents : null;
      if (latest != null) {
        document.querySelectorAll('[data-live-pool-value="' + pool.poolId + '"]').forEach(function (el) {
          var prev = last['pool:' + pool.poolId];
          el.textContent = usd(latest);
          el.classList.add('value-flash');
          flash(el, prev, latest);
          last['pool:' + pool.poolId] = latest;
        });
      }
    });
  }

  function poll() {
    fetch('/api/portfolio', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) render(d); })
      .catch(function () {});
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (lastData) render(lastData); }, 150);
  });

  poll();
  setInterval(poll, interval);
})();
