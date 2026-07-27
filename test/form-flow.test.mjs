/**
 * End-to-end test for the application form.
 *
 *   npm test
 *
 * Builds the site, starts the backend against a throwaway data directory,
 * drives the real built page in jsdom, and checks that a finished
 * application arrives in the store with the right shape. The form is how
 * every lead reaches the business, so it gets an actual test.
 */
import { JSDOM } from 'jsdom';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123;
const API = `http://localhost:${PORT}`;
const PAGE = join(ROOT, 'dist', 'apply', 'index.html');

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? (pass++, console.log('  ✓', msg)) : (fail++, console.log('  ✗', msg)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── harness ───────────────────────────────────────────────────────── */

const dataDir = mkdtempSync(join(tmpdir(), 'pl-test-'));
const PASSWORD = 'test-password-1234';
const hash = execFileSync('node', [join(ROOT, 'backend/scripts/hash-password.mjs'), PASSWORD], { encoding: 'utf8' }).trim();

console.log('building…');
execFileSync('node', [join(ROOT, 'build/build.mjs'), 'build'], { stdio: 'ignore' });

const server = spawn('node', [join(ROOT, 'backend/src/server.js')], {
  env: {
    ...process.env,
    PORT: String(PORT), DATA_DIR: dataDir,
    JWT_SECRET: 'test-secret', ADMIN_PASSWORD_HASH: hash,
    GITHUB_TOKEN: 'unused-in-this-test', GITHUB_OWNER: 'o', GITHUB_REPO: 'r',
    MIN_FILL_SECONDS: '0', NOTIFY_WEBHOOK: '',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return; } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('backend did not start');
}

function finish(code) {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
}

/* ── page driver ───────────────────────────────────────────────────── */

async function boot() {
  const dom = new JSDOM(readFileSync(PAGE, 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://pratyushfitness.edastra.in/apply/',
    beforeParse(w) {
      // jsdom ships neither of these; every real browser has them.
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.fetch = (url, opts) => fetch(url, opts);
      w.PL_FORM_API = API;   // point the page at the test backend
    },
  });
  await sleep(150);
  return dom.window;
}

const live = (w) => w.document.querySelector('.screen.live')?.dataset.screen;
const one = (w, sel) => w.document.querySelector(`.screen.live ${sel}`);
const all = (w, sel) => [...w.document.querySelectorAll(`.screen.live ${sel}`)];
// Long enough to cover the auto-advance delay plus the screen transition.
const click = async (w, el) => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(820); };

/** Answer everything up to (but not including) the investment question. */
async function fillToInvest(w) {
  await click(w, one(w, '.start'));
  await click(w, all(w, '.opt')[0]);          // source
  await click(w, all(w, '.opt')[1]);          // age
  await click(w, all(w, '.opt')[0]);          // goal
  await click(w, all(w, '.opt')[0]);          // blockers (multi)
  await click(w, one(w, '.next'));
  await click(w, all(w, '.opt')[1]);          // commitment
  await click(w, all(w, '.opt')[0]);          // startWhen
  one(w, 'input').value = '84 kgs, 178cm';
  await click(w, one(w, '.next'));
  one(w, 'input').value = 'Software Engineer';
  await click(w, one(w, '.next'));
}

/* ── tests ─────────────────────────────────────────────────────────── */

await waitForServer();

console.log('\nnavigation');
{
  const w = await boot();
  ok(live(w) === 'welcome', 'opens on the welcome screen');

  await click(w, one(w, '.start'));
  ok(live(w) === 'source', 'the start button enters the first question');

  await click(w, one(w, '.back'));
  ok(live(w) === 'welcome', 'back from the first question returns to welcome');

  await click(w, one(w, '.start'));
  await click(w, all(w, '.opt')[0]);
  ok(live(w) === 'age', 'a single-select advances on its own');

  await click(w, one(w, '.back'));
  ok(live(w) === 'source', 'back returns to the previous question, not the first');
  ok(all(w, '.opt')[0].classList.contains('on'), 'the earlier answer is still selected');
  w.close();
}

console.log('\nanswer handling');
{
  const w = await boot();
  await click(w, one(w, '.start'));
  await click(w, all(w, '.opt')[0]);
  await click(w, all(w, '.opt')[1]);
  await click(w, all(w, '.opt')[0]);
  ok(live(w) === 'blockers', 'reached the multiple-choice question');

  await click(w, all(w, '.opt')[0]);
  await click(w, all(w, '.opt')[2]);
  ok(live(w) === 'blockers', 'a multiple-choice question does not auto-advance');
  ok(all(w, '.opt').filter((o) => o.classList.contains('on')).length === 2, 'both choices stay selected');
  await click(w, all(w, '.opt')[2]);
  ok(all(w, '.opt').filter((o) => o.classList.contains('on')).length === 1, 'clicking a choice again deselects it');

  await click(w, one(w, '.next'));
  await click(w, all(w, '.opt')[1]);
  await click(w, all(w, '.opt')[0]);
  ok(live(w) === 'stats', 'reached the first text question');

  await click(w, one(w, '.next'));
  ok(live(w) === 'stats', 'an empty required answer is blocked');
  ok(one(w, '.err').classList.contains('on'), 'the validation message is shown');

  one(w, 'input').value = '84 kgs, 178cm';
  await click(w, one(w, '.next'));
  ok(live(w) === 'profession', 'a filled-in answer advances');
  w.close();
}

console.log('\ndisqualify branch');
{
  const w = await boot();
  await fillToInvest(w);
  ok(live(w) === 'invest', 'reached the investment question');
  const opts = all(w, '.opt');
  await click(w, opts[opts.length - 1]);   // "No, I'm not ready to meaningfully invest."
  ok(live(w) === 'disqualify', 'the disqualifying option jumps straight to the exit screen');
  w.close();
}

console.log('\nsubmission');
{
  const w = await boot();
  await fillToInvest(w);
  await click(w, all(w, '.opt')[0]);       // "Yes, Sign me up!"
  one(w, 'input').value = 'Bengaluru, India';
  await click(w, one(w, '.next'));
  ok(live(w) === 'contact', 'reached the contact block');

  const set = (name, v) => { one(w, `input[name="${name}"]`).value = v; };
  set('name', 'Jsdom Tester');
  set('email', 'not-an-email');
  await click(w, one(w, '.next'));
  ok(live(w) === 'contact', 'a malformed email address is rejected');
  ok(/email/i.test(one(w, '.err').textContent), 'the error names the email field');

  set('email', 'jsdom@example.com');
  set('phone', '+91 90000 00000');
  await click(w, one(w, '.next'));
  await sleep(600);
  ok(live(w) === 'success', 'a complete application lands on the success screen');
  w.close();
}

console.log('\nstored record');
{
  const login = await (await fetch(`${API}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })).json();
  const { submissions, counts } = await (await fetch(`${API}/api/submissions`, {
    headers: { Authorization: `Bearer ${login.token}` },
  })).json();

  ok(counts.new === 1, `exactly one new application is stored (got ${counts.new})`);
  const a = submissions[0].answers;
  ok(a.source === 'Instagram', 'the single-select answer is stored');
  ok(Array.isArray(a.blockers) && a.blockers.length === 1, 'the multi-select is stored as an array');
  ok(a.stats === '84 kgs, 178cm', 'the text answer is stored');
  ok(a.contact.email === 'jsdom@example.com', 'the contact block is stored');
  ok(submissions[0].meta.page.endsWith('/apply/'), 'the source page is recorded');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
finish(fail ? 1 : 0);
