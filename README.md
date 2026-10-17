# Omaha Drain — TV Board

Live technician performance board, fed directly from the ServiceTitan Reporting API.

Replaces the old chain: ServiceTitan → Zapier → Google Drive → Apps Script → Google Sheets.

## Setup

### 1. Environment variables

In Netlify → Site settings → Environment variables, add these four.
**Never commit them to the repo.**

| Key | Value |
| --- | --- |
| `ST_CLIENT_ID` | from ServiceTitan → Settings → Integrations → API Application Access |
| `ST_CLIENT_SECRET` | same screen (shown once — regenerate if lost) |
| `ST_APP_KEY` | from developer.servicetitan.io → My Apps |
| `ST_TENANT_ID` | `4652044181` |

### 2. Verify the connection

Deploy, then open:

```
https://rankingtvapp.netlify.app/api/report-meta
```

This returns every field and parameter the report exposes, with exact API names.
If it errors, the message tells you which of the four env vars is wrong.

### 3. Check the feed

```
https://rankingtvapp.netlify.app/api/feed?debug=1
```

`debug=1` shows which parameters were sent and how they were resolved.
Any parameter marked `REQUIRED but unmapped` needs an entry in
`config/board-config.json` → `report.parameterOverrides`.

## Changing the board

Everything you'd normally need a developer for lives in
`config/board-config.json`:

- **Add a tech** — add them to `forceShow` (and `photos` if you have a headshot)
- **Remove a tech** — add their exact name to `exclude`
- **Move a tech between boards** — add `"Name": "install"` to `assign`
- **Change targets** — edit `targets.<board>.monthlyRevenue`
- **Turn off prorated goals** — set `prorateTargets` to `false`

Commit the change. Netlify redeploys in about 30 seconds.

Names must match ServiceTitan exactly, including middle names.

## Date ranges

`/api/feed` defaults to month-to-date. Also accepts `?range=wtd` and `?range=ytd`.

Note: the old scheduled export was running a rolling **week**, not MTD.
This function computes the range explicitly, so the board now matches its header.

## Monthly Winners slide

The fourth slide in the rotation (`?unit=winners` to lock a TV to it) shows the
#1 Service (revenue), Sales (total sold) and Install (revenue) tech for every
month since `winners.startMonth` in `config/board-config.json`. The current
month is labeled "Leading".

Data comes from `/api/winners`, which runs the same report once per month and
caches results in Netlify Blobs. Past months are re-pulled every 6 hours, so
late adjustments still change the winner. To respect the rate limit, each call
pulls at most 3 months, so a fresh deploy can take a minute or two to fill in.

## Notes

- Tokens last 15 minutes and are cached in memory between invocations.
- ServiceTitan rate limit is 5 calls of the same report per minute per tenant.
  A 15-minute board refresh is nowhere near that.
- The app has **read-only** scope, restricted to the `technician` report category.
  It cannot modify anything in ServiceTitan.
