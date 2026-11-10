/*!
 * PromptBama Studio widget — v1.0.0
 * Renders the in-article card (design A or B), the floating bar and the
 * portrait flow (style + selfie → account → payment → generation → delivery).
 * Everything lives in Shadow DOM so the host theme's CSS never collides.
 * Talks only to the PromptBama partner API; no secret is present here.
 */
(function () {
  'use strict';

  var C = window.PBS_CONFIG;
  if (!C || !C.siteKey || !C.apiBase || !window.fetch || !document.body.attachShadow) return;

  var API = String(C.apiBase).replace(/\/$/, '') + '/api/partner/v1';
  var T = C.texts || {};
  var TOKEN_KEY = 'pbs_t_' + C.siteKey;
  var PENDING_KEY = 'pbs_pending_' + C.siteKey;

  /* ------------------------------ utilities ------------------------------ */

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v == null) window.sessionStorage.removeItem(k); else window.sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function fa(n) {
    try { return Number(n).toLocaleString('fa-IR'); } catch (e) { return String(n); }
  }
  function toman(n) {
    var k = Math.round(Number(n) / 1000);
    return fa(k) + ' هزار تومان';
  }
  function faDigitsToEn(s) {
    return String(s || '').replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); })
      .replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
  }

  /** Tiny element builder. Text only via textContent (no HTML injection). */
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (s) { el.style.setProperty(s, v[s]); });
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  var ICONS = {
    arrow: 'M19 12H5M11 6l-6 6 6 6',
    back: 'M5 12h14M13 6l6 6-6 6',
    close: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12l5 5L20 7',
    shield: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z M9 12l2 2 4-4',
    camera: 'M4 7h3l2-2h6l2 2h3v12H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    plus: 'M12 5v14M5 12h14',
    lock: 'M6 10h12v10H6z M8 10V7a4 4 0 0 1 8 0v3',
    down: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    share: 'M18 8a3 3 0 1 0-2.8-4M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    chevron: 'M6 9l6 6 6-6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'
  };
  function icon(name, size) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size || 18);
    s.setAttribute('height', size || 18);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'ic');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONS[name] || '');
    s.appendChild(p);
    return s;
  }

  function shadowHost(host) {
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = '';
    root.appendChild(h('link', { rel: 'stylesheet', href: C.cssUrl }));
    host.style.setProperty('--pbs-accent', C.accent || '#D7FF3D');
    if (C.font && C.font !== 'inherit') host.style.setProperty('--pbs-font', C.font);
    return root;
  }

  /* ------------------------------ A/B + tracking ------------------------------ */

  function pickVariant(forced) {
    if (forced === 'a' || forced === 'b') return forced;
    if (C.variant === 'a' || C.variant === 'b') return C.variant;
    var saved = lsGet('pbs_variant');
    if (saved === 'a' || saved === 'b') return saved;
    var v = Math.random() * 100 < Number(C.abSplit || 50) ? 'b' : 'a';
    lsSet('pbs_variant', v);
    return v;
  }

  var tracked = {};
  function track(event, variant, once) {
    if (!C.trackUrl) return;
    var k = event + ':' + variant;
    if (once && tracked[k]) return;
    tracked[k] = true;
    var body = JSON.stringify({ event: event, variant: variant });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(C.trackUrl, new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* fall back */ }
    fetch(C.trackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  }

  /* --------------------------------- API --------------------------------- */

  function token() { return lsGet(TOKEN_KEY); }

  function api(method, path, body) {
    var headers = { 'x-pb-site': C.siteKey };
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    var init = { method: method, headers: headers, credentials: 'omit' };
    if (body instanceof FormData) init.body = body;
    else if (body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          if (res.status === 401 && t) lsSet(TOKEN_KEY, null);
          var err = new Error(data.message || data.error || 'error');
          err.status = res.status;
          err.code = data.error || 'error';
          err.userMessage = data.message || '';
          throw err;
        }
        return data;
      });
    });
  }

  var configP = null;
  function getConfig() {
    if (!configP) configP = api('GET', '/config').catch(function (e) { configP = null; throw e; });
    return configP;
  }
  var stylesCache = {};
  function getStyles(category) {
    var key = category || '_';
    if (!stylesCache[key]) {
      var q = '?limit=' + encodeURIComponent(C.stylesLimit || 8) + (category ? '&category=' + encodeURIComponent(category) : '') + (C.stylesTag ? '&tag=' + encodeURIComponent(C.stylesTag) : '');
      stylesCache[key] = api('GET', '/styles' + q).then(function (d) {
        var list = (d && d.styles) || [];
        if (!list.length && category) return getStyles('');
        return list;
      });
    }
    return stylesCache[key];
  }

  function friendly(err) {
    if (err && err.userMessage) return err.userMessage;
    if (err && err.status === 429) return 'تلاش زیاد بود؛ کمی بعد دوباره امتحان کن.';
    if (err && (err.status >= 500 || !err.status)) return 'ارتباط برقرار نشد؛ اینترنت را بررسی کن و دوباره امتحان کن.';
    return 'مشکلی پیش آمد؛ دوباره امتحان کن.';
  }

  /* --------------------------------- card --------------------------------- */

  function peopleOf(style) { var n = Number(style && style.people) || 1; return n > 3 ? 3 : n < 1 ? 1 : n; }
  function peopleBadge(style) {
    var n = peopleOf(style);
    return n > 1 ? h('span', { class: 'people-badge', text: n === 2 ? 'دونفره' : 'سه‌نفره' }) : null;
  }

  function tile(style, i, variant, selected, onPick) {
    var caption = null;
    if (variant === 'b') {
      var caps = (T.b && T.b.captions) || [];
      caption = caps.length ? caps[i % caps.length] : style.title;
    }
    return h('button', {
      type: 'button',
      class: 'tile' + (selected ? ' is-on' : ''),
      'aria-pressed': selected ? 'true' : 'false',
      onclick: function () { onPick(i); }
    }, [
      h('span', { class: 'tile-img' }, [
        h('img', { src: style.imageUrl, alt: style.title, loading: 'lazy', decoding: 'async' }),
        peopleBadge(style),
        selected ? h('span', { class: 'tile-check' }, icon('check', 14)) : null
      ]),
      caption ? h('span', { class: 'tile-cap', text: caption }) : null,
      h('span', { class: 'tile-name', text: style.title })
    ]);
  }

  function skeletonRail(n) {
    var kids = [];
    for (var i = 0; i < n; i++) kids.push(h('span', { class: 'tile tile-skel', 'aria-hidden': 'true' }, h('span', { class: 'tile-img' })));
    return h('div', { class: 'rail' }, kids);
  }

  function privacyLine() {
    return h('p', { class: 'privacy' }, [icon('shield', 18), h('span', { text: T.privacy || '' })]);
  }
  function faDigits(str) { return String(str || '').replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function guaranteeLine() {
    if (!T.guarantee) return null;
    var kids = [icon('check', 16), h('span', { text: T.guarantee })];
    return C.supportUrl
      ? h('a', { class: 'guarantee', href: C.supportUrl, target: '_blank', rel: 'noopener' }, kids)
      : h('p', { class: 'guarantee' }, kids);
  }
  function socialLine() {
    return T.social ? h('p', { class: 'social' }, [h('span', { class: 'social-dot', 'aria-hidden': 'true' }), h('span', { text: faDigits(T.social) })]) : null;
  }
  function brandLine() {
    return C.showBrand ? h('p', { class: 'brand' }, ['با فناوری ', h('a', { href: C.apiBase, target: '_blank', rel: 'noopener', text: 'پرامپت باما' })]) : null;
  }

  /* Auto-advancing carousel: moves one frame every few seconds, pauses while the
     pointer/finger/keyboard focus is on it or the card is off-screen, and is
     off for users who prefer reduced motion. Manual scrolling keeps working. */
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function autoScroll(rail, holder) {
    if (holder.stop) holder.stop();
    holder.stop = null;
    if (REDUCED || !rail || rail.children.length < 4) return;
    var paused = false, visible = true, resumeAt = 0;
    var rtl = getComputedStyle(rail).direction === 'rtl';
    function stepSize() {
      var t = rail.children[0];
      var gap = parseFloat(getComputedStyle(rail).columnGap || getComputedStyle(rail).gap) || 10;
      return t ? t.getBoundingClientRect().width + gap : 120;
    }
    function tick() {
      if (paused || !visible || Date.now() < resumeAt || document.hidden || (Flow && Flow.isOpen())) return;
      var max = rail.scrollWidth - rail.clientWidth;
      if (max <= 4) return;
      var pos = Math.abs(rail.scrollLeft);
      if (pos >= max - 4) { rail.scrollTo({ left: 0, behavior: 'smooth' }); return; }
      rail.scrollBy({ left: rtl ? -stepSize() : stepSize(), behavior: 'smooth' });
    }
    function hold() { paused = true; }
    function release() { paused = false; resumeAt = Date.now() + 2500; }
    ['pointerenter', 'pointerdown', 'touchstart', 'focusin'].forEach(function (e) { rail.addEventListener(e, hold, { passive: true }); });
    ['pointerleave', 'touchend', 'touchcancel', 'focusout'].forEach(function (e) { rail.addEventListener(e, release, { passive: true }); });
    rail.addEventListener('wheel', function () { resumeAt = Date.now() + 4000; }, { passive: true });
    var io = window.IntersectionObserver ? new IntersectionObserver(function (en) { visible = en[0] && en[0].isIntersecting; }, { threshold: 0.3 }) : null;
    if (io) io.observe(rail);
    var timer = setInterval(tick, 2800);
    holder.stop = function () { clearInterval(timer); if (io) io.disconnect(); };
  }

  function mountCard(host) {
    var forced = host.getAttribute('data-variant');
    var variant = pickVariant(forced);
    var layout = host.getAttribute('data-layout') === 'sidebar' ? 'sidebar' : 'inline';
    var category = host.getAttribute('data-category') || '';
    var root = shadowHost(host);
    host.style.background = 'transparent';
    var state = { styles: [], picked: 0, open: true };
    var tx = variant === 'b' ? (T.b || {}) : (T.a || {});

    var wrap = h('div', { class: 'wrap', 'data-variant': variant, 'data-layout': layout });
    root.appendChild(wrap);

    function picked() { return state.styles[state.picked]; }
    function ctaText() {
      if (variant === 'b') return tx.cta || 'بله، این عکس را می‌خواهم';
      var s = picked();
      return String(tx.cta || 'با «%s» بساز').replace('%s', s ? s.title : '');
    }
    function start() {
      var s = picked();
      if (!s) return;
      Flow.open({ style: s, styles: state.styles, variant: variant, category: category });
    }

    function render(loading) {
      var prev = wrap.querySelector('.rail');
      var keep = prev ? prev.scrollLeft : 0;
      wrap.innerHTML = '';
      var card = h('section', { class: 'card' + (variant === 'b' && !state.open ? ' is-collapsed' : ''), 'aria-label': 'ساخت پرتره با هوش مصنوعی' });
      var head = h('div', { class: 'head' }, [
        h('span', { class: 'sticker', text: tx.eyebrow || '' }),
        socialLine(),
        h('h2', { class: 'title' }, [tx.title1 || '', h('br'), h('span', { class: 'accent', text: tx.title2 || '' })]),
        h('p', { class: 'sub', text: tx.sub || '' }),
        variant === 'b' && tx.imagine && layout === 'inline' ? h('p', { class: 'imagine', text: tx.imagine }) : null
      ]);
      card.appendChild(head);

      if (loading) {
        card.appendChild(skeletonRail(layout === 'sidebar' ? 2 : 5));
      } else {
        var rail = h('div', { class: 'rail', role: 'list' });
        state.styles.forEach(function (s, i) {
          rail.appendChild(tile(s, i, variant, i === state.picked, function (idx) {
            state.picked = idx;
            if (variant === 'b') state.open = true;
            render(false);
          }));
        });
        var railWrap = h('div', { class: 'rail-wrap' }, [rail]);
        if (layout === 'inline' && state.styles.length > 3) {
          railWrap.appendChild(h('div', { class: 'rail-nav' }, [
            h('button', { type: 'button', class: 'round', 'aria-label': 'قاب‌های قبلی', onclick: function () { rail.scrollBy({ left: 260, behavior: 'smooth' }); } }, icon('back', 18)),
            h('button', { type: 'button', class: 'round', 'aria-label': 'قاب‌های بعدی', onclick: function () { rail.scrollBy({ left: -260, behavior: 'smooth' }); } }, icon('arrow', 18))
          ]));
        }
        card.appendChild(railWrap);
      }

      {
        if (variant === 'b' && tx.quote) {
          card.appendChild(h('figure', { class: 'quote' }, [
            h('blockquote', { text: '«' + tx.quote + '»' }),
            tx.quoteBy ? h('figcaption', { text: tx.quoteBy }) : null
          ]));
        }
        card.appendChild(h('div', { class: 'foot' }, [
          h('button', { type: 'button', class: 'cta', disabled: loading || !picked() ? true : null, onclick: start }, [h('span', { text: ctaText() }), icon('arrow', 20)]),
          h('div', { class: 'trust' }, [privacyLine(), guaranteeLine()])
        ]));
      }
      var brand = brandLine();
      if (brand) card.appendChild(brand);
      wrap.appendChild(card);
      var rail2 = wrap.querySelector('.rail');
      if (rail2 && keep) rail2.scrollLeft = keep;
      if (!loading) autoScroll(rail2, state);
    }

    render(true);
    getStyles(category).then(function (list) {
      if (!list.length) { host.style.display = 'none'; return; }
      state.styles = list;
      host.style.minHeight = '';
      render(false);
      watchVisibility(host, variant);
      if (layout === 'inline') Floating.register(host, function () { return { style: picked(), styles: state.styles, variant: variant, category: category }; });
    }).catch(function () {
      host.style.display = 'none'; // Never leave a broken box inside an article.
    });
  }

  function watchVisibility(host, variant) {
    if (!('IntersectionObserver' in window)) { track('view', variant, true); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && e.intersectionRatio >= 0.4) { track('view', variant, true); io.disconnect(); }
      });
    }, { threshold: [0.4] });
    io.observe(host);
  }

  /* ----------------------------- floating bar ----------------------------- */

  var Floating = (function () {
    var host = null, root = null, getCtx = null, shown = false;
    function show(on) {
      if (!host || on === shown) return;
      shown = on;
      host.classList.toggle('pbs-float-on', on);
      root.querySelector('.float').classList.toggle('is-on', on);
    }
    return {
      register: function (cardHost, ctxFn) {
        if (host || !C.floatingBar) return;
        getCtx = ctxFn;
        host = h('div', { class: 'pbs-float-host' });
        host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;pointer-events:none';
        document.body.appendChild(host);
        root = shadowHost(host);
        var ctx = getCtx();
        root.appendChild(h('div', { class: 'float' }, [
          h('button', { type: 'button', class: 'float-btn', onclick: function () { Flow.open(getCtx()); } }, [
            h('span', { class: 'float-thumbs' }, (ctx.styles || []).slice(0, 3).map(function (s) { return h('img', { src: s.imageUrl, alt: '' }); })),
            h('span', { class: 'float-text', text: T.floating || '' }),
            h('span', { class: 'float-go', text: 'بساز' })
          ])
        ]));
        if (!('IntersectionObserver' in window)) return;
        new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            var passed = !e.isIntersecting && e.boundingClientRect.top < 0;
            show(passed && window.innerWidth < 900 && !Flow.isOpen());
          });
        }).observe(cardHost);
      },
      hide: function () { show(false); }
    };
  })();

  /* --------------------------------- flow --------------------------------- */

  var Flow = (function () {
    var host = null, root = null, mountEl = null, sheet = null, lastFocus = null;
    var f = null; // flow state
    var pollTimer = null;
    var openState = false;

    function ensureHost() {
      if (host) return;
      host = h('div', { class: 'pbs-flow-host' });
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:none';
      document.body.appendChild(host);
      root = shadowHost(host);
      mountEl = h('div', { class: 'flow-mount' });
      root.appendChild(mountEl);
      root.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    }

    function open(ctx, at) {
      if (!ctx || !ctx.style) return;
      ensureHost();
      lastFocus = document.activeElement;
      f = {
        style: ctx.style, styles: ctx.styles || [ctx.style], variant: ctx.variant || 'a',
        category: ctx.category || '', selfieId: null, lid: null, locals: [], others: [],
        me: null, phone: '', exists: null, error: '', busy: false, job: null, pack: 'pack5'
      };
      openState = true;
      Floating.hide();
      host.style.display = 'block';
      document.documentElement.style.overflow = 'hidden';
      track('open', f.variant);
      if (at === false) return; // caller drives the next step
      if (token()) {
        loadMe().then(function () { go(at || 'style'); });
      } else {
        go(at || 'style');
      }
    }

    function close() {
      if (!host) return;
      openState = false;
      host.style.display = 'none';
      document.documentElement.style.overflow = '';
      if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* ignore */ }
    }

    function loadMe() {
      return api('GET', '/me').then(function (me) {
        f.me = me;
        if (!f.selfieId && !f.lid && me.selfies && me.selfies.length) {
          var taken = (f.others || []).map(function (o) { return o && o.selfieId; });
          var free = me.selfies.filter(function (x) { return taken.indexOf(x.id) === -1; })[0];
          if (free) f.selfieId = free.id;
        }
        var have = (me.selfies || []).map(function (x) { return x.id; });
        (f.others || []).forEach(function (o) { if (o && o.selfieId && have.indexOf(o.selfieId) === -1) o.selfieId = null; });
        return me;
      }).catch(function () { f.me = null; });
    }

    function go(step) {
      f.step = step;
      f.error = '';
      render();
    }

    function setError(msg) { f.error = msg; f.busy = false; render(); }

    /* ---------- frame ---------- */

    function frame(opts, body, footer) {
      var prevMini = mountEl.querySelector('.mini-rail');
      var keepMini = prevMini ? prevMini.scrollLeft : 0;
      var prevBody = mountEl.querySelector('.sheet-body');
      var keepBody = prevBody && opts.keepScroll ? prevBody.scrollTop : 0;
      mountEl.innerHTML = '';
      var overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay && f.step !== 'gen') close(); } });
      sheet = h('div', { class: 'sheet' + (opts.dark ? ' is-dark' : ''), tabindex: '-1', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pbs-flow-title' });
      var top = h('div', { class: 'sheet-top' }, [
        opts.back ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'برگشت', onclick: opts.back }, icon('back', 20)) : h('span'),
        opts.stepLabel ? h('span', { class: 'step', text: opts.stepLabel }) : h('span'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': opts.minimize ? 'کوچک کردن' : 'بستن', onclick: close }, icon(opts.minimize ? 'chevron' : 'close', 20))
      ]);
      var content = h('div', { class: 'sheet-body' }, [
        h('h3', { class: 'sheet-title', id: 'pbs-flow-title', text: opts.title }),
        opts.sub ? h('p', { class: 'sheet-sub', text: opts.sub }) : null,
        f.error ? h('p', { class: 'alert', role: 'alert', text: f.error }) : null
      ].concat(body));
      sheet.appendChild(top);
      sheet.appendChild(content);
      if (footer) sheet.appendChild(h('div', { class: 'sheet-foot' }, footer));
      overlay.appendChild(sheet);
      mountEl.appendChild(overlay);
      var mini = mountEl.querySelector('.mini-rail');
      if (mini && keepMini) mini.scrollLeft = keepMini;
      if (keepBody) content.scrollTop = keepBody;
      if (f._focusStep !== f.step) {
        f._focusStep = f.step;
        var focusable = sheet.querySelector('input:not(.sr), button.cta');
        setTimeout(function () { try { (focusable || sheet).focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
      }
    }

    function cta(label, onclick, opts) {
      opts = opts || {};
      return h('button', { type: 'button', class: 'cta', disabled: f.busy || opts.disabled ? true : null, onclick: onclick }, [
        opts.icon ? icon(opts.icon, 18) : null,
        h('span', { text: f.busy ? 'لطفاً صبر کن…' : label }),
        opts.trail ? h('span', { class: 'cta-trail', text: opts.trail }) : icon('arrow', 20)
      ]);
    }

    function render() {
      ({ style: stepStyle, auth: stepAuth, pay: stepPay, gen: stepGen, done: stepDone })[f.step]();
    }

    /* ---------- step 1: style + selfie ---------- */

    /* Faces. Person 0 is the user; persons 1–2 exist for two/three-person
       styles. Each person points at a saved selfie (id) or at a photo picked on
       this device (lid) that is uploaded when they continue. Any number of
       photos can be added; each person picks one. */
    var lidSeq = 0;
    function slotOf(idx) {
      if (!f.others[idx - 1]) f.others[idx - 1] = { selfieId: null, lid: null };
      return f.others[idx - 1];
    }
    function selOf(idx) { return idx === 0 ? { selfieId: f.selfieId, lid: f.lid } : slotOf(idx); }
    function setSel(idx, id, lid) {
      // One photo can't be two people: release it from everyone else first.
      for (var k = 0; k < 3; k++) {
        if (k === idx) continue;
        var o = k === 0 ? null : f.others[k - 1];
        if (k === 0) {
          if (id && f.selfieId === id) f.selfieId = null;
          if (lid && f.lid === lid) f.lid = null;
        } else if (o) {
          if (id && o.selfieId === id) o.selfieId = null;
          if (lid && o.lid === lid) o.lid = null;
        }
      }
      if (idx === 0) { f.selfieId = id || null; f.lid = lid || null; }
      else { var sl = slotOf(idx); sl.selfieId = id || null; sl.lid = lid || null; }
    }
    function releaseSelfie(id) {
      if (!id) return;
      if (f.selfieId === id) f.selfieId = null;
      f.others.forEach(function (o) { if (o && o.selfieId === id) o.selfieId = null; });
    }
    function releaseLocal(lid) {
      if (f.lid === lid) f.lid = null;
      f.others.forEach(function (o) { if (o && o.lid === lid) o.lid = null; });
    }
    function usedBy(idx, id, lid) {
      for (var k = 0; k < 3; k++) {
        if (k === idx) continue;
        var sel = k === 0 ? { selfieId: f.selfieId, lid: f.lid } : f.others[k - 1];
        if (!sel) continue;
        if ((id && sel.selfieId === id) || (lid && sel.lid === lid)) return true;
      }
      return false;
    }
    function hasFace(idx) { var sel = selOf(idx); return Boolean(sel && (sel.selfieId || sel.lid)); }

    function facePicker(idx, people, selfies) {
      var sel = selOf(idx);
      var inputId = 'pbs-file-' + idx;
      var name = idx === 0 ? (people > 1 ? 'نفر اول (تو)' : 'سلفی‌ات را اضافه کن') : (idx === 1 ? 'نفر دوم' : 'نفر سوم');
      var inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, class: 'sr', id: inputId, onchange: function (e) {
        var files = Array.prototype.slice.call((e.target.files || []));
        var first = null;
        files.forEach(function (file) {
          if (file.size > 25 * 1024 * 1024) { setError('حجم عکس زیاد است (حداکثر ۲۵ مگابایت).'); return; }
          var item = { lid: 'l' + (++lidSeq), file: file, preview: URL.createObjectURL(file) };
          f.locals.push(item);
          if (!first) first = item;
        });
        e.target.value = '';
        if (first) { setSel(idx, null, first.lid); track('selfie', f.variant, true); }
        render();
      } });
      var items = [];
      f.locals.forEach(function (it) {
        var on = sel.lid === it.lid;
        items.push(h('span', { class: 'selfie-wrap' }, [
          h('button', { type: 'button', class: 'selfie' + (on ? ' is-on' : '') + (!on && usedBy(idx, null, it.lid) ? ' is-taken' : ''), 'aria-pressed': on ? 'true' : 'false', 'aria-label': 'انتخاب این عکس', onclick: function () { setSel(idx, null, it.lid); render(); } }, [h('img', { src: it.preview, alt: '' })]),
          h('button', { type: 'button', class: 'selfie-x', 'aria-label': 'برداشتن این عکس', onclick: function () {
            URL.revokeObjectURL(it.preview);
            f.locals = f.locals.filter(function (x) { return x.lid !== it.lid; });
            releaseLocal(it.lid); setError(''); render();
          } }, icon('close', 14))
        ]));
      });
      selfies.forEach(function (sf) {
        var on = sel.selfieId === sf.id;
        items.push(h('span', { class: 'selfie-wrap' }, [
          h('button', { type: 'button', class: 'selfie' + (on ? ' is-on' : '') + (!on && usedBy(idx, sf.id, null) ? ' is-taken' : ''), 'aria-pressed': on ? 'true' : 'false', 'aria-label': 'انتخاب این سلفی', onclick: function () { setSel(idx, sf.id, null); render(); } }, [h('img', { src: sf.url, alt: '' })]),
          h('button', { type: 'button', class: 'selfie-x', 'aria-label': 'حذف این سلفی از حسابم', disabled: f.removing ? true : null, onclick: function () {
            f.removing = true; render();
            api('DELETE', '/selfies/' + encodeURIComponent(sf.id)).then(function () {
              releaseSelfie(sf.id);
              return loadMe();
            }).then(function () {
              f.removing = false; setError(''); render(); Toast.say('سلفی پاک شد.');
            }).catch(function (e) { f.removing = false; setError(friendly(e)); });
          } }, icon('close', 14))
        ]));
      });
      items.push(h('label', { class: 'selfie add', for: inputId }, [icon('camera', 20), h('span', { text: items.length ? 'عکس دیگر' : 'عکس بگیر یا انتخاب کن' })]));
      var ready = hasFace(idx);
      return h('div', { class: 'box' }, [
        h('div', { class: 'box-head' }, [
          h('strong', { text: name }),
          people > 1 && ready ? h('span', { class: 'ok-chip' }, [icon('check', 12), 'آماده'])
            : h('span', { class: 'muted', text: people > 1 ? 'یک عکس واضح از صورت' : 'یک عکس کافی است' })
        ]),
        h('div', { class: 'selfies' }, items),
        inp,
        idx === 0 ? h('p', { class: 'muted small', text: 'نور روشن، صورت از روبه‌رو و بدون عینک آفتابی؛ نتیجه شبیه‌تر می‌شود.' }) : null
      ]);
    }

    function stepStyle() {
      var selfies = (f.me && f.me.selfies) || [];
      var rail = h('div', { class: 'mini-rail' }, f.styles.map(function (s) {
        var on = s.slug === f.style.slug;
        return h('button', { type: 'button', class: 'mini' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { f.style = s; render(); } }, [
          h('span', { class: 'mini-img' }, [h('img', { src: s.imageUrl, alt: '', loading: 'lazy', decoding: 'async' }), peopleBadge(s)]), h('span', { text: s.title })
        ]);
      }));

      var people = peopleOf(f.style);
      var boxes = [];
      var complete = true;
      for (var i = 0; i < people; i++) {
        boxes.push(facePicker(i, people, selfies));
        if (!hasFace(i)) complete = false;
      }
      frame(
        { title: 'استایلت را انتخاب کن', stepLabel: 'قدم ۱ از ۳', dark: true, keepScroll: true },
        [rail].concat(boxes).concat([privacyLine()]),
        [cta('ادامه', function () {
          if (!complete) { setError(people > 1 ? 'از هر ' + (people === 2 ? 'دو' : 'سه') + ' نفر یک عکس اضافه کن.' : 'اول یک سلفی اضافه کن.'); return; }
          if (!token()) go('auth');
          else proceed();
        }, { disabled: !complete })]
      );
    }

    /* ---------- step 2: phone + password ---------- */

    function stepAuth() {
      var phoneInput = h('input', { id: 'pbs-phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', dir: 'ltr', placeholder: '09123456789', value: f.phone });
      var body = [];
      var footer;
      if (f.exists === null) {
        body.push(h('label', { class: 'label', for: 'pbs-phone', text: 'شماره موبایل' }), phoneInput);
        footer = [cta('ادامه', function () {
          var phone = faDigitsToEn(phoneInput.value).replace(/\D/g, '');
          if (!/^(0?9\d{9}|989\d{9})$/.test(phone)) { setError('شماره موبایل را درست وارد کن، مثل ۰۹۱۲۳۴۵۶۷۸۹'); return; }
          f.phone = phone; f.busy = true; render();
          api('POST', '/auth/check', { phone: phone }).then(function (d) {
            f.busy = false; f.exists = Boolean(d.exists); f._focusStep = null; render();
          }).catch(function (e) { setError(friendly(e)); });
        })];
      } else {
        var pass = h('input', { id: 'pbs-pass', type: 'password', dir: 'ltr', autocomplete: f.exists ? 'current-password' : 'new-password', minlength: '8' });
        var toggle = h('button', { type: 'button', class: 'eye', 'aria-label': 'نمایش رمز', onclick: function () { pass.type = pass.type === 'password' ? 'text' : 'password'; } }, icon('eye', 20));
        body.push(
          h('div', { class: 'row-between muted' }, [h('span', { dir: 'ltr', text: f.phone }), h('button', { type: 'button', class: 'link', onclick: function () { f.exists = null; render(); }, text: 'تغییر شماره' })]),
          h('label', { class: 'label', for: 'pbs-pass', text: f.exists ? 'رمز عبور' : 'یک رمز برای حسابت بگذار' }),
          h('div', { class: 'pass' }, [pass, toggle]),
          f.exists
            ? (C.supportUrl ? h('a', { class: 'link', href: C.supportUrl, target: '_blank', rel: 'noopener', text: 'رمز را فراموش کرده‌ای؟ به پشتیبانی پیام بده' }) : null)
            : h('p', { class: 'muted small', text: 'حداقل ۸ حرف یا عدد. این همان حساب پرامپت باماست و اعتبار و پرتره‌هایت آنجا هم هست.' })
        );
        footer = [cta(f.exists ? 'ورود و ادامه' : 'ساخت حساب و ادامه', function () {
          var pw = pass.value;
          if (!f.exists && pw.length < 8) { setError('رمز عبور باید حداقل ۸ کاراکتر باشد.'); return; }
          if (!pw) { setError('رمز عبور را وارد کن.'); return; }
          f.busy = true; render();
          api('POST', f.exists ? '/auth/login' : '/auth/register', { phone: f.phone, password: pw }).then(function (d) {
            lsSet(TOKEN_KEY, d.token);
            track('auth', f.variant, true);
            f.busy = false;
            return loadMe().then(proceed);
          }).catch(function (e) {
            if (e.code === 'phone_exists') { f.exists = true; }
            setError(friendly(e));
          });
        })];
      }
      frame(
        {
          title: f.exists === null ? 'پرتره‌ات را کجا نگه داریم؟' : f.exists ? 'خوش برگشتی' : 'یک رمز بگذار و تمام',
          sub: f.exists === null ? 'با شماره موبایلت یک حساب ساده می‌سازیم تا پرتره‌ها و اعتبارت همیشه در دسترست باشد.' : null,
          stepLabel: 'قدم ۲ از ۳', dark: true, back: function () { go('style'); }
        },
        [h('form', { class: 'form', onsubmit: function (e) { e.preventDefault(); var b = sheet.querySelector('.sheet-foot .cta'); if (b) b.click(); } }, body.concat([h('button', { type: 'submit', class: 'sr', tabindex: '-1', 'aria-hidden': 'true' })]))],
        footer.concat([C.termsUrl ? h('p', { class: 'muted small center' }, ['ادامه یعنی پذیرش ', h('a', { href: C.termsUrl, target: '_blank', rel: 'noopener', text: 'شرایط استفاده' })]) : null])
      );
    }

    /* ---------- after auth: upload selfie, then pay or generate ---------- */

    function proceed() {
      f.busy = true;
      render();
      var need = peopleOf(f.style);
      var lids = [];
      for (var i = 0; i < need; i++) { var sel = selOf(i); if (sel.lid && lids.indexOf(sel.lid) === -1) lids.push(sel.lid); }
      var chain = Promise.resolve();
      lids.forEach(function (lid) {
        chain = chain.then(function () {
          var it = f.locals.filter(function (x) { return x.lid === lid; })[0];
          if (!it) return;
          var fd = new FormData();
          fd.append('file', it.file);
          return api('POST', '/selfies', fd).then(function (d) {
            for (var k = 0; k < need; k++) {
              var s2 = selOf(k);
              if (s2.lid === lid) setSel(k, d.selfie.id, null);
            }
            URL.revokeObjectURL(it.preview);
            f.locals = f.locals.filter(function (x) { return x.lid !== lid; });
          });
        });
      });
      chain.then(function () { return loadMe().catch(function () {}); }).then(function () {
        f.busy = false;
        var credits = f.me ? Number(f.me.imageCredits || 0) : 0;
        if (credits >= 1) startGeneration();
        else getConfig().then(function (cfg) { f.config = cfg; go('pay'); }).catch(function (e) { setError(friendly(e)); });
      }).catch(function (e) {
        f.busy = false;
        f.step = 'style';
        setError(friendly(e));
      });
    }

    /* ---------- step 3: pay ---------- */

    function stepPay() {
      var p = (f.config && f.config.pricing) || { singleToman: 59000, packs: [] };
      var packs = [{ id: 'single', title: '۱ پرتره', per: p.singleToman, total: p.singleToman, save: 'برای امتحان' }];
      (p.packs || []).filter(function (x) { return x.credits === 5 || x.credits === 10; }).forEach(function (x) {
        var save = p.singleToman * x.credits - x.totalToman;
        packs.push({ id: 'pack' + x.credits, credits: x.credits, title: fa(x.credits) + ' پرتره', per: x.perImageToman, total: x.totalToman, save: save > 0 ? toman(save) + ' کمتر' : '', badge: x.credits === 5 });
      });
      if (!packs.some(function (x) { return x.id === f.pack; })) f.pack = packs[0].id;
      var chosen = packs.filter(function (x) { return x.id === f.pack; })[0];

      var list = h('div', { class: 'packs', role: 'radiogroup', 'aria-label': 'بسته‌ها' }, packs.map(function (x) {
        var on = x.id === f.pack;
        return h('button', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: 'pack' + (on ? ' is-on' : ''), onclick: function () { f.pack = x.id; if (f.disc) { applyCode(); } else { render(); } } }, [
          h('span', { class: 'pack-main' }, [
            h('span', { class: 'pack-title' }, [x.title, x.badge ? h('span', { class: 'badge', text: 'به‌صرفه‌ترین' }) : null]),
            h('span', { class: 'pack-save', text: x.save })
          ]),
          h('span', { class: 'pack-price' }, [h('strong', { text: fa(Math.round(x.per / 1000)) }), h('small', { text: 'هزار تومان / هر پرتره' })])
        ]);
      }));

      var disc = f.disc && f.disc.packId === chosen.id ? f.disc : null;
      var finalTotal = disc ? disc.finalToman : chosen.total;
      var discBox;
      if (!f.dOpen) {
        discBox = h('button', { type: 'button', class: 'link', onclick: function () { f.dOpen = true; f.dErr = ''; render(); setTimeout(function () { var i = root.querySelector('#pbs-dcode'); if (i) i.focus(); }, 30); } }, 'کد تخفیف داری؟');
      } else {
        var dIn = h('input', { id: 'pbs-dcode', type: 'text', dir: 'ltr', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '64', placeholder: 'کد تخفیف', value: f.dCode || '',
          oninput: function (e) { f.dCode = e.target.value; },
          onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } } });
        discBox = h('div', { class: 'disc' }, [
          h('div', { class: 'disc-row' }, [
            dIn,
            h('button', { type: 'button', class: 'pill', disabled: f.dBusy ? true : null, onclick: function () { applyCode(); } }, f.dBusy ? '…' : 'اعمال')
          ]),
          disc ? h('p', { class: 'disc-ok' }, [
            h('span', { text: '✓ ' + (disc.label || 'تخفیف اعمال شد') + ' — ' }),
            h('s', { class: 'muted', text: toman(disc.originalToman) }),
            h('strong', { text: ' ' + toman(disc.finalToman) })
          ]) : null,
          f.dErr ? h('p', { class: 'disc-err', role: 'alert', text: f.dErr }) : null
        ]);
      }

      frame(
        { title: 'پرتره‌ات یک قدم با تو فاصله دارد', stepLabel: 'قدم آخر', dark: true, keepScroll: true, back: function () { go('style'); } },
        [
          h('div', { class: 'pay-hero' }, [h('img', { src: f.style.largeUrl || f.style.imageUrl, alt: '', decoding: 'async' }), h('span', { class: 'pay-hero-tag', text: f.style.title + ' · با چهره‌ی تو' })]),
          list,
          discBox,
          h('p', { class: 'muted small', text: 'اعتبار باقی‌مانده در حسابت می‌ماند. ساخت ناموفق؟ اعتبارت خودکار برمی‌گردد.' })
        ],
        [
          cta('بساز، همین الان', function () { pay(chosen, disc); }, { trail: toman(finalTotal), icon: 'lock' }),
          h('p', { class: 'muted small center', text: 'پرداخت امن با درگاه زیبال؛ بعد از پرداخت به همین صفحه برمی‌گردی.' })
        ]
      );
    }

    function currentPack() {
      if (f.pack === 'single') return { id: 'single', kind: 'single' };
      var n = parseInt(String(f.pack).replace('pack', ''), 10) || 5;
      return { id: f.pack, kind: 'pack', credits: n };
    }

    function applyCode() {
      var code = String(f.dCode || '').trim();
      if (!code) { f.disc = null; f.dErr = 'کد تخفیف را وارد کن'; render(); return; }
      var pk = currentPack();
      f.dBusy = true; f.dErr = ''; render();
      api('POST', '/discount', { kind: pk.kind, credits: pk.credits, code: code }).then(function (d) {
        f.dBusy = false;
        if (d && d.ok) {
          f.disc = { code: d.code, label: d.label, originalToman: d.originalToman, finalToman: d.finalToman, packId: pk.id };
          f.dErr = '';
        } else {
          f.disc = null;
          f.dErr = (d && d.message) || 'کد تخفیف معتبر نیست';
        }
        render();
      }).catch(function (e) {
        f.dBusy = false; f.disc = null;
        f.dErr = e && e.status === 429 ? 'تلاش زیاد بود؛ چند دقیقه بعد دوباره امتحان کن.' : ((e && e.message && e.status === 422) ? e.message : 'بررسی کد ممکن نشد؛ دوباره امتحان کن.');
        render();
      });
    }

    function pay(pack, disc) {
      f.busy = true; render();
      ssSet(PENDING_KEY, JSON.stringify({ style: f.style, styles: f.styles.slice(0, 12), variant: f.variant, category: f.category, selfieId: f.selfieId, others: f.others.map(function (o) { return { selfieId: o && o.selfieId || null }; }), at: Date.now() }));
      var body = pack.id === 'single'
        ? { kind: 'single', slug: f.style.slug, returnUrl: location.href.split('#')[0] }
        : { kind: 'pack', credits: pack.credits, slug: f.style.slug, returnUrl: location.href.split('#')[0] };
      if (disc && disc.packId === pack.id && disc.code) body.code = disc.code;
      api('POST', '/checkout', body).then(function (d) {
        track('checkout', f.variant);
        location.href = d.url;
      }).catch(function (e) { setError(friendly(e)); });
    }

    /* ---------- step 4: generating ---------- */

    function selfieIdsFor(style) {
      var ids = f.selfieId ? [f.selfieId] : [];
      var need = peopleOf(style);
      for (var k = 1; k < need; k++) { var o = f.others[k - 1]; if (o && o.selfieId) ids.push(o.selfieId); }
      return ids;
    }
    function hasFacesFor(style) {
      return selfieIdsFor(style).length >= peopleOf(style);
    }

    function startGeneration() {
      f.busy = true;
      f.job = null;
      go('gen');
      api('POST', '/generate', { slug: f.style.slug, selfieIds: selfieIdsFor(f.style) }).then(function (d) {
        track('generate', f.variant);
        f.job = d.job; f.busy = false; f.startedAt = Date.now();
        render(); poll();
      }).catch(function (e) {
        f.busy = false;
        if (e.code === 'insufficient_credits') {
          getConfig().then(function (cfg) { f.config = cfg; go('pay'); });
          return;
        }
        f.step = 'style';
        setError(friendly(e));
      });
    }

    function poll() {
      clearTimeout(pollTimer);
      if (!f.job) return;
      pollTimer = setTimeout(function () {
        api('GET', '/generate/' + encodeURIComponent(f.job.id)).then(function (d) {
          f.job = d.job;
          if (d.job.status === 'COMPLETED') {
            track('delivered', f.variant);
            loadMe().then(function () {
              if (openState) go('done');
              else Toast.ready(function () { reopen('done'); });
            });
            return;
          }
          if (d.job.status === 'FAILED' || d.job.status === 'CANCELED') {
            f.step = 'gen';
            f.failed = true;
            if (openState) render();
            return;
          }
          if (Date.now() - f.startedAt > 6 * 60 * 1000) { f.failed = true; if (openState) render(); return; }
          // Only rebuild the sheet when the stage actually changes; a full
          // re-render every poll re-decoded the image and made the page janky.
          if (openState && f.step === 'gen' && d.job.status !== f.shownStatus) render();
          poll();
        }).catch(function () { poll(); });
      }, 3000);
    }

    function reopen(step) {
      ensureHost();
      openState = true;
      host.style.display = 'block';
      document.documentElement.style.overflow = 'hidden';
      go(step);
    }

    function stepGen() {
      var status = f.job ? f.job.status : 'QUEUED';
      f.shownStatus = status;
      if (f.failed) {
        frame(
          { title: 'این بار ساخت کامل نشد', dark: true },
          [h('p', { class: 'sheet-sub', text: 'نگران نباش؛ اعتبارت خودکار برگشت. می‌توانی دوباره امتحان کنی یا استایل دیگری انتخاب کنی.' })],
          [cta('دوباره بساز', function () { f.failed = false; startGeneration(); }), h('button', { type: 'button', class: 'ghost', onclick: function () { f.failed = false; go('style'); }, text: 'انتخاب استایل دیگر' })]
        );
        return;
      }
      frame(
        { title: 'پرتره‌ات در حال ساخت است', sub: 'معمولاً کمتر از یک دقیقه طول می‌کشد', dark: true, minimize: true },
        [
          f.paidNotice ? h('div', { class: 'paid', role: 'status' }, [icon('check', 18), h('span', { text: 'پرداخت با موفقیت انجام شد؛ داریم عکست را می‌سازیم.' })]) : null,
          h('div', { class: 'gen-art' }, [h('img', { src: f.style.largeUrl || f.style.imageUrl, alt: '', decoding: 'async' }), h('span', { class: 'scan', 'aria-hidden': 'true' })]),
          h('ul', { class: 'stages' }, [
            h('li', { class: 'done' }, [icon('check', 16), 'سلفی دریافت شد']),
            h('li', { class: status !== 'QUEUED' ? 'done' : 'now' }, [status !== 'QUEUED' ? icon('check', 16) : h('span', { class: 'spin' }), 'چهره‌ات شناسایی شد']),
            h('li', { class: status === 'PROCESSING' ? 'now' : '' }, [h('span', { class: 'spin' }), 'اعمال استایل ' + f.style.title])
          ]),
          h('p', { class: 'box muted small', text: 'لازم نیست منتظر بمانی. پنجره را کوچک کن و مطلب را بخوان؛ آماده که شد همین‌جا خبرت می‌کنیم.' })
        ],
        null
      );
    }

    /* ---------- step 5: delivered ---------- */

    function suggestBox(credits) {
      var others = (f.styles || []).filter(function (s) { return s.slug !== f.style.slug; }).slice(0, 10);
      if (!others.length) {
        return h('div', { class: 'box row-between' }, [
          h('strong', { text: credits > 0 ? fa(credits) + ' پرتره‌ی دیگر در حسابت داری' : 'یک استایل دیگر هم امتحان کن' }),
          h('button', { type: 'button', class: 'pill', onclick: function () { go('style'); }, text: 'استایل بعدی' })
        ]);
      }
      return h('div', { class: 'box' }, [
        h('div', { class: 'box-head' }, [
          h('strong', { text: 'این‌ها هم به چهره‌ات می‌آید' }),
          credits > 0 ? h('span', { class: 'muted small', text: fa(credits) + ' اعتبار داری' }) : null
        ]),
        h('div', { class: 'mini-rail' }, others.map(function (s) {
          return h('button', { type: 'button', class: 'mini', onclick: function () {
            f.style = s; f.job = null; f.paidNotice = false;
            if (credits > 0 && hasFacesFor(s)) startGeneration(); else go('style');
          } }, [h('img', { src: s.imageUrl, alt: '', loading: 'lazy', decoding: 'async' }), h('span', { text: s.title })]);
        }))
      ]);
    }

    function stepDone() {
      var outs = (f.job && f.job.outputs) || [];
      var credits = f.me ? Number(f.me.imageCredits || 0) : 0;
      var shareBtn = navigator.share ? h('button', { type: 'button', class: 'ghost', onclick: function () {
        navigator.share({ title: 'پرتره‌ی من', text: 'این پرتره را با هوش مصنوعی ساختم', url: location.href.split('?')[0] }).catch(function () {});
      } }, [icon('share', 18), 'ارسال برای دوستان']) : null;

      frame(
        { title: 'پرتره‌ات آماده است', sub: f.style.title + ' · کیفیت کامل', dark: true },
        [
          h('div', { class: 'results' }, outs.map(function (o) {
            return h('a', { class: 'result', href: o.url, target: '_blank', rel: 'noopener' }, h('img', { src: o.url, alt: 'پرتره‌ی ساخته‌شده' }));
          })),
          h('div', { class: 'row-gap' }, [
            outs[0] ? h('a', { class: 'cta as-link', href: outs[0].url, target: '_blank', rel: 'noopener', download: 'portrait.jpg' }, [icon('down', 18), h('span', { text: 'ذخیره‌ی پرتره' })]) : null,
            shareBtn
          ]),
          h('a', { class: 'saved', href: String(C.apiBase).replace(/\/$/, '') + '/dashboard/generations', target: '_blank', rel: 'noopener' }, [
            h('span', { class: 'saved-ic' }, icon('check', 16)),
            h('span', { class: 'saved-txt' }, [h('strong', { text: 'در حساب پرامپت بامای تو ذخیره شد' }), h('small', { text: 'هر وقت خواستی با همین شماره وارد شو و دوباره دانلودش کن' })]),
            h('span', { class: 'saved-go', text: 'مشاهده' })
          ]),
          suggestBox(credits),
          C.supportUrl ? h('a', { class: 'unhappy', href: C.supportUrl, target: '_blank', rel: 'noopener' }, [
            h('span', { text: 'از نتیجه راضی نیستی؟' }), h('strong', { text: 'در تلگرام پیام بده' })
          ]) : null,
          f.selfieId ? h('button', { type: 'button', class: 'link small', onclick: function () {
            api('DELETE', '/selfies/' + encodeURIComponent(f.selfieId)).then(function () {
              f.selfieId = null; return loadMe();
            }).then(function () { setError(''); Toast.say('سلفی‌ات پاک شد.'); }).catch(function (e) { setError(friendly(e)); });
          } }, [icon('trash', 14), 'پاک کردن سلفی از حسابم']) : null
        ],
        null
      );
    }

    return {
      open: open,
      isOpen: function () { return openState; },
      resumeAfterPayment: function () {
        var params = new URLSearchParams(location.search);
        var status = params.get('pbs_pay');
        if (!status) return;
        params.delete('pbs_pay');
        var clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
        try { history.replaceState(null, '', clean); } catch (e) { /* ignore */ }
        var pending = null;
        try { pending = JSON.parse(ssGet(PENDING_KEY) || 'null'); } catch (e) { pending = null; }
        ssSet(PENDING_KEY, null);
        if (!pending || !pending.style || !token()) return;
        open(pending, false);
        f.selfieId = pending.selfieId || null;
        f.others = (pending.others || []).map(function (o) { return { selfieId: (o && o.selfieId) || null, lid: null }; });
        if (status === 'ok') {
          track('paid', f.variant);
          f.paidNotice = true;
          go('gen');
          loadMe().then(function () { startGeneration(); });
        } else {
          getConfig().then(function (cfg) {
            f.config = cfg; go('pay');
            setError('پرداخت انجام نشد یا لغو شد. اگر مبلغی کم شده، طی ۷۲ ساعت برمی‌گردد.');
          });
        }
      }
    };
  })();

  /* --------------------------------- toast --------------------------------- */

  var Toast = (function () {
    var host = null, root = null, timer = null;
    function ensure() {
      if (host) return;
      host = h('div', { class: 'pbs-toast-host' });
      host.style.cssText = 'position:fixed;left:0;right:0;bottom:16px;z-index:2147483500;pointer-events:none';
      document.body.appendChild(host);
      root = shadowHost(host);
    }
    function show(node, ms) {
      ensure();
      root.querySelectorAll('.toast').forEach(function (n) { n.remove(); });
      root.appendChild(node);
      clearTimeout(timer);
      if (ms) timer = setTimeout(function () { node.remove(); }, ms);
    }
    return {
      say: function (msg) { show(h('div', { class: 'toast', role: 'status', text: msg }), 3500); },
      ready: function (onOpen) {
        var n = h('div', { class: 'toast', role: 'status' }, [
          h('span', { text: 'پرتره‌ات آماده است' }),
          h('button', { type: 'button', class: 'pill', onclick: function () { n.remove(); onOpen(); }, text: 'ببین' })
        ]);
        show(n, 0);
      }
    };
  })();

  /* --------------------------------- boot --------------------------------- */

  function boot() {
    var hosts = document.querySelectorAll('.pbs-root');
    if (!hosts.length) return;
    var pending = Array.prototype.slice.call(hosts);
    function mount(el) {
      if (el.__pbs) return;
      el.__pbs = true;
      try { mountCard(el); } catch (e) { el.style.display = 'none'; }
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); mount(e.target); } });
      }, { rootMargin: '800px 0px' });
      pending.forEach(function (el) { io.observe(el); });
    } else {
      pending.forEach(mount);
    }
    Flow.resumeAfterPayment();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
