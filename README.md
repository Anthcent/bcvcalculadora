# BCV Calc

Mobile-first calculator for the official Banco Central de Venezuela (BCV) exchange rates.
Converts between bolívares (Bs), US dollars and euros. It has multiple calculation windows,
a running total, WhatsApp sharing, and a printable or downloadable receipt.

## Features

- **Rates screen**: USD and EUR rates from [bcv.org.ve](https://www.bcv.org.ve/), with value date. Rates refresh automatically every 5 minutes, when the app returns to the foreground, and when the connection comes back.
- **Quick calc**: type an amount, pick a currency and jump straight into the calculator.
- **Calculator**: six-way conversion (Bs ↔ USD ↔ EUR). Each currency has a color:
  green for USD, orange for EUR, white for Bs. The swap button carries the result over
  as the new amount.
- **Multiple calculations**: a side panel lists every calculation, with a per-item
  "include in total" toggle, delete, and clear all.
- **Total and sharing**: total in Bs, USD or EUR, shared via WhatsApp, copy, or a
  receipt that can be printed, saved as PDF or downloaded as PNG.
- Works offline with the last known rates. Responsive from 320px phones to desktop, including landscape.

> The receipt is informational only. It is not a fiscal invoice.

## Requirements

- Node.js **22.15+**. No npm dependencies.

## Run

```bash
npm start      # http://localhost:3000 (also prints LAN URLs for your phone)
npm test
```

`PORT` overrides the default port.

### Why `--use-system-ca`

bcv.org.ve serves an incomplete TLS certificate chain, so Node's bundled CA store rejects it.
The start script uses `--use-system-ca`, which trusts the operating system's certificate store.
TLS verification stays **on**. Never disable it with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Project structure

```
server.js            Static file server + GET /api/rates
src/bcv-parser.js    Parses rates and value date from the BCV home page
src/rates-service.js In-memory cache (10 min), forced refresh, stale fallback
public/              Vanilla HTML/CSS/JS client (ES modules, no build step)
test/                node:test unit tests
```

## API

`GET /api/rates[?refresh=1]`

```json
{ "usd": 911.6243, "eur": 1009.34130871, "valueDate": "2026-11-13",
  "fetchedAt": "2026-11-13T18:42:54.409Z", "source": "bcv.org.ve", "stale": false }
```
