# iBase Poster — Phase 2 starter

Posts a photo + caption to Facebook Page, Instagram Business, and LinkedIn from one dashboard.
This is a starter codebase, not a finished product — you need real app credentials and platform
approval before anything here actually posts.

## What's real vs. what's still a TODO

Works once configured — the full flow, end to end:
- Upload a photo in the dashboard
- Photo is uploaded to Supabase Storage automatically (gets a public URL, no manual pasting)
- Claude generates a tailored caption + hashtags for every connected platform, in one step
  (uses Google's Gemini API — free tier, no billing required, see Step 0 below)
- Review/edit each caption inline
- Click "Post to X" — it posts for real via that platform's API, no copy-paste

Still needs setup before any of the above works live:
- Meta App Review approval (Facebook Page + Instagram Business posting)
- LinkedIn Community Management API approval (for Company Page posting specifically —
  personal profile posting works with standard approval)
- A Supabase Storage bucket named `ibase-photos`, set to public

Not included, and not possible via any approach:
- **WhatsApp Status posting** — no platform, ever, has offered a public API for this.
  Keep using Caption Counter's copy-paste flow for WhatsApp specifically.
- Twitter/X posting — API is a paid tier (~$100/mo minimum); add `pages/api/post/twitter.js`
  following the same pattern as `meta.js` once that's worth paying for

## Step 0 — Gemini API key (free, no billing needed)

1. Go to aistudio.google.com and sign in with any Google account
2. Click "Get API key" → "Create API key"
3. Copy it into `.env` as `GEMINI_API_KEY`

This covers caption generation. Google's free tier gives real ongoing daily quota (not a
one-time trial), so this stays free for iBase's expected usage volume.

## Step 1 — Meta (Facebook + Instagram)

1. Go to developers.facebook.com → Create App → type "Business"
2. Add the "Facebook Login" product, set a Valid OAuth Redirect URI to
   `https://your-domain.com/api/auth/meta/callback`
3. Under App Review, request these permissions: `pages_manage_posts`, `pages_read_engagement`,
   `instagram_basic`, `instagram_content_publish`, `business_management`
4. Meta requires: a privacy policy URL, a terms of service URL, and a screen-recorded demo of
   the exact OAuth + posting flow for each permission you request
5. iBase's Facebook Page must already have an Instagram **Business** (not personal) account
   linked to it — Settings → Linked Accounts on the Page
6. Review typically takes 1–4 weeks. Until it's approved, only accounts listed as
   Admins/Testers on the app (in App Roles) can use it — good enough to test with iBase's own
   account before going live

## Step 2 — LinkedIn

Two very different paths depending on what iBase actually wants:

- **Posting as an individual employee's profile** — works with the standard LinkedIn app
  (Sign In with LinkedIn + `w_member_social` scope), approved almost instantly. This repo's
  LinkedIn flow does this today.
- **Posting as the iBase Company Page** — needs LinkedIn's Community Management API, which is
  a separate, manually-reviewed partnership application (LinkedIn asks what you're building and
  why, and approval is not guaranteed or fast — this is the single biggest timeline risk in this
  whole project). Apply early at linkedin.com/developers, under your app's Products tab.

Until Company Page access is approved, plan on posting via a staff member's personal profile,
or fall back to Caption Counter's copy-paste flow for LinkedIn specifically.

## Step 3 — Supabase (token + photo storage)

1. Create a project at supabase.com
2. Run `supabase/schema.sql` in the SQL editor
3. Go to Storage → Create a new bucket named `ibase-photos`, and set it to **Public**
   (Meta and LinkedIn's APIs fetch the photo from its URL server-side, so it must be reachable
   without auth)
4. Copy the Project URL and `service_role` key (Settings → API) into your `.env`

## Step 4 — Deploy

1. `cp .env.example .env` and fill in every value (see comments in that file)
2. Generate `ENCRYPTION_KEY` with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. Push this repo to GitHub, import it into Vercel, add all `.env` values as Vercel environment
   variables
