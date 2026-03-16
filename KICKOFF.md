# Chaka Signs Map — Session Kickoff

## Live URL
https://brentbillington-ship-it.github.io/sign-map/

## GitHub Repo
https://github.com/brentbillington-ship-it/sign-map

---

## Credentials
- **Map password:** `choochoo`
- **Apps Script URL:** `https://script.google.com/macros/s/AKfycbx5MkAyVLaFS4p5G6JM6UfSCBQEeFGpMK88zqMwDlXT51TvVFhEE4BFYUxID0i6G9wU/exec`
- **Google Sheet ID:** `1aBfll1stuWNXGD9Ez9vQnJ_uiJOt6zoVc-iNOjnE2nw`
- **Sheet URL:** https://docs.google.com/spreadsheets/d/1aBfll1stuWNXGD9Ez9vQnJ_uiJOt6zoVc-iNOjnE2nw/edit

---

## Current Version: v3.1f (in progress — not yet pushed)

### File Structure
```
index.html          — Shell, CSS, toolbar HTML, boot script
config.js           — Version, password, Apps Script URL, layer defs, seed data
layers.js           — Layer state, markers, drag reorder, undo, opacity
points.js           — Point placement tool, popups, attribution, copy/paste
parcels_layer.js    — 16,986 parcel polygons, identify mode
parcels.js          — Baked-in parcel GeoJSON (6MB, never edit)
annotations.js      — Draw tools: line, shape, text, measure, erase
sync.js             — Google Sheets sync (delta saves)
ui.js               — Sidebar, layer dropdown, search, modals, style editor
presence.js         — Who's online
apps_script.js      — Google Apps Script backend (requires redeploy after changes)
```

### Module Load Order (index.html)
`config.js → parcels.js → layers.js → presence.js → sync.js → parcels_layer.js → points.js → annotations.js → ui.js`

---

## Architecture: How It Works

### Saves (IMPORTANT — previous sessions had bugs here)
Saves use **delta GET requests** — only the changed point is sent, not the whole dataset.
- New point → `Sync.addPoint(layerId, pt)` → `?payload={"action":"addPoint",...}`
- Edit/drag → `Sync.updatePoint(layerId, pt)` → `?payload={"action":"updatePoint",...}`
- Delete → `Sync.deletePoint(layerId, ptId)` → `?payload={"action":"deletePoint",...}`
- Bulk (seed/undo/import) → `Sync.savePoints(allPoints)` → chunked per layer, 15 pts at a time
- Reason: full save payload (56 seeds = 18KB URL-encoded) exceeds GAS 8KB GET limit
- POST was tried but fails due to CORS preflight — `Content-Type: application/json` triggers OPTIONS which GAS doesn't handle

### Apps Script (REQUIRES REDEPLOY after any apps_script.js change)
Deploy → Manage deployments → pencil ✏ → New version → Deploy (same URL preserved)
Actions handled in `doGet`: `load`, `presence`, `addPoint`, `updatePoint`, `savePoint`, `deletePoint`, `saveLayer`, `saveAnnotations`, `heartbeat`, `save` (legacy fallback)

### Parcel Identify
- Default state: parcels interactive (clicking shows owner/address popup)
- When Point tool active: parcels non-interactive
- When draw tool active: parcels non-interactive
- When SV mode: parcels non-interactive
- All managed via `ParcelsLayer.setIdentifyMode(bool)`

### Point Tool (Nearmap-style)
- Click "Point" in toolbar → activates (highlights like other tools)
- Click map → shows new point form popup → save keeps tool active for next placement
- Right-click OR Esc → deactivates, returns to parcel identify
- Mobile: floating "✕ Cancel" bar appears at bottom when active

---

## Layer Definitions
| ID | Name | Color | Shape |
|---|---|---|---|
| large-repair | Large Sign (Repair) | #e05252 | square |
| large-risky | Large Signs (Risky) | #e07c3a | square |
| large-pending | Large Signs (Pending) | #4d94d4 | square |
| large-ready | Large Signs (Ready) | #5cb85c | square |
| large-installed | Large Signs (Installed) | #9b6dd4 | square |
| small-risky | Small Signs (Risky) | #e07c3a | circle |
| small-pending | Small Signs (Pending) | #4d94d4 | circle |
| small-ready | Small Signs (Ready) | #5cb85c | circle |
| small-installed | Small Signs (Installed) | #9b6dd4 | circle |
| residential | Residential Signs | #e06fa0 | circle |

---

## Brand Colors
- Navy `#1C355E`, Seafoam/Accent `#68949E`, Teal `#115E6B`
- Mint `#B7CECD`, Cool Gray `#D9DAE4`, Salmon `#FC6758`
- BG `#0d1117`, Panel `#161b22`, Border `#21262d`
- Fonts: DM Mono (monospace), Syne (headers)

---

## Known Issues / Pending Work (DO NOT START WITHOUT "go")

### Bug Fixes Needed
1. **apps_script.js has an orphaned code block** — already fixed in local v3.1f but not yet delivered. The block between `saveLayer` and `saveAllPoints` (lines 164–175) needs to be removed. Fixed in working copy.
2. **Saves not confirmed working** — delta save architecture is implemented but not yet tested live. Apps Script needs redeploy. User needs to test after pushing v3.1f files.
3. **Residential signs show as maroon on mobile** — `#e06fa0` renders differently. Add `color-scheme: dark` meta tag (already in index.html v3.1e) and confirm it's in the deployed file.
4. **Point labels vertical on mobile** — fixed with `writing-mode: horizontal-tb !important` in `.map-label` CSS (already in index.html v3.1f). Confirm deployed.

### Feature Requests (pending "go")
5. **Line/Measure tools clunky** — double-click to finish works but feels unreliable. Need to ensure single-click adds point, double-click reliably finishes without adding an extra point. Currently `_onDblClick` pops last point then finishes — may need debounce.
6. **Selecting annotations to delete is difficult** — lines and shapes have thin click targets. Need wider invisible hit area (e.g. 15px stroke-width transparent overlay on top of each annotation for click detection).
7. **Undo should work for ALL features** — currently undo only covers point CRUD. Annotations (lines, shapes, text, measures) are not in the undo stack. Need to add annotation state to `undoStack` in `layers.js` or create a unified undo manager that covers both points and annotations.
8. **Place Point tool UX** — already refactored to Nearmap-style (activates/deactivates like draw tools). Right-click or Esc to cancel. Mobile cancel bar. Confirm working after v3.1f push.

### Nice-to-Have (lower priority)
9. **Ghost cursor on point placement** — show semi-transparent point following cursor when Point tool is active
10. **Layer style changes don't persist across hard refresh** — saved to localStorage but not Sheets; will reset if localStorage cleared

---

## Rules for This Project
- **NEVER write code without an explicit "go" signal from Brent**
- Present proposed changes as a numbered list first, confirm, then wait for "go"
- **Only deliver files that changed** — not the full 11-file zip every time
- Always use `parcels.js` from the repo — never regenerate it (it's 6MB of baked-in GeoJSON)
- Apps Script changes always require a redeploy reminder
- File timestamps: Central Time (`America/Chicago`)
- Halff/Chaka brand colors as defined above
