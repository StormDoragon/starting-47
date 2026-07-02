/* Meridian — site-wide behaviour (CSP-safe, no inline scripts). */
(function () {
  'use strict';

  // ---- Mobile nav toggle --------------------------------------------------
  var toggle = document.querySelector('[data-nav-toggle]');
  var links = document.querySelector('[data-nav-links]');
  if (toggle && links) {
    toggle.addEventListener('click', function () { links.classList.toggle('open'); });
  }

  // ---- Static charts from embedded JSON ----------------------------------
  function readJSON(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function renderStaticCharts() {
    if (!window.MeridianCharts) return;
    document.querySelectorAll('[data-render]').forEach(function (canvas) {
      var kind = canvas.getAttribute('data-render');
      var data = readJSON(canvas.getAttribute('data-src'));
      if (!data) return;
      if (kind === 'line') {
        window.MeridianCharts.line(canvas, data.points, {
          color: data.color || data.accent, axis: !!data.axis, height: canvas.clientHeight,
        });
      } else if (kind === 'spark') {
        window.MeridianCharts.spark(canvas, data.points, data.color || data.accent);
      } else if (kind === 'donut') {
        window.MeridianCharts.donut(canvas, data.segments, {
          centerLabel: data.centerLabel, centerSub: data.centerSub,
        });
      }
    });
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderStaticCharts, 150);
  });
  renderStaticCharts();

  // ---- Live marketing ticker ---------------------------------------------
  var tickerTrack = document.querySelector('[data-ticker]');
  if (tickerTrack) {
    var render = function (rates) {
      var html = rates.map(function (r) {
        var cls = r.up ? 'text-up' : 'text-down';
        var arrow = r.up ? '▲' : '▼';
        return '<span class="tk"><span class="sym">' + r.sym + '</span>' +
          '<span class="px">' + r.price + '</span>' +
          '<span class="chg ' + cls + '">' + arrow + ' ' + r.changePct + '%</span></span>';
      }).join('');
      // Duplicate the set so the marquee loops seamlessly.
      tickerTrack.innerHTML = html + html;
    };
    var poll = function () {
      fetch('/api/ticker', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.rates) render(d.rates); })
        .catch(function () {});
    };
    poll();
    setInterval(poll, 4000);
  }

  // ---- File-name mirroring (mock ID upload: no real file leaves the browser)
  document.querySelectorAll('input[type=file][data-name-target]').forEach(function (input) {
    input.addEventListener('change', function () {
      var target = document.getElementById(input.getAttribute('data-name-target'));
      var label = input.parentNode.querySelector('[data-file-label]');
      var name = input.files && input.files[0] ? input.files[0].name : '';
      if (target) target.value = name;
      if (label && name) label.textContent = name;
    });
  });

  // ---- Deposit allocation live total -------------------------------------
  var depositForm = document.querySelector('[data-deposit-form]');
  if (depositForm) {
    var totalEl = depositForm.querySelector('[data-alloc-total]');
    var minCents = parseInt(depositForm.getAttribute('data-min-cents'), 10) || 0;
    var noteEl = depositForm.querySelector('[data-alloc-note]');
    var amountInputs = depositForm.querySelectorAll('[data-alloc-input]');
    var recalc = function () {
      var sum = 0;
      amountInputs.forEach(function (i) {
        var val = parseFloat((i.value || '').replace(/[^0-9.]/g, ''));
        if (!isNaN(val)) sum += val;
      });
      if (totalEl) totalEl.textContent = sum.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      var ok = sum * 100 >= minCents;
      if (noteEl) {
        noteEl.textContent = ok
          ? 'Meets the minimum deposit.'
          : 'Minimum total is ' + (minCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) + '.';
        noteEl.className = ok ? 'small text-up' : 'small text-down';
      }
    };
    amountInputs.forEach(function (i) { i.addEventListener('input', recalc); });
    var splitBtn = depositForm.querySelector('[data-split-even]');
    if (splitBtn) {
      splitBtn.addEventListener('click', function () {
        var each = (minCents / 100 / amountInputs.length);
        // Round up to a clean dollar so the total clears the minimum.
        each = Math.ceil(each);
        amountInputs.forEach(function (i) { i.value = each.toFixed(2); });
        recalc();
      });
    }
    recalc();
  }

  // ---- Confirm-before-submit (early withdrawal, 2FA disable) -------------
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // ---- Countdown ticker on hero cards (optional) -------------------------
  document.querySelectorAll('[data-countup]').forEach(function (el) {
    var target = parseFloat(el.getAttribute('data-countup'));
    if (isNaN(target)) return;
    var dur = 1100, start = performance.now();
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    function frame(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = prefix + (target * eased).toLocaleString('en-US', { maximumFractionDigits: 0 }) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
})();
