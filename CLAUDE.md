# Barn Park — guide for Claude Code

Barn Park (barnpark.onrender.com) is a multi-tenant direct-booking platform for small Thai hotels, homestays and community stays. Each property gets its own booking website, takes payments by PromptPay / bank transfer / pay at the desk, and is managed mostly through the Barn Park LINE OA bot. Owner: Bell. The team writes requests in Thai.

## Stack

- Node 20, Express 4, Mongoose 8 (MongoDB Atlas), ES modules (`"type": "module"`), no build step, no TypeScript.
- Hosted on Render (auto-deploys the `main` branch). Email through Brevo's HTTP API. Images resized with `sharp` and stored inside MongoDB as data URLs.
- No front-end framework: every page in `public/` is one HTML file with inline CSS and JS, plus the shared `public/api.js` and `public/style.css`.

## Layout

- `server.js` — Express app: security headers, JSON body, rate limits (per path, registered before routes), route mounting, static files, error handler.
- `routes/` — REST API under `/api/...`
  - `public.js` — guest booking API, no login, rate-limited
  - `hotels.js` — hotel settings plus the `/admin/...` endpoints
  - `rooms.js`, `services.js`, `bookings.js`, `activities.js`, `promos.js`, `reviews.js`, `feedback.js` — data endpoints
  - `auth.js` — login and accounts
  - `line.js` — LINE webhooks
  - `dev.js` — GitHub callback for LINE jobs
  - `setup.js` — first-run seeding
- `models/` — Mongoose schemas: Hotel, RoomType, Booking, Service, ActivityBooking, PromoCode, Review, User, LineChat, LinkCode, Feedback, Setting (key/value), DevJob.
- `lib/` — logic:
  - `linebot.js` — the Barn Park LINE bot, a large file. Text goes through `onText` → `KEYWORDS`, buttons through `onPostback` → `ACTIONS`.
  - `lineui.js` — LINE message, Flex and quick-reply helpers.
  - `line.js` — LINE Messaging API. `reply` is free; `push` counts against the 300 free messages a month.
  - `notify.js` — booking alerts by LINE and email.
  - `images.js`, `security.js`, `ratelimit.js`
  - `pay.js` (payment methods), `stay.js` (breakfast, check-in info, map), `promptpay.js`
  - `checklist.js`, `announce.js`, `feedback.js`, `onboard.js`, `presets.js`, `pricing.js`, `promo.js`, `holds.js`, `og.js`
  - `calc.js` — Channex cost calculator
  - `devjobs.js` — LINE jobs for Claude Code
  - `channex.js` and `omise.js` are scaffolds that are not live yet.
- `public/` — pages:
  - `index.html` — marketing homepage, TH/EN, with intro videos in `media/`
  - `book.html` — the guest booking page: 10 templates × 10 colour presets, TH/EN
  - `app.html` — hotel back office
  - `admin.html` — platform admin, Thai only
  - `login.html`, `privacy.html`, `ota-guide.html`
  - `api.js` — API client, i18n (`API.t(th, en)`, `data-th`/`data-en` attributes, `API.applyI18n()`), themes, `API.esc`.

## Conventions

- UI text is Thai first. Guest-facing pages (`book.html`, `index.html`) must also work in English: use `data-th`/`data-en` on static text or `API.t(th, en)` in scripts. `admin.html` is Thai only.
- Keep pages single-file and match the surrounding code style (compact JS, small helpers, no new libraries). Add npm dependencies only when truly needed.
- Server: validate and clamp every input; use `requireAuth` + `requireAdmin` for admin endpoints and `canAccessHotel` for hotel data; add a rate limit in `server.js` for new public endpoints.
- Browser: escape anything user-supplied before putting it into HTML (`API.esc` / `esc`).
- LINE: prefer reply messages (free); push only for important alerts. Button labels are at most 20 characters, quick replies at most 13 items.
- Money is in Thai baht. Dates are `YYYY-MM-DD` strings in Bangkok time (UTC+7).
- For user-visible changes, add a short Thai bullet to the latest "อัปเดต" section at the end of `README.md`.
- For changes hotel owners or guests will notice, also add an entry at the top of `CHANGELOG` in `lib/changelog.js` (new unique `id`, today's `date`, Thai `title`, short Thai `items` saying what they get and where to use it). The admin "📣 แจ้งอัปเดต" announcement is built from this list, so it must match what is actually shipped.

## Testing

- `npm test` runs `test/run.mjs`: syntax checks of every JS file and every inline `<script>` in `public/*.html`, then each `test/*.test.mjs`.
- Tests stub Mongoose model methods and `fetch`. No database or network is needed. Follow the existing test files when adding new ones.
- Run `npm test` before finishing; it must pass.

## Never

- Never read, create or edit `.env` files, and never put secrets, tokens or passwords in code or logs.
- Never edit `.github/` (workflows) or `render.yaml`. If a change needs a new environment variable, add it to `.env.example` and tell Bell.
- Never weaken authentication, admin checks, rate limits, input validation or HTML escaping.
- Never write code that deletes or rewrites existing bookings or hotel data unless the request explicitly asks for it.
- Do not commit or push in LINE jobs: the workflow opens a pull request that Bell reviews and merges herself.
