# Chaka Signs Map — Session Kickoff Doc
*Give this file to a new Claude chat to resume development instantly*

---

## What This Is
A collaborative web map for the Coppell, TX Chaka sign campaign. Hosted on GitHub Pages. No server — uses Google Apps Script + Google Sheets as a backend.

**Live URL:** `https://brentbillington-ship-it.github.io/Sign_Routing/` *(update if repo changes)*

---

## File Structure
```
chaka-map/
├── index.html        ← Shell only. Loads all modules. Boot logic at bottom.
├── config.js         ← ALL config: password, Apps Script URL, map bounds, layer defs
├── layers.js         ← Layer state, marker icons, render, visibility, CRUD
├── points.js         ← Point placement, edit/delete/copy/paste popups, keyboard shortcuts
├── parcels_layer.js  ← Read-only parcel overlay, click popup, highlight on select
├── parcels.js        ← 6MB baked-in GeoJSON (16,986 Coppell parcels from PROPERTY_LINES.kmz)
├── presence.js       ← Who's online sidebar pill rendering
├── sync.js           ← Google Sheets load/save/refresh + presence heartbeat
├── ui.js             ← Sidebar build, login, toast, context menu, KMZ upload, add layer modal, location btn
└── apps_script.js    ← Paste into Google Apps Script (not served by GitHub Pages)
```

**Module load order** (enforced by index.html):
`config.js` → `parcels.js` → `layers.js` → `presence.js` → `sync.js` → `parcels_layer.js` → `points.js` → `ui.js`

---

## Key Config (config.js)
```js
MAP_PASSWORD:    'choochoo'
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbx5MkAyVLaFS4p5G6JM6UfSCBQEeFGpMK88zqMwDlXT51TvVFhEE4BFYUxID0i6G9wU/exec'
MAP_CENTER:      [32.9546, -97.0075]   // Coppell, TX
MIN_ZOOM:        10                     // ~DFW metro
MAX_ZOOM:        19                     // last good Esri aerial
```

---

## Layers
| ID | Name | Shape | Color |
|---|---|---|---|
| large-repair | Large Sign (Repair) | square | #e05252 |
| large-risky | Large Signs (Risky) | square | #e07c3a |
| large-pending | Large Signs (Pending) | square | #4d94d4 |
| large-ready | Large Signs (Ready) | square | #5cb85c |
| large-installed | Large Signs (Installed) | square | #9b6dd4 |
| small-risky | Small Signs (Risky) | circle | #e07c3a |
| small-pending | Small Signs (Pending) | circle | #4d94d4 |
| small-ready | Small Signs (Ready) | circle | #5cb85c |
| small-installed | Small Signs (Installed) | circle | #9b6dd4 |
| residential | Residential Signs | circle | #e06fa0 |

Custom layers can be added at runtime via the UI — they get `group:'custom'` and a generated ID.

---

## Backend (Google Apps Script)
- **Apps Script URL:** `https://script.google.com/macros/s/AKfycbx5MkAyVLaFS4p5G6JM6UfSCBQEeFGpMK88zqMwDlXT51TvVFhEE4BFYUxID0i6G9wU/exec`
- **Deployment ID:** `AKfycbx5MkAyVLaFS4p5G6JM6UfSCBQEeFGpMK88zqMwDlXT51TvVFhEE4BFYUxID0i6G9wU`
- **Sheet name:** `Chaka Signs Data`
- **Tabs auto-created:** `Points`, `Presence`

**After every apps_script.js change:**
Deploy → Manage deployments → pencil → New version → Deploy (URL stays the same)

---

## Features Built
- [x] Esri World Imagery aerial basemap
- [x] CartoDB street label overlay (toggle)
- [x] 10 sign layers: 5 large square + 5 small circle
- [x] Click map to place point on active layer
- [x] Right-click context menu: Place here / Paste
- [x] Edit popup: change layer, name, notes
- [x] Delete button + Delete key shortcut
- [x] Ctrl+C / Ctrl+V copy-paste
- [x] Last layer remembered in localStorage
- [x] Add custom layer (name, color, shape picker)
- [x] KMZ drag-and-drop upload (renders as yellow overlay)
- [x] Property Lines layer (16,986 parcels baked in, read-only, click for owner popup, highlight on select)
- [x] My Location button (floating, GPS pulse dot, Felt-style)
- [x] Who's online (presence bar with animated dots)
- [x] Login gate with name prompt (localStorage remembers auth)
- [x] Google Sheets backend: 15s silent refresh, presence heartbeat every 25s
- [x] Export to GeoJSON button
- [x] Scale bar (imperial + metric)
- [x] Min zoom: 10 (DFW metro), Max zoom: 19 (no bad tiles)

---

## Parcel Data
- Source: `PROPERTY_LINES.kmz` (Coppell ISD parcel KMZ, DCAD data)
- Parsed to GeoJSON: 16,986 features, ~6MB raw / ~1MB gzipped
- Fields: `name` (land use), `owner` (OWNER_NAME1), `addr1`, `addr2`
- Stored in: `parcels.js` as `const PARCELS_GEOJSON = {...}`
- Layer logic: `parcels_layer.js` — yellow outlines, hover highlight, click = white highlight + popup

---

## Pending / Not Built Yet
- [ ] Residential Signs data upload (spreadsheet import)
- [ ] Sign status workflow (e.g. move Pending → Installed in bulk)
- [ ] Mobile optimizations
- [ ] Print/PDF export

---

## Deploy Checklist (GitHub Pages)
1. Push all files to repo root (or subfolder with Pages configured)
2. Settings → Pages → Deploy from branch → main / root
3. `parcels.js` is large (6MB) — GitHub Pages serves it gzip-compressed, loads fine

## Rules Claude Should Follow For This Project
- Never write or modify code without an explicit "go" signal from Brent
- Always present changes as a numbered list first, wait for go
- Use `py` not `python` in terminal commands (Windows)
- Deliver as zip bundles (Brent can't download .py or .js files directly)
- Set file timestamps to Central Time before zipping
- After apps_script.js changes, remind Brent to redeploy (new version, same URL)
