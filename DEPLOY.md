# Deploying this repo to Cloudways with pm2 + GitHub Actions

`.github/workflows/deploy.yml` deploys `main` to the Cloudways server over
SSH on every push, then restarts it under `pm2`. It needs the one-time setup
below before it can run.

## 1. Enable SSH access on Cloudways

Cloudways disables shell/SSH access by default. In the Cloudways platform
dashboard (not the terminal):

1. Open the server → **Master Credentials** (or **Settings & Patches** on
   newer UIs) → find **SSH Access** and enable it.
2. Add the deploy key's *public* half as an authorized key for the app's SSH
   user. A key pair already exists for this at `~/.ssh/cloudways_github_actions`
   / `~/.ssh/cloudways_github_actions.pub` on the dev machine — paste the
   `.pub` file's contents into Cloudways' "Add SSH Key" field.

Until this is done, `ssh <user>@<host>` will keep printing
`Shell access is disabled !` and closing the connection immediately — that's
this exact setting, not a network or key problem.

## 2. One-time setup on the server itself

Once shell access works, SSH in and, under the path you'll deploy to:

```bash
git clone <this repo's URL> <BE_DEPLOY_PATH>
cd <BE_DEPLOY_PATH>
npm ci
cp .env.example .env   # then fill in real values — .env is gitignored,
                        # so it is never deployed and must be created here once
npm run build
npm run db:migrate
npm i -g pm2           # if not already installed
pm2 start dist/index.js --name adplaylist-be
pm2 save
pm2 startup            # follow the printed command once, so pm2 survives reboots
```

## 3. GitHub repo secrets

In this repo's GitHub Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `CLOUDWAYS_SSH_HOST` | `142.93.88.185` |
| `CLOUDWAYS_SSH_USER` | the app's SSH user (e.g. `abhises`, or the per-app user Cloudways assigned) |
| `CLOUDWAYS_SSH_KEY` | the **private** key contents of `~/.ssh/cloudways_github_actions` |
| `BE_DEPLOY_PATH` | absolute path on the server, e.g. `/home/master/applications/<app_id>/public_html` |

## 4. Ship it

Merge to `main` (or push directly) — the workflow runs `git pull` equivalent,
`npm ci`, `npm run build`, `npm run db:migrate`, and restarts the `pm2`
process, creating it on the very first run.
