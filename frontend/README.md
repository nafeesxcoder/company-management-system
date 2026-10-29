# Web frontend

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. The partners' desktop
and mobile-browser view of the books.

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

The backend must be running first — this app has no data of its own.

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```

`NEXT_PUBLIC_*` values are **compiled into the browser bundle**. Only the API
URL belongs here; there is nothing a visitor cannot read. Changing it requires a
rebuild — it is not read at runtime.

## Scripts

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (also typechecks) |
| `npm start` | Serve the build |
| `npm run lint` | ESLint |

## Layout

```
src/
├── app/
│   ├── login/ forgot-password/ reset-password/ accept-invite/   public routes
│   ├── (app)/          authenticated shell: dashboard, projects, income,
│   │                   transactions, expenses, reports, profit-sharing,
│   │                   team, integrations, audit-logs, settings
│   ├── layout.tsx      fonts, metadata
│   └── providers.tsx   React Query · theme · toasts · AuthProvider
├── components/         ui/ (shadcn) + Money, Figure, states, app shell
├── features/auth/      session context and the shared public-page shell
├── services/queries.ts every API call, as a typed React Query hook
├── lib/api-client.ts   axios instance, auth header, single-flight refresh
└── types/api.ts        response types mirroring the API
```

## How the session works

The access token lives in **React state only** — never `localStorage`, which any
injected script can read. The refresh token is an `HttpOnly` cookie the API sets,
so this code never touches it; `withCredentials` is what sends it back.

On a page reload there is no access token, so the app silently refreshes from
the cookie. That is why a signed-in user stays signed in without the token ever
being written anywhere a script could reach.

On a 401 the client refreshes **once** and replays the request. Concurrent 401s
share one in-flight refresh: ten parallel requests firing ten rotations would
trip the backend's token-reuse detector and kill the session.

### Getting in

There is no sign-up. `/accept-invite?token=…` is the only route into a company,
from a link an owner generates under Team. `/forgot-password` and
`/reset-password?token=…` handle resets.

## Money on screen

Amounts arrive as strings and are rendered as strings. The `Figure` component is
the one way money is displayed — serif with tabular numerals, so a column aligns
on the decimal. Colour is applied only where sign carries meaning, never as
decoration.

This app **does not calculate**. Every total, including the profit margin, comes
from the API. If a number looks wrong, the fix belongs in the backend, which is
also what the Flutter app reads.

## Data fetching

Every call is a typed hook in `services/queries.ts`, using TanStack Query. 4xx
responses are never retried — the server meant them; only transient failures get
a second attempt. Mutations invalidate the queries they affect, so a recorded
expense updates the dashboard without a manual refresh.

Loading, empty and error states are explicit on every screen. An error surfaces
the API's own message plus its `requestId`, so a report can be traced to exact
log lines.

## Responsiveness

Built to work at phone width in a browser: sidebar collapses, tables become
stacked cards, charts scroll rather than overflow, and no page scrolls
horizontally. The Flutter app is the better phone experience, but the web app
remains usable on one.
