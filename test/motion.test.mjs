/**
 * Tests the scroll motion on the home page.
 *
 * The heading treatment rewrites the DOM, so this guards the two things
 * that could silently break: the copy must survive the word split intact,
 * and everything must stand down under prefers-reduced-motion.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('node', [join(ROOT, 'build/build.mjs'), 'build'], { stdio: 'ignore' });
let pass=0,fail=0;
const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function boot(reduced=false){
  const observed=[];
  const dom=new JSDOM(readFileSync(join(ROOT,'dist/index.html'),'utf8'),{
    runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){
      w.matchMedia=q=>({matches:reduced&&/reduced-motion/.test(q),addEventListener(){},removeEventListener(){}});
      w.IntersectionObserver=class{
        constructor(cb){this.cb=cb;observed.push(this)}
        observe(el){this.els=(this.els||[]);this.els.push(el)}
        unobserve(){} disconnect(){}
        fire(){this.cb((this.els||[]).map(t=>({isIntersecting:true,target:t})),this)}
      };
    },
  });
  return {w:dom.window,observed};
}

console.log('\nheading word split');
{
  const {w,observed}=boot(); await sleep(200);
  const d=w.document;
  const h=d.querySelector('.transf h2');
  ok(h.classList.contains('split'),'section headings are marked as split');
  const words=[...h.querySelectorAll('.wi')];
  ok(words.length>=3,`heading split into ${words.length} words`);
  ok(words.map(x=>x.textContent).join(' ').includes('Proof over'),'the words still read as the original copy');
  ok(!!h.querySelector('em'),'inline <em> markup survives the split');
  ok(h.textContent.replace(/\s+/g,' ').trim()==='Proof over promises.','textContent is unchanged');
  ok(words[0].style.transitionDelay==='0ms'&&words[1].style.transitionDelay==='55ms','words are staggered 55ms apart');
  ok(!h.classList.contains('in'),'not revealed before it scrolls into view');
  observed.forEach(o=>o.fire());
  ok(h.classList.contains('in'),'revealed once it enters the viewport');

  const story=d.querySelector('.story h2');
  ok(story&&!story.classList.contains('split'),'the story heading keeps its own animation, as the CSS asks');
  w.close();
}

console.log('\nparallax');
{
  const {w}=boot(); await sleep(200);
  const d=w.document;
  const hero=d.querySelector('.hero-figure'), banner=d.getElementById('pl-team-banner');
  ok(hero.dataset.par==='0.1','hero figure is registered for drift');
  ok(banner.dataset.par==='-0.06','team banner is registered for drift');
  ok(banner.dataset.parBase==='scale(1.14)','banner keeps its over-scale so no edge shows');
  w.scrollY=400;
  w.dispatchEvent(new w.Event('scroll'));
  await sleep(80);
  ok(/translate3d/.test(hero.style.transform),`hero drifts on scroll (${hero.style.transform||'none'})`);
  ok(banner.style.transform.startsWith('scale(1.14)'),'banner transform keeps the base scale');
  w.close();
}

console.log('\nreduced motion');
{
  const {w,observed}=boot(true); await sleep(200);
  const d=w.document;
  ok(d.querySelector('.hero-figure').style.transform==='','no parallax when reduced motion is requested');
  observed.forEach(o=>o.fire());
  ok(d.querySelector('.transf h2').classList.contains('split'),'headings still split (CSS shows them instantly)');
  w.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
