# Movie Night

A private Friday ritual for friends: find movies nobody attending has seen, spin for the person who picks, and learn the group’s taste after each night.

## Run locally or in the cloud workspace

Requires Node.js 24 or newer. No API keys or external database required.

```bash
npm ci
npm run dev
```

The server listens on port 3000 by default (`PORT` overrides it). It serves both the React app and API. Create an account and a club, then share the invite code in **Group & settings** with your two friends. They choose **Join my friends** when registering. Or choose **Explore a demo club** for an isolated club with fictional members and sample history.

```bash
npm test          # API integration tests with isolated in-memory databases
npm run build    # TypeScript check and production frontend build
npm run test:browser # Build + full Friday workflow in Chromium
npm start        # Production server; run build first
```

Browser tests use `/usr/bin/chromium` when present, or the Playwright browser. Set `CHROMIUM_PATH` for another installed Chromium binary. If none is installed, run `npx playwright install chromium` on a network that permits Playwright downloads.

Production requires HTTPS: session cookies are Secure by default in production. For an **HTTP-only local production smoke check**, use `COOKIE_SECURE=false npm start`; do not use that override on a public deployment. Development works over HTTP. Real deployment should use a persistent disk, HTTPS, and database backups. This project has not been publicly deployed.

## How it works

- **Movie memory:** unanswered movies are assumed unseen. Marking a movie seen is permanent; its reaction can be edited between loved, liked, okay, and not good. Swipe left for unseen; swipe right to select a seen reaction. Buttons do the same thing.
- **Starter session and Friday 20:** review up to 100 starter movies, or 20 personalized suggestions. Previously unreviewed movies come first. Already reviewed unseen movies can return when fresh ones run out. A checkbox moves the current movie to the top of your watchlist; friends’ suggestions appear in the same recommendation pool.
- **Eligibility:** only the current night’s attendees count. Any attendee’s seen history disqualifies a movie. A last-minute veto saves it as seen and clears the pick. Eligibility is checked again when starting playback.
- **Watchlists:** each person has a visible personal queue. Priority suggestions influence group recommendations. Seen movies remain in the owner’s queue until removed but cannot be chosen for a night attended by someone who has seen them.
- **The wheel:** equal odds or taste-weighted odds. Taste weighting starts each member at 100 weight units, adding 25 units per point their past picks’ average rating is above 3/5, or subtracting 25 per point below 3/5. Normalize the weights to percentages. A new picker starts neutral. The server draws using cryptographic randomness and saves one winner per night; refreshes and duplicate requests do not reroll it. Attendance and wheel mode lock after a spin. Only the winner can choose the movie.
- **Finish and rate:** finishing marks the movie seen for all attendees, initially with an okay reaction. Each person’s 1–5 rating updates that reaction. They can also compare it with an earlier night. Past nights show the group’s ratings.
- **Recommendations:** a local, deterministic preference engine uses genre affinity from each member’s reactions, pairwise comparisons, and watchlist priorities. It balances the least enthusiastic attendee with average group affinity. It needs no paid AI service. This is an initial recommendation method, not a trained large model. The interface does not show plots, IMDb scores, or recommendation explanations. Stars in past-night records are your group’s own ratings.
- **Sharing:** clients refresh group state every five seconds. The app shares the saved spin outcome; it does not synchronize the exact animation frame between devices.

## IMDb catalog limitation

The environment now permits `imdb.com` and `www.imdb.com`. Chart requests reach IMDb, but IMDb’s CloudFront service still returns HTTP 403, including for a normal browser user agent. The included 100 English-language movies are a **curated starter library**, not the current IMDb top 100. The title-card artwork is original abstract typography, not official movie posters.

To add an IMDb list, export it as CSV from IMDb and import it in **Group & settings**. Limit each import to 100 movies and filter it to English-language titles first. Required columns: `Const`, `Title`, `Year`. Optional: `Genres`, `Runtime (mins)`. Imports upsert titles using IMDb IDs and preserve all viewing history and queues. New catalog entries retain import order; recommendation order remains personalized. This does not automatically refresh or verify IMDb’s chart. The live IMDb top-100 integration remains unfinished pending a usable data source/access.

## Storage, authentication, and operations

The Express/TypeScript server uses Node’s SQLite driver. Data is stored in `data/movie-night.sqlite` (`DB_PATH` overrides this). The database and its WAL/SHM files, dependencies, build output, and local configuration are ignored by Git. Passwords use salted scrypt hashes. Sessions use random tokens, hashed in storage, with HTTP-only SameSite cookies and a 14-day lifetime. Authentication endpoints have an in-memory attempt limit; state-changing requests validate the browser origin. Each API operation is scoped to the authenticated member’s club.

For a consistent backup, stop the app before copying the database, or use SQLite’s online backup API. Do not copy just the main file while it is writing in WAL mode. Live processes and databases are separate from Git; pushing the code does not back up movie history. On restart, sessions and history persist if the same database is retained.

The first version has no email delivery, self-service password recovery, account deletion UI, invitation rotation UI, or administrator moderation. Don’t treat a publicly reachable demo server as a finished hosted product. Review hosting, backups, recovery, and access controls before inviting users over the public internet.

## Project layout

- `server/app.ts`: authenticated API, SQLite schema, recommendations, and wheel rules.
- `server/catalog.ts`: the labeled starter library.
- `server/index.ts`: combined frontend/API development and production server.
- `src/`: React views, shared response types, and responsive styles.
- `tests/app.test.ts`: business-rule and authentication integration checks.
- `tests/browser.smoke.ts`: signup through complete movie night, including mobile and login checks.

Cloud tasks already have an isolated checkout. Reuse `/workspace/movie-night`; a separate Git worktree is unnecessary unless explicitly requested.
