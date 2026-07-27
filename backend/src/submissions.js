/**
 * Application storage.
 *
 * One JSON file per submission under DATA_DIR/submissions. Leads are personal
 * data, so they live only on the EC2 box — they are deliberately never
 * committed to the (public) GitHub repo like site content is.
 *
 * File-per-record keeps status updates trivially atomic and needs no database;
 * this form takes a handful of submissions a day, not thousands an hour.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATUSES = ['new', 'contacted', 'won', 'archived', 'spam'];

const MAX_FIELDS = 40;
const MAX_VALUE = 2000;
const MAX_ITEMS = 20;

export class Submissions {
  constructor(dir) {
    this.dir = join(dir, 'submissions');
    mkdirSync(this.dir, { recursive: true });
  }

  path(id) {
    if (!/^[\w.-]+$/.test(id)) throw Object.assign(new Error('bad id'), { status: 400 });
    return join(this.dir, `${id}.json`);
  }

  /**
   * Answers come from a form whose questions are editable in the console, so
   * the shape is not fixed. Rather than hard-code fields, clamp the size and
   * coerce everything to strings / arrays of strings.
   */
  static clean(answers) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw Object.assign(new Error('answers must be an object'), { status: 400 });
    }
    const entries = Object.entries(answers).slice(0, MAX_FIELDS);
    const out = {};
    for (const [k, v] of entries) {
      const key = String(k).slice(0, 60);
      if (Array.isArray(v)) out[key] = v.slice(0, MAX_ITEMS).map((x) => String(x).slice(0, MAX_VALUE));
      else if (v && typeof v === 'object') {
        out[key] = Object.fromEntries(
          Object.entries(v).slice(0, MAX_FIELDS).map(([k2, v2]) => [String(k2).slice(0, 60), String(v2 ?? '').slice(0, MAX_VALUE)]),
        );
      } else out[key] = String(v ?? '').slice(0, MAX_VALUE);
    }
    return out;
  }

  create({ answers, meta, ip, userAgent, suspected }) {
    const now = new Date();
    const id = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomUUID().slice(0, 8)}`;
    const record = {
      id,
      receivedAt: now.toISOString(),
      status: suspected ? 'spam' : 'new',
      ...(suspected ? { suspected } : {}),
      answers: Submissions.clean(answers),
      notes: '',
      meta: {
        ip, userAgent: String(userAgent ?? '').slice(0, 300),
        elapsedMs: Number(meta?.elapsedMs) || null,
        referrer: meta?.referrer ? String(meta.referrer).slice(0, 400) : null,
        page: meta?.page ? String(meta.page).slice(0, 400) : null,
      },
    };
    // Write then rename, so a reader never sees a half-written file.
    const tmp = `${this.path(id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
    renameSync(tmp, this.path(id));
    return record;
  }

  list({ status, limit = 200 } = {}) {
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort().reverse();
    const out = [];
    for (const f of files) {
      if (out.length >= limit) break;
      try {
        const rec = JSON.parse(readFileSync(join(this.dir, f), 'utf8'));
        if (status && rec.status !== status) continue;
        out.push(rec);
      } catch { /* skip an unreadable record rather than failing the whole list */ }
    }
    return out;
  }

  counts() {
    const totals = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const rec of this.list({ limit: Infinity })) totals[rec.status] = (totals[rec.status] ?? 0) + 1;
    return totals;
  }

  update(id, { status, notes }) {
    const rec = JSON.parse(readFileSync(this.path(id), 'utf8'));
    if (status !== undefined) {
      if (!STATUSES.includes(status)) throw Object.assign(new Error(`status must be one of: ${STATUSES.join(', ')}`), { status: 400 });
      rec.status = status;
    }
    if (notes !== undefined) rec.notes = String(notes).slice(0, 4000);
    rec.updatedAt = new Date().toISOString();
    writeFileSync(this.path(id), JSON.stringify(rec, null, 2) + '\n');
    return rec;
  }

  /** Flat CSV — one column per answer key seen across the export. */
  toCsv(records) {
    const keys = new Set();
    for (const r of records) {
      for (const [k, v] of Object.entries(r.answers)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach((k2) => keys.add(`${k}.${k2}`));
        else keys.add(k);
      }
    }
    const cols = ['id', 'receivedAt', 'status', ...keys, 'notes'];
    const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = records.map((r) => cols.map((c) => {
      if (c === 'id' || c === 'receivedAt' || c === 'status' || c === 'notes') return cell(r[c]);
      const [a, b] = c.split('.');
      const v = b ? r.answers[a]?.[b] : r.answers[a];
      return cell(Array.isArray(v) ? v.join(' | ') : v);
    }).join(','));
    return [cols.map(cell).join(','), ...rows].join('\n') + '\n';
  }
}
