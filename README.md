# Saxophonist booking site

A booking site with a real calendar, booking requests, an admin panel, and
(once you add the link) automatic sync with a Google Calendar's busy dates.

## 1. Create a free Supabase project
Go to supabase.com, sign up, and create a new project (any name/region/password
is fine — save the database password somewhere).

## 2. Create the database tables
In your Supabase project, open **SQL Editor** and run this:

```sql
create table profile (
  id int primary key default 1,
  name text,
  tagline text,
  bio text,
  email text,
  instagram text,
  rate text,
  photo text
);

insert into profile (id, name, tagline, bio, email, instagram, rate, photo) values
(1, 'John Nicole Pasion',
 'Saxophones for weddings, clubs, cocktail hours and private events.',
 '',
 'johnnicole.pasion1113@gmail.com',
 'https://www.facebook.com/johnnicole.pasion',
 '',
 '');

create table dates (
  date text primary key,
  status text
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  name text,
  email text,
  phone text,
  type text,
  message text,
  status text default 'pending',
  created_at timestamptz default now()
);
```

> **Already ran this SQL before and just added the photo?** Run this instead of
> the block above: `alter table profile add column photo text;`

Then go to **Project Settings → API** and copy:
- **Project URL** → this is `SUPABASE_URL`
- **service_role key** (not the anon key) → this is `SUPABASE_SERVICE_KEY`

Keep the service_role key private — never put it in the site's frontend code
(this project only uses it inside the server-side API routes, which is safe).

## 3. Put the code on GitHub
Create a free GitHub account if you don't have one, create a new repository,
and push this project's files to it. (In GitHub's web UI you can also just
drag-and-drop the whole project folder to upload it — you don't need to use
git on the command line if you don't want to.)

## 4. Deploy on Vercel
- Sign up at vercel.com with your GitHub account.
- Click **Add New → Project**, pick the repo you just created.
- Before deploying, add these **Environment Variables**:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `ADMIN_PASSWORD` — pick something only you two know
  - `GOOGLE_ICS_URL` — leave this blank for now
- Click **Deploy**. In a minute or two you'll get a live link like
  `your-project.vercel.app` — that's the real, working site.

## 5. Add Google Calendar later
When you're ready: open his Google Calendar → the three dots next to his
calendar's name → **Settings and sharing** → scroll to **Integrate calendar**
→ copy **Secret address in iCal format**.

In Vercel: **Project → Settings → Environment Variables**, add
`GOOGLE_ICS_URL` with that link, then **Deployments → Redeploy**.
From then on, any day he's already busy on that calendar will automatically
show as unavailable on the site — no further action needed from him.

## Notes
- The admin password logs him into the panel to approve/decline requests,
  manually mark dates booked or unavailable, and edit his profile text.
- Google Calendar sync is one-way (read-only) — it blocks busy days, but
  approved bookings on the site do not get added back into his calendar.
- Local development: copy `.env.example` to `.env.local`, fill in the values,
  run `npm install` then `npm run dev`.
