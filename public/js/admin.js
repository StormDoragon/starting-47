/* Meridian — admin overview live layer. Renders the platform AUM curve and the
   capital-by-pool donut from embedded JSON, then polls /admin/api/overview to
   keep the headline figures and charts current. All values originate from the
   server's stored performance-tick series. CSP-safe: no inline scripts. */
(function () {
  'use strict';

  if (!window.MeridianCharts) return;
  var initEl = document.getElementById('admin-init');
  if (!initEl) return;
  var seed = {};
  try { seed = JSON.parse(initEl.textContent); } catch (e) { seed = {}; }

  var aumCanvas = document.querySelector('[data-admin-aum]');
  var donutCanvas = document.querySelector('[data-admin-donut]');
  var legendEl = document.querySelector('[data-admin-legend]');

  var usd = function (cents) {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  };
  var usd0 = function (cents) {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  };
  var pct = function (frac) {
    return (frac > 0 ? '+' : '') + (frac * 100).toFixed(2) + '%';
  };

  var last = {};
  var lastState = { aumSeries: seed.aumSeries || [], poolBreakdown: seed.poolBreakdown || [] };

  function flash(el, oldVal, newVal) {
    if (oldVal === undefined || oldVal === newVal) return;
    el.classList.remove('up', 'down');
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

  function drawCharts() {
    if (aumCanvas && lastState.aumSeries && lastState.aumSeries.length) {
      window.MeridianCharts.line(
        aumCanvas,
        lastState.aumSeries.map(function (p) { return p.valueCents / 100; }),
        {
          color: '#D8B25A', axis: true, height: aumCanvas.clientHeight || 280,
          labels: lastState.aumSeries.map(function (p) { return p.day; }),
          seriesName: 'AUM',
          fmt: function (v) { return '$' + Math.round(v).toLocaleString('en-US'); },
        }
      );
    }
    var pools = (lastState.poolBreakdown || []).filter(function (p) { return p.valueCents > 0; });
    if (donutCanvas && pools.length) {
      var total = pools.reduce(function (a, p) { return a + p.valueCents; }, 0);
      window.MeridianCharts.donut(
        donutCanvas,
        pools.map(function (p) {
          return { value: p.valueCents, color: p.accent, label: p.name, valueText: usd0(p.valueCents) };
        }),
        { centerLabel: usd0(total), centerSub: 'AUM', height: donutCanvas.clientHeight || 170 }
      );
    }
    if (legendEl && pools.length) {
      legendEl.textContent = '';
      pools.forEach(function (p) {
        var row = document.createElement('div');
        row.className = 'flex justify-between items-center legend-row';
        var item = document.createElement('span');
        item.className = 'legend-item';
        var swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = p.accent;
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(p.name));
        var val = document.createElement('span');
        val.className = 'mono small';
        val.textContent = usd0(p.valueCents);
        row.appendChild(item);
        row.appendChild(val);
        legendEl.appendChild(row);
      });
    }
  }

  function render(data) {
    if (data.aumSeries) lastState.aumSeries = data.aumSeries;
    if (data.poolBreakdown) lastState.poolBreakdown = data.poolBreakdown;

    setLive('aum', usd(data.aumCents), data.aumCents);
    setLive('gain', (data.gainCents >= 0 ? '+' : '') + usd(data.gainCents));
    setLive('gainPct', pct(data.gainPct));
    setLive('cash', usd(data.cashTotalCents), data.cashTotalCents);
    setLive('positions', String(data.activePositions));

    document.querySelectorAll('[data-live="gain"],[data-live="gainPct"]').forEach(function (el) {
      el.classList.toggle('text-up', data.gainCents >= 0);
      el.classList.toggle('text-down', data.gainCents < 0);
    });

    drawCharts();
  }

  function poll() {
    fetch('/admin/api/overview', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) render(d); })
      .catch(function () {});
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawCharts, 150);
  });

  drawCharts();
  poll();
  setInterval(poll, 6000);
})();
