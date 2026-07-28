/**
 * Pratyush Liftz — runtime content.
 *
 * The site is plain hand-written HTML served straight from this repo, with
 * no build step. This script is what makes the admin console mean anything:
 * it loads content/site.json in the browser and swaps the editable parts of
 * the page for whatever is in that file.
 *
 * The markup itself declares what is editable, exactly as the old build
 * script did:
 *
 *   data-cms="key"          replace the element's inner HTML
 *   data-cms-list="key"     replace a <ul>'s children with one <li> per item
 *   data-cms-href="key"     replace the href attribute
 *   data-cms-src="key"      replace the src attribute
 *   data-cms-content="key"  replace the content attribute (meta tags)
 *   <!-- PL:NAME:START -->  region rendered from a collection in site.json
 *
 * The HTML keeps a full copy of the current content as its fallback, so a
 * failed or slow fetch degrades to the page exactly as it ships. Nothing
 * here is required for the page to be readable.
 *
 * Pages await window.PL_CMS_READY before running their own scripts, so
 * everything downstream sees the final DOM.
 */
window.PL_CMS_READY = (() => {
  const CONTENT_URL = '/content/site.json';

  const domReady = document.readyState === 'loading'
    ? new Promise((r) => addEventListener('DOMContentLoaded', r, { once: true }))
    : Promise.resolve();

  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  /** Copy may carry inline <b>/<em>; data- attributes want the plain text. */
  const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '');

  /* ── collection regions ──────────────────────────────────────────── */
  /* Each renderer returns the same markup the page ships with, so the
     rendered page stays diffable against the static fallback. */

  /* ── responsive images ───────────────────────────────────────────── */
  /* The images that ship with the repo have resized .jpg/.webp siblings on
     disk (see images/image-metadata.md): pl-x-480.webp, pl-x-768.jpg and so
     on. This map records the intrinsic size and which widths exist, so a
     phone can fetch a 20 KB file instead of the full-size original.
     Anything uploaded later is simply absent here and renders as a plain
     <img>, exactly as before. */
  const VARIANTS = {
    'images/pl-pratyush-coach-training.jpg': [1290, 1353, [480, 768, 1200]],
    'images/pl-pratyush-founder-poster.jpg': [1082, 1353, [480, 768]],
    'images/pl-team-banner-welcome.jpg': [1600, 600, [480, 768, 1200]],
    'images/pl-transformation-chandra.jpg': [385, 206, []],
    'images/pl-transformation-dad.jpg': [1021, 798, [480, 768]],
    'images/pl-transformation-fayaz.jpg': [1420, 811, [480, 768, 1200]],
    'images/pl-transformation-garv.jpg': [1724, 729, [480, 768, 1200]],
    'images/pl-transformation-harsh.jpg': [1011, 905, [480, 768]],
    'images/pl-transformation-parth.jpg': [769, 669, [480]],
  };

  /** <picture> with webp + jpg srcsets, or a plain <img> for unknown files. */
  function responsiveImg(src, sizes, attrs) {
    const v = VARIANTS[src];
    if (!v) return `<img src="${esc(src)}" ${attrs}>`;
    const [w, h, widths] = v;
    const stem = src.slice(0, -4);
    const set = (ext) => [...widths.map((n) => `${stem}-${n}.${ext} ${n}w`),
                          `${stem}.${ext} ${w}w`].join(', ');
    return `<picture><source type="image/webp" srcset="${esc(set('webp'))}" sizes="${esc(sizes)}">`
      + `<img src="${esc(src)}" srcset="${esc(set('jpg'))}" sizes="${esc(sizes)}"`
      + ` width="${w}" height="${h}" ${attrs} decoding="async"></picture>`;
  }

  const TF_SIZES = '(max-width:980px) calc(100vw - 64px), 33vw';

  const stagger = (i, steps) =>
    (i % steps === 0 ? '' : ` style="transition-delay:.${String((i % steps) * 8).padStart(2, '0')}s"`);

  const renderers = {
    TRANSFORMATIONS: (items) => items.map((t, i) => {
      const data = [
        `data-name="${esc(t.name)}"`,
        `data-stat="${esc(t.stat)}"`,
        `data-story="${esc(strip(t.story))}"`,
        t.full ? `data-full="${esc(t.full)}"` : '',
        t.video ? `data-video="${esc(t.video)}"` : '',
        t.video ? `data-video-type="${esc(t.videoType || 'embed')}"` : '',
        t.video && t.videoWide ? 'data-video-wide="1"' : '',
        t.video && t.poster ? `data-poster="${esc(t.poster)}"` : '',
      ].filter(Boolean).join(' ');
      const badge = t.video
        ? '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6 3.5l11 6.5-11 6.5z"/></svg>'
        : '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="M13.5 13.5L18 18M9 6.5v5M6.5 9h5"/></svg>';
      return `
      <figure class="tf-card rv${t.video ? ' has-video' : ''}"${stagger(i, 3)} role="button" tabindex="0" ${data} aria-label="${esc(`${t.name} — ${t.stat}. Open full ${t.video ? 'video' : 'photo'}`)}">
        <figure>${responsiveImg(t.image, TF_SIZES, `alt="${esc(t.alt)}" title="${esc(t.title)}" loading="lazy"`)}</figure>
        <span class="zoom">${badge}</span>
        <figcaption><b>${t.name}</b><span>${t.stat}</span></figcaption>
        <p class="tf-story">${t.story}</p>
      </figure>`;
    }).join(''),

    VIDEOS: (items) => items.map((v, i) => {
      const media = v.type === 'file'
        ? `<video src="${esc(v.src)}" controls playsinline preload="metadata"${v.poster ? ` poster="${esc(v.poster)}"` : ''}></video>`
        : `<iframe src="${esc(v.src)}" title="${esc(v.name)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      return `
      <figure class="vid-card${v.wide ? ' wide' : ''} rv"${stagger(i, 3)}>
        <div class="media">${media}</div>
        <figcaption><b>${v.name}</b><span>${v.label}</span></figcaption>
      </figure>`;
    }).join(''),

    STATS: (items) => items.map((s, i) => `
        <div class="rv"${i === 0 ? '' : ` style="transition-delay:.${String(i * 6).padStart(2, '0')}s"`}><b data-count="${esc(s.count)}" data-suffix="${esc(s.suffix)}">0</b><span>${s.label}</span></div>`).join(''),

    FAQ: (items) => items.map((f) => `
      <div class="faq-item rv"><button class="faq-q">${f.q}</button><div class="faq-a"><p>${f.a}</p></div></div>`).join(''),

    /* A post with nothing written yet still gets its card — it just has
       nowhere to go, exactly as the teaser cards behave today. */
    POSTS: (items) => window.PL_POSTS.published(items).map((p) => {
      const href = window.PL_POSTS.href(p);
      const cover = p.cover
        ? (href
          ? `\n      <a class="post-cover" href="${esc(href)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.cover)}" alt="${esc(p.coverAlt || '')}" loading="lazy"></a>`
          : `\n      <span class="post-cover"><img src="${esc(p.cover)}" alt="${esc(p.coverAlt || '')}" loading="lazy"></span>`)
        : '';
      const meta = [p.tag, window.PL_POSTS.dateLabel(p.date)].filter(Boolean)
        .map((x) => `<span>${esc(x)}</span>`).join('');
      return `
    <article class="post">${cover}
      <p class="tag">${meta}</p>
      <h2>${href ? `<a href="${esc(href)}">${p.title}</a>` : p.title}</h2>
      <p>${p.excerpt || ''}</p>
      ${href
        ? `<a class="more" href="${esc(href)}">Read <span aria-hidden="true">→</span></a>`
        : '<span class="more">Read soon <span aria-hidden="true">→</span></span>'}
    </article>`;
    }).join(''),

    FORM: renderForm,
  };
  renderForm.raw = true;   // gets the applyForm object, not an array

  /* ── blog helpers, shared with the single-post page ──────────────── */

  window.PL_POSTS = {
    /** Drafts stay out of the site entirely; newest first. */
    published: (items) => (items ?? [])
      .filter((p) => p && p.status !== 'draft' && p.title)
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))),

    /**
     * An external url wins; otherwise the post reads on its own page.
     * A post with neither a body nor a link is a teaser and goes nowhere.
     */
    href: (p) => {
      if (p.url) return p.url;
      if (p.slug && String(p.body ?? '').trim()) return `/blog/post/?s=${encodeURIComponent(p.slug)}`;
      return '';
    },

    dateLabel: (d) => {
      if (!d) return '';
      const t = new Date(d);
      return Number.isNaN(+t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    },

    find: (items, slug) => window.PL_POSTS.published(items).find((p) => p.slug === slug),
  };

  /* ── application form ────────────────────────────────────────────── */

  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const anim = (kind, i = 0) => ` data-anim="${kind}"${i ? ` data-anim-delay="${i * 70}"` : ''}`;
  const screen = (id, inner) => `\n  <section class="screen" data-screen="${id}">${inner}\n  </section>\n`;

  function optionsBlock(step) {
    return `
    <div class="opts" role="${step.type === 'multi' ? 'group' : 'radiogroup'}" aria-label="${esc(step.question)}">${
      step.options.map((o, i) => `
      <button type="button" class="opt" data-value="${esc(o)}"${anim('fade-up', i + 2)} role="${step.type === 'multi' ? 'checkbox' : 'radio'}" aria-checked="false">
        <span class="key" aria-hidden="true">${ALPHA[i] || i + 1}</span>
        <span class="val">${esc(o)}</span>
        <svg class="tick" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>
      </button>`).join('')}
    </div>`;
  }

  function fieldsBlock(step) {
    return `
    <div class="grid">${step.fields.map((f, i) => `
      <div class="fl"${anim('fade-up', i + 2)}>
        <label for="f-${esc(f.key)}">${f.label}${f.required ? ' <span class="req">*</span>' : ''}</label>
        <div class="line">
          <input id="f-${esc(f.key)}" name="${esc(f.key)}" type="${esc(f.inputType || 'text')}"
                 placeholder="${esc(f.placeholder || '')}" autocomplete="${f.key === 'name' ? 'name' : f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'off'}"${f.required ? ' required' : ''}>
          <span class="under"></span>
        </div>
      </div>`).join('')}
    </div>`;
  }

  function textBlock(step) {
    return `
    <div class="textwrap"${anim('fade-up', 2)}>
      <div class="line">
        <input id="f-${esc(step.id)}" name="${esc(step.id)}" type="text" placeholder="${esc(step.placeholder || '')}" autocomplete="off"${step.required ? ' required' : ''}>
        <span class="under"></span>
      </div>
    </div>`;
  }

  /**
   * The form opens straight on question 1 — there is no welcome screen —
   * and the page's own script drives it from the JSON config at the end.
   */
  function renderForm(form) {
    const L = form.labels;
    const total = form.steps.length;

    const steps = form.steps.map((step, i) => {
      const last = i === total - 1;
      const body = step.type === 'contact' ? fieldsBlock(step)
        : step.type === 'text' ? textBlock(step)
        : optionsBlock(step);
      // Single-selects advance on click, so they need no Next button.
      const showNext = last || step.type !== 'single';
      const n = String(i + 1).padStart(2, '0');
      return screen(step.id, `
    <p class="eyebrow"${anim('fade-down')}>${n} — ${esc(step.type === 'multi' ? L.multi : `Question ${i + 1} of ${total}`)}</p>
    <h2 class="q"${anim('fade-up', 1)}><span class="n" aria-hidden="true">${n}</span>${step.question}</h2>
    <p class="desc"${anim('fade-up', 1)}>${step.description || ''}</p>${body}
    <div class="actions"${anim('fade-up', (step.options?.length || step.fields?.length || 1) + 2)}>${showNext ? `
      <button type="button" class="btn next"><span class="label">${last ? L.submit : L.next}</span> <span class="arrow">→</span></button>` : ''}${i === 0 ? '' : `
      <button type="button" class="btn ghost back">${L.back}</button>`}${showNext ? `
      <span class="hint">${L.enterHint}</span>` : ''}
    </div>
    <p class="err" role="alert"></p>`);
    }).join('');

    const success = screen('success', `
    <svg class="mark" viewBox="0 0 74 74" aria-hidden="true"><circle cx="37" cy="37" r="33"/><path d="M23 38.5l10 10 19-22"/></svg>
    <h2 class="mast"${anim('fade-up', 1)}>${form.success.title}</h2>
    <p class="lead"${anim('fade-up', 2)}>${form.success.body}</p>
    <div class="actions"${anim('fade-up', 3)}><a class="btn" href="/"><span class="label">${form.success.cta}</span> <span class="arrow">→</span></a></div>`);

    const disqualify = screen('disqualify', `
    <h2 class="mast"${anim('fade-up')}>${form.disqualify.title}</h2>
    <p class="lead"${anim('fade-up', 1)}>${form.disqualify.body}</p>
    <div class="actions"${anim('fade-up', 2)}><a class="btn ghost" href="/">${form.disqualify.cta}</a></div>`);

    // Everything the page script needs to drive validation and branching.
    const config = {
      labels: L,
      steps: form.steps.map((s) => ({
        id: s.id, type: s.type, required: !!s.required,
        ...(s.disqualifyOn ? { disqualifyOn: s.disqualifyOn } : {}),
        ...(s.fields ? { fields: s.fields.map((f) => ({ key: f.key, label: f.label, inputType: f.inputType, required: !!f.required })) } : {}),
      })),
    };

    return `${steps}${success}${disqualify}
  <p class="nojs">Send this application by email to <a href="mailto:hello@pratyushliftz.com">hello@pratyushliftz.com</a> — the interactive version needs JavaScript.</p>
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <label for="pl-website">Leave this empty</label>
    <input id="pl-website" name="website" type="text" tabindex="-1" autocomplete="off">
  </div>
  <script id="pl-form-config" type="application/json">${JSON.stringify(config).replace(/</g, '\\u003c')}<\/script>
  `;
  }

  /* ── applying content to the page ────────────────────────────────── */

  const REGION_KEYS = {
    TRANSFORMATIONS: 'transformations', VIDEOS: 'videoClips',
    STATS: 'stats', FAQ: 'faqs', POSTS: 'posts', FORM: 'applyForm',
  };

  /** The `<!-- PL:NAME:START -->` comment node, if this page has one. */
  function findMarker(name) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
    const want = `PL:${name}:START`;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim() === want) return n;
    }
    return null;
  }

  function renderRegions(content) {
    for (const [name, key] of Object.entries(REGION_KEYS)) {
      const start = findMarker(name);
      if (!start) continue;
      const render = renderers[name];
      const items = content[key];
      if (render.raw ? !items : !Array.isArray(items)) continue;

      // Drop everything between the markers, then insert the fresh markup.
      const end = `PL:${name}:END`;
      for (let n = start.nextSibling; n && !(n.nodeType === 8 && n.nodeValue.trim() === end);) {
        const next = n.nextSibling;
        n.remove();
        n = next;
      }
      const tpl = document.createElement('template');
      tpl.innerHTML = render(items);
      start.after(tpl.content);
    }
  }

  function applyContent(content) {
    for (const [attr, sel] of [['href', 'data-cms-href'], ['src', 'data-cms-src'], ['content', 'data-cms-content']]) {
      for (const el of document.querySelectorAll(`[${sel}]`)) {
        const v = get(content, el.getAttribute(sel));
        if (v == null) continue;
        // A swapped-in image has none of the pre-generated sizes: drop the
        // srcsets baked into the markup so the browser cannot pick a 404.
        if (attr === 'src' && el.tagName === 'IMG' && el.getAttribute('src') !== v) {
          el.removeAttribute('srcset');
          el.removeAttribute('sizes');
          el.parentElement?.querySelectorAll?.(':scope > source').forEach((n) => n.remove());
        }
        el.setAttribute(attr, v);
      }
    }
    for (const el of document.querySelectorAll('[data-cms]')) {
      const v = get(content, el.dataset.cms);
      if (v != null) el.innerHTML = v;
    }
    for (const el of document.querySelectorAll('[data-cms-list]')) {
      const items = get(content, el.getAttribute('data-cms-list'));
      if (Array.isArray(items)) el.innerHTML = items.map((li) => `<li>${li}</li>`).join('');
    }
    renderRegions(content);
  }

  const load = fetch(CONTENT_URL, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`site.json ${r.status}`))))
    .catch((e) => { console.warn('[cms] using the built-in copy:', e.message); return null; });

  return Promise.all([domReady, load]).then(([, content]) => {
    window.PL_CONTENT = content;
    if (content) {
      try { applyContent(content); }
      catch (e) { console.warn('[cms] could not apply content:', e); }
    }
    document.documentElement.classList.add('cms-ready');
    return content;
  });
})();
