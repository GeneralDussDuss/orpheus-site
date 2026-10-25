/* ORPHEUS site — house interactions.
   Nav state, scroll progress, hero entrance, reveal, tilt, magnetic buttons,
   cursor glow, counters, title scramble and the Ctrl+K palette. */

(function () {
  'use strict';
  /* ?still=1 is this site's capture mode: it freezes the shader so a headless
     screenshot can resolve, and it has to show finished content too -- an
     IntersectionObserver never fires during a screenshot run, which left every
     revealed section black. Capture mode therefore implies calm. */
  var still = /[?&]still/.test(location.search);
  if (still) document.documentElement.className += ' is-capture';
  var calm = still || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---- nav + scroll progress ---- */
  var nav = $('.nav'), prog = $('.prog');
  function onScroll() {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
    if (prog) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      prog.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---- hero title, letter by letter ---- */
  var title = $('[data-letters]');
  if (title) {
    var txt = title.textContent.trim();
    title.textContent = '';
    txt.split('').forEach(function (ch, i) {
      var s = document.createElement('span');
      s.textContent = ch === ' ' ? ' ' : ch;
      s.style.setProperty('--d', (0.25 + i * 0.045) + 's');
      title.appendChild(s);
    });
    if (!calm) setTimeout(function () { title.classList.add('glitching'); }, 2500);
  }

  /* ---- typed tagline ---- */
  var typed = $('[data-type]');
  if (typed) {
    var full = typed.getAttribute('data-type');
    if (calm) { typed.textContent = full; }
    else {
      var i = 0;
      typed.innerHTML = '<span class="cur">_</span>';
      setTimeout(function tick() {
        i++;
        typed.innerHTML = full.slice(0, i) + '<span class="cur">_</span>';
        if (i < full.length) setTimeout(tick, 34);
        else setTimeout(function () { var c = $('.cur', typed); if (c) c.style.display = 'none'; }, 2200);
      }, 900);
    }
  }

  /* ---- rotating status line ---- */
  var rot = $('[data-rot]');
  if (rot && !calm) {
    var lines = [];
    try { lines = JSON.parse(rot.getAttribute('data-rot')); } catch (e) { lines = []; }
    if (lines.length) {
      var ri = 0;
      rot.textContent = lines[0];
      setInterval(function () {
        rot.style.opacity = '0';
        setTimeout(function () {
          ri = (ri + 1) % lines.length;
          rot.textContent = lines[ri];
          rot.style.opacity = '1';
        }, 400);
      }, 3200);
    }
  }

  /* ---- reveal ---- */
  var reveals = $$('.reveal');
  if (reveals.length) {
    if (calm || !('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('visible'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var st = parseInt(e.target.getAttribute('data-stagger') || '0', 10);
          if (st) {
            $$(':scope > *', e.target).forEach(function (kid, k) {
              kid.style.transitionDelay = (k * st) + 'ms';
            });
          }
          e.target.classList.add('visible');
          io.unobserve(e.target);
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
      reveals.forEach(function (el) { io.observe(el); });
    }
  }

  /* ---- counters ---- */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    var dur = 1500, start = null;
    function step(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - t, 3);
      var v = target * e;
      el.textContent = (target >= 1000 ? Math.floor(v).toLocaleString() : (target % 1 ? v.toFixed(2) : Math.floor(v))) + suffix;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counters = $$('[data-count]');
  if (counters.length) {
    if (calm || !('IntersectionObserver' in window)) {
      counters.forEach(function (el) {
        el.textContent = parseFloat(el.getAttribute('data-count')).toLocaleString() + (el.getAttribute('data-suffix') || '');
      });
    } else {
      var cio = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); cio.unobserve(e.target); } });
      }, { threshold: 0.4 });
      counters.forEach(function (el) { el.textContent = '0'; cio.observe(el); });
    }
  }

  /* ---- scramble section titles once ---- */
  if (!calm && 'IntersectionObserver' in window) {
    var CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*';
    var sio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target, real = el.textContent, n = real.length, f = 0;
        var iv = setInterval(function () {
          f++;
          el.textContent = real.split('').map(function (c, k) {
            if (c === ' ') return ' ';
            return k < f * 1.6 ? c : CH[(Math.random() * CH.length) | 0];
          }).join('');
          if (f * 1.6 >= n) { clearInterval(iv); el.textContent = real; }
        }, 30);
        sio.unobserve(el);
      });
    }, { threshold: 0.6 });
    $$('[data-scramble]').forEach(function (el) { sio.observe(el); });
  }

  /* ---- 3D tilt ---- */
  if (!calm && window.matchMedia('(hover: hover)').matches) {
    $$('[data-tilt]').forEach(function (el) {
      var amt = parseFloat(el.getAttribute('data-tilt')) || 6;
      el.addEventListener('mousemove', function (ev) {
        var r = el.getBoundingClientRect();
        var x = (ev.clientX - r.left) / r.width - 0.5;
        var y = (ev.clientY - r.top) / r.height - 0.5;
        el.style.transform = 'perspective(800px) rotateX(' + (-y * amt) + 'deg) rotateY(' + (x * amt) + 'deg) translateY(-4px)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    });

    /* magnetic buttons */
    $$('.btn').forEach(function (b) {
      b.addEventListener('mousemove', function (ev) {
        var r = b.getBoundingClientRect();
        b.style.transform = 'translate(' + ((ev.clientX - r.left - r.width / 2) * 0.12) + 'px,' +
          ((ev.clientY - r.top - r.height / 2) * 0.12 - 2) + 'px) scale(1.03)';
      });
      b.addEventListener('mouseleave', function () { b.style.transform = ''; });
    });

    /* cursor glow */
    var cgEl = document.createElement('div');
    cgEl.className = 'cursor-glow';
    document.body.appendChild(cgEl);
    var cx = 0, cy = 0, tx = 0, ty = 0;
    window.addEventListener('mousemove', function (e) { tx = e.clientX; ty = e.clientY; });
    var cgStill = /[?&]still/.test(location.search), cgN = 0;
    (function loop() {
      if (cgStill && cgN++ > 150) return;
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
      cgEl.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
      requestAnimationFrame(loop);
    })();
  }

  /* ---- command palette ---- */
  var pal = $('.pal');
  if (pal) {
    var input = $('input', pal), list = $('.pal-list', pal);
    var items = $$('li', list), sel = 0;
    function paint() {
      var vis = items.filter(function (li) { return li.style.display !== 'none'; });
      items.forEach(function (li) { li.classList.remove('sel'); });
      if (vis[sel]) vis[sel].classList.add('sel');
    }
    function open() { pal.classList.add('on'); input.value = ''; items.forEach(function (li) { li.style.display = ''; }); sel = 0; paint(); setTimeout(function () { input.focus(); }, 20); }
    function close() { pal.classList.remove('on'); }
    $$('.nav-k').forEach(function (b) { b.addEventListener('click', open); });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.classList.contains('on') ? close() : open(); return; }
      if (!pal.classList.contains('on')) {
        // bare digits jump between pages, as the palette advertises
        var el = e.target;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        var hit = items.filter(function (li) { return li.getAttribute('data-key') === e.key; })[0];
        if (hit) { e.preventDefault(); window.location.href = $('a', hit).getAttribute('href'); }
        return;
      }
      var vis = items.filter(function (li) { return li.style.display !== 'none'; });
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, vis.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
      else if (e.key === 'Enter' && vis[sel]) { e.preventDefault(); window.location.href = $('a', vis[sel]).getAttribute('href'); }
    });
    input.addEventListener('input', function () {
      var q = input.value.toLowerCase();
      items.forEach(function (li) { li.style.display = li.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none'; });
      sel = 0; paint();
    });
    pal.addEventListener('click', function (e) { if (e.target === pal) close(); });
  }
})();

/* ---- device profile, star count, copy buttons -------------------------- */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* The <html> classes are set by an inline script in <head> so the first
     paint is already correct. This fills in what needs the engine's own
     verdict, which only exists once engine.js has run. */
  var T = window.OrpheusEngine && window.OrpheusEngine.TIER;
  if (T) {
    document.documentElement.setAttribute('data-tier', T.name);
    var read = $('[data-tier-readout]');
    if (read) {
      read.textContent = (T.phone ? 'PHONE' : T.tablet ? 'TABLET' : 'DESKTOP') +
        ' · ' + T.name.toUpperCase() + ' · ' + T.cores + ' CORES' +
        (T.thrifty ? ' · DATA SAVER' : '');
    }
  }

  /* ---- live star count --------------------------------------------------
     No key, no build step: the public API allows unauthenticated reads. If it
     rate-limits or fails, the button keeps its static label and nobody
     notices. */
  var repo = document.documentElement.getAttribute('data-repo');
  var outs = $$('[data-stars]');
  if (repo && outs.length && 'fetch' in window) {
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem('orpheus:stars') || 'null'); } catch (e) {}
    var paint = function (n) {
      outs.forEach(function (el) { el.textContent = String(n); el.classList.add('on'); });
    };
    if (cached && Date.now() - cached.t < 6e5) paint(cached.n);
    else {
      fetch('https://api.github.com/repos/' + repo, { headers: { Accept: 'application/vnd.github+json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || typeof d.stargazers_count !== 'number') return;
          paint(d.stargazers_count);
          try { sessionStorage.setItem('orpheus:stars', JSON.stringify({ n: d.stargazers_count, t: Date.now() })); } catch (e) {}
        })
        .catch(function () {});
    }
  }

  /* ---- copy buttons ---- */
  $$('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = $(btn.getAttribute('data-copy'));
      if (!src) return;
      var txt = src.innerText.replace(/^\s*\$\s?/gm, '').trim();
      var done = function () {
        var was = btn.textContent;
        btn.textContent = 'COPIED';
        btn.classList.add('ok');
        setTimeout(function () { btn.textContent = was; btn.classList.remove('ok'); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () {});
      } else {
        var ta = document.createElement('textarea');
        ta.value = txt; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  });

  /* ---- mobile nav ---- */
  var burger = $('.nav-burger');
  if (burger) {
    var links = $('.nav-links');
    burger.addEventListener('click', function () {
      var on = document.body.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    $$('a', links).forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }
})();
