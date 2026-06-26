# Accounts setup (Phase 1) — step by step

This turns on **sign-in, saving & sharing creations, and the admin dashboard**.
It uses [Supabase](https://supabase.com) (a free hosted Postgres + auth backend).
The explorer keeps working **fully anonymously and locally** until you finish these
steps — accounts only light up once the two keys below are set.

You only have to do this **once**. Takes ~10 minutes.

---

## 1. Create a free Supabase project
1. Go to **[supabase.com](https://supabase.com)** and click **Start your project** → sign in with GitHub.
2. Click **New project**.
3. Name it `thousandworlds`, pick a **database password** (save it somewhere), choose the region closest to you, and click **Create new project**.
4. Wait ~1 minute while it sets up. ✅ When the dashboard loads, you're ready.

## 2. Create the database tables
1. In the left sidebar, click **SQL Editor** → **New query**.
2. Open **`supabase/schema.sql`** from this repo, copy **all** of it, paste it into the editor, and click **Run** (bottom right). You should see **Success. No rows returned**. ✅
3. **Grant admin to your team.** Open **`supabase/admins.local.sql`** — it's **git-ignored** (the real admin emails are kept out of this public repo on purpose). Copy it into a new query and **Run** it. To add/remove an admin later, edit that file and re-run, or use the snippet at the bottom of this doc.

## 3. Turn on email sign-in
1. Left sidebar → **Authentication** → **Providers**.
2. Make sure **Email** is **enabled** (it is by default). Leave "Confirm email" on.
3. Left sidebar → **Authentication** → **URL Configuration**. Set **Site URL** to your live site `https://thousandworldsexplorer.com` and add `http://localhost:5173` under **Redirect URLs** (so sign-in works locally too). Click **Save**.

## 4. Copy your two keys into the app
1. Left sidebar → **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon / public** key.
3. In the repo, copy `.env.example` to a new file named **`.env.local`** and paste them in:
   ```
   VITE_SUPABASE_URL=https://YOURPROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...   (the long anon key)
   ```
   > `.env.local` is git-ignored — it never gets committed. The anon key is safe to ship in a browser app; the database is protected by row-level security.

## 5. Run it
```bash
npm install
npm run dev
```
Open **http://localhost:5173**. You'll see a **Sign in** button at the top-right.
Sign in with your email → check your inbox → click the magic link → you're in.
Because your email is in the admin allowlist, you'll also see **Admin dashboard** in your account menu.

## 6. Deploy
On your host (Vercel/Netlify/etc.), add the **same two environment variables**
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the project settings, then redeploy.

---

### Adding or changing an admin later
Either add the email to the `admin_emails` table (takes effect on their next sign-up), or promote an existing user directly in the SQL Editor:
```sql
update public.profiles set is_admin = true where email = 'someone@example.com';
```

### What we store (and the privacy promise)
- **Anonymous visitors:** nothing leaves the browser — exactly as before.
- **Signed-in users:** we store your **email**, the **worlds/findings you choose to save**, and a lightweight **activity log** (sign-ins, saves, shares) so admins can see what the community is making. Public creations are visible to everyone via their share link; private ones only to you and admins. Users can delete their creations (account deletion: ask an admin for now).
