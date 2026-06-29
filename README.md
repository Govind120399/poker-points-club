# FIFA World Cup 2026 Prediction League

Premium private prediction league built with Next.js 15, TypeScript, Tailwind CSS, Framer Motion, Shadcn-style UI patterns, Supabase Auth, Supabase PostgreSQL, Edge Functions, and API-Football.

## Folder Structure

```text
app/
  api/
  auth/
  dashboard/
  leaderboard/
  league/[leagueId]/
  predictions/
  statistics/
components/
  forms/
  layout/
  league/
  navigation/
  providers/
  sections/
  ui/
lib/
  repositories/
public/
  icons/
supabase/
  functions/
  migrations/
tests/
```

## Core Features

- Private league creation with invite code and invite link support
- Supabase email auth plus Google OAuth flow scaffolding
- Match sync pipeline using API-Football and 15-minute refresh-ready architecture
- Prediction deadline lock logic 30 minutes before kickoff
- Automated scoring endpoints and leaderboard-ready data model
- Realtime-friendly UI built for mobile, including bottom navigation and PWA manifest

## Database Setup

1. Create a Supabase project on the free tier.
2. Run `supabase db push` to apply [`supabase/migrations/202606280001_init.sql`](/C:/Users/govin/OneDrive%20-%20Skavatar/Documents/New%20project/supabase/migrations/202606280001_init.sql:1).
3. Run `supabase db reset --linked --seed` or execute [`supabase/seed.sql`](/C:/Users/govin/OneDrive%20-%20Skavatar/Documents/New%20project/supabase/seed.sql:1) manually.
4. Deploy Edge Functions from [`supabase/functions/sync-fixtures/index.ts`](/C:/Users/govin/OneDrive%20-%20Skavatar/Documents/New%20project/supabase/functions/sync-fixtures/index.ts:1) and [`supabase/functions/score-predictions/index.ts`](/C:/Users/govin/OneDrive%20-%20Skavatar/Documents/New%20project/supabase/functions/score-predictions/index.ts:1).

## Local Development

1. Create `.env.local` from [`.env.example`](/C:/Users/govin/OneDrive%20-%20Skavatar/Documents/New%20project/.env.example:1).
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Run tests with `npm test`.

## Deployment

1. Import the repo into Vercel.
2. Add the Supabase and API-Football environment variables in Vercel project settings.
3. Set up a scheduled job in Vercel or Supabase to call `/api/sync/matches` every 15 minutes.
4. Configure Supabase Realtime on `predictions` and `leaderboard` tables for live UI updates.
5. Configure Google OAuth callback URLs to include `/auth/callback`.

## Product Assumptions

- The scoring implementation follows the provided examples: exact score = 10, correct outcome = 3, wrong outcome = 0.
- The app targets a private league size of roughly 10-15 friends, so the leaderboard and moderation flows are intentionally lightweight.
- Push notifications and offline mode are scaffolded with a service worker and notifications page, ready for Supabase Edge Function or OneSignal integration.
