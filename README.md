# Pratyush Liftz

Marketing site, application form and content pipeline. The admin console that
drives it lives in [pratyushAdmin](https://github.com/Ed-Astra-Solutions/pratyushAdmin).

```
frontend/          the public site — hand-written HTML/CSS, no framework
  index.html         home page (content hooks marked with data-cms="…")
  blog/index.html    blog index
  apply/index.html   the coaching application form
  content/site.json  every editable string, list, image path and form question
  images/            all site imagery
  CNAME              custom domain for GitHub Pages
backend/           the API that runs on EC2: commits content, receives applications
build/build.mjs    injects content/site.json into the HTML → dist/
test/              end-to-end test of the application form (npm test)
.github/workflows/ deploy.yml — tests, builds and publishes to GitHub Pages
```

## How an edit reaches the live site

```
admin console  ← its own repo + Pages site: Ed-Astra-Solutions/pratyushAdmin
        │  PUT /api/content  (bearer token)
        ▼
backend (EC2, nginx + TLS)          ← holds the GitHub token; the console never does
        │  GitHub Contents API: commit frontend/content/site.json to main
        ▼
push to main → .github/workflows/deploy.yml
        │  node build/build.mjs build   →  dist/
        ▼
GitHub Pages  →  https://pratyushfitness.edastra.in   (usually live in ~60s)
```

The console also has a **Trigger rebuild** button, which calls `POST /api/rebuild` →
`workflow_dispatch` on the same workflow, for republishing without a content change.

## How an application reaches you

The site used to hand visitors off to YouForm. It now runs its own form at
`/apply/`, so the questions are editable in the console and the answers stay on
infrastructure you control.

```
/apply/  (GitHub Pages, static)
    │  POST /api/apply   — no auth, rate-limited, honeypot + timing checks
    ▼
backend (EC2)  →  one JSON file per application under /var/lib/pl-admin-api
    │                (never committed to the repo — leads are private)
    │  optional: pings NOTIFY_WEBHOOK (Slack/Discord) on each new application
    ▼
admin console → Applications: read, triage (new / contacted / won / archived /
                spam), add private notes, export CSV
```

The questions themselves live in `content.applyForm` and are edited under
**Application form** in the console — including the branch that sends anyone
who picks "not ready to invest" to a polite exit screen instead of the form.
Because they are site content, changing a question republishes the page like
any other edit.

The form is a single page with no framework: one question per screen, keyboard
driven (`1`–`9` picks an option, `Enter` advances), with a no-JS fallback that
renders every question on one scrolling page. The motion is a hand-rolled
version of the Elementor stack the rest of the site is documented against —
entrance animations with stagger, blur/translate step transitions, a mouse-track
parallax backdrop and an animated progress bar — all of which collapse under
`prefers-reduced-motion`.

`npm test` drives the real built page in jsdom against a real backend and
asserts the whole path, including the disqualify branch and the stored record.
CI runs it before every deploy.

The admin console lives in its own repository,
[Ed-Astra-Solutions/pratyushAdmin](https://github.com/Ed-Astra-Solutions/pratyushAdmin),
deployed to https://pratyushadmin.edastra.in — deliberately not on the public
marketing domain. It talks to the same EC2 backend.

## Editing content

Anything in `frontend/content/site.json` is editable from the console. Two mechanisms
tie the JSON back to the markup:

| In the HTML | Effect |
| --- | --- |
| `data-cms="hero.body"` | element's inner HTML comes from `content.hero.body` |
| `data-cms-list="fit.yesItems"` | `<ul>` is filled with one `<li>` per array item |
| `data-cms-href` / `-src` / `-content` | that attribute is replaced |
| `<!-- PL:FAQ:START --> … <!-- PL:FAQ:END -->` | region rendered from a collection array |

Every card in the results section ("Proof over promises") opens an expanded
view — full photo, result badge and the whole story, with arrow-key paging.
A transformation can carry a `video` instead: the card gets a play badge and
the expanded view plays the clip. Both are set per client in the console.

## Motion

The home page motion follows the reference build (compasia.com) — which runs
GSAP + ScrollTrigger + SplitType + Lenis — reproduced without the libraries,
since the whole site is otherwise dependency-free:

| | |
| --- | --- |
| Section headings | split into words in the DOM, each rising out of its own mask 55ms after the last, on a long decelerating ease. Inline `<em>`/`<br>` survive the split |
| `[data-par]` | scrubbed parallax: elements drift a fraction of the scroll distance while on screen, from one rAF-throttled listener |
| Result cards | click for a full view, arrow keys to page |
| Existing `.rv` | fade-up entrance reveals, unchanged |

One deliberate omission: **no smooth-scroll hijacking.** The reference site
runs Lenis, and reimplementing it badly costs more than it gains — it breaks
scrollbar dragging, keyboard paging and sticky positioning. Anchor links use
native `scroll-behavior: smooth` instead.

Everything above stands down under `prefers-reduced-motion`, and `npm test`
asserts both that the heading copy survives the split and that the motion
switches off.

To make a new piece of copy editable: add `data-cms="group.key"` to the element,
run `npm run extract` (which reads the current markup back into `site.json`), and
the field appears in the console automatically. Collections need a matching entry
in the console's `schema.js` (in the pratyushAdmin repo).

The hook attributes are stripped from the built output, so the shipped HTML stays
identical to what you would have hand-written.

## Local development

```bash
npm install            # jsdom, for the form test
npm run build          # frontend/ + content → dist/
npm run preview        # build, then serve dist/ on http://localhost:4173
npm run extract        # markup → content/site.json (after adding new data-cms hooks)
npm test               # end-to-end application form test (starts its own backend)
```

For the console, run the backend locally (see `backend/README.md`) and serve the
[pratyushAdmin](https://github.com/Ed-Astra-Solutions/pratyushAdmin) checkout —
its `config.js` points at `localhost:8080` by default.

## One-time setup

1. **Pages source.** Repo → Settings → Pages → *Build and deployment* → Source:
   **GitHub Actions**. This replaces branch-root serving; until it is switched the
   site will 404, because the HTML now lives under `frontend/`.
2. **Repository variable.** Settings → Secrets and variables → Actions → Variables →
   `PL_API_BASE` = `https://api.pratyushfitness.edastra.in` (the EC2 endpoint). The
   build bakes it into the application form.
3. **Backend.** Follow `backend/README.md` to bring up the EC2 instance.
4. Push to `main` and confirm the workflow deploys.

> **The deploy workflow cannot run yet.** Custom GitHub Actions workflows are
> blocked on this organisation — runs fail immediately with *"the job was not
> started because your account is locked due to a billing issue."* GitHub's own
> `pages-build-deployment` still works, so branch-served Pages is fine, but
> nothing here that needs a build will publish until that lock is cleared.

`CNAME` stays in `frontend/`, so the custom domain carries over unchanged.
