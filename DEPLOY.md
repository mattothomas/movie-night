# Put Movie Night online for your friends

The repository contains a Render Blueprint (`render.yaml`) for one always-running Node server and a persistent 1 GB disk. **It uses Render’s paid Starter plan because this SQLite app needs persistent storage.** The MLH domain offer covers a domain name, not this hosting bill. Review Render’s current price before creating the service. This guide prepares deployment; no hosted service or domain records have been created by Codex.

## Deploy the shared app

1. Open [Deploy to Render](https://render.com/deploy?repo=https://github.com/mattothomas/movie-night), sign in, and connect the GitHub repository. Alternatively create a Blueprint in Render and select `mattothomas/movie-night`, branch `main`.
2. Review the Blueprint. It builds with `npm ci --include=dev && npm run build`, starts with `npm start`, checks `/healthz`, and mounts its persistent disk at `/var/data`. `DB_PATH` is `/var/data/movie-night.sqlite`. Keep this path: a database in the disposable checkout would lose history during a new deployment.
3. Enter the **TMDB API Read Access Token** in Render’s `TMDB_API_READ_TOKEN` environment variable. This is a separate host; the secret saved in the Codex cloud environment is not automatically copied to Render. Do not commit the token or put it in your frontend.
4. Create the service after reviewing its paid plan. Wait for the build and health check to finish. Open the HTTPS `onrender.com` address Render gives you.
5. First, choose **Matthew → 032**. The TEST GROUP banner confirms this is the isolated sandbox. Try a movie, swipe, wheel, finish, and rating. Then choose Switch person and use the normal group.
6. Share the host’s HTTPS address with Chris and Yash. All three people must use this same hosted app; separate local copies do not share a database.

The Blueprint uses Node 24.19, production Secure cookies, friends mode, and a 24-hour automatic catalog refresh. Do not set `COOKIE_SECURE=false` on the public service. Keep one app instance with this SQLite disk; horizontal replicas would require moving the user database to a shared database service.

For a local check of production startup, run `npm run build` then `COOKIE_SECURE=false npm start`. That override is only for an HTTP local smoke check.

## Use the MLH / GoDaddy Registry domain

1. Open the offer you supplied: [mlh.link/godaddyregistry](https://mlh.link/godaddyregistry). Redeem it using that page’s eligibility and domain choices. I could not inspect the redemption page from this environment, so I have not verified the current eligible extensions or offer terms.
2. A registry promotion may place your domain with a partner registrar. Use the DNS dashboard of the registrar where your claimed domain actually appears; it need not be GoDaddy’s retail dashboard.
3. In Render, open the deployed service’s **Custom Domains** settings and add your domain. Add `www` too if you want both addresses to work.
4. Render will display the exact DNS records it needs. In the registrar’s DNS manager, create those records. A `www` CNAME normally points to your service’s `onrender.com` hostname; for the root domain, use the exact A/ALIAS/ANAME instructions Render provides. CNAME targets contain a hostname, not `https://` or a URL path. Preserve unrelated email/DNS records.
5. Return to Render and verify the domain. Wait for DNS propagation and HTTPS certificate issuance, then test the custom HTTPS URL before sharing it.

You do not need to buy separate GoDaddy hosting to use the domain with Render. The free registration period and renewal price are handled by the domain provider. No DNS credentials are needed in this repository.

## Codes and host controls

| Select                 | Code  | Result                                   |
| ---------------------- | ----- | ---------------------------------------- |
| Chris / Matthew / Yash | `449` | Their normal profile in the real group   |
| Matthew                | `650` | Matthew’s admin board for the real group |
| Matthew                | `032` | Separate test group, with test controls  |

These are the requested default short codes. They are server-side configuration, not account passwords. `FRIEND_GROUP_PIN`, `FRIEND_ADMIN_PIN`, and `FRIEND_TEST_PIN` can override them on the host. Keep the codes distinct. The retained account system can be restored with `AUTH_MODE=accounts` later.

The admin board can add/edit completed movie nights, record each attendee’s historical rating or leave it for them to rate later, enable a one-shot next-picker lock, and reset unfinished picks. A locked spin is labeled **host-selected**; it is not represented as a random fair result. The override is consumed once. If a night has already been spun, reset its unfinished pick first or the override waits for the next new spin.

The `032` sandbox has separate users, histories, ratings, queues, wheel outcomes, and recommendations. Its controls let you play as any test-group member. Changes there cannot alter the real group’s records.

## Clear your practice picks

The database is ignored by Git, so pulling code cannot reset the database on your own computer.

With your local development server stopped, run:

```bash
git pull origin main
npm ci
npm run reset:picks
npm run dev
```

The reset command backs up the SQLite database, then clears picker/movie/draw data for unfinished nights in the real and test groups. It disables pending wheel overrides. **It preserves completed nights, reactions, seen history, and watchlists.** Alternatively use Matthew → 650 → Reset current picks, or the same control within the sandbox for that group only. Starting a new hosted disk creates a fresh database; it does not import local test data.

## When ratings happen

After a picker chooses a film, use **We’re pressing play**. At the end, click **We finished. Let’s rate it.** The person who clicks it gets the rating dialog immediately. Everyone who attended is marked as having seen the movie. Other attendees see a persistent **Rate our movie** reminder when they open any main screen, and can also rate it from Past Fridays. Each person submits their own 1–5 rating and optional comparison with a previous night.

When adding an old night in admin, enter known ratings or leave **Let them rate it later**. Those attendees get the same reminder. Editing an old entry never silently erases permanent seen history. Comparisons use calendar dates, so newly entered old Fridays can be compared with newer nights correctly.

## Catalog updates and storage

This is not an infinite preloaded movie database. The app queries TMDB and caches titles and metadata as they are discovered or searched. A new instance starts with the curated library; cache size grows over time. Search reaches beyond that local cache.

Fresh review batches and Find more movies update recommendations. An always-running server also checks all real/test groups at startup and every 24 hours (`AUTO_CATALOG_REFRESH_HOURS`, set `0` to disable). Discovery combines highly rated classics, related films seeded by each person’s taste, and a recent-release feed from the last year with at least 25 TMDB votes. The recent feed avoids the classic feed’s 1,000-vote threshold. This cannot guarantee every new film appears immediately: TMDB coverage and the quality filters still apply.

Use `npm run backup` on the deployed service or local machine to create an online SQLite backup. Backups default to a `backups` directory alongside the database, or `BACKUP_DIR`. Admin pick resets also create a backup. Copy important backups off the host periodically; files on the same disk are not protection against deleting that disk. To migrate existing local history, take a consistent backup and restore it into the hosted `DB_PATH` before opening the app to friends. Do not overwrite a live database file or upload a real database to GitHub.
