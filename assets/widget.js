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
    if (forced === 'a' || forced === 'b' || forced === 'c') return forced;
    if (C.variant === 'a' || C.variant === 'b' || C.variant === 'c') return C.variant;
    var key = C.variant === 'abc' ? 'pbs_variant3' : 'pbs_variant';
    var saved = lsGet(key);
    var allowed = C.variant === 'abc' ? ['a', 'b', 'c'] : ['a', 'b'];
    if (allowed.indexOf(saved) !== -1) return saved;
    var v = C.variant === 'abc'
      ? allowed[Math.floor(Math.random() * 3)]
      : (Math.random() * 100 < Number(C.abSplit || 50) ? 'b' : 'a');
    lsSet(key, v);
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

  /* Resize a phone photo to max 1600px JPEG (~200–400 KB) before upload; on
     slow mobile networks the original multi-MB file was the main delay. */
  function shrinkPhoto(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type) || file.size < 450 * 1024 || !window.createImageBitmap && !window.FileReader) { resolve(file); return; }
      var done = function (blob) { resolve(blob && blob.size < file.size ? new File([blob], 'selfie.jpg', { type: 'image/jpeg' }) : file); };
      var draw = function (img, w, h) {
        try {
          var max = 1600, scale = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(done, 'image/jpeg', 0.86);
        } catch (e) { resolve(file); }
      };
      if (window.createImageBitmap) {
        createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) { draw(bmp, bmp.width, bmp.height); }).catch(function () { resolve(file); });
      } else {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () { draw(im, im.naturalWidth, im.naturalHeight); URL.revokeObjectURL(url); };
        im.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
        im.src = url;
      }
    });
  }

  var catsCache = null;
  function getCategories() {
    if (!catsCache) catsCache = api('GET', '/categories').then(function (d) { return (d && d.categories) || []; }).catch(function () { return []; });
    return catsCache;
  }
  var pageCache = {};
  function getStylePage(cat, page, size) {
    size = size || 4;
    var key = (cat || '_') + ':' + page + ':' + size;
    if (!pageCache[key]) {
      var q = '?limit=' + size + '&page=' + page + (cat ? '&cat=' + encodeURIComponent(cat) : '') + (C.stylesTag ? '&tag=' + encodeURIComponent(C.stylesTag) : '');
      pageCache[key] = api('GET', '/styles' + q).then(function (d) { return { styles: (d && d.styles) || [], hasMore: !!(d && d.hasMore) }; });
      pageCache[key].catch(function () { delete pageCache[key]; });
    }
    return pageCache[key];
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

  /* ------------------------- design C (white & calm) ------------------------- */

  function mountCardC(host, layout, category, root) {
    var TC = T.c || {};
    var wrap = h('div', { class: 'wrap', 'data-variant': 'c', 'data-layout': layout });
    root.appendChild(wrap);
    // Legend sits on the border: give it the page's own background colour.
    try {
      var bg = getComputedStyle(host.parentElement || document.body).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') host.style.setProperty('--pbs-c-legend-bg', bg);
    } catch (e) { /* ignore */ }

    var state = { cats: [], cat: '', items: [], page: 0, hasMore: false, loading: true, picked: 0 };

    function picked() { return state.items[state.picked]; }
    function start() {
      var s = picked();
      if (!s) return;
      Flow.open({ style: s, styles: state.items, variant: 'c', category: category });
    }
    function loadMore() {
      state.loading = true; render();
      getStylePage(state.cat, state.page + 1).then(function (d) {
        var have = {};
        state.items.forEach(function (x) { have[x.slug] = 1; });
        d.styles.forEach(function (x) { if (!have[x.slug]) state.items.push(x); });
        state.page += 1; state.hasMore = d.hasMore && d.styles.length > 0;
        state.loading = false; render();
      }).catch(function () { state.loading = false; render(); });
    }
    function chooseCat(slug) {
      if (slug === state.cat && state.items.length) return;
      state.cat = slug; state.items = []; state.page = 0; state.picked = 0; state.hasMore = false;
      loadMore();
    }

    function render() {
      var prevChips = wrap.querySelector('.c-chips');
      var keep = prevChips ? prevChips.scrollLeft : 0;
      wrap.innerHTML = '';
      var grid;
      if (!state.items.length && state.loading) {
        grid = h('div', { class: 'c-grid' }, [0, 1, 2, 3].map(function () { return h('span', { class: 'c-skel', 'aria-hidden': 'true' }); }));
      } else if (!state.items.length) {
        grid = h('p', { class: 'c-empty', text: 'برای این دسته هنوز نمونه‌ای نداریم؛ یک دسته‌ی دیگر را ببینید.' });
      } else {
        grid = h('div', { class: 'c-grid' }, state.items.map(function (s, i) {
          var on = i === state.picked;
          return h('button', { type: 'button', class: 'c-item' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { state.picked = i; render(); } }, [
            h('span', { class: 'c-img' }, [
              h('img', { src: s.imageUrl, alt: s.title, loading: 'lazy', decoding: 'async' }),
              peopleBadge(s),
              on ? h('span', { class: 'c-check' }, icon('check', 14)) : null
            ]),
            h('span', { class: 'c-name', text: s.title })
          ]);
        }));
      }
      var card = h('section', { class: 'c-card', 'aria-label': (TC.legend || 'استودیو تصویرسازی') + ' — ساخت عکس با چهره‌ی خودتان' }, [
        h('span', { class: 'c-legend' }, [icon('camera', 16), TC.legend || 'استودیو تصویرسازی']),
        h('h2', { class: 'c-title', text: TC.title || 'همان عکسی که همیشه دلتان می‌خواست، با چهره‌ی خودتان' }),
        h('p', { class: 'c-sub', text: TC.sub || 'فقط یک عکس ساده از خودتان بفرستید؛ چند دقیقه بعد یک پرتره‌ی رسمی، عکس خانوادگی یا قاب یادگاری تحویل بگیرید که دلتان بخواهد قابش کنید.' }),
        state.cats.length > 1 ? h('div', { class: 'c-chips', role: 'tablist', 'aria-label': 'نوع عکس' }, state.cats.map(function (c) {
          return h('button', { type: 'button', role: 'tab', class: 'c-chip', 'aria-selected': c.slug === state.cat ? 'true' : 'false', onclick: function () { chooseCat(c.slug); }, text: c.name });
        })) : null,
        grid,
        state.hasMore ? h('button', { type: 'button', class: 'c-more', disabled: state.loading ? true : null, onclick: loadMore }, [icon('chevron', 16), state.loading ? 'در حال آوردن…' : 'مشاهده‌ی نمونه‌های بیشتر']) : null,
        h('div', { class: 'c-foot' }, [
          h('ul', { class: 'c-trust' }, [
            h('li', {}, [icon('shield', 18), h('span', { text: T.privacy || 'عکس شما خصوصی می‌ماند و فقط در حساب خودتان است.' })]),
            T.guarantee ? h('li', {}, [icon('check', 18), C.supportUrl ? h('a', { href: C.supportUrl, target: '_blank', rel: 'noopener', text: T.guarantee }) : h('span', { text: T.guarantee })]) : null,
            T.social ? h('li', {}, [h('span', { class: 'social-dot', 'aria-hidden': 'true' }), h('span', { text: faDigits(T.social) })]) : null
          ]),
          h('button', { type: 'button', class: 'c-cta', disabled: !picked() ? true : null, onclick: start, text: TC.cta || 'این عکس را با چهره‌ی من بسازید' })
        ]),
        brandLine()
      ]);
      wrap.appendChild(card);
      var chips = wrap.querySelector('.c-chips');
      if (chips && keep) chips.scrollLeft = keep;
    }

    render();
    var wanted = String(C.cCategories || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    getCategories().then(function (cats) {
      var list;
      if (wanted.length) {
        var by = {};
        cats.forEach(function (c) { by[c.slug] = c; });
        list = wanted.map(function (slug) { return by[slug]; }).filter(Boolean);
      } else {
        list = cats.slice().sort(function (a, b) { return b.postCount - a.postCount; }).slice(0, 6);
      }
      state.cats = [{ slug: '', name: 'همه' }].concat(list.map(function (c) { return { slug: c.slug, name: c.name }; }));
      // Start on the category mapped to this article, if it is one of the chips.
      var start = list.filter(function (c) { return c.slug === category; })[0];
      state.cat = start ? start.slug : '';
      return getStylePage(state.cat, 1);
    }).then(function (d) {
      if (!d.styles.length && state.cat) { state.cat = ''; return getStylePage('', 1); }
      return d;
    }).then(function (d) {
      state.items = d.styles; state.page = 1; state.hasMore = d.hasMore; state.loading = false;
      if (!state.items.length) { host.style.display = 'none'; return; }
      host.style.minHeight = '';
      render();
      watchVisibility(host, 'c');
      if (layout === 'inline') Floating.register(host, function () { return { style: picked(), styles: state.items, variant: 'c', category: category }; });
    }).catch(function () { host.style.display = 'none'; });
  }

  function mountCard(host) {
    var forced = host.getAttribute('data-variant');
    var variant = pickVariant(forced);
    var layout = host.getAttribute('data-layout') === 'sidebar' ? 'sidebar' : 'inline';
    var category = host.getAttribute('data-category') || '';
    var root = shadowHost(host);
    host.style.background = 'transparent';
    if (variant === 'c') { mountCardC(host, layout, category, root); return; }
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
    var host = null, root = null, getCtx = null, shown = false, blocked = false;
    function show(on) {
      if (on && blocked) on = false;
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
        root.appendChild(h('div', { class: 'float' + (ctx.variant === 'c' ? ' is-light' : '') }, [
          h('button', { type: 'button', class: 'float-btn', onclick: function () { Flow.open(getCtx()); } }, [
            h('span', { class: 'float-thumbs' }, (ctx.styles || []).slice(0, 3).map(function (s) { return h('img', { src: s.imageUrl, alt: '' }); })),
            h('span', { class: 'float-text', text: T.floating || '' }),
            h('span', { class: 'float-go', text: ctx.variant === 'c' ? 'ساخت عکس' : 'بساز' })
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
      hide: function () { show(false); },
      block: function (on) { blocked = !!on; if (on) show(false); }
    };
  })();

  /* --------------------------------- flow --------------------------------- */

  var Flow = (function () {
    var host = null, root = null, mountEl = null, sheet = null, lastFocus = null, fitSheet = null;
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

      // Mobile keyboard: keep the sheet inside the visible area and the
      // focused field in view, instead of letting the keyboard cover it.
      var vv = window.visualViewport;
      function fit() {
        if (!vv || !openState) return;
        host.style.top = vv.offsetTop + 'px';
        host.style.height = vv.height + 'px';
        host.style.bottom = 'auto';
        var s = root.querySelector('.sheet');
        if (s) s.style.maxHeight = Math.round(vv.height * 0.96) + 'px';
      }
      if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
      fitSheet = fit;
      root.addEventListener('focusin', function (e) {
        var el = e.target;
        if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.type === 'file') return;
        setTimeout(function () { fit(); try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { /* ignore */ } }, 320);
      });
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
      Toast.clear();
      host.style.display = 'block';
      document.documentElement.style.overflow = 'hidden';
      track('open', f.variant);
      getConfig().then(function (cfg) { if (f) f.config = f.config || cfg; }).catch(function () {});
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
      backgroundPill();
    }

    // While a portrait is being made in the background, keep a small pill on
    // screen so the user can always get back to it after minimizing.
    function backgroundPill() {
      if (!f || openState) return;
      var c = f.variant === 'c';
      if (f.step === 'gen' && f.failed) { Toast.failed(function () { reopen('gen'); }, c); return; }
      if (f.step === 'gen' && (f.busy || (f.job && f.job.status !== 'COMPLETED'))) {
        Toast.working(function () { reopen('gen'); }, c);
      }
    }

    var JOB_KEY = 'pbs_job';
    function saveJob() {
      if (!f || !f.job) { ssSet(JOB_KEY, null); return; }
      ssSet(JOB_KEY, JSON.stringify({ id: f.job.id, t: f.startedAt || Date.now(), style: f.style, styles: (f.styles || []).slice(0, 8), variant: f.variant, category: f.category }));
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

    // Design C speaks to an older audience: formal «شما» and warmer words.
    function cx(base, warm) { return f && f.variant === 'c' ? warm : base; }

    // Which account is signed in here, with its balance and a way out — the
    // widget keeps its own login per site, separate from promptbama.com.
    function accountLine() {
      if (!f.me || !token() || f.step === 'gen' || f.step === 'auth') return null;
      var credits = Number(f.me.imageCredits || 0);
      return h('div', { class: 'acct' }, [
        h('span', {}, ['وارد شده با ', h('bdi', { dir: 'ltr', text: faDigits(f.me.phone || '') }), ' · اعتبار: ' + fa(credits) + ' عکس']),
        h('button', { type: 'button', class: 'link small', onclick: logout, text: cx('حساب دیگر', 'ورود با حساب دیگر') })
      ]);
    }
    function logout() {
      lsSet(TOKEN_KEY, null);
      f.me = null; f.selfieId = null; f.lid = null; f.locals = []; f.phone = ''; f.exists = null;
      (f.others || []).forEach(function (o) { if (o) { o.selfieId = null; o.lid = null; } });
      go('style');
    }

    function frame(opts, body, footer) {
      var prevMini = mountEl.querySelector('.mini-rail');
      var keepMini = prevMini ? prevMini.scrollLeft : 0;
      var prevBody = mountEl.querySelector('.sheet-body');
      var keepBody = prevBody && opts.keepScroll ? prevBody.scrollTop : 0;
      mountEl.innerHTML = '';
      mountEl.className = 'flow-mount' + (f.variant === 'c' ? ' is-light' : '');
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
        accountLine(),
        f.error ? h('p', { class: 'alert', role: 'alert', text: f.error }) : null
      ].concat(body));
      sheet.appendChild(top);
      sheet.appendChild(content);
      if (footer) sheet.appendChild(h('div', { class: 'sheet-foot' }, footer));
      overlay.appendChild(sheet);
      mountEl.appendChild(overlay);
      var mini = mountEl.querySelector('.mini-rail');
      if (mini && keepMini) mini.scrollLeft = keepMini;
      if (fitSheet) fitSheet();
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

    /* One photo box for everyone. The user taps photos to pick them; for a
       two/three-person style the picks are numbered (person 1, 2, 3). */
    function picks() {
      var out = [];
      if (f.selfieId || f.lid) out.push({ selfieId: f.selfieId, lid: f.lid });
      f.others.forEach(function (o) { if (o && (o.selfieId || o.lid)) out.push({ selfieId: o.selfieId, lid: o.lid }); });
      return out;
    }
    function setPicks(list) {
      var p0 = list[0] || {};
      f.selfieId = p0.selfieId || null; f.lid = p0.lid || null;
      f.others = list.slice(1).map(function (x) { return { selfieId: x.selfieId || null, lid: x.lid || null }; });
    }
    function sameRef(a, b) { return (a.selfieId && a.selfieId === b.selfieId) || (a.lid && a.lid === b.lid); }
    function togglePick(ref, people) {
      var list = picks();
      var at = -1;
      list.forEach(function (x, i) { if (sameRef(x, ref)) at = i; });
      if (at !== -1) { list.splice(at, 1); }
      else if (people === 1) { list = [ref]; }
      else if (list.length < people) { list.push(ref); }
      else { list[list.length - 1] = ref; }
      setPicks(list.slice(0, people));
    }
    function pickIndex(ref) {
      var list = picks(), at = -1;
      list.forEach(function (x, i) { if (sameRef(x, ref)) at = i; });
      return at;
    }
    var ORD = ['۱', '۲', '۳'];
    var WHO = ['نفر اول', 'نفر دوم', 'نفر سوم'];

    function photoBox(people, selfies) {
      var list = picks();
      if (list.length > people) { setPicks(list.slice(0, people)); list = picks(); }
      var inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, class: 'sr', id: 'pbs-file', onchange: function (e) {
        var files = Array.prototype.slice.call((e.target.files || []));
        files.forEach(function (file) {
          if (file.size > 25 * 1024 * 1024) { setError('حجم عکس زیاد است (حداکثر ۲۵ مگابایت).'); return; }
          var item = { lid: 'l' + (++lidSeq), file: file, preview: URL.createObjectURL(file) };
          f.locals.push(item);
          var cur = picks();
          if (people === 1) setPicks([{ lid: item.lid }]);
          else if (cur.length < people) { cur.push({ lid: item.lid }); setPicks(cur); }
        });
        e.target.value = '';
        f.addedMany = f.locals.length > 1 || files.length > 1;
        if (files.length) track('selfie', f.variant, true);
        setError(''); render();
      } });

      function thumb(ref, src, onRemove, removeLabel) {
        var at = pickIndex(ref);
        var on = at !== -1;
        return h('span', { class: 'selfie-wrap' }, [
          h('button', { type: 'button', class: 'selfie' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false',
            'aria-label': on && people > 1 ? 'عکس ' + WHO[at] : 'انتخاب این عکس',
            onclick: function () { togglePick(ref, people); render(); } }, [
            h('img', { src: src, alt: '' }),
            on && people > 1 ? h('span', { class: 'pick-no', text: ORD[at] }) : null
          ]),
          h('button', { type: 'button', class: 'selfie-x', 'aria-label': removeLabel, disabled: f.removing ? true : null, onclick: onRemove }, icon('close', 14))
        ]);
      }
      var items = [];
      f.locals.forEach(function (it) {
        items.push(thumb({ lid: it.lid }, it.preview, function () {
          URL.revokeObjectURL(it.preview);
          f.locals = f.locals.filter(function (x) { return x.lid !== it.lid; });
          setPicks(picks().filter(function (x) { return x.lid !== it.lid; }));
          setError(''); render();
        }, 'برداشتن این عکس'));
      });
      selfies.forEach(function (sf) {
        items.push(thumb({ selfieId: sf.id }, sf.url, function () {
          f.removing = true; render();
          api('DELETE', '/selfies/' + encodeURIComponent(sf.id)).then(function () {
            setPicks(picks().filter(function (x) { return x.selfieId !== sf.id; }));
            return loadMe();
          }).then(function () {
            f.removing = false; setError(''); render(); Toast.say('سلفی پاک شد.');
          }).catch(function (e) { f.removing = false; setError(friendly(e)); });
        }, 'حذف این سلفی از حسابم'));
      });
      items.push(h('label', { class: 'selfie add', for: 'pbs-file' }, [icon('camera', 20), h('span', { text: items.length ? 'عکس دیگر' : 'عکس بگیر یا انتخاب کن' })]));

      // Guidance that matches what they picked.
      var count = list.length;
      var total = f.locals.length + selfies.length;
      var hint;
      if (people > 1 && count < people) {
        hint = { cls: 'hint is-warn', text: 'این طرح ' + (people === 2 ? 'دونفره' : 'سه‌نفره') + ' است؛ عکس ' + WHO[count] + ' را هم اضافه یا انتخاب کن.' };
      } else if (people > 1) {
        hint = { cls: 'hint is-ok', text: 'عکس‌ها به ترتیب شماره برای ' + WHO.slice(0, people).join('، ') + ' استفاده می‌شوند.' };
      } else if (total > 1 && f.addedMany) {
        hint = { cls: 'hint', text: 'این طرح تک‌نفره است و فقط عکسِ تیک‌خورده استفاده می‌شود. برای عکس دونفره یک طرح «دونفره» انتخاب کن.' };
      }
      return h('div', { class: 'box' }, [
        h('div', { class: 'box-head' }, [
          h('strong', { text: people > 1 ? 'عکس هر ' + (people === 2 ? 'دو' : 'سه') + ' نفر' : 'سلفی‌ات را اضافه کن' }),
          people > 1
            ? h('span', { class: count >= people ? 'ok-chip' : 'muted' }, count >= people ? [icon('check', 12), 'آماده'] : [fa(count) + ' از ' + fa(people)])
            : h('span', { class: 'muted', text: 'یک عکس کافی است' })
        ]),
        h('div', { class: 'selfies' }, items),
        inp,
        hint ? h('p', { class: hint.cls, role: 'status', text: hint.text }) : null,
        h('p', { class: 'muted small', text: 'نور روشن، صورت از روبه‌رو و بدون عینک آفتابی؛ نتیجه شبیه‌تر می‌شود.' })
      ]);
    }

    function loadMoreStyles() {
      if (f.moreBusy) return;
      f.moreBusy = true; render();
      var size = 8;
      f.morePage = f.morePage || Math.floor(f.styles.length / size);
      getStylePage('', f.morePage + 1, size).then(function (d) {
        var have = {};
        f.styles.forEach(function (x) { have[x.slug] = 1; });
        d.styles.forEach(function (x) { if (!have[x.slug]) f.styles.push(x); });
        f.morePage += 1;
        f.noMore = !d.hasMore || !d.styles.length;
        f.moreBusy = false; render();
      }).catch(function () { f.moreBusy = false; render(); });
    }

    function stepStyle() {
      var selfies = (f.me && f.me.selfies) || [];
      var rail = h('div', { class: 'mini-rail' }, f.styles.map(function (s) {
        var on = s.slug === f.style.slug;
        return h('button', { type: 'button', class: 'mini' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { f.style = s; render(); } }, [
          h('span', { class: 'mini-img' }, [h('img', { src: s.imageUrl, alt: '', loading: 'lazy', decoding: 'async' }), peopleBadge(s)]), h('span', { text: s.title })
        ]);
      }).concat(f.noMore ? [] : [h('button', { type: 'button', class: 'mini mini-more', disabled: f.moreBusy ? true : null, onclick: loadMoreStyles }, [
        h('span', { class: 'mini-more-ic' }, icon(f.moreBusy ? 'chevron' : 'plus', 22)),
        h('span', { text: f.moreBusy ? 'در حال آوردن…' : 'طرح‌های بیشتر' })
      ])]));

      var people = peopleOf(f.style);
      var boxes = [photoBox(people, selfies)];
      var complete = picks().length >= people;
      frame(
        { title: cx('استایلت را انتخاب کن', 'کدام قاب، قصه‌ی شماست؟'), stepLabel: 'قدم ۱ از ۳', dark: true, keepScroll: true },
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
          title: f.exists === null ? cx('پرتره‌ات را کجا نگه داریم؟', 'عکس‌هایتان را کجا برایتان نگه داریم؟') : f.exists ? cx('خوش برگشتی', 'خوش برگشتید') : cx('یک رمز بگذار و تمام', 'یک رمز بگذارید؛ همین.'),
          sub: f.exists === null ? cx('با شماره موبایلت یک حساب ساده می‌سازیم تا پرتره‌ها و اعتبارت همیشه در دسترست باشد.', 'با شماره موبایلتان یک حساب ساده می‌سازیم تا عکس‌های یادگاری‌تان همیشه امن و در دسترس بمانند.') : null,
          stepLabel: 'قدم ۲ از ۳', dark: true, back: function () { go('style'); }
        },
        [h('form', { class: 'form', onsubmit: function (e) { e.preventDefault(); var b = sheet.querySelector('.sheet-foot .cta'); if (b) b.click(); } }, body.concat([h('button', { type: 'submit', class: 'sr', tabindex: '-1', 'aria-hidden': 'true' })]))],
        footer.concat([C.termsUrl ? h('p', { class: 'muted small center' }, ['ادامه یعنی پذیرش ', h('a', { href: C.termsUrl, target: '_blank', rel: 'noopener', text: 'شرایط استفاده' })]) : null])
      );
    }

    /* ---------- after auth: upload selfie, then pay or generate ---------- */

    /* Upload the chosen local photos (once). Returns a promise that resolves
       when every chosen person has a saved selfie id. */
    function uploadChosen() {
      if (f.uploading) return f.uploading;
      var need = peopleOf(f.style);
      var lids = [];
      for (var i = 0; i < need; i++) { var sel = selOf(i); if (sel.lid && lids.indexOf(sel.lid) === -1) lids.push(sel.lid); }
      if (!lids.length) return Promise.resolve();
      var chain = Promise.resolve();
      lids.forEach(function (lid) {
        chain = chain.then(function () {
          var it = f.locals.filter(function (x) { return x.lid === lid; })[0];
          if (!it) return;
          return shrinkPhoto(it.file).then(function (small) {
            var fd = new FormData();
            fd.append('file', small, small.name || 'selfie.jpg');
            return api('POST', '/selfies', fd);
          }).then(function (d) {
            for (var k = 0; k < need; k++) { if (selOf(k).lid === lid) setSel(k, d.selfie.id, null); }
            URL.revokeObjectURL(it.preview);
            f.locals = f.locals.filter(function (x) { return x.lid !== lid; });
          });
        });
      });
      f.uploading = chain.then(function () { f.uploading = null; }, function (e) { f.uploading = null; throw e; });
      return f.uploading;
    }

    function proceed() {
      var credits = f.me ? Number(f.me.imageCredits || 0) : 0;
      if (credits >= 1) {
        f.busy = true; render();
        uploadChosen().then(function () { f.busy = false; startGeneration(); })
          .catch(function (e) { f.busy = false; f.step = 'style'; setError(friendly(e)); });
        return;
      }
      // No credit: show prices right away while the photo uploads behind it.
      var up = uploadChosen();
      up.catch(function (e) { setError(friendly(e)); });
      if (f.config) { go('pay'); return; }
      f.busy = true; render();
      getConfig().then(function (cfg) { f.busy = false; f.config = cfg; go('pay'); })
        .catch(function (e) { f.busy = false; setError(friendly(e)); });
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
            h('span', { class: 'pack-title' }, [x.title, x.badge ? h('span', { class: 'badge', text: 'خیلی به‌صرفه' }) : null]),
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
        { title: cx('پرتره‌ات یک قدم با تو فاصله دارد', 'عکس یادگاری‌تان یک قدم با شما فاصله دارد'), stepLabel: 'قدم آخر', dark: true, keepScroll: true, back: function () { go('style'); } },
        [
          h('div', { class: 'pay-hero' }, [h('img', { src: f.style.largeUrl || f.style.imageUrl, alt: '', decoding: 'async' }), h('span', { class: 'pay-hero-tag', text: f.style.title + ' · با چهره‌ی تو' })]),
          list,
          discBox,
          h('p', { class: 'muted small', text: 'اعتبار باقی‌مانده در حسابت می‌ماند. ساخت ناموفق؟ اعتبارت خودکار برمی‌گردد.' })
        ],
        [
          cta(cx('بساز، همین الان', 'همین حالا بسازید'), function () { pay(chosen, disc); }, { trail: toman(finalTotal), icon: 'lock' }),
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
      (f.uploading || Promise.resolve()).then(function () { payNow(pack, disc); })
        .catch(function (e) { f.busy = false; f.step = 'style'; setError(friendly(e)); });
    }
    function payNow(pack, disc) {
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
        saveJob();
        if (openState) render(); else backgroundPill();
        poll();
      }).catch(function (e) {
        f.busy = false;
        if (!openState) Toast.clear();
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
            ssSet(JOB_KEY, null);
            loadMe().then(function () {
              if (openState) go('done');
              else Toast.ready(function () { reopen('done'); }, f.variant === 'c');
            });
            return;
          }
          if (d.job.status === 'FAILED' || d.job.status === 'CANCELED') {
            f.step = 'gen';
            f.failed = true;
            ssSet(JOB_KEY, null);
            if (openState) render(); else backgroundPill();
            return;
          }
          if (Date.now() - f.startedAt > 6 * 60 * 1000) { f.failed = true; ssSet(JOB_KEY, null); if (openState) render(); else backgroundPill(); return; }
          // Only rebuild the sheet when the stage actually changes; a full
          // re-render every poll re-decoded the image and made the page janky.
          if (openState && f.step === 'gen' && d.job.status !== f.shownStatus) render();
          poll();
        }).catch(function () { poll(); });
      }, 3000);
    }

    function reopen(step) {
      ensureHost();
      Toast.clear();
      Floating.hide();
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
          { title: cx('این بار ساخت کامل نشد', 'این بار عکس آن‌طور که باید نشد'), dark: true },
          [h('p', { class: 'sheet-sub', text: cx('نگران نباش؛ اعتبارت خودکار برگشت. می‌توانی دوباره امتحان کنی یا استایل دیگری انتخاب کنی.', 'نگران نباشید؛ اعتبارتان خودکار برگشت. یک بار دیگر امتحان کنید یا طرح دیگری انتخاب کنید.') })],
          [cta('دوباره بساز', function () { f.failed = false; startGeneration(); }), h('button', { type: 'button', class: 'ghost', onclick: function () { f.failed = false; go('style'); }, text: 'انتخاب استایل دیگر' })]
        );
        return;
      }
      frame(
        { title: cx('پرتره‌ات در حال ساخت است', 'داریم عکس یادگاری‌تان را می‌سازیم'), sub: cx('معمولاً کمتر از یک دقیقه طول می‌کشد', 'معمولاً کمتر از یک دقیقه؛ چیزی که منتظرش بودید در راه است.'), dark: true, minimize: true },
        [
          f.paidNotice ? h('div', { class: 'paid', role: 'status' }, [icon('check', 18), h('span', { text: cx('پرداخت با موفقیت انجام شد؛ داریم عکست را می‌سازیم.', 'پرداخت با موفقیت انجام شد؛ داریم عکستان را می‌سازیم.') })]) : null,
          h('div', { class: 'gen-art' }, [h('img', { src: f.style.largeUrl || f.style.imageUrl, alt: '', decoding: 'async' }), h('span', { class: 'scan', 'aria-hidden': 'true' })]),
          h('ul', { class: 'stages' }, [
            h('li', { class: 'done' }, [icon('check', 16), 'سلفی دریافت شد']),
            h('li', { class: status !== 'QUEUED' ? 'done' : 'now' }, [status !== 'QUEUED' ? icon('check', 16) : h('span', { class: 'spin' }), 'چهره‌ات شناسایی شد']),
            h('li', { class: status === 'PROCESSING' ? 'now' : '' }, [h('span', { class: 'spin' }), 'اعمال استایل ' + f.style.title])
          ]),
          h('p', { class: 'box muted small', text: cx('لازم نیست منتظر بمانی. پنجره را کوچک کن و مطلب را بخوان؛ آماده که شد همین‌جا خبرت می‌کنیم.', 'لازم نیست منتظر بمانید. پنجره را کوچک کنید و مطلب را بخوانید؛ آماده که شد همین‌جا خبرتان می‌کنیم.') })
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
          h('strong', { text: cx('این‌ها هم به چهره‌ات می‌آید', 'این قاب‌ها هم به شما می‌آید') }),
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
      function grab(url) {
        return fetch(url).then(function (r) { if (!r.ok) throw new Error('fetch'); return r.blob(); }).then(function (blob) {
          var ext = /png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg';
          return new File([blob], 'portrait-' + Date.now() + '.' + ext, { type: blob.type || 'image/jpeg' });
        });
      }
      function saveFile(file) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }
      // Save to gallery: download the file itself. On iPhone/iPad a download
      // lands in Files, so open the share sheet there («Save Image» → Photos).
      var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      var saveBtn = outs[0] ? h('button', { type: 'button', class: 'cta', disabled: f.saving ? true : null, onclick: function () {
        f.saving = true; render();
        grab(outs[0].url).then(function (file) {
          f.saving = false; render();
          if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
            return navigator.share({ files: [file] }).catch(function () {});
          }
          saveFile(file);
          Toast.say(cx('عکس در گالری‌ات ذخیره شد.', 'عکس در گالری شما ذخیره شد.'));
        }).catch(function () {
          f.saving = false; render();
          setError(cx('دانلود انجام نشد؛ یک بار دیگر بزن.', 'دانلود انجام نشد؛ لطفاً یک بار دیگر بزنید.'));
        });
      } }, [icon('down', 18), h('span', { text: f.saving ? 'در حال ذخیره…' : 'ذخیره در گالری' })]) : null;
      // Share the portrait itself (as an image file), not the article link.
      var shareBtn = outs[0] ? h('button', { type: 'button', class: 'ghost', disabled: f.sharing ? true : null, onclick: function () {
        f.sharing = true; render();
        fetch(outs[0].url).then(function (r) { if (!r.ok) throw new Error('fetch'); return r.blob(); }).then(function (blob) {
          var ext = /png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg';
          var file = new File([blob], 'portrait.' + ext, { type: blob.type || 'image/jpeg' });
          f.sharing = false; render();
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            return navigator.share({ files: [file], title: 'پرتره‌ی من' }).catch(function () {});
          }
          saveFile(file);
          Toast.say(cx('عکس ذخیره شد؛ از گالری برای دوستانت بفرست.', 'عکس ذخیره شد؛ از گالری برای عزیزانتان بفرستید.'));
        }).catch(function () {
          f.sharing = false; render();
          window.open(outs[0].url, '_blank', 'noopener');
        });
      } }, [icon('share', 18), f.sharing ? 'آماده‌سازی…' : cx('ارسال برای دوستان', 'ارسال برای عزیزان')]) : null;

      frame(
        { title: cx('پرتره‌ات آماده است', 'همان عکسی که می‌خواستید، آماده است'), sub: f.style.title + ' · کیفیت کامل', dark: true },
        [
          h('div', { class: 'results' }, outs.map(function (o) {
            return h('div', { class: 'result' }, h('img', { src: o.url, alt: 'پرتره‌ی ساخته‌شده' }));
          })),
          h('div', { class: 'row-gap' }, [
            saveBtn,
            shareBtn
          ]),
          h('a', { class: 'saved', href: String(C.apiBase).replace(/\/$/, '') + '/dashboard/generations', target: '_blank', rel: 'noopener' }, [
            h('span', { class: 'saved-ic' }, icon('check', 16)),
            h('span', { class: 'saved-txt' }, [h('strong', { text: cx('در حساب پرامپت بامای تو ذخیره شد', 'در حساب پرامپت بامای شما ذخیره شد') }), h('small', { text: cx('هر وقت خواستی با همین شماره وارد شو و دوباره دانلودش کن', 'هر وقت خواستید با همین شماره وارد شوید و دوباره دانلودش کنید') })]),
            h('span', { class: 'saved-go', text: 'مشاهده' })
          ]),
          suggestBox(credits),
          C.supportUrl ? h('a', { class: 'unhappy', href: C.supportUrl, target: '_blank', rel: 'noopener' }, [
            h('span', { text: cx('از نتیجه راضی نیستی؟', 'دقیقاً همانی نشد که می‌خواستید؟') }), h('strong', { text: cx('در تلگرام پیام بده', 'در تلگرام بگویید تا درستش کنیم') })
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
      resumeJob: function () {
        if (f) return;
        var saved = null;
        try { saved = JSON.parse(ssGet(JOB_KEY) || 'null'); } catch (e) { saved = null; }
        if (!saved || !saved.id || !saved.style || !token() || Date.now() - saved.t > 6 * 60 * 1000) { ssSet(JOB_KEY, null); return; }
        ensureHost();
        f = {
          style: saved.style, styles: saved.styles || [saved.style], variant: saved.variant || 'a',
          category: saved.category || '', selfieId: null, lid: null, locals: [], others: [],
          me: null, phone: '', exists: null, error: '', busy: false, pack: 'pack5',
          job: { id: saved.id, status: 'PROCESSING' }, startedAt: saved.t, step: 'gen'
        };
        backgroundPill();
        poll();
      },
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
    function clear() { clearTimeout(timer); Floating.block(false); if (root) root.querySelectorAll('.toast').forEach(function (n) { n.remove(); }); }
    function sticky(cls, label, btn, onOpen, light) {
      var n = h('button', { type: 'button', class: 'toast toast-job ' + cls + (light ? ' is-light' : ''), role: 'status', onclick: function () { clear(); onOpen(); } }, [
        cls === 'is-working' ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : null,
        h('span', { text: label }),
        h('span', { class: 'pill', text: btn })
      ]);
      show(n, 0);
      Floating.block(true);
    }
    return {
      clear: clear,
      working: function (onOpen, light) { sticky('is-working', light ? 'عکس شما در حال ساخت است…' : 'پرتره‌ات در حال ساخت است…', 'دیدن', onOpen, light); },
      failed: function (onOpen, light) { sticky('is-failed', light ? 'ساخت کامل نشد؛ اعتبارتان برگشت' : 'ساخت کامل نشد؛ اعتبارت برگشت', 'دوباره', onOpen, light); },
      say: function (msg) { show(h('div', { class: 'toast', role: 'status', text: msg }), 3500); },
      ready: function (onOpen, light) {
        var n = h('div', { class: 'toast' + (light ? ' is-light' : ''), role: 'status' }, [
          h('span', { text: light ? 'عکس شما آماده است' : 'پرتره‌ات آماده است' }),
          h('button', { type: 'button', class: 'pill', onclick: function () { clear(); onOpen(); }, text: 'ببین' })
        ]);
        show(n, 0);
        Floating.block(true);
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
    Flow.resumeJob();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
