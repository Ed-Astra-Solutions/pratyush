/**
 * Pratyush Liftz admin console.
 *
 * Static page on GitHub Pages; every privileged action goes to the EC2
 * backend, which holds the GitHub token and does the committing. Saving
 * pushes frontend/content/site.json, and that push is what triggers the
 * Pages rebuild.
 */
(() => {
  const CFG = window.PL_ADMIN_CONFIG || {};
  const S = window.PL_SCHEMA;
  const API = (CFG.apiBase || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);

  let token = sessionStorage.getItem('pl_token') || '';
  let content = null;      // working copy
  let baseline = '';       // JSON of last saved state
  let sha = null;          // git blob sha for optimistic concurrency
  let active = S.sections[0].id;
  let pollTimer = null;

  /* ── api ─────────────────────────────────────────────────────── */

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
    const text = await res.text();
    const data = text && text[0] === '{' ? JSON.parse(text) : text;
    if (res.status === 401) { signOut(); throw new Error('Session expired — sign in again.'); }
    if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
    return data;
  }

  /* ── auth ────────────────────────────────────────────────────── */

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login-btn'), err = $('login-err');
    btn.disabled = true; btn.textContent = 'Signing in…'; err.classList.add('hidden');
    try {
      const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) });
      token = r.token;
      sessionStorage.setItem('pl_token', token);
      await start();
    } catch (e2) {
      err.textContent = e2.message; err.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });

  function signOut() {
    token = ''; sessionStorage.removeItem('pl_token');
    clearInterval(pollTimer);
    $('shell').classList.add('hidden'); $('login').classList.remove('hidden');
  }
  $('logout').addEventListener('click', signOut);

  /* ── boot ────────────────────────────────────────────────────── */

  async function start() {
    const r = await api('/api/content');
    content = r.content; sha = r.sha;
    baseline = JSON.stringify(content);
    $('login').classList.add('hidden');
    $('shell').classList.remove('hidden');
    $('view-site').href = CFG.siteUrl || '/';
    $('last-saved').textContent = content.updatedAt
      ? `Last edit ${new Date(content.updatedAt).toLocaleString()}`
      : 'No edits yet';
    renderNav();
    render();
    refreshCount();
  }

  /* ── nav ─────────────────────────────────────────────────────── */

  function renderNav() {
    $('nav').innerHTML = '';
    for (const s of S.sections) {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.className = s.id === active ? 'on' : '';
      if (s.submissions && newCount) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = newCount;
        b.appendChild(badge);
      }
      b.onclick = () => { active = s.id; renderNav(); render(); };
      $('nav').appendChild(b);
    }
  }

  /** Unread application count, refreshed in the background for the nav badge. */
  let newCount = 0;
  async function refreshCount() {
    try {
      const r = await api('/api/submissions?limit=1');
      newCount = r.counts.new || 0;
      renderNav();
    } catch { /* the badge is a nicety; never block the console on it */ }
  }

  /* ── helpers ─────────────────────────────────────────────────── */

  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), content);
  function set(path, value) {
    const parts = path.split('.'), last = parts.pop();
    let n = content; for (const p of parts) n = n[p] ??= {};
    n[last] = value;
  }

  const humanise = (k) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
  const labelFor = (path) => S.fieldLabels[path] || humanise(path.split('.').slice(1).join('.'));

  function dirty() {
    const d = JSON.stringify(content) !== baseline;
    $('save').disabled = !d;
    const pill = $('status');
    if (d) { pill.className = 'pill dirty'; pill.textContent = 'Unsaved changes'; }
    else if (pill.className === 'pill dirty') { pill.className = 'pill'; pill.textContent = 'Saved'; }
    return d;
  }

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), kind === 'err' ? 8000 : 4000);
  }

  /* ── field widgets ───────────────────────────────────────────── */

  function fieldEl({ label, hint, value, type, options, onInput }) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const lab = document.createElement('label');
    lab.textContent = label;
    wrap.appendChild(lab);

    let input;
    if (type === 'textarea') { input = document.createElement('textarea'); input.value = value ?? ''; }
    else if (type === 'select') {
      input = document.createElement('select');
      for (const o of options) {
        const op = document.createElement('option'); op.value = o; op.textContent = o;
        if (o === value) op.selected = true; input.appendChild(op);
      }
    } else if (type === 'bool') {
      input = document.createElement('input'); input.type = 'checkbox';
      input.checked = !!value; input.style.width = 'auto';
    } else { input = document.createElement('input'); input.type = 'text'; input.value = value ?? ''; }

    const read = () => (type === 'bool' ? input.checked : input.value);
    input.addEventListener(type === 'select' || type === 'bool' ? 'change' : 'input', () => { onInput(read()); dirty(); });
    wrap.appendChild(input);

    if (type === 'image') wrap.appendChild(imageWidget(value, (p) => { input.value = p; onInput(p); dirty(); }));
    if (hint) { const h = document.createElement('p'); h.className = 'hint'; h.textContent = hint; wrap.appendChild(h); }
    if (type === 'textarea') {
      const h = document.createElement('p'); h.className = 'hint';
      h.textContent = 'Inline HTML allowed: <b>, <em>, <i>, <br>.';
      wrap.appendChild(h);
    }
    return wrap;
  }

  function imageWidget(path, onPick) {
    const box = document.createElement('div');
    box.className = 'thumb';
    const img = document.createElement('img');
    img.alt = ''; img.src = path ? `${CFG.siteUrl}/${String(path).replace(/^\//, '')}` : '';
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.className = 'hidden';
    const btn = document.createElement('button');
    btn.className = 'btn ghost tiny'; btn.type = 'button'; btn.textContent = 'Upload';
    btn.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        const b64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(',')[1]);
          fr.onerror = rej; fr.readAsDataURL(f);
        });
        const r = await api('/api/images', {
          method: 'POST',
          body: JSON.stringify({ filename: f.name, contentBase64: b64 }),
        });
        img.src = URL.createObjectURL(f);
        onPick(r.path);
        toast(`Uploaded ${r.path}`, 'ok');
      } catch (e) { toast(e.message, 'err'); }
      finally { btn.disabled = false; btn.textContent = 'Upload'; }
    };
    box.append(img, btn, file);
    return box;
  }

  /* ── rendering ───────────────────────────────────────────────── */

  function render() {
    const sec = S.sections.find((s) => s.id === active);
    $('section-title').textContent = sec.label;
    const panel = $('panel');
    panel.innerHTML = '';

    if (sec.deploys) return renderDeploys(panel);
    if (sec.submissions) return renderSubmissions(panel);

    for (const g of sec.groups || []) {
      const data = g.includes('.') ? get(g) : content[g];
      if (!data || typeof data !== 'object') continue;
      const box = document.createElement('div');
      box.className = 'group';
      const h = document.createElement('h3');
      h.textContent = S.groupLabels[g] || humanise(g);
      box.appendChild(h);
      for (const [k, v] of Object.entries(data)) {
        const path = `${g}.${k}`;
        if (Array.isArray(v)) { box.appendChild(listField(path, v)); continue; }
        if (v && typeof v === 'object') {           // e.g. system.card1.{title,body}
          for (const [k2, v2] of Object.entries(v)) {
            box.appendChild(fieldEl({
              label: `${humanise(k)} — ${humanise(k2)}`,
              value: v2,
              type: typeOf(`${path}.${k2}`, v2),
              onInput: (val) => set(`${path}.${k2}`, val),
            }));
          }
          continue;
        }
        box.appendChild(fieldEl({
          label: labelFor(path),
          value: v,
          type: typeOf(path, v),
          hint: S.imageKeys.includes(path) ? 'Path relative to the site root.' : '',
          onInput: (val) => set(path, val),
        }));
      }
      panel.appendChild(box);
    }

    for (const c of sec.collections || []) panel.appendChild(collectionEl(c));
    if (sec.form) panel.appendChild(stepsEditor());
  }

  function typeOf(path, v) {
    if (S.imageKeys.includes(path)) return 'image';
    if (typeof v === 'string' && (v.length > 90 || v.includes('<b>') || v.includes('<em>'))) return 'textarea';
    return 'text';
  }

  /** Simple array-of-strings editor (the fit lists). */
  function listField(path, items) {
    const box = document.createElement('div');
    box.className = 'group';
    const h = document.createElement('h3');
    h.textContent = labelFor(path);
    box.appendChild(h);
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'item-head';
      row.appendChild(fieldEl({
        label: `Item ${i + 1}`, value: item, type: 'textarea',
        onInput: (val) => { items[i] = val; },
      }));
      const del = document.createElement('button');
      del.className = 'btn danger tiny'; del.textContent = 'Remove';
      del.onclick = () => { items.splice(i, 1); dirty(); render(); };
      row.appendChild(del);
      box.appendChild(row);
    });
    const add = document.createElement('button');
    add.className = 'btn ghost tiny'; add.textContent = '+ Add item';
    add.onclick = () => { items.push('New item'); dirty(); render(); };
    box.appendChild(add);
    return box;
  }

  function collectionEl(name) {
    const def = S.collections[name];
    const items = (content[name] ??= []);
    const box = document.createElement('div');
    box.className = 'group';
    const h = document.createElement('h3');
    h.textContent = `${def.label} (${items.length})`;
    box.appendChild(h);
    if (def.hint) { const p = document.createElement('p'); p.className = 'hint'; p.style.marginBottom = '14px'; p.textContent = def.hint; box.appendChild(p); }

    items.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'item';
      const head = document.createElement('div');
      head.className = 'item-head';
      const idx = document.createElement('span');
      idx.className = 'idx'; idx.textContent = String(i + 1).padStart(2, '0');
      const title = document.createElement('b');
      title.textContent = item[def.titleField] || '—';
      head.append(idx, title);
      for (const [txt, delta] of [['↑', -1], ['↓', 1]]) {
        const b = document.createElement('button');
        b.className = 'btn ghost tiny'; b.textContent = txt;
        b.disabled = (delta < 0 && i === 0) || (delta > 0 && i === items.length - 1);
        b.onclick = () => { items.splice(i + delta, 0, items.splice(i, 1)[0]); dirty(); render(); };
        head.appendChild(b);
      }
      const del = document.createElement('button');
      del.className = 'btn danger tiny'; del.textContent = 'Delete';
      del.onclick = () => {
        if (!confirm(`Delete "${item[def.titleField] || 'this entry'}"?`)) return;
        items.splice(i, 1); dirty(); render();
      };
      head.appendChild(del);
      card.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'row';
      for (const f of def.fields) {
        const el = fieldEl({
          label: f.label, hint: f.hint, value: item[f.key], type: f.type, options: f.options,
          onInput: (val) => { item[f.key] = val; if (f.key === def.titleField) title.textContent = val || '—'; },
        });
        if (f.type === 'textarea') el.style.gridColumn = '1 / -1';
        grid.appendChild(el);
      }
      card.appendChild(grid);
      box.appendChild(card);
    });

    const add = document.createElement('button');
    add.className = 'btn ghost tiny';
    add.textContent = `+ Add ${def.label.replace(/s$/, '').toLowerCase()}`;
    add.onclick = () => { items.push(structuredClone(def.blank)); dirty(); render(); };
    box.appendChild(add);
    return box;
  }

  /* ── application form editor ─────────────────────────────────── */
  /* Questions are site content, so edits here publish with everything else. */

  function stepsEditor() {
    const steps = (content.applyForm.steps ??= []);
    const box = document.createElement('div');
    box.className = 'group';
    const h = document.createElement('h3');
    h.textContent = `Questions (${steps.length})`;
    box.appendChild(h);

    steps.forEach((step, i) => {
      const card = document.createElement('div');
      card.className = 'item';

      const head = document.createElement('div');
      head.className = 'item-head';
      const idx = document.createElement('span');
      idx.className = 'idx'; idx.textContent = String(i + 1).padStart(2, '0');
      const title = document.createElement('b');
      title.textContent = step.question || '—';
      head.append(idx, title);
      for (const [txt, delta] of [['↑', -1], ['↓', 1]]) {
        const b = document.createElement('button');
        b.className = 'btn ghost tiny'; b.textContent = txt;
        b.disabled = (delta < 0 && i === 0) || (delta > 0 && i === steps.length - 1);
        b.onclick = () => { steps.splice(i + delta, 0, steps.splice(i, 1)[0]); dirty(); render(); };
        head.appendChild(b);
      }
      const del = document.createElement('button');
      del.className = 'btn danger tiny'; del.textContent = 'Delete';
      del.onclick = () => {
        if (!confirm(`Delete the question "${step.question}"?`)) return;
        steps.splice(i, 1); dirty(); render();
      };
      head.appendChild(del);
      card.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'row';
      const q = fieldEl({
        label: 'Question', value: step.question, type: 'text',
        onInput: (v) => { step.question = v; title.textContent = v || '—'; },
      });
      q.style.gridColumn = '1 / -1';
      grid.appendChild(q);
      grid.appendChild(fieldEl({
        label: 'Type', value: step.type, type: 'select',
        options: S.stepTypes.map((t) => t.value),
        hint: S.stepTypes.find((t) => t.value === step.type)?.label,
        onInput: (v) => { step.type = v; render(); },
      }));
      grid.appendChild(fieldEl({
        label: 'Answer key (used in exports)', value: step.id, type: 'text',
        hint: 'Changing this only affects applications received from now on.',
        onInput: (v) => { step.id = v.replace(/[^a-zA-Z0-9_]/g, ''); },
      }));
      const desc = fieldEl({
        label: 'Helper text under the question', value: step.description || '', type: 'text',
        onInput: (v) => { step.description = v; },
      });
      desc.style.gridColumn = '1 / -1';
      grid.appendChild(desc);
      grid.appendChild(fieldEl({
        label: 'Required', value: !!step.required, type: 'bool',
        onInput: (v) => { step.required = v; },
      }));
      if (step.type === 'text') {
        grid.appendChild(fieldEl({
          label: 'Placeholder', value: step.placeholder || '', type: 'text',
          onInput: (v) => { step.placeholder = v; },
        }));
      }
      card.appendChild(grid);

      if (step.type === 'single' || step.type === 'multi') {
        card.appendChild(optionsEditor(step));
      }
      if (step.type === 'contact') {
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = `Collects: ${(step.fields || []).map((f) => f.label).join(', ')}.`;
        card.appendChild(note);
      }
      box.appendChild(card);
    });

    const add = document.createElement('button');
    add.className = 'btn ghost tiny';
    add.textContent = '+ Add question';
    add.onclick = () => {
      steps.push({ id: `q${steps.length + 1}`, type: 'single', question: 'New question', required: true, options: ['Option one', 'Option two'] });
      dirty(); render();
    };
    box.appendChild(add);
    return box;
  }

  function optionsEditor(step) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '10px';
    const lab = document.createElement('p');
    lab.className = 'hint';
    lab.style.marginBottom = '8px';
    lab.textContent = 'Answer options';
    wrap.appendChild(lab);

    (step.options ??= []).forEach((opt, i) => {
      const row = document.createElement('div');
      row.className = 'opt-row';
      const input = document.createElement('input');
      input.type = 'text'; input.value = opt;
      input.oninput = () => { step.options[i] = input.value; dirty(); };
      row.appendChild(input);

      // Marking an option as disqualifying jumps straight to the polite exit screen.
      const dq = document.createElement('button');
      const isDq = step.disqualifyOn === opt;
      dq.className = `btn tiny ${isDq ? '' : 'ghost'}`;
      dq.title = 'Send anyone choosing this option to the "thank you for considering" screen';
      dq.textContent = isDq ? 'Ends form' : 'End on this';
      dq.onclick = () => {
        step.disqualifyOn = isDq ? undefined : step.options[i];
        if (!step.disqualifyOn) delete step.disqualifyOn;
        dirty(); render();
      };
      row.appendChild(dq);

      const del = document.createElement('button');
      del.className = 'btn danger tiny'; del.textContent = '×';
      del.onclick = () => {
        if (step.disqualifyOn === step.options[i]) delete step.disqualifyOn;
        step.options.splice(i, 1); dirty(); render();
      };
      row.appendChild(del);
      wrap.appendChild(row);
    });

    const add = document.createElement('button');
    add.className = 'btn ghost tiny';
    add.textContent = '+ Add option';
    add.onclick = () => { step.options.push('New option'); dirty(); render(); };
    wrap.appendChild(add);
    return wrap;
  }

  /* ── applications inbox ──────────────────────────────────────── */
  /* Applications live on the EC2 box, not in the repo — they are never
     part of a content save, so this view talks to the API directly. */

  let subFilter = '';

  async function renderSubmissions(panel) {
    panel.innerHTML = '<p class="hint">Loading applications…</p>';
    let data;
    try { data = await api(`/api/submissions${subFilter ? `?status=${subFilter}` : ''}`); }
    catch (e) { panel.innerHTML = `<p class="hint">${e.message}</p>`; return; }

    newCount = data.counts.new || 0;
    renderNav();
    panel.innerHTML = '';

    const bar = document.createElement('div');
    bar.className = 'filters';
    for (const s of ['', ...data.statuses]) {
      const b = document.createElement('button');
      const n = s ? data.counts[s] ?? 0 : Object.values(data.counts).reduce((a, x) => a + x, 0);
      b.className = `pill ${subFilter === s ? 'on' : ''}`;
      b.textContent = `${s || 'all'} ${n}`;
      b.onclick = () => { subFilter = s; render(); };
      bar.appendChild(b);
    }
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    bar.appendChild(spacer);
    const csv = document.createElement('button');
    csv.className = 'btn ghost tiny';
    csv.textContent = 'Export CSV';
    csv.onclick = () => downloadCsv(csv);
    bar.appendChild(csv);
    panel.appendChild(bar);

    if (!data.submissions.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.style.marginTop = '20px';
      p.textContent = subFilter ? `No ${subFilter} applications.` : 'No applications yet.';
      panel.appendChild(p);
      return;
    }

    for (const sub of data.submissions) panel.appendChild(submissionEl(sub));
  }

  function answerText(v) {
    if (Array.isArray(v)) return v.join(' · ');
    if (v && typeof v === 'object') return Object.entries(v).filter(([, x]) => x).map(([k, x]) => `${humanise(k)}: ${x}`).join('\n');
    return v;
  }

  function submissionEl(sub) {
    const contact = sub.answers.contact || {};
    const card = document.createElement('div');
    card.className = `item sub ${sub.status}`;

    const head = document.createElement('div');
    head.className = 'item-head';
    head.style.cursor = 'pointer';
    const name = document.createElement('b');
    name.textContent = contact.name || sub.answers.name || 'Anonymous';
    const meta = document.createElement('span');
    meta.className = 'sub-meta';
    meta.textContent = [contact.email, sub.answers.goal, sub.answers.location].filter(Boolean).join(' · ');
    const when = document.createElement('time');
    when.textContent = new Date(sub.receivedAt).toLocaleString();
    const pill = document.createElement('span');
    pill.className = `pill st-${sub.status}`;
    pill.textContent = sub.status;
    head.append(name, meta, pill, when);
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'sub-body hidden';
    head.onclick = () => body.classList.toggle('hidden');

    const dl = document.createElement('dl');
    dl.className = 'answers';
    for (const [k, v] of Object.entries(sub.answers)) {
      const dt = document.createElement('dt');
      dt.textContent = humanise(k);
      const dd = document.createElement('dd');
      dd.textContent = answerText(v);
      dl.append(dt, dd);
    }
    body.appendChild(dl);

    if (sub.suspected) {
      const flag = document.createElement('p');
      flag.className = 'hint';
      flag.textContent = `Filed as spam automatically (${sub.suspected}). If that's wrong, set the status back to new.`;
      body.appendChild(flag);
    }

    const notes = document.createElement('textarea');
    notes.placeholder = 'Private notes…';
    notes.value = sub.notes || '';
    notes.style.marginTop = '14px';
    body.appendChild(notes);

    const actions = document.createElement('div');
    actions.className = 'sub-actions';
    for (const s of ['new', 'contacted', 'won', 'archived', 'spam']) {
      const b = document.createElement('button');
      b.className = `btn tiny ${sub.status === s ? '' : 'ghost'}`;
      b.textContent = s;
      b.onclick = async () => {
        try {
          await api(`/api/submissions/${sub.id}`, { method: 'PATCH', body: JSON.stringify({ status: s, notes: notes.value }) });
          toast(`Marked ${s}`, 'ok');
          render();
        } catch (e) { toast(e.message, 'err'); }
      };
      actions.appendChild(b);
    }
    const save = document.createElement('button');
    save.className = 'btn ghost tiny';
    save.textContent = 'Save notes';
    save.onclick = async () => {
      try { await api(`/api/submissions/${sub.id}`, { method: 'PATCH', body: JSON.stringify({ notes: notes.value }) }); toast('Notes saved', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    };
    actions.appendChild(save);
    body.appendChild(actions);

    card.appendChild(body);
    return card;
  }

  async function downloadCsv(btn) {
    btn.disabled = true;
    try {
      const res = await fetch(`${API}/api/submissions.csv${subFilter ? `?status=${subFilter}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `pl-applications-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast(e.message, 'err'); }
    finally { btn.disabled = false; }
  }

  /* ── deployments ─────────────────────────────────────────────── */

  async function renderDeploys(panel) {
    panel.innerHTML = '<div class="deploys" id="deploy-list"><div class="deploy">Loading…</div></div>';
    const bar = document.createElement('div');
    bar.style.marginTop = '18px';
    const b = document.createElement('button');
    b.className = 'btn ghost tiny'; b.textContent = 'Trigger rebuild';
    b.onclick = async () => {
      b.disabled = true;
      try { await api('/api/rebuild', { method: 'POST' }); toast('Rebuild queued', 'ok'); setTimeout(loadDeploys, 2500); }
      catch (e) { toast(e.message, 'err'); }
      finally { b.disabled = false; }
    };
    bar.appendChild(b);
    panel.appendChild(bar);
    loadDeploys();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (active === 'deploys') loadDeploys(); else clearInterval(pollTimer); }, 10000);
  }

  async function loadDeploys() {
    const list = $('deploy-list');
    if (!list) return;
    try {
      const r = await api('/api/deployments');
      list.innerHTML = '';
      if (!r.runs.length) list.innerHTML = '<div class="deploy">No builds yet.</div>';
      for (const run of r.runs) {
        const row = document.createElement('div');
        row.className = 'deploy';
        const dot = document.createElement('span');
        dot.className = 'dot ' + (run.status !== 'completed' ? 'run' : run.conclusion === 'success' ? 'ok' : 'err');
        const txt = document.createElement('span');
        txt.textContent = run.title || run.name;
        const link = document.createElement('a');
        link.href = run.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'log ↗';
        const t = document.createElement('time');
        t.textContent = new Date(run.createdAt).toLocaleString();
        row.append(dot, txt, link, t);
        list.appendChild(row);
      }
    } catch (e) { list.innerHTML = `<div class="deploy">${e.message}</div>`; }
  }

  /* ── save ────────────────────────────────────────────────────── */

  $('save').addEventListener('click', async () => {
    const btn = $('save');
    btn.disabled = true; btn.textContent = 'Publishing…';
    const pill = $('status');
    try {
      const r = await api('/api/content', {
        method: 'PUT',
        body: JSON.stringify({ content, sha, message: `admin: update site content` }),
      });
      sha = r.sha;
      content.updatedAt = r.updatedAt;
      baseline = JSON.stringify(content);
      pill.className = 'pill ok'; pill.textContent = 'Published — building';
      $('last-saved').textContent = `Last edit ${new Date(r.updatedAt).toLocaleString()}`;
      toast('Saved. GitHub Pages is rebuilding — usually live in about a minute.', 'ok');
    } catch (e) {
      pill.className = 'pill err'; pill.textContent = 'Save failed';
      toast(e.message, 'err');
    } finally {
      btn.textContent = 'Save & publish';
      dirty();
    }
  });

  addEventListener('beforeunload', (e) => {
    if (content && JSON.stringify(content) !== baseline) { e.preventDefault(); e.returnValue = ''; }
  });

  // Resume an existing session if the token is still good.
  if (token) start().catch(() => signOut());
})();
