# 🧭 Gnoke GeoCompass

A GPS compass with real-time bearing, distance, speed, and city search.

> **Portable. Private. Persistent.**

---

## Live Demo

**[edmundsparrow.github.io/gnoke-geocompass](https://edmundsparrow.github.io/gnoke-geocompass)**

---

## What It Does

- Real-time device orientation compass (DeviceOrientation API)
- GPS location tracking with accuracy display
- Set destination by coordinates or name
- City search with map preview (Nominatim / OpenStreetMap)
- Live bearing and distance to destination (Haversine formula)
- 12 preset locations (Nigerian cities + world capitals)
- **GPS Speedometer** — analog dial with live speed, average, max, trip meter and odometer
- **Unit toggle** — switch between km/h and mph; preference persisted
- Works completely offline (after first load)
- No account. No server. No tracking.

---

## Run Locally

```bash
git clone https://github.com/edmundsparrow/gnoke-geocompass.git
cd gnoke-geocompass
python -m http.server 8080
```

Open: **http://localhost:8080**

> ⚠️ Always run through a local server — DeviceOrientation and GPS require a secure context (HTTPS or localhost).

---

## Project Structure

```
gnoke-geocompass/
├── index.html          ← Splash / intro screen
├── main/
│   └── index.html      ← Main app shell (clean URL: /main/)
├── js/
│   ├── state.js        ← App state (single source of truth)
│   ├── theme.js        ← Dark / light toggle
│   ├── ui.js           ← Toast, modal, status chip
│   ├── geo-compass.js  ← Compass engine (orientation, GPS, math, search)
│   ├── speed.js        ← Speedometer (GPS speed, dial, trip meter, odometer)
│   ├── update.js       ← Version checker
│   └── app.js          ← Bootstrap + event wiring
├── style.css           ← Gnoke design system
├── sw.js               ← Service worker (offline / PWA)
├── manifest.json       ← PWA manifest
├── global.png          ← App icon (192×192 and 512×512)
└── LICENSE
```

---

## How It Works

1. **Enable Compass** — requests DeviceOrientation permission (iOS 13+ requires a tap)
2. **GPS** — starts automatically, shows coordinates and accuracy
3. **Set Destination** — enter coordinates, pick a preset, or search for a city
4. **Navigate** — compass shows live heading; gold arrow + readout shows bearing and distance
5. **Speed** — open the Speedometer page; analog dial updates in real time via `coords.speed`

---

## Privacy & Tech

- **Stack:** DeviceOrientation API, Geolocation API (`coords.speed`), Nominatim geocoding, Haversine formula, Vanilla JS — zero dependencies.
- **Privacy:** No tracking, no telemetry, no ads. GPS data never leaves the device.
- **Geocoding:** City search uses the free Nominatim API (OpenStreetMap). No API key required.
- **Odometer:** Trip distance is computed on-device using Haversine between GPS fixes and persisted in `localStorage`. Never transmitted.
- **License:** GNU GPL v3.0

---

## Support

If this app saves you time, consider buying me a coffee:
**[selar.com/showlove/edmundsparrow](https://selar.com/showlove/edmundsparrow)**

---

© 2026 Edmund Sparrow — Gnoke Suite · v1.0
