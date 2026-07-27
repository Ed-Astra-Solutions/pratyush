/**
 * End-to-end test for the application form.
 *
 *   npm test
 *
 * Builds the site, drives the real built page in jsdom, and checks that a
 * finished application produces the right request. The form is how every lead
 * reaches the business, so it gets an actual test.
 *
 * The server lives in its own repo now (Ed-Astra-Solutions/pratyushServer),
 * so the boundary is the request: this asserts exactly what the page sends,
 * and the server's own suite asserts what it does with it.
 */
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.test.invalid';
const PAGE = join(ROOT, 'dist', 'apply', 'index.html');

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? (pass++, console.log('  ✓', msg)) : (fail++, console.log('  ✗', msg)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('building…');
execFileSync('node', [join(ROOT, 'build/build.mjs'), 'build'], { stdio: 'ignore' });

/* ── page driver ───────────────────────────────────────────────────── */

/** Requests the page made, most recent last. Reset on every boot. */
let sent = [];
/** The requests from the completed-application run, kept for the assertions. */
let submitted = [];

/**
 * @param reduced  Boot as a visitor who asked for reduced motion. The page
 *   then advances synchronously, so the flow can be driven in milliseconds
 *   rather than waiting out every transition. The last case below runs with
 *   the real timings, to prove the animated path advances too.
 */
async function boot(reduced = true) {
  sent = [];
  const dom = new JSDOM(readFileSync(PAGE, 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://pratyushfitness.edastra.in/apply/',
    beforeParse(w) {
      // jsdom ships neither of these; every real browser has them.
      w.matchMedia = (q) => ({ matches: reduced && /reduced-motion/.test(q), addEventListener() {}, removeEventListener() {} });
      // Stand in for the backend and record what the page sends.
      w.fetch = async (url, opts = {}) => {
        sent.push({ url, method: opts.method, body: JSON.parse(opts.body || '{}'), headers: opts.headers });
        return { ok: true, status: 201, text: async () => '{"ok":true,"id":"test"}', json: async () => ({ ok: true, id: 'test' }) };
      };
      w.PL_FORM_API = API;
    },
  });
  await sleep(120);
  return dom.window;
}

// Reduced-motion boots settle at once; the animated one needs the
// auto-advance delay (340ms) plus the screen transition (340ms).
let WAIT = 60;

const live = (w) => w.document.querySelector('.screen.live')?.dataset.screen;
const one = (w, sel) => w.document.querySelector(`.screen.live ${sel}`);
const all = (w, sel) => [...w.document.querySelectorAll(`.screen.live ${sel}`)];
// Long enough to cover the auto-advance delay plus the screen transition.
const click = async (w, el) => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(WAIT); };

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
  await sleep(200);
  ok(live(w) === 'success', 'a complete application lands on the success screen');
  submitted = sent.slice();       // captured here; later boots reset `sent`
  w.close();
}

console.log('\nwith the animation running');
{
  WAIT = 820;
  const w = await boot(false);
  await click(w, one(w, '.start'));
  ok(live(w) === 'source', 'the animated page enters the first question');
  await click(w, all(w, '.opt')[0]);
  ok(live(w) === 'age', 'a single-select still auto-advances once the transition finishes');
  await click(w, one(w, '.back'));
  ok(live(w) === 'source', 'and Back still steps to the previous screen');
  w.close();
  WAIT = 60;
}

console.log('\nthe request it sends');
{
  ok(submitted.length === 1, `exactly one request is made (${submitted.length})`);
  const req = submitted[0];
  ok(req.url === `${API}/api/apply`, 'it posts to /api/apply on the configured backend');
  ok(req.method === 'POST', 'it is a POST');

  const a = req.body.answers;
  ok(a.source === 'Instagram', 'the single-select answer is sent');
  ok(Array.isArray(a.blockers) && a.blockers.length === 1, 'the multi-select is sent as an array');
  ok(a.stats === '84 kgs, 178cm', 'the text answer is sent');
  ok(a.contact.email === 'jsdom@example.com', 'the contact block is sent');
  ok(a.contact.phone === '+91 90000 00000', 'optional contact fields are included');
  ok(req.body.meta.page.endsWith('/apply/'), 'the source page is reported');
  ok(typeof req.body.meta.elapsedMs === 'number', 'time-to-complete is reported, for the spam check');
  ok(req.body.website === '', 'the honeypot is sent empty');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
