# Daampatyam — prototype

Encrypted, chapter-based relationship memory app. AES-256-GCM encryption,
passphrase + 12-word recovery phrase. Two modes:

- **Guest Mode** — everything stays on-device (IndexedDB), no account needed.
- **Account Mode** — logs in via Supabase Auth (email/password); the same
  encrypted blobs sync across devices through a Supabase table. Supabase
  only ever stores ciphertext — never your passphrase, recovery phrase, or
  plaintext content.

You can start in Guest Mode and create an account later from Settings
("Create an account & sync") to bring your existing data with you.

## Set up Supabase (required for login/sync + centralized feedback)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** in the Supabase dashboard: paste the contents
   of `supabase/schema.sql` from this repo and run it. This creates:
   - `feedback` — star rating + optional comment; anyone can insert, no one
     (not even the app) can read it back except you, from the dashboard.
   - `kv_store` — encrypted app data for logged-in accounts, one row per
     `(user, key)`. Row Level Security ensures each account can only ever
     read/write its own rows.
3. **Authentication → Providers**: Email should already be enabled by
   default. Optional: under **Authentication → Settings**, you can turn off
   "Confirm email" during testing so new accounts can log in immediately
   without checking their inbox — turn it back on before any real users.
4. **Project Settings → API**: copy the **Project URL** and **anon public
   key**.
5. **For local dev**: copy `.env.example` to `.env.local` and fill in those
   two values.
6. **For GitHub Pages / Netlify**: add the same two values as environment
   variables in your hosting platform (see below) so they're available at
   build time.

If Supabase isn't configured at all, the app still works fully in Guest
Mode — login/signup will just show a "backend isn't configured" message.

## Run locally

```
npm install
npm run dev
```

Open the printed `localhost` URL. To test on your **phone over the same
Wi-Fi**, run `npm run dev -- --host` instead, then open the "Network" URL
it prints in Chrome on your phone.

## Deploy to GitHub Pages

1. Create a new **public** repo on GitHub.
2. In this folder:
   ```
   git init
   git add .
   git commit -m "Initial prototype"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. Repo → **Settings → Secrets and variables → Actions → New repository
   secret**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Repo → **Settings → Pages → Source → GitHub Actions**. The included
   workflow (`.github/workflows/deploy.yml`) builds and deploys
   automatically on every push to `main`.
5. After the Action finishes (check the **Actions** tab), your app is live at:
   `https://<your-username>.github.io/<repo-name>/`

## Deploy to Netlify

1. **Site settings → Build & deploy**: build command `npm run build`,
   publish directory `dist`.
2. **Site settings → Environment variables**: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
3. Trigger a deploy (push to your connected repo, or "Trigger deploy" in
   the Netlify dashboard).

`vite.config.js` uses a relative `base: "./"`, so the same build works
correctly on both GitHub Pages (subpath URL) and Netlify (root domain)
without any platform-specific edits.

## Notes on this prototype's scope

- Video attachments are a disabled placeholder — not implemented yet.
- Favorites/wishlist/complaints in the Partner Profile are freeform text
  fields for now, not structured lists.
- Point values in the Relationship Score are placeholders, easy to tune
  once you've used the app for a while.