4. Once deployed, update `META_REDIRECT_URI` / `LINKEDIN_REDIRECT_URI` and your Meta/LinkedIn
   app settings to match the real Vercel URL, not localhost

## Local development

```bash
npm install
npm run dev
```

Meta and LinkedIn both reject `localhost` redirect URIs for anything beyond basic testing —
for real OAuth testing you'll want a tunnel like `ngrok` pointed at your local server, with that
ngrok URL registered as the redirect URI temporarily.

## Suggested order of operations

1. Deploy this with your own personal test accounts connected first — confirm a real post lands
   on a test Facebook Page and your own Instagram/LinkedIn before touching iBase's real accounts
2. Apply for Meta App Review and LinkedIn Community Management API access in parallel — they're
   independent processes and both take real time, so don't do them sequentially
3. Once approved, connect iBase's actual Page/Instagram/LinkedIn accounts and go live

## Scheduling posts

After generating and reviewing captions, pick a date/time under "Or schedule it" and click
**Schedule all**. Posts appear in the **Scheduled** tab (cancel any that haven't started), and
the result shows up in History once published.

Setup:
1. Run `supabase/scheduled_posts.sql` in the Supabase SQL editor.
2. Set `CRON_SECRET` (any long random string) in your env / Vercel variables.
3. Something must call `GET /api/cron/publish-scheduled` with header
   `Authorization: Bearer <CRON_SECRET>` every few minutes. Pick one:
   - **GitHub Actions (free, included):** `.github/workflows/publish-scheduled.yml` runs every
     5 minutes. Add repo secrets `APP_BASE_URL` and `CRON_SECRET`. (GitHub may delay scheduled
     runs by a few minutes at busy times.)
   - **cron-job.org or similar (free):** a 5-minute job hitting the URL with that header.
   - **Vercel Cron (Pro plan only for sub-daily):** add to `vercel.json`
     `{"crons":[{"path":"/api/cron/publish-scheduled","schedule":"*/5 * * * *"}]}`.
     Vercel sends the `CRON_SECRET` bearer header automatically. Don't add this on the Hobby
     plan: it rejects cron schedules more frequent than once a day.

Posts publish within roughly one scheduler interval after the chosen time. Times are entered
in your browser's local timezone. Posts stuck mid-publish for 15+ minutes are marked Failed
rather than retried, to avoid double-posting.

## Login

Everything except `/login` requires a signed-in user (enforced in `middleware.js`; the cron
endpoint uses its own `CRON_SECRET`). Accounts are email + bcrypt-hashed password in `app_users`.

Setup:
1. Run `supabase/auth_schema.sql` in the Supabase SQL editor.
2. Set `AUTH_SECRET` (long random string, signs sessions) and `GOOGLE_ALLOWED_EMAILS` (the emails, or `@domain`, allowed to create accounts).
3. Open `/login` → "Create one", enter an allowed email and a password.
4. To close signup later, empty `GOOGLE_ALLOWED_EMAILS` (existing accounts still work).

Sessions last 7 days; changing `AUTH_SECRET` signs everyone out.

## Google login

"Continue with Google" on `/login` signs people in with their Google account.

1. Go to console.cloud.google.com → create/select a project → APIs & Services →
   **OAuth consent screen** (External; add your email as a test user while in Testing mode).
2. **Credentials → Create credentials → OAuth client ID → Web application.** Add Authorized
   redirect URIs: `https://your-app.vercel.app/api/auth/google/callback` (and
   `http://localhost:3000/api/auth/google/callback` for local testing; Google allows localhost).
3. Put the client ID/secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and set
   `GOOGLE_REDIRECT_URI` to the exact URI from step 2 (also in Vercel env vars, then redeploy).
4. Set `GOOGLE_ALLOWED_EMAILS` to the emails (or `@domain`) allowed to get in. Anyone who
   already has an account here can also use Google with the same email. Everyone else is refused,
   since this app can post to the company's social accounts.
