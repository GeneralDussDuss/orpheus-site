/* Orpheus visualizer engine for the web.
   Feeds the ported shaders the same things the app feeds its own: 32 bands,
   falling peaks, a 32x40 spectrum history, a kick-transient `beat`, `energy`,
   `bass`, and `flow` -- distance integrated on the CPU from a tempo-driven
   speed, never time * speed. */

window.OrpheusEngine = (function () {
  'use strict';

  var VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

  // Site palette standing in for the live theme tokens the app reads.
  var THEME = {
    c1: [0.184, 0.357, 1.0, 1],   // #2f5bff
    c2: [0.169, 0.910, 0.784, 1], // #2be8c8
    c3: [1.0, 0.851, 0.541, 1],   // #ffd98a
    bg: [0.016, 0.024, 0.051, 1], // #04060d
    fg: [0.918, 0.945, 1.0, 1]    // #eaf1ff
  };

  var ROWS = 40, BANDS = 32;

  /* ---- device tier -------------------------------------------------------
     Prism costs ~40 raymarch iterations per pixel. On a desktop GPU that is
     free; on a phone it is a battery fire. So the page decides what the
     machine can take, from what the browser will actually tell us, and then
     keeps checking its own frame times and backs off if it guessed high.

     Resolution is the lever, not the shader: every style stays the real
     shader at every tier, it just renders fewer pixels. That keeps the hero's
     claim honest on a phone. */
  var TIER = (function () {
    var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
    var nav = navigator || {};
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};

    // A coarse pointer alone is not a touch device: headless Chrome reports
    // hover:none with zero touch points, and so do some TV browsers. Require
    // the pointer hint AND a real touch capability.
    var coarse = mq('(hover: none)') || mq('(pointer: coarse)');
    var canTouch = (nav.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    var touch = coarse && canTouch;
    var shortEdge = Math.min(screen.width || 9999, screen.height || 9999);
    var phone = touch && shortEdge <= 820;
    var tablet = touch && !phone;
    var cores = nav.hardwareConcurrency || (phone ? 4 : 8);
    var mem = nav.deviceMemory || (phone ? 4 : 8);
    var thrifty = !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
    var reduce = mq('(prefers-reduced-motion: reduce)');

    // weakest signal wins: a touch screen, few cores, little memory or an
    // explicit data-saver all pull the tier down.
    var name = 'high';
    if (tablet || cores <= 4 || mem <= 4) name = 'mid';
    if (phone || cores <= 2 || mem <= 2 || thrifty) name = 'low';

    var dpr = { high: 1.4, mid: 1.05, low: 0.8 }[name];
    var fps = { high: 0, mid: 45, low: 30 }[name];

    return {
      name: name, phone: phone, tablet: tablet, touch: touch,
      reduce: reduce, thrifty: thrifty, cores: cores, mem: mem,
      dprCap: dpr, fpsCap: fps
    };
  })();

  function mount(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl', {
      antialias: false, alpha: false, powerPreference: 'low-power',
      // a frozen frame only survives compositing if we keep the buffer, and
      // reduced-motion freezes on purpose
      preserveDrawingBuffer: /[?&]still/.test(location.search) || TIER.reduce
    });
    if (!gl) { canvas.style.display = 'none'; return null; }
    gl.getExtension('OES_standard_derivatives');

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[orpheus] shader failed:\n' + gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    }
    var vs = compile(gl.VERTEX_SHADER, VERT);
    var progs = {};
    function program(style) {
      if (progs[style] !== undefined) return progs[style];
      var fs = compile(gl.FRAGMENT_SHADER, window.OrpheusViz.PRELUDE + '\n' + window.OrpheusViz.STYLES[style]);
      if (!vs || !fs) { progs[style] = null; return null; }
      var pr = gl.createProgram();
      gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
        console.error('[orpheus] link failed: ' + gl.getProgramInfoLog(pr));
        progs[style] = null; return null;
      }
      var u = {};
      ['res', 'time', 'bandTex', 'peakTex', 'hist', 'c1', 'c2', 'c3', 'bg', 'fg',
       'bass', 'energy', 'light', 'beat', 'flow', 'tempo'].forEach(function (n) {
        u[n] = gl.getUniformLocation(pr, n);
      });
      progs[style] = { pr: pr, u: u, loc: gl.getAttribLocation(pr, 'p') };
      return progs[style];
    }

    function tex(w, h) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(w * h));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    var bandTex = tex(BANDS, 1), peakTex = tex(BANDS, 1), histTex = tex(BANDS, ROWS);
    var bandBuf = new Uint8Array(BANDS), peakBuf = new Uint8Array(BANDS);
    var histBuf = new Uint8Array(BANDS * ROWS);

    /* ---- state ---- */
    var bands = new Float32Array(BANDS), smooth = new Float32Array(BANDS), peaks = new Float32Array(BANDS);
    var beat = 0, energy = 0, bass = 0, flow = 0, slowBass = 0;
    var bpm = opts.bpm || 104, phase = 0, style = opts.style || 'prism';
    var live = false, analyser = null, freq = null, actx = null;
    var t0 = performance.now(), histClock = 0, raf = null, running = true, frames = 0;
    var quality = 1, QUALITY_FLOOR = 0.5, cost = 0, costN = 0;
    var budget = TIER.fpsCap ? (1 / TIER.fpsCap) * 1.45 : 0.0235;
    var minStep = TIER.fpsCap ? 1 / TIER.fpsCap - 0.0015 : 0, acc = 0;
    var STILL = /[?&]still/.test(location.search);

    /* Synthetic drive: a kick on the beat, a snare off it, a drifting shimmer.
       Reads as music rather than as noise, so the shaders behave as they do
       against real audio. */
    function synth(dt) {
      phase += dt * (bpm / 60);
      var b = phase % 1.0;
      var kick = Math.pow(1 - b, 7);
      var snare = Math.pow(1 - Math.abs(((phase + 0.5) % 1)), 9);
      var sweep = 0.5 + 0.5 * Math.sin(phase * 0.21);
      for (var i = 0; i < BANDS; i++) {
        var f = i / (BANDS - 1);
        var low = kick * Math.exp(-f * 9.0);
        var mid = snare * 0.8 * Math.exp(-Math.abs(f - 0.42) * 7.0);
        var wob = Math.pow(Math.sin(phase * (1.6 + i * 0.37) + i * 1.9), 2.0);
        var air = (0.10 + 0.10 * sweep) * Math.exp(-Math.abs(f - 0.70) * 4.6) * (0.25 + 0.75 * wob);
        var tilt = Math.exp(-f * 1.1);          // real spectra fall off toward treble
        bands[i] = Math.max(0, (low * 1.1 + mid + air) * tilt) * 0.92;
      }
    }

    function fromMic() {
      analyser.getByteFrequencyData(freq);
      var n = freq.length;
      for (var i = 0; i < BANDS; i++) {
        var a = Math.floor(Math.pow(i / BANDS, 1.7) * n * 0.55);
        var b2 = Math.max(a + 1, Math.floor(Math.pow((i + 1) / BANDS, 1.7) * n * 0.55));
        var m = 0;
        for (var j = a; j < b2 && j < n; j++) if (freq[j] > m) m = freq[j];
        bands[i] = m / 255;
      }
    }

    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, TIER.dprCap) * quality;
      var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
      }
    }

    /* The tier is a guess from specs; this is the measurement. If the rolling
       frame time says we are missing the budget, shed resolution rather than
       stutter. It only ever steps down, so it cannot oscillate. */
    function watchCost(dt) {
      if (STILL || quality <= QUALITY_FLOOR) return;
      cost = cost ? cost * 0.9 + dt * 0.1 : dt;
      if (++costN < 45) return;
      costN = 0;
      if (cost > budget) { quality = Math.max(QUALITY_FLOOR, quality * 0.8); size(); }
    }

    function frame(now) {
      if (STILL && frames > 170) { raf = null; return; }
      // prefers-reduced-motion: let the world build for a second, then hold
      // that frame. Still the real shader, just not a moving one.
      if (TIER.reduce && frames > 70) { raf = null; return; }
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
      if (!running) return;
      // Frame-rate cap for the lower tiers: a phone at 30 fps looks the same
      // as a phone at 60 and lasts twice as long.
      if (minStep) { acc += dt; if (acc < minStep) return; dt = acc; acc = 0; }
      watchCost(dt);
      size();
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      frames++;

      if (live && analyser) fromMic(); else synth(dt);

      var sum = 0, lo = 0;
      for (var i = 0; i < BANDS; i++) {
        smooth[i] += (bands[i] - smooth[i]) * (bands[i] > smooth[i] ? 0.6 : 0.14);
        peaks[i] = Math.max(smooth[i], peaks[i] - 0.012);   // falling peaks, as the app does
        sum += smooth[i];
        if (i < 4) lo += smooth[i];
        bandBuf[i] = Math.max(0, Math.min(255, smooth[i] * 255)) | 0;
        peakBuf[i] = Math.max(0, Math.min(255, peaks[i] * 255)) | 0;
      }
      energy = sum / BANDS;
      bass = lo / 4;
      slowBass = slowBass * 0.94 + bass * 0.06;
      var kick = Math.max(0, Math.min(1, (bass - slowBass * 1.15) * 4));
      beat = Math.max(kick, beat * 0.82);

      // history: row 0 newest, stepped at ~30 Hz like cava
      histClock += dt;
      if (histClock > 1 / 30) {
        histClock = 0;
        histBuf.copyWithin(BANDS, 0, BANDS * (ROWS - 1));
        histBuf.set(bandBuf.subarray(0, BANDS), 0);
        gl.bindTexture(gl.TEXTURE_2D, histTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BANDS, ROWS, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, histBuf);
      }

      // flow: distance, never time * speed
      flow += dt * (0.5 + energy * 2.2 + beat * 0.5);
      if (flow > 4096) flow -= 4096;

      var P = program(style);
      if (!P) return;
      gl.useProgram(P.pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(P.loc);
      gl.vertexAttribPointer(P.loc, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bandTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BANDS, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bandBuf);
      gl.uniform1i(P.u.bandTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, peakTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BANDS, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, peakBuf);
      gl.uniform1i(P.u.peakTex, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, histTex);
      gl.uniform1i(P.u.hist, 2);

      gl.uniform2f(P.u.res, canvas.width, canvas.height);
      gl.uniform1f(P.u.time, (now / 1000) % 3600);
      gl.uniform4fv(P.u.c1, THEME.c1); gl.uniform4fv(P.u.c2, THEME.c2); gl.uniform4fv(P.u.c3, THEME.c3);
      gl.uniform4fv(P.u.bg, THEME.bg); gl.uniform4fv(P.u.fg, THEME.fg);
      gl.uniform1f(P.u.bass, bass);
      gl.uniform1f(P.u.energy, Math.min(1, energy * 2.0));
      gl.uniform1f(P.u.light, 0.0);
      gl.uniform1f(P.u.beat, beat);
      gl.uniform1f(P.u.flow, flow);
      gl.uniform1f(P.u.tempo, bpm / 120);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    size();
    window.addEventListener('resize', size);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        var e = es[0], r = e.boundingClientRect;
        // during layout the rect can be 0x0 and report "not intersecting";
        // latching on that would leave the canvas black for the whole visit
        if (r.width > 0 && r.height > 0) running = e.isIntersecting;
      }, { threshold: 0 }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
      else if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(frame); }
    });
    frame(performance.now());

    return {
      setStyle: function (s) { if (window.OrpheusViz.STYLES[s]) style = s; },
      getStyle: function () { return style; },
      setBpm: function (v) { bpm = v; },
      isLive: function () { return live; },
      toggleMic: function (cb) {
        if (live) {
          live = false;
          if (actx) { actx.close(); actx = null; analyser = null; }
          cb(false, 'LIVE AUDIO'); return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cb(false, 'NO INPUT'); return; }
        cb(false, 'LISTENING…');
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
          .then(function (stream) {
            actx = new (window.AudioContext || window.webkitAudioContext)();
            var src = actx.createMediaStreamSource(stream);
            analyser = actx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.7;
            freq = new Uint8Array(analyser.frequencyBinCount);
            src.connect(analyser);
            live = true;
            cb(true, 'LIVE ✓');
          })
          .catch(function () { cb(false, 'MIC BLOCKED'); });
      }
    };
  }

  return { mount: mount, THEME: THEME, TIER: TIER };
})();
