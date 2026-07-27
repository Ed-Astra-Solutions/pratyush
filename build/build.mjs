#!/usr/bin/env node
/**
 * Pratyush Liftz site build.
 *
 *   node build/build.mjs build     frontend/ + content/site.json  ->  dist/
 *   node build/build.mjs extract   frontend/ markup               ->  content/site.json text keys
 *
 * The site stays plain hand-written HTML. Editable copy is marked in the
 * markup itself and swapped in at build time:
 *
 *   data-cms="key"          replace the element's inner HTML
 *   data-cms-list="key"     replace a <ul>'s children with one <li> per array item
 *   data-cms-href="key"     replace the href attribute
 *   data-cms-src="key"      replace the src attribute
 *   data-cms-content="key"  replace the content attribute (meta tags)
 *   <!-- PL:NAME:START -->  region rendered from a collection in site.json
 *
 * No dependencies: this runs on stock Node 20 in CI and on the EC2 box.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'frontend');
const CONTENT = join(FRONTEND, 'content', 'site.json');
const PAGES = ['index.html', 'blog/index.html', 'apply/index.html'];

const VOID_TAGS = new Set(['meta', 'img', 'br', 'hr', 'input', 'link', 'source']);

/* ── tiny HTML helpers ─────────────────────────────────────────────── */

/** Every `<tag ... attr="key" ...>` in document order. */
function findHooks(html, attr) {
  const re = new RegExp(`<([a-zA-Z][\\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\\s${attr}="([^"]+)"`, 'g');
  const out = [];
  for (const m of html.matchAll(re)) {
    out.push({ tag: m[1].toLowerCase(), key: m[3], start: m.index });
  }
  return out;
}

/** End index of the open tag that starts at `start`. */
function openTagEnd(html, start) {
  let i = start, quote = null;
  while (i < html.length) {
    const c = html[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
    i++;
  }
  throw new Error(`unterminated tag at ${start}`);
}

/** [innerStart, innerEnd) for the element opening at `start`, matching nesting. */
function innerRange(html, start, tag) {
  const innerStart = openTagEnd(html, start);
  if (VOID_TAGS.has(tag)) return [innerStart, innerStart];
  const re = new RegExp(`<(/?)${tag}\\b`, 'gi');
  re.lastIndex = innerStart;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return [innerStart, m.index];
  }
  throw new Error(`unclosed <${tag}> at ${start}`);
}

/** Replace one attribute's value on the open tag starting at `start`. */
function setAttr(html, start, attr, value) {
  const end = openTagEnd(html, start);
  const tag = html.slice(start, end);
  const re = new RegExp(`(\\s${attr}=")[^"]*(")`);
  if (!re.test(tag)) throw new Error(`no ${attr} on tag at ${start}`);
  return html.slice(0, start) + tag.replace(re, `$1${escapeAttr(value)}$2`) + html.slice(end);
}

