/**
 * Pratyush Liftz admin backend.
 *
 * Runs on a small EC2 box behind nginx + TLS. It is the only thing that
 * holds the GitHub token: the admin console (static, on GitHub Pages)
 * calls this, this commits frontend/content/site.json, and that commit
 * is what fires the Pages rebuild workflow.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { GitHub } from './github.js';
import { validate, stamp } from './content.js';
import { Submissions, STATUSES } from './submissions.js';

const {
  PORT = 8080,
  JWT_SECRET,
  ADMIN_PASSWORD_HASH,
  ADMIN_ORIGINS = '',
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH = 'main',
  GITHUB_WORKFLOW = 'deploy.yml',
  CONTENT_PATH = 'frontend/content/site.json',
  IMAGE_DIR = 'frontend/images',
  COMMITTER_NAME = 'PL Admin Console',
  COMMITTER_EMAIL = 'admin@pratyushliftz.com',
  SESSION_HOURS = 12,
  DATA_DIR = '/var/lib/pl-admin-api',
  NOTIFY_WEBHOOK = '',
  MIN_FILL_SECONDS = 8,
} = process.env;

for (const [k, v] of Object.entries({ JWT_SECRET, ADMIN_PASSWORD_HASH, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO })) {
  if (!v) { console.error(`missing required env var: ${k}`); process.exit(1); }
}

const gh = new GitHub({
  token: GITHUB_TOKEN, owner: GITHUB_OWNER, repo: GITHUB_REPO,
  branch: GITHUB_BRANCH, workflow: GITHUB_WORKFLOW,
  committer: { name: COMMITTER_NAME, email: COMMITTER_EMAIL },
});

const app = express();
app.set('trust proxy', 1);              // nginx sits in front
app.use(express.json({ limit: '12mb' })); // image uploads arrive base64-encoded

const origins = ADMIN_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
  methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
}));

/* ── auth ────────────────────────────────────────────────────────── */

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.post('/api/login', loginLimit, async (req, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== 'string' || !(await bcrypt.compare(password, ADMIN_PASSWORD_HASH))) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const token = jwt.sign({ sub: 'admin' }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
  res.json({ token, expiresInHours: Number(SESSION_HOURS) });
});

function auth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Not signed in.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired.' });
  }
}

/* ── content ─────────────────────────────────────────────────────── */

app.get('/api/content', auth, async (req, res, next) => {
  try {
    const { text, sha } = await gh.getFile(CONTENT_PATH);
    res.json({ content: JSON.parse(text), sha, path: CONTENT_PATH });
  } catch (e) { next(e); }
});

app.put('/api/content', auth, async (req, res, next) => {
  try {
    const { content, sha, message } = req.body ?? {};
    const errors = validate(content);
    if (errors.length) return res.status(400).json({ error: errors.join('; '), errors });
    if (!sha) return res.status(400).json({ error: 'Missing sha — reload the console before saving.' });

    const stamped = stamp(content, req.user.sub);
    const body = JSON.stringify(stamped, null, 2) + '\n';
    const result = await gh.putFile({
      path: CONTENT_PATH,
      contentBase64: Buffer.from(body, 'utf8').toString('base64'),
      message: (message || 'admin: update site content').slice(0, 120),
      sha,
    });

    // The push to main is what triggers the Pages build; no extra dispatch needed.
    res.json({ ...result, updatedAt: stamped.updatedAt });
  } catch (e) {
    if (e.status === 409) {
      return res.status(409).json({ error: 'Someone else edited the site since you loaded it. Reload the console and reapply your changes.' });
    }
    next(e);
  }
});

/* ── images ──────────────────────────────────────────────────────── */

const IMAGE_TYPES = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', mp4: 'mp4' };

