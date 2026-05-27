# 🍾 Pyaasa — a compass for the thirsty

A dead-simple installable PWA that points a compass arrow toward the nearest liquor shop and shows the approximate distance. Built for Dewas, expandable anywhere. No backend, no database, no API keys.

It's a real PWA: a manifest + service worker mean it's installable to your home screen ("Add to Home Screen") and opens offline. Shop data is fetched network-first so edits show up immediately when online, with a cached fallback when offline.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

Deploy by pushing to GitHub and importing into Vercel — HTTPS (required for compass + GPS) and analytics come free.

> **Note:** the compass and location only work over HTTPS (so: `localhost` or Vercel, not a raw file). On iOS you'll get a "tap to enable compass" button — that's Safari requiring a user gesture before granting orientation access.

## Adding shops

Shop data lives in **`public/shops.geojson`** — a plain static file. To add shops:

1. Open [geojson.io](https://geojson.io).
2. Drop a pin on each shop using the point tool.
3. Add a `name` (and optional `note`) in the properties panel.
4. Copy the generated GeoJSON into `public/shops.geojson`, commit, done.

⚠️ **GeoJSON coordinates are `[longitude, latitude]` — lng first.** This is backwards from Google Maps' "lat, lng". geojson.io handles it for you; only matters if you hand-edit.

## Design decisions

### Why there's no spatial index

The obvious "scale" instinct is to reach for a spatial index (geohash buckets, k-d tree, R-tree) so you don't compute distance to every shop on every location update. **This project deliberately does not do that**, and here's the math:

- Hand-mapped, one city (Dewas): ~20 shops.
- A fully-mapped large Indian metro: low thousands.
- A realistic *national* crowdsourced dataset: tens of thousands, and that's years away.

A brute-force scan of even 10,000 points is a few thousand trig operations — **sub-millisecond on a phone**, and invisible next to the cost of the GPS fix itself. An index would add code, dependencies, and a build step to solve a problem that doesn't exist at this scale. So the nearest-shop lookup is a plain `O(n)` loop.

What *does* earn its keep is a **movement gate**: the GPS watcher fires constantly (and jitters even when you're standing still), so we skip recomputing the nearest shop unless the user has actually moved >10m. That kills the genuinely wasteful work without any indexing machinery.

### If it ever needed to scale

The path is known, and it's still backend-free:

1. **Tens of thousands of points:** add a client-side index like [`geokdbush`](https://github.com/mourner/geokdbush) (built once on load, `O(log n)` nearest-neighbour). Still one static file.
2. **National / hundreds of thousands:** pre-tile the data — geohash-prefixed JSON files or [PMTiles](https://github.com/protomaps/PMTiles) — and fetch only the tiles near the user. A CDN / GitHub Pages serves static tiles for free; the client never downloads the whole dataset.

A real database/server is only needed for concurrent *write* traffic (live crowdsourced submissions), which is a much later problem.

### Accuracy expectations

- **GPS distance**: 5–20m typical outdoors — hence the `~` prefix on distances.
- **Compass heading**: ±10–20° on a decent phone, worse near metal/cars. The distance readout (pure GPS) stays reliable even when the arrow gets confused, so it's shown prominently as the trustworthy fallback.

This is a "get me within eyeshot" tool, not survey equipment — and for a 50–100m vicinity, the sensors are comfortably good enough.