function getAttr(html, start, attr) {
  const tag = html.slice(start, openTagEnd(html, start));
  return tag.match(new RegExp(`\\s${attr}="([^"]*)"`))?.[1] ?? '';
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/* ── content access ────────────────────────────────────────────────── */

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function set(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  let node = obj;
  for (const p of parts) node = node[p] ??= {};
  node[last] = value;
}

/* ── collection renderers ──────────────────────────────────────────── */
/* Each returns markup byte-identical in shape to the hand-written original,
   so the built page stays diffable against the source. */

const stagger = (i, steps) => (i % steps === 0 ? '' : ` style="transition-delay:.${String(i % steps * 8).padStart(2, '0')}s"`);

const renderers = {
  TRANSFORMATIONS: (items) => items.map((t, i) => `
      <figure class="tf-card rv"${stagger(i, 3)}>
        <figure><img src="${escapeAttr(t.image)}" alt="${escapeAttr(t.alt)}" title="${escapeAttr(t.title)}" loading="lazy"></figure>
        <figcaption><b>${t.name}</b><span>${t.stat}</span></figcaption>
        <p class="tf-story">${t.story}</p>
      </figure>`).join('') + '\n      ',

  VIDEOS: (items) => (items.length ? items.map((v, i) => {
    const media = v.type === 'file'
      ? `<video src="${escapeAttr(v.src)}" controls playsinline preload="metadata"${v.poster ? ` poster="${escapeAttr(v.poster)}"` : ''}></video>`
      : `<iframe src="${escapeAttr(v.src)}" title="${escapeAttr(v.name)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    return `
      <figure class="vid-card${v.wide ? ' wide' : ''} rv"${stagger(i, 3)}>
        <div class="media">${media}</div>
        <figcaption><b>${v.name}</b><span>${v.label}</span></figcaption>
      </figure>`;
  }).join('') + '\n      ' : '\n      '),

  STATS: (items) => items.map((s, i) => `
        <div class="rv"${i === 0 ? '' : ` style="transition-delay:.${String(i * 6).padStart(2, '0')}s"`}><b data-count="${escapeAttr(s.count)}" data-suffix="${escapeAttr(s.suffix)}">0</b><span>${s.label}</span></div>`).join('') + '\n      ',

  FAQ: (items) => items.map((f) => `
      <div class="faq-item rv"><button class="faq-q">${f.q}</button><div class="faq-a"><p>${f.a}</p></div></div>`).join('') + '\n      ',

  POSTS: (items) => items.map((p) => `
    <article class="post">
      <span class="tag">${p.tag}</span>
      <h2>${p.title}</h2>
      <p>${p.excerpt}</p>
      ${p.url ? `<a class="more" href="${escapeAttr(p.url)}">Read →</a>` : `<span class="more">${p.cta || 'Read soon →'}</span>`}
    </article>`).join('') + '\n    ',

  FORM: renderForm,
};
renderForm.raw = true;   // gets the applyForm object, not an array

/* ── application form ──────────────────────────────────────────────── */

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Entrance animation + stagger, in the Elementor idiom the page documents. */
const anim = (kind, i = 0) => ` data-anim="${kind}"${i ? ` data-anim-delay="${i * 70}"` : ''}`;

function renderScreen(id, inner) {
  return `\n  <section class="screen" data-screen="${id}">${inner}\n  </section>\n`;
}

function optionsBlock(step) {
  return `
    <div class="opts" role="${step.type === 'multi' ? 'group' : 'radiogroup'}" aria-label="${escapeAttr(step.question)}">${
    step.options.map((o, i) => `
      <button type="button" class="opt" data-value="${escapeAttr(o)}"${anim('fade-up', i + 2)} role="${step.type === 'multi' ? 'checkbox' : 'radio'}" aria-checked="false">
        <span class="key" aria-hidden="true">${ALPHA[i] || i + 1}</span>
        <span class="val">${o}</span>
        <svg class="tick" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>
      </button>`).join('')}
    </div>`;
}

function fieldsBlock(step) {
  return `
    <div class="grid">${step.fields.map((f, i) => `
      <div class="fl"${anim('fade-up', i + 2)}>
        <label for="f-${f.key}">${f.label}${f.required ? ' <span class="req">*</span>' : ''}</label>
        <div class="line">
          <input id="f-${f.key}" name="${escapeAttr(f.key)}" type="${escapeAttr(f.inputType || 'text')}"
                 placeholder="${escapeAttr(f.placeholder || '')}" autocomplete="${f.key === 'name' ? 'name' : f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'off'}"${f.required ? ' required' : ''}>
          <span class="under"></span>
        </div>
      </div>`).join('')}
    </div>`;
}

function textBlock(step) {
  return `
    <div class="textwrap"${anim('fade-up', 2)}>
      <div class="line">
        <input id="f-${step.id}" name="${escapeAttr(step.id)}" type="text" placeholder="${escapeAttr(step.placeholder || '')}" autocomplete="off"${step.required ? ' required' : ''}>
        <span class="under"></span>
      </div>
    </div>`;
}

function renderForm(form) {
  const L = form.labels;
  const total = form.steps.length;

  const welcome = renderScreen('welcome', `
    <p class="eyebrow"${anim('fade-down')}>${form.welcome.eyebrow}</p>
    <h1 class="mast"${anim('fade-up', 1)}>${form.welcome.title}</h1>
    <p class="lead"${anim('fade-up', 2)}>${form.welcome.body}</p>
    <div class="actions"${anim('fade-up', 3)}>
      <button type="button" class="btn start"><span class="label">${form.welcome.cta}</span> <span class="arrow">→</span></button>
      <span class="hint">or ${L.enterHint}</span>
    </div>
    <p class="note"${anim('fade-in', 4)}>${form.welcome.note}</p>`);

  const steps = form.steps.map((step, i) => {
    const last = i === total - 1;
    const body = step.type === 'contact' ? fieldsBlock(step)
      : step.type === 'text' ? textBlock(step)
      : optionsBlock(step);
    // Single-selects advance on click, so they need no Next button.
    const showNext = last || step.type !== 'single';
    return renderScreen(step.id, `
    <p class="eyebrow"${anim('fade-down')}>${String(i + 1).padStart(2, '0')} — ${escapeAttr(step.type === 'multi' ? L.multi : `Question ${i + 1} of ${total}`)}</p>
    <h2 class="q"${anim('fade-up', 1)}><span class="n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>${step.question}</h2>
    <p class="desc"${anim('fade-up', 1)}>${step.description || ''}</p>${body}
    <div class="actions"${anim('fade-up', (step.options?.length || step.fields?.length || 1) + 2)}>${showNext ? `
      <button type="button" class="btn next"><span class="label">${last ? L.submit : L.next}</span> <span class="arrow">→</span></button>` : ''}
      <button type="button" class="btn ghost back">${L.back}</button>${showNext ? `
      <span class="hint">${L.enterHint}</span>` : ''}
    </div>
    <p class="err" role="alert"></p>`);
  }).join('');

  const success = renderScreen('success', `
    <svg class="mark" viewBox="0 0 74 74" aria-hidden="true"><circle cx="37" cy="37" r="33"/><path d="M23 38.5l10 10 19-22"/></svg>
    <h2 class="mast"${anim('fade-up', 1)}>${form.success.title}</h2>
    <p class="lead"${anim('fade-up', 2)}>${form.success.body}</p>
    <div class="actions"${anim('fade-up', 3)}><a class="btn" href="/"><span class="label">${form.success.cta}</span> <span class="arrow">→</span></a></div>`);

  const disqualify = renderScreen('disqualify', `
    <h2 class="mast"${anim('fade-up')}>${form.disqualify.title}</h2>
    <p class="lead"${anim('fade-up', 1)}>${form.disqualify.body}</p>
    <div class="actions"${anim('fade-up', 2)}><a class="btn ghost" href="/">${form.disqualify.cta}</a></div>`);

  // Everything the page script needs to drive validation and branching.
  const config = {
    api: process.env.PL_API_BASE || 'https://api.pratyushfitness.edastra.in',
    labels: L,
    steps: form.steps.map((s) => ({
      id: s.id, type: s.type, required: !!s.required,
      ...(s.disqualifyOn ? { disqualifyOn: s.disqualifyOn } : {}),
      ...(s.fields ? { fields: s.fields.map((f) => ({ key: f.key, label: f.label, inputType: f.inputType, required: !!f.required })) } : {}),
    })),
  };

  return `${welcome}${steps}${success}${disqualify}
  <p class="nojs">Send this application by email to <a href="mailto:hello@pratyushliftz.com">hello@pratyushliftz.com</a> — the interactive version needs JavaScript.</p>
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <label for="pl-website">Leave this empty</label>
    <input id="pl-website" name="website" type="text" tabindex="-1" autocomplete="off">
  </div>
  <script id="pl-form-config" type="application/json">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>
  `;
}

const COLLECTION_KEYS = {
  TRANSFORMATIONS: 'transformations', VIDEOS: 'videoClips',
  STATS: 'stats', FAQ: 'faqs', POSTS: 'posts', FORM: 'applyForm',
};

function renderRegions(html, content) {
  for (const [name, key] of Object.entries(COLLECTION_KEYS)) {
    const open = `<!-- PL:${name}:START -->`;
    const close = `<!-- PL:${name}:END -->`;
    const a = html.indexOf(open);
    if (a === -1) continue;
    const b = html.indexOf(close, a);
    if (b === -1) throw new Error(`missing ${close}`);
    const render = renderers[name];
    const items = content[key] ?? (render.raw ? null : []);
    if (!render.raw && !Array.isArray(items)) throw new Error(`content.${key} must be an array`);
    if (render.raw && !items) throw new Error(`content.${key} is missing`);
    html = html.slice(0, a + open.length) + render(items) + html.slice(b);
  }
  return html;
}

/* ── build ─────────────────────────────────────────────────────────── */

function applyContent(html, content, page) {
  const missing = [];

  // Attribute hooks first: they do not move any inner offsets around.
  for (const attr of ['href', 'src', 'content']) {
    let hooks = findHooks(html, `data-cms-${attr}`);
    // Re-scan after each write; setAttr can change byte offsets.
    for (let n = 0; n < hooks.length; n++) {
      hooks = findHooks(html, `data-cms-${attr}`);
      const h = hooks[n];
      const value = get(content, h.key);
      if (value == null) { missing.push(`${page}:${h.key}`); continue; }
      html = setAttr(html, h.start, attr, value);
    }
  }

  // Inner-HTML hooks, applied back-to-front so earlier offsets stay valid.
  const inner = findHooks(html, 'data-cms').reverse();
  for (const h of inner) {
    const value = get(content, h.key);
    if (value == null) { missing.push(`${page}:${h.key}`); continue; }
    const [s, e] = innerRange(html, h.start, h.tag);
    html = html.slice(0, s) + value + html.slice(e);
  }

  const lists = findHooks(html, 'data-cms-list').reverse();
  for (const h of lists) {
    const items = get(content, h.key);
    if (!Array.isArray(items)) { missing.push(`${page}:${h.key}`); continue; }
    const [s, e] = innerRange(html, h.start, h.tag);
    const body = items.map((li) => `\n          <li>${li}</li>`).join('') + '\n        ';
    html = html.slice(0, s) + body + html.slice(e);
  }

  if (missing.length) throw new Error(`content keys missing from site.json:\n  ${missing.join('\n  ')}`);
  html = renderRegions(html, content);
  // The hooks are authoring metadata; the shipped page stays clean.
  return html.replace(/ data-cms(?:-href|-src|-content|-list)?="[^"]*"/g, '');
}

function build(outDir = join(ROOT, 'dist')) {
  const content = JSON.parse(readFileSync(CONTENT, 'utf8'));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Static assets: everything in frontend/ except the HTML we template and
  // the content source itself (it is not needed at runtime).
  cpSync(FRONTEND, outDir, {
    recursive: true,
    filter: (src) => !src.startsWith(join(FRONTEND, 'content')) && !PAGES.some((p) => src === join(FRONTEND, p)),
  });

  for (const page of PAGES) {
    const html = applyContent(readFileSync(join(FRONTEND, page), 'utf8'), content, page);
    const dest = join(outDir, page);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
  }

  // The admin console is deployed separately, from Ed-Astra-Solutions/pratyushAdmin,
  // so it is not on the public marketing domain at all.

  writeFileSync(join(outDir, 'build.json'), JSON.stringify({
    builtAt: new Date().toISOString(),
    contentUpdatedAt: content.updatedAt ?? null,
    commit: process.env.GITHUB_SHA ?? null,
  }, null, 2) + '\n');

  console.log(`built -> ${outDir}`);
}

/* ── extract (markup -> site.json, used once to seed and to re-sync) ── */

function extract() {
  const content = existsSync(CONTENT) ? JSON.parse(readFileSync(CONTENT, 'utf8')) : {};
  for (const page of PAGES) {
    const html = readFileSync(join(FRONTEND, page), 'utf8');
    for (const h of findHooks(html, 'data-cms')) {
      const [s, e] = innerRange(html, h.start, h.tag);
      set(content, h.key, html.slice(s, e));
    }
    for (const attr of ['href', 'src', 'content']) {
      for (const h of findHooks(html, `data-cms-${attr}`)) {
        if (get(content, h.key) == null) set(content, h.key, getAttr(html, h.start, attr));
      }
    }
    for (const h of findHooks(html, 'data-cms-list')) {
      const [s, e] = innerRange(html, h.start, h.tag);
      set(content, h.key, [...html.slice(s, e).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].trim()));
    }
  }
  writeFileSync(CONTENT, JSON.stringify(content, null, 2) + '\n');
  console.log(`extracted -> ${CONTENT}`);
}

const cmd = process.argv[2] ?? 'build';
if (cmd === 'build') build(process.argv[3] ? resolve(process.argv[3]) : undefined);
else if (cmd === 'extract') extract();
else { console.error(`unknown command: ${cmd}`); process.exit(1); }

export { applyContent, build };
