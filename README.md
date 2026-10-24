# Movie Night

A private Friday ritual for Chris, Matthew, and Yash: discover films nobody has seen, learn each person’s taste, and let the wheel choose who gets the final pick.

## Start the app

Requires **Node.js 24.5 or newer**. Your group’s history lives in SQLite; no external user database is required.

```bash
npm ci
# Optional: copy .env.example to .env and configure the TMDB token below.
npm run dev
```

The combined frontend/API server listens on port 3000 (`PORT` overrides it). Choose **I am Chris**, **I am Matthew**, or **I am Yash**, then enter the agreed three-digit club code. All three profiles share one club while maintaining independent movie histories, taste profiles, and watchlists. The requested shared code is the server default; `FRIEND_GROUP_PIN` overrides it. It is not sent to the browser in configuration or stored in client-side code. Sessions persist through restarts in the retained database.

The previous username/password, registration, invitation, and demo systems remain in the code. They are disabled on both the server and login screen by default. Set `AUTH_MODE=accounts` to restore them. Existing account data is preserved; friend mode creates a separate club and does not silently transfer existing people’s histories into the named profiles.

## Connect the movie catalog and official posters

This version integrates **The Movie Database (TMDB)** for movie metadata, official posters, paginated title search, highly rated English-language discovery, and related-film recommendations. It expands beyond the bundled starter library; it does not claim to contain every film ever made or to provide literally infinite results. TMDB search can also find films that are too obscure for the quality-filtered discovery feed.

