# Deploying the backend

Production: `https://api.adplaylist.com` → AWS server `13.49.71.156`
(Ubuntu, user `ubuntu`). The server also hosts another site (brasq); the two
are fully separate — own compose project, own Docker network, own nginx site
file, own ports. Never edit brasq's files or containers.

## How it runs

```
nginx (443) ── /etc/nginx/sites-available/adplaylist ──▶ 127.0.0.1:5001
                                                          │
  ~/adplaylist/docker-compose.yml  (compose project "adplaylist")
    adplaylist-api  image adplaylist-be:<git sha>   :5000 → 127.0.0.1:5001
    adplaylist-db   mariadb:10.11                    :3306 → 127.0.0.1:3307
                    data in Docker volume adplaylist_db_data
```

Files in `~/adplaylist` on the server:

| File | What |
|---|---|
| `docker-compose.yml`, `mariadb.cnf` | copied from `deploy/` on every deploy |
| `.env` | compose variables: `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `API_TAG` (the live image tag) |
| `.env.api` | the app's secrets (Stripe, S3, SMTP, Google, JWT…). `DATABASE_URL` and `PORT` are set by compose. Edit, then `docker compose up -d api` |

The database lives in the named volume `adplaylist_db_data`. Restarting,
recreating or upgrading containers keeps it; only
`docker volume rm adplaylist_db_data` deletes it. Don't run
`docker compose down -v`.

Images (ad creatives, uploads) are in S3, not on the server.

## CI/CD

`.github/workflows/deploy.yml` runs on every push to `main`:

1. builds the Docker image on GitHub's runner (the 1 GB server never builds),
2. copies it + `deploy/docker-compose.yml` + `deploy/mariadb.cnf` to the server,
3. runs `prisma migrate deploy`, swaps the API container,
4. waits for the health check; **if the new container isn't healthy it rolls
   back** to the previous image automatically,
5. keeps the current and previous image, deletes older ones (disk is small).

GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_HOST` | `13.49.71.156` |
| `DEPLOY_SSH_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | private key `~/.ssh/adplaylist_deploy` (its `.pub` must be in the server's `~/.ssh/authorized_keys`) |

## Everyday commands (on the server, in `~/adplaylist`)

```bash
docker compose ps                         # status
docker compose logs -f --tail 100 api     # API logs
docker compose up -d api                  # apply edits to .env.api
# manual rollback to a previous image:
docker images adplaylist-be               # pick a tag
sed -i 's/^API_TAG=.*/API_TAG=<tag>/' .env && docker compose up -d --no-deps api
# database shell / backup:
. ./.env && docker exec -it adplaylist-db mariadb -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"
. ./.env && docker exec adplaylist-db mariadb-dump -u"$DB_USER" -p"$DB_PASSWORD" --single-transaction "$DB_NAME" | gzip > backup-$(date +%F).sql.gz
```

## TLS

`sudo certbot --nginx -d api.adplaylist.com` (certbot.timer renews it).

## Previous host

Until November 2026 the API ran on Cloudways (`abhises@142.93.88.185`,
pm2, MariaDB 10.11). Data was copied with `mysqldump` at cutover.
