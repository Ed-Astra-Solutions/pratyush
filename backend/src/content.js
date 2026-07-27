/**
 * Validation for incoming content.
 *
 * The console is single-user and trusted enough to write inline HTML
 * (<b>, <em>, <br> are part of the copy), so this is not a general-purpose
 * sanitiser — it blocks the things that would turn a copy edit into a
 * persistent script on the public site, and rejects anything structurally
 * wrong before it reaches a commit.
 */

const MAX_BYTES = 512 * 1024;

const REQUIRED = ['meta', 'hero', 'links', 'applyForm'];
const STEP_TYPES = ['single', 'multi', 'text', 'contact'];
const COLLECTIONS = ['transformations', 'videoClips', 'stats', 'faqs', 'posts'];

const DANGEROUS = [
  /<\s*script\b/i,
  /<\s*\/?\s*(iframe|object|embed|form|link|style|base)\b/i,
  /\bon[a-z]+\s*=/i,          // onclick=, onerror=, …
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
];

/** Video embeds legitimately need an iframe, so their src is URL-checked instead. */
const EMBED_HOSTS = [
  'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
  'player.vimeo.com', 'www.instagram.com',
];

export function validate(content) {
  const errors = [];

  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return ['content must be a JSON object'];
  }

  const bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
  if (bytes > MAX_BYTES) errors.push(`content is ${Math.round(bytes / 1024)} KB, limit is ${MAX_BYTES / 1024} KB`);

  for (const key of REQUIRED) {
    if (!content[key] || typeof content[key] !== 'object') errors.push(`missing section: ${key}`);
  }
  for (const key of COLLECTIONS) {
    if (key in content && !Array.isArray(content[key])) errors.push(`${key} must be an array`);
  }

  if (content.links) {
    for (const [k, v] of Object.entries(content.links)) {
      if (typeof v !== 'string' || !/^(https?:\/\/|mailto:|\/|#)/.test(v)) {
        errors.push(`links.${k} must be an http(s), mailto:, / or # URL`);
      }
    }
  }

  // A malformed form would break the page that brings in every lead, so it
  // gets checked properly rather than just scanned for markup.
  const form = content.applyForm;
  if (form && typeof form === 'object') {
    if (!Array.isArray(form.steps) || !form.steps.length) errors.push('applyForm.steps must be a non-empty array');
    else {
      const ids = new Set();
      form.steps.forEach((s, i) => {
        const at = `applyForm.steps[${i}]`;
        if (!s.id || !/^[a-zA-Z0-9_]+$/.test(s.id)) errors.push(`${at}.id must be letters, numbers or underscores`);
        else if (ids.has(s.id)) errors.push(`${at}.id "${s.id}" is used twice`);
        else ids.add(s.id);
        if (!STEP_TYPES.includes(s.type)) errors.push(`${at}.type must be one of: ${STEP_TYPES.join(', ')}`);
        if (!String(s.question ?? '').trim()) errors.push(`${at}.question cannot be empty`);
        if (s.type === 'single' || s.type === 'multi') {
          if (!Array.isArray(s.options) || !s.options.length) errors.push(`${at} needs at least one option`);
          else if (s.options.some((o) => !String(o ?? '').trim())) errors.push(`${at} has a blank option`);
          if (s.disqualifyOn && !(s.options ?? []).includes(s.disqualifyOn)) {
            errors.push(`${at}.disqualifyOn does not match any of its options`);
          }
        }
        if (s.type === 'contact' && (!Array.isArray(s.fields) || !s.fields.length)) {
          errors.push(`${at} needs at least one contact field`);
        }
      });
    }
    for (const screen of ['welcome', 'success', 'disqualify', 'labels']) {
      if (!form[screen] || typeof form[screen] !== 'object') errors.push(`applyForm.${screen} is missing`);
    }
  }

  // Anything that ends up in an iframe src has its host checked, wherever it
  // came from: the video section, or a clip attached to a result card.
  const embeds = [
    ...(content.videoClips ?? []).map((c) => ({ name: c.name, src: c.src, type: c.type })),
    ...(content.transformations ?? []).filter((t) => t.video).map((t) => ({ name: t.name, src: t.video, type: t.videoType })),
  ];
  for (const clip of embeds) {
    if (clip.type === 'file') continue;
    let host;
    try { host = new URL(clip.src).host; } catch { errors.push(`video "${clip.name}": src is not a valid URL`); continue; }
    if (!EMBED_HOSTS.includes(host)) errors.push(`video "${clip.name}": ${host} is not an allowed embed host`);
  }

  walk(content, (path, value) => {
    if (path.startsWith('videoClips.') && path.endsWith('.src')) return;  // checked above
    for (const re of DANGEROUS) {
      if (re.test(value)) { errors.push(`${path}: disallowed markup (${re.source})`); return; }
    }
  });

  return errors;
}

function walk(node, fn, path = '') {
  if (typeof node === 'string') return fn(path, node);
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, fn, `${path}${path ? '.' : ''}${i}`));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, fn, `${path}${path ? '.' : ''}${k}`);
  }
}

/** Keys the server owns; whatever the client sends for these is ignored. */
export function stamp(content, who) {
  return { ...content, updatedAt: new Date().toISOString(), updatedBy: who };
}
