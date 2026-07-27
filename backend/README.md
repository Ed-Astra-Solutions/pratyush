# Admin API (EC2)

Small Express service. It is the only component that holds the GitHub token:
the admin console is public static hosting, so every privileged action goes
through here.

| Route | Auth | Does |
| --- | --- | --- |
| `POST /api/login` | — | password → 12h JWT (rate-limited, 10 attempts / 15 min) |
| `GET /api/content` | bearer | reads `frontend/content/site.json` + its blob sha |
| `PUT /api/content` | bearer | validates, then commits to `main` → triggers the Pages build |
| `POST /api/images` | bearer | commits an upload to `frontend/images/`, returns its site path |
| `POST /api/rebuild` | bearer | `workflow_dispatch` on `deploy.yml` |
| `GET /api/deployments` | bearer | recent workflow runs, for the console's status list |
| `POST /api/apply` | **public** | receives a coaching application (rate-limited, 6 / hour / IP) |
| `GET /api/submissions` | bearer | applications + per-status counts |
| `PATCH /api/submissions/:id` | bearer | set status and private notes |
| `GET /api/submissions.csv` | bearer | CSV export |
| `GET /health` | — | liveness |

Content writes send back the sha that was read, so a save fails with **409**
rather than silently overwriting an edit made elsewhere in the meantime.

## Applications

`POST /api/apply` is the only unauthenticated write, so it is deliberately
narrow: rate-limited per IP, capped at 40 fields / 2 KB per value, everything
coerced to strings. Two spam signals — a hidden honeypot field and a form
completed faster than `MIN_FILL_SECONDS` — file the submission as `spam`
rather than rejecting it, so a false positive is recoverable from the console.

Each application is one JSON file under `$DATA_DIR/submissions`, written to a
temp name and renamed so a reader never sees a partial record. **Applications
are never committed to GitHub** — the repo is public, and leads are personal
data. They exist only on the instance, which makes that directory the one thing
on the box worth backing up:

```bash
sudo tar czf ~/pl-applications-$(date +%F).tar.gz -C /var/lib/pl-admin-api submissions
```

systemd's `StateDirectory=` creates `/var/lib/pl-admin-api` with `0700` and
hands it to the service; the rest of the filesystem stays read-only to it.

## Provision

An EC2 `t3.micro` (or `t4g.micro` with the arm64 AMI) on Ubuntu 24.04 is plenty —
this handles a handful of requests a day.

```bash
# security group: 80 + 443 from anywhere, 22 from your IP only
# attach an Elastic IP, then point api.pratyushfitness.edastra.in at it

scp -r backend ubuntu@<elastic-ip>:/tmp/backend
ssh ubuntu@<elastic-ip> 'sudo bash /tmp/backend/deploy/bootstrap.sh'
```

`bootstrap.sh` installs Node 20 + nginx, creates the `plapi` service user,
installs the app to `/opt/pl-admin-api`, and registers the systemd unit.

The service listens on **port 3005**, bound to the instance only — nginx
terminates TLS on 443 and proxies to it. Do **not** open 3005 in the security
group; nothing outside the box should reach it directly. To move it, set `PORT`
in `.env` and change `proxy_pass` in `deploy/nginx.conf` to match.

## Configure

```bash
sudo -u plapi npm --prefix /opt/pl-admin-api run hash -- 'a-long-admin-password'
sudo nano /opt/pl-admin-api/.env      # see .env.example for every field
sudo systemctl restart pl-admin-api
curl -s localhost:3005/health
```

The GitHub token should be a **fine-grained PAT** scoped to
`Ed-Astra-Solutions/pratyush` only, with `Contents: read/write` and
`Actions: read/write`. Nothing else.

Then TLS — the console is served over HTTPS, so the API must be too or the
browser will block the calls:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.pratyushfitness.edastra.in
```

## Operate

```bash
sudo systemctl status pl-admin-api
sudo journalctl -u pl-admin-api -f
```

To ship a code change: re-run `bootstrap.sh` (it is idempotent and leaves
`.env` alone) and restart the service.

## Run locally

```bash
cd backend && npm install
cp .env.example .env      # fill in JWT_SECRET, ADMIN_PASSWORD_HASH, GITHUB_TOKEN
npm run dev
```

Local runs commit to the real repo, so use a scratch branch via `GITHUB_BRANCH`
if you are experimenting.

## Notes on exposure

The console lives at a public URL
([pratyushAdmin](https://ed-astra-solutions.github.io/pratyushAdmin/)) and is
`noindex`/`Disallow`ed, but that is obscurity, not security — the password check
is the actual gate. Use a long password, and if you want a second layer, restrict
the nginx server block to known source IPs.
