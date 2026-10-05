# Saxophonist Booking Site

A personal website for a freelance saxophonist: a portfolio page, a live availability calendar, and a booking request system with an admin dashboard. Clients pick a date and time range, send a request, and the musician approves or declines it from a private admin panel. Approved gigs can be added to Google Calendar automatically.

Built with Next.js, Supabase and Vercel, and designed to run on free tiers.

## Features

**Public site**
- Portfolio with bio, photo, performance videos, testimonials and venues
- Availability calendar showing open, partly booked and unavailable days
- Time-slot booking requests with automatic conflict and buffer-time checks
- Booking form with a required privacy consent checkbox
- Light and dark themes (remembered between visits), plus scroll and hover animations
- Responsive layout for desktop, tablet and phone
- Link previews for Facebook and Messenger (Open Graph tags)

**Admin dashboard** (`/admin`)
- Password login with expiring session tokens
- Review requests: approve, decline, or cancel a confirmed gig with a reason
- Approving a gig automatically declines any pending requests that overlap it
- Block whole days manually and view the full schedule
- Edit profile text, photo, videos, testimonials and the buffer time between gigs

**Integrations** (all optional)
- Google Calendar read: busy days sync in as unavailable (iCal link)
- Google Calendar write: approved gigs become calendar events, and cancelled gigs remove them
- Email alerts for new requests through Gmail or Resend

## Tech Stack

| Area | Technology |
| --- | --- |
| Framework | Next.js 14 (pages router), React 18 |
| Database | Supabase (Postgres) with Row Level Security |
| Hosting | Vercel |
| Calendar | Google Calendar (iCal feed and service account) |
| Email | Nodemailer (Gmail) or Resend |

## Getting Started

### Prerequisites
- Node.js 18.17 or later
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) account and a GitHub repository for deployment

### 1. Install

```bash
git clone <your-repo-url>
cd sax-booking
npm install
```

### 2. Set up the database

Create a Supabase project, then open **SQL Editor** and run the following.

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

insert into profile (id, name, tagline, bio, email, instagram, rate, photo)
values (1, 'Your Name', 'Saxophones for weddings, clubs and private events.', '', 'you@example.com', '', '', '');

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

Then run the migration files from this repo **in this order**, one at a time:

| Order | File | What it adds |
| --- | --- | --- |
| 1 | `migration.sql` | Time slots (start and end time) and the buffer between gigs |
| 2 | `migration-content.sql` | Videos, testimonials and venues on the profile |
| 3 | `migration-cancel.sql` | Cancellation reason and timestamp |
| 4 | `migration-calendar.sql` | Google Calendar event tracking |
| 5 | `migration-lockdown.sql` | Turns on Row Level Security so the public API can't read or write anything |

All migrations are safe to re-run. `migration-lockdown.sql` ends with two read-only checks: every table should show `rowsecurity = true`, and the policies query should return no rows.

Then go to **Project Settings → API** and copy the **Project URL** and the **service_role** (secret) key.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase `service_role` key. Keep it private. |
| `ADMIN_PASSWORD` | Yes | Admin login password (use 12+ characters) |
| `SITE_URL` | Yes | Your live address with no trailing slash, e.g. `https://your-site.vercel.app` |
| `NEXT_PUBLIC_SITE_TIMEZONE` | Yes | IANA timezone, e.g. `Asia/Manila` |
| `GOOGLE_ICS_URL` | No | Calendar "Secret address in iCal format", used to block busy days |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | No | Service account email, used to add gigs to the calendar |
| `GOOGLE_PRIVATE_KEY` | No | Service account `private_key`, pasted as one line keeping the `\n` characters |
| `GOOGLE_CALENDAR_ID` | No | Calendar ID, ends in `@group.calendar.google.com` |
| `NOTIFY_EMAIL` | No | Where new-request alerts go (defaults to the profile email) |
| `EMAIL_FROM_NAME` | No | Sender name on emails |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | No | Send through Gmail using an App Password |
| `RESEND_API_KEY`, `EMAIL_FROM` | No | Send through Resend instead (Gmail wins if both are set) |

If the Google or email variables are left blank, the app still works. It prints what it would have sent or created in the server log.

### 4. Run locally

```bash
npm run dev
```

Open <http://localhost:3000>. The admin panel is at <http://localhost:3000/admin>.

## Deployment (Vercel)

1. Push the project to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Add the environment variables above. Add `NEXT_PUBLIC_SITE_TIMEZONE` as a normal (non-secret) variable, since `NEXT_PUBLIC_` values are exposed to the browser.
4. Click **Deploy**.
5. Once you have your live address, set `SITE_URL` to it and **Redeploy**. Environment variable changes only apply to new deployments.

`vercel.json` schedules a daily request to `/api/profile` so the free Supabase project doesn't pause from inactivity.

### Connecting Google Calendar

**Read busy days (iCal):** In Google Calendar, open the calendar's **Settings and sharing → Integrate calendar**, copy the **Secret address in iCal format**, and set it as `GOOGLE_ICS_URL`.

**Add approved gigs (service account):** Create a service account in Google Cloud and enable the Calendar API. Share the calendar with the service account's email using **Make changes to events**. Then set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` and `GOOGLE_CALENDAR_ID`.

## Project Structure

```
.
├── components/        Shared UI (theme toggle)
├── lib/               Server helpers: auth, email, Google Calendar, iCal, slots, timezone, Supabase client
├── pages/
│   ├── index.js       Public site
│   ├── admin.js       Admin dashboard
│   └── api/           Server routes: requests, dates, profile, photo, login
├── styles/            Global theme styles and admin CSS module
├── migration*.sql     Database setup and upgrades
├── next.config.js     Security headers and noindex rules
└── vercel.json        Daily keep-alive cron
```

## Security Notes

- The Supabase `service_role` key is used only in server-side API routes and never reaches the browser.
- Row Level Security is enabled on every table with no policies, so the public Supabase API can't read or write data.
- Admin login issues signed, expiring tokens, so the password isn't sent with every action.
- Booking forms use a hidden honeypot field, a minimum fill time and per-IP rate limiting to cut spam.
- Client-supplied text is escaped before it goes into emails.
- `/admin` and `/api/*` are marked `noindex`, and the site sends standard security headers.
- The rate limiter keeps its counts in memory, so on Vercel each server instance counts separately. It limits guessing but isn't a hard cap.
- Never commit `.env.local`. If a key or password is ever shared by accident, rotate it.

## Notes

- Bookings are by time range, not whole day. A gig is rejected if it overlaps another approved gig or falls inside the buffer time.
- Client details are used only to follow up on the booking. To delete a client's data, remove the row from the `requests` table in Supabase.
- Vercel's free Hobby plan is for non-commercial use. Move to a paid plan if the site is used for business.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm start` | Run the production build |