1. Create a TMDB account and request API access at [TMDB API settings](https://www.themoviedb.org/settings/api).
2. Copy the **API Read Access Token** (the bearer token, rather than the short API key).
3. For local development, put it in the ignored `.env` file as `TMDB_API_READ_TOKEN=...`. For the cloud environment, supply it securely in environment settings using the saved `TMDB_API_READ_TOKEN` requirement. Never commit a real token or paste it into chat.
4. Permit `api.themoviedb.org` and `image.tmdb.org` in the cloud network settings, save the settings, and restart the app so the server receives the token. Publish the environment when the environment UI requires it to retain the setup.
5. Open a review batch or use **Find more movies** in the approved list. Group settings also has a catalog refresh button.

The token remains on the server; only public poster paths reach the browser. The start commands honor the environment’s HTTPS proxy. Official poster images load from `image.tmdb.org`; the production content policy permits that host. The app never substitutes generated title-card artwork for official posters: missing posters use a clearly labeled neutral placeholder.

**Current validation limit:** no live TMDB credential was available during implementation. Provider requests, catalog expansion, language filtering, cached official poster paths, and personalized candidate retrieval have been tested with controlled provider responses. Live authentication, catalog downloads, and actual poster delivery still need validation with a configured token. Without it, the app works with its saved starter library but cannot fetch new posters or expand discovery.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## The Friday flow

1. **Your first 50:** each person reviews 50 popular starter/highly rated catalog movies. Swipe left for unseen; swipe right to choose loved, liked, okay, or not good. Seen films become permanent history. Buttons and left/right arrow keys work too. Progress saves after each answer and resumes after closing the app or switching profiles.
2. **Friday 20:** a saved, personalized batch of 20 fresh cards. It draws from movies not reviewed by that person and not marked seen by anyone attending. Completed batches do not recycle the same cards. Related candidates enter as the catalog refreshes. A checkbox moves an unseen movie to the top of that person’s watchlist.
3. **Approved list:** the group’s eligible films, ranked for everyone attending. **The earlier rule is preserved: unanswered means unseen.** An eligible movie becomes explicitly confirmed unseen once every attendee answers unseen; the detail view distinguishes confirmation from pending answers. Any attendee’s seen history immediately removes the film. The list is a ranked set of possibilities, not a guarantee everyone will like every entry.
4. **The wheel:** equal odds or taste-weighted odds select the person, not the movie. Only that picker can set the final movie. The server saves one draw per night. Attendance and wheel mode lock after the spin. The animation has Web Audio clicks that slow down with the spin, plus a remembered mute toggle. Audio unlocks from the user’s tap so it can work on mobile; unavailable audio never blocks choosing a picker.
5. **Veto, watch, rate:** “Wait, I’ve seen this” saves the film as seen and clears the choice. Starting playback rechecks eligibility. Finishing marks the film seen for all attendees. Each attendee rates it 1–5 and can compare it with a previous Friday. Their feedback updates their taste profile for subsequent rankings.

The wheel’s performance mode starts at 100 weight units per person and adjusts by 25 units for every point their past picks’ average rating is above or below 3/5. Weights are normalized to probabilities. New pickers start neutral.

## How learning works

This is an explainable recommendation engine with explicit positive and negative evidence, not a claim of a pretrained model that knows everyone’s taste.

- **Independent taste:** each person’s loved/liked/okay/disliked history is retained separately. Loved is stronger positive evidence than liked; disliked is negative evidence. Pairwise comparisons add relative preference evidence. Unseen answers affect eligibility and review history, not a fabricated enjoyment rating.
- **Specific similarity:** films are compared using genres, TMDB keywords, directors, principal cast, and TMDB’s related-film links. This can connect _Get Out_ to another social thriller or Jordan Peele film more strongly than to a generic slasher that merely shares the Horror label. Before TMDB enrichment, only available starter metadata can contribute.
- **Candidate retrieval:** on catalog refresh, each member contributes positive seed films. Their related-film pools supply new candidates, while paginated highly rated English-language discovery expands beyond that neighborhood. Provider metadata is cached in SQLite. Positive/negative reactions and post-night ratings invalidate the discovery cache for the next batch.
- **Group compromise:** ranking combines 60% average personal affinity with 40% the least enthusiastic attendee’s affinity. One prolific rater cannot simply outweigh the others. Sparse evidence is shrunk toward neutral rather than presented as certainty.
- **Quality and queues:** a modest Bayesian provider-quality prior helps with cold starts; it does not replace taste. Personal watchlist priorities add a small boost. Provider scores and plots stay out of the interface.
- **Exploration:** a diversity pass reduces near-duplicate cards, with every fifth selection giving extra room to another taste cluster. This broadens what the system can learn instead of serving 20 nearly identical thrillers.
- **Feedback loop:** new reactions immediately rerank cached candidates. The next fresh review batch refreshes related candidates when new feedback makes discovery stale. Existing in-progress batches stay stable so swipes cannot jump between films.

A test explicitly checks that everyone loving _Get Out_ raises _Us_ above a generic genre-only match and that a dissenting dislike lowers the group prediction. These are algorithm-behavior checks, not proof it can guarantee a great movie every Friday. There is no empirical accuracy benchmark until the group provides real feedback.

## Data, persistence, and operations

The database defaults to `data/movie-night.sqlite`; `DB_PATH` overrides it. It stores profiles, hashed sessions, reviews, watchlists, movie nights, individual ratings, provider metadata, and resumable review batches. Additive schema creation preserves existing databases. Dependencies, `.env`, database files, and build output are ignored by Git.

For a consistent backup, stop the server before copying the database or use SQLite’s online backup API. Do not copy just the main database while WAL writes are active. GitHub stores code, not your group’s watch history. Deployment requires a shared server with a persistent disk and HTTPS so all three phones see the same data. Production cookies are Secure by default. Use `COOKIE_SECURE=false` only for an HTTP local production smoke check.

```bash
npm test               # Business rules, profiles, saved reviews, recommendation behavior, provider contracts
npm run build          # TypeScript check + production frontend
npm run test:browser   # Retained accounts flow + mobile friend/PIN/touch/audio flow in Chromium
npm run format:check
npm start              # Production server; build first
```

Browser tests use `/usr/bin/chromium` if present, or Playwright’s browser; `CHROMIUM_PATH` overrides it. Install a Playwright browser with `npx playwright install chromium` if needed and permitted by the network. The mobile test dispatches actual touch events in a mobile Chromium context and checks that repeated audio oscillators start. It does not substitute a physical iPhone/Safari audio test.

The 100 English-language starter films are curated, not IMDb’s current top 100. IMDb chart requests still returned HTTP 403 from its CloudFront service after the environment allowlist was opened. The older IMDb CSV importer remains available and preserves history by IMDb ID; direct IMDb scraping is not a dependency of the TMDB integration.

## Project layout

- `server/app.ts`: profile/account modes, authenticated group API, SQLite persistence, review batches, wheel rules.
- `server/tmdb.ts`: server-only TMDB adapter, caching, language filtering, metadata and official poster paths.
- `server/catalog-service.ts`: paginated discovery, favorite-seed retrieval, catalog expansion and feedback invalidation.
- `server/recommender.ts`: individual affinities, group compromise, pairwise feedback, quality prior and diversity.
- `src/`: responsive React flows, pointer-based swipe cards and wheel audio.
- `tests/`: integration, provider-contract, algorithm-behavior, account and mobile-browser checks.

Cloud tasks already have an isolated checkout. Reuse `/workspace/movie-night`; do not create a Git worktree unless explicitly requested.
