# Deploying this repo to Cloudways with pm2 + GitHub Actions

`.github/workflows/deploy.yml` deploys `main` to the Cloudways server over
SSH on every push, then restarts it under `pm2`. The steps below have
already been done once for `142.93.88.185` — this file documents what's
there and how to redo it if the app ever moves to a fresh server.

## 1. Enable SSH access on Cloudways

Cloudways disables shell/SSH access by default. In the Cloudways platform
dashboard (not the terminal): open the server → **Master Credentials** (or
**Settings & Patches**) → **SSH Access** → enable it, and add the deploy
key's *public* half (`~/.ssh/cloudways_github_actions.pub` on the dev
machine) as an authorized key. Until this is done, `ssh <user>@<host>`
prints `Shell access is disabled !` and closes immediately.

Note the SSH *username* Cloudways gives you (here `abhises`) lands you in a
different internal system user (here `jcphuwabrr`, `whoami` after connecting
confirms it) — that internal name is what shows up in paths below.

## 2. Server quirks this app's user runs into

This Cloudways app user can't write to `$HOME` at all — only
`public_html`, `private_html` and `tmp` are writable (confirmed with
`getfacl ~`). So everything (the app, npm's cache, npm's global-install
prefix, and pm2's runtime state) lives under `~/private_html/` instead of
the usual `~/.npm` / `~/.pm2` / global npm prefix.

The system Node is v20.5.1, which is too old to run this repo's
`typescript` (v7, the native compiler) — its `tsc` binary needs a newer
Node. Since there's no root/sudo, a second Node was installed user-locally
via `nvm` into `~/private_html/.nvm` rather than touching the system one.

There's also no `sudo`, so `pm2 startup` (which needs root to install a
systemd unit) isn't available — pm2 won't currently auto-restart the app
after a full server reboot. If that matters, it needs either Cloudways
support to grant it, or using Cloudways' own "Supervisor" feature from the
dashboard to keep the process alive instead of pm2 owning the boot step.

## 3. One-time server setup (already done for 142.93.88.185)

```bash
# Node 22 via nvm, since the system Node is too old for this repo's tsc
export NVM_DIR=~/private_html/.nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 22 && nvm use 22

# npm cache + global prefix, redirected off the unwritable $HOME
export NPM_CONFIG_CACHE=~/private_html/.npm-cache
mkdir -p "$NPM_CONFIG_CACHE"
npm install -g pm2   # installs to the npm default prefix (/usr) target dir;
                      # if that's unwritable too, also set
                      # NPM_CONFIG_PREFIX=~/private_html/.npm-global first

# pm2's own runtime state, same reason
export PM2_HOME=~/private_html/.pm2

# the app itself
git clone https://github.com/abhises/adplaylist-be.git ~/private_html/app
cd ~/private_html/app
npm ci
cat > .env <<'EOF'
PORT=5000
DATABASE_URL="mysql://<db-user>:<db-password>@127.0.0.1:3306/<db-name>"
JWT_SECRET=<a long random string>
CORS_ORIGIN=<your frontend's origin>
EOF
npm run build
npm run db:migrate
~/private_html/.npm-global/bin/pm2 start dist/index.js --name adplaylist-be
~/private_html/.npm-global/bin/pm2 save
```

DB credentials come from Cloudways → this application → **Access Details**
→ Database tab.

## 4. It's not publicly reachable yet

The app listens on `127.0.0.1:5000` and responds fine *from the server
itself* (`curl http://127.0.0.1:5000/api/health`), but port 5000 isn't
open to the internet — external requests to `142.93.88.185:5000` time out.
This app was provisioned as a PHP-type Cloudways app (there's a leftover
`index.php` and root-owned Apache/nginx/PHP-FPM configs in `~/conf`), not a
Node app, so there's no reverse proxy pointing a real domain/port 80/443 at
port 5000 — and this app user can't edit those root-owned vhost configs.

To make it publicly reachable, either:
- ask Cloudways support to open port 5000 in the server firewall (quick,
  but no domain/HTTPS — you'd hit it as `http://142.93.88.185:5000`), or
- (recommended) get this turned into/pointed at by a proper Node.js
  application in Cloudways, or have an nginx/Apache vhost added that
  proxies a real domain to `127.0.0.1:5000` — that also gets you Cloudways'
  free SSL. Either needs Cloudways dashboard/support access this app user
  doesn't have.

## 5. GitHub repo secrets

In this repo's GitHub Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `CLOUDWAYS_SSH_HOST` | `142.93.88.185` |
| `CLOUDWAYS_SSH_USER` | `abhises` |
| `CLOUDWAYS_SSH_KEY` | the **private** key contents of `~/.ssh/cloudways_github_actions` |
| `BE_DEPLOY_PATH` | `/home/192315.cloudwaysapps.com/jcphuwabrr/private_html/app` |

## 6. Ship it

Merge to `main` (or push directly) — the workflow SSHes in, sources the
Node 22 nvm environment above, `git reset --hard origin/main`, `npm ci`,
`npm run build`, `npm run db:migrate`, and restarts the `pm2` process
(starting it fresh on the very first run).
