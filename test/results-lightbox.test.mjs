/**
 * Tests the "Proof over promises" results section.
 *
 * Every card opens an expanded view, and a card that carries a clip opens
 * the video instead of the photo. Built from a fixture so the video path is
 * covered even when no real client has a clip attached yet.
 */
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EMBED = 'https://www.youtube.com/embed/TEST_VIDEO_ID';

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? (pass++, console.log('  ✓', msg)) : (fail++, console.log('  ✗', msg)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── build from a fixture ──────────────────────────────────────────── */

const work = mkdtempSync(join(tmpdir(), 'pl-lightbox-'));
const content = JSON.parse(readFileSync(join(ROOT, 'frontend/content/site.json'), 'utf8'));

// card 2 gets a 16:9 clip, card 3 gets a separate larger photo
content.transformations[1].video = EMBED;
content.transformations[1].videoType = 'embed';
content.transformations[1].videoWide = true;
content.transformations[2].full = 'images/pl-og-image.jpg';

const fixture = join(work, 'site.json');
writeFileSync(fixture, JSON.stringify(content));
execFileSync('node', [join(ROOT, 'build/build.mjs'), 'build', join(work, 'dist')], {
  env: { ...process.env, PL_CONTENT: fixture }, stdio: 'ignore',
});

/* ── drive the built page ──────────────────────────────────────────── */

const dom = new JSDOM(readFileSync(join(work, 'dist/index.html'), 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://pratyushfitness.edastra.in/',
  beforeParse(w) {
    // jsdom ships neither; both are universal in the browsers this targets.
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  },
});

const w = dom.window, d = w.document;
await sleep(200);

const cards = [...d.querySelectorAll('.tf-card')];
const lb = d.getElementById('lb');
const text = (id) => d.getElementById(id).textContent;
const click = async (el) => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(120); };
const key = async (k, el = w) => { el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true })); await sleep(120); };

console.log('\ncards');
ok(cards.length === content.transformations.length, `every result renders a card (${cards.length})`);
ok(cards.every((c) => c.getAttribute('role') === 'button' && c.tabIndex === 0), 'every card is focusable and announced as a button');
ok(cards.every((c) => c.getAttribute('aria-label')), 'every card has an accessible label');
ok(cards[1].classList.contains('has-video'), 'the card with a clip is badged as video');
ok(!cards[0].classList.contains('has-video'), 'a photo-only card is not');
ok(lb.hidden, 'the expanded view starts hidden');

console.log('\nopening');
await click(cards[0]);
ok(!lb.hidden && lb.classList.contains('open'), 'clicking a card opens the expanded view');
ok(text('lb-name') === content.transformations[0].name, 'it shows that client’s name');
ok(text('lb-stat') === content.transformations[0].stat, 'it shows the result badge');
ok(text('lb-story').length > 40, 'it shows the full story');
ok(!!d.querySelector('#lb-media img'), 'a photo card shows the photo');
ok(text('lb-count') === `01 / ${String(cards.length).padStart(2, '0')}`, 'the counter reads 01 of the total');
ok(w.getComputedStyle(d.body).overflow === 'hidden', 'the page behind is locked from scrolling');

console.log('\nvideo');
await key('ArrowRight');
const frame = d.querySelector('#lb-media iframe');
ok(text('lb-name') === content.transformations[1].name, 'arrow right moves to the next result');
ok(!!frame, 'a card with a clip shows a video instead of a photo');
ok(frame && frame.src === EMBED, 'the video points at the configured embed');
ok(d.querySelector('.lb-media').classList.contains('wide'), 'the 16:9 flag sets the wide aspect ratio');

console.log('\nnavigation');
await key('ArrowLeft');
await key('ArrowLeft');
ok(text('lb-count') === `${String(cards.length).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`, 'paging backwards wraps to the last result');
await click(lb.querySelector('.lb-nav.next'));
ok(text('lb-count') === '01 / ' + String(cards.length).padStart(2, '0'), 'the next button wraps to the first');

console.log('\nclosing');
await key('Escape');
await sleep(420);
ok(lb.hidden, 'Escape closes it');
ok(w.getComputedStyle(d.body).overflow !== 'hidden', 'scrolling is restored');
ok(d.getElementById('lb-media').innerHTML === '', 'the media is torn down, so a playing video stops');

await key('Enter', cards[2]);
await sleep(150);
ok(!lb.hidden, 'Enter on a focused card opens it');
ok(d.querySelector('#lb-media img').src.includes('pl-og-image'), 'the larger photo is used when one is set');
await click(lb.querySelector('.lb-veil'));
await sleep(420);
ok(lb.hidden, 'clicking the backdrop closes it');

rmSync(work, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