app.post('/api/images', auth, async (req, res, next) => {
  try {
    const { filename, contentBase64 } = req.body ?? {};
    if (typeof filename !== 'string' || typeof contentBase64 !== 'string') {
      return res.status(400).json({ error: 'filename and contentBase64 are required.' });
    }
    const ext = IMAGE_TYPES[filename.split('.').pop()?.toLowerCase()];
    if (!ext) return res.status(400).json({ error: 'Allowed file types: jpg, png, webp, gif, mp4.' });

    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'File is over 8 MB — please compress it first.' });

    const slug = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'upload';
    const path = `${IMAGE_DIR}/pl-${slug}-${Date.now().toString(36)}.${ext}`;

    await gh.putFile({ path, contentBase64, message: `admin: upload ${slug}.${ext}` });
    // Paths in site.json are relative to the site root, not the repo.
    res.json({ path: path.replace(/^frontend\//, ''), repoPath: path });
  } catch (e) { next(e); }
});

/* ── builds ──────────────────────────────────────────────────────── */

app.post('/api/rebuild', auth, async (req, res, next) => {
  try { await gh.dispatchWorkflow(); res.json({ ok: true }); } catch (e) { next(e); }
});

app.get('/api/deployments', auth, async (req, res, next) => {
  try { res.json({ runs: await gh.recentRuns() }); } catch (e) { next(e); }
});

/* ── applications ────────────────────────────────────────────────── */
/* The public form posts here. Leads stay on this box and are never
   committed to the repo — only the questions are site content. */

const store = new Submissions(DATA_DIR);

const applyLimit = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 6,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many applications from this connection. Please try again later, or DM @pratyushliftz.' },
});

app.post('/api/apply', applyLimit, async (req, res, next) => {
  try {
    const { answers, meta, website } = req.body ?? {};

    // Two quiet spam signals: the honeypot field, and a form filled faster
    // than a human could read it. Both are stored as spam rather than
    // rejected, so a false positive is recoverable from the console.
    const suspected = website ? 'honeypot'
      : (Number(meta?.elapsedMs) || 0) < Number(MIN_FILL_SECONDS) * 1000 ? 'too-fast'
      : null;

    const record = store.create({
      answers, meta, suspected,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    if (!suspected && NOTIFY_WEBHOOK) notify(record).catch((e) => console.error('notify failed:', e.message));
    res.status(201).json({ ok: true, id: record.id });
  } catch (e) { next(e); }
});

/** Optional ping to Slack/Discord/whatever accepts a JSON POST. */
async function notify(record) {
  const a = record.answers;
  const name = a.contact?.name || a.name || 'Someone';
  const lines = Object.entries(a).map(([k, v]) => {
    const val = Array.isArray(v) ? v.join(', ')
      : v && typeof v === 'object' ? Object.entries(v).map(([k2, v2]) => `${k2}: ${v2}`).join(', ')
      : v;
    return `• ${k}: ${val}`;
  });
  await fetch(NOTIFY_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `New coaching application from ${name}\n${lines.join('\n')}` }),
  });
}

app.get('/api/submissions', auth, (req, res, next) => {
  try {
    const { status, limit } = req.query;
    res.json({
      submissions: store.list({ status, limit: Math.min(Number(limit) || 200, 500) }),
      counts: store.counts(),
      statuses: STATUSES,
    });
  } catch (e) { next(e); }
});

app.patch('/api/submissions/:id', auth, (req, res, next) => {
  try { res.json(store.update(req.params.id, req.body ?? {})); } catch (e) { next(e); }
});

app.get('/api/submissions.csv', auth, (req, res, next) => {
  try {
    const csv = store.toCsv(store.list({ status: req.query.status, limit: 5000 }));
    res.type('text/csv').attachment(`pl-applications-${new Date().toISOString().slice(0, 10)}.csv`).send(csv);
  } catch (e) { next(e); }
});

app.get('/health', (req, res) => res.json({ ok: true, repo: `${GITHUB_OWNER}/${GITHUB_REPO}`, branch: GITHUB_BRANCH }));

/* ── errors ──────────────────────────────────────────────────────── */

app.use((err, req, res, _next) => {
  console.error(`${req.method} ${req.path} —`, err.message);
  if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found.' });
  if (err.github) {
    return res.status(err.status < 500 ? err.status : 502).json({ error: `GitHub: ${err.message}` });
  }
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  res.status(502).json({ error: 'Upstream error, please retry.' });
});

app.listen(PORT, () => console.log(`pl-admin-api on :${PORT} → ${GITHUB_OWNER}/${GITHUB_REPO}@${GITHUB_BRANCH}`));
