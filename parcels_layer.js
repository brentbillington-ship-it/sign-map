// ─────────────────────────────────────────────────────────────────────────────
// parcels_layer.js — Read-only parcel layer + parcel search + address search
// ─────────────────────────────────────────────────────────────────────────────

const ParcelsLayer = (() => {
  let mapRef        = null;
  let geojsonLayer  = null;
  let selectedLayer = null;
  let visible       = true;
  let searchPin     = null;   // temporary address search pin
  let searchPinData = null;   // { latlng, label }

  const STYLE_DEFAULT  = { color:'#f5d76e', weight:1.5, opacity:0.7, fillColor:'#f5d76e', fillOpacity:0.0 };
  const STYLE_HOVER    = { weight:2, color:'#ffe066', fillOpacity:0.08 };
  const STYLE_SELECTED = { weight:2.5, color:'#ffffff', fillColor:'#ffffff', fillOpacity:0.18 };

  // ── STREET SUFFIXES for address scrubbing ─────────────────────────────────
  const STREET_SUFFIXES = /\b(st|ave|blvd|dr|ln|rd|ct|cir|pl|way|pkwy|hwy|fwy|loop|run|trail|trl|bend|cv|cove|pass|xing|crossing|hollow|hl|hill|ridge|pt|point|park|row|sq|square|ter|terrace|walk|path|pike|route|rte|spur)\b/i;

  function _isAddress(str) {
    if (!str) return false;
    // Has a leading number OR contains a street suffix
    return /^\d/.test(str.trim()) || STREET_SUFFIXES.test(str);
  }

  function _scrubProps(raw) {
    const name  = (raw.name  || '').trim();
    const owner = (raw.owner || '').trim();
    let   addr1 = (raw.addr1 || '').trim();
    let   addr2 = (raw.addr2 || '').trim();

    // If addr1 looks like a name (not an address), move it to owner context
    if (addr1 && !_isAddress(addr1)) {
      // It's likely a second owner line — append to owner display, clear addr1
      addr1 = '';
    }
    if (addr2 && !_isAddress(addr2)) {
      addr2 = '';
    }

    return { name, owner, addr1, addr2 };
  }

  // ── INIT ────────────────────────────────────────────────────────────────────
  function init(map) {
    mapRef = map;
    if (typeof PARCELS_GEOJSON === 'undefined') {
      console.warn('ParcelsLayer: PARCELS_GEOJSON not found');
      return;
    }
    geojsonLayer = L.geoJSON(PARCELS_GEOJSON, {
      style:         () => ({...STYLE_DEFAULT}),
      onEachFeature: _onEachFeature,
    }).addTo(mapRef);
  }

  function _onEachFeature(feature, layer) {
    layer.on({
      mouseover: e => { if (e.target!==selectedLayer) e.target.setStyle(STYLE_HOVER); },
      mouseout:  e => { if (e.target!==selectedLayer) geojsonLayer.resetStyle(e.target); },
      click:     e => { L.DomEvent.stopPropagation(e); _onSelect(feature, layer, e); },
    });
  }

  function _onSelect(feature, layer, e) {
    if (selectedLayer && selectedLayer !== layer) geojsonLayer.resetStyle(selectedLayer);
    selectedLayer = layer;
    layer.setStyle(STYLE_SELECTED);
    layer.bringToFront();

    const p    = _scrubProps(feature.properties || {});
    const addr = [p.addr1, p.addr2].filter(Boolean).join(', ') || '—';

    L.popup({ maxWidth:280 })
      .setLatLng(e.latlng)
      .setContent(`
        <div class="parcel-popup">
          <div class="parcel-title">${_esc(p.name||'Parcel')}</div>
          <table class="parcel-table">
            <tr><td>Owner</td><td>${_esc(p.owner||'—')}</td></tr>
            <tr><td>Address</td><td>${_esc(addr)}</td></tr>
          </table>
          <div class="parcel-note">Read-only · click elsewhere to deselect</div>
        </div>
      `)
      .openOn(mapRef);

    mapRef.once('click', _deselect);
    mapRef.once('popupclose', _deselect);
  }

  function _deselect() {
    if (selectedLayer) { geojsonLayer.resetStyle(selectedLayer); selectedLayer = null; }
  }

  // ── VISIBILITY ───────────────────────────────────────────────────────────────
  function toggleVisibility() {
    visible = !visible;
    if (visible) mapRef.addLayer(geojsonLayer);
    else         mapRef.removeLayer(geojsonLayer);
    const tog = document.getElementById('tog-parcels');
    const row = document.getElementById('row-parcels');
    if (tog) { tog.classList.toggle('checked',visible); tog.textContent=visible?'✓':''; }
    if (row) row.classList.toggle('hidden-layer',!visible);
  }

  // ── PARCEL SEARCH ────────────────────────────────────────────────────────────
  function searchParcels(query) {
    if (!geojsonLayer || !query) return [];
    const q = query.toLowerCase().trim();
    const results = [];
    geojsonLayer.eachLayer(layer => {
      const p = _scrubProps(layer.feature.properties || {});
      const haystack = [p.name, p.owner, p.addr1, p.addr2].join(' ').toLowerCase();
      if (haystack.includes(q)) {
        results.push({ layer, props: p });
      }
    });
    return results.slice(0, 8);
  }

  function flyToParcel(layer) {
    _deselect();
    selectedLayer = layer;
    layer.setStyle(STYLE_SELECTED);
    layer.bringToFront();
    try {
      const bounds = layer.getBounds();
      mapRef.fitBounds(bounds, { maxZoom:18, padding:[40,40] });
    } catch(e) {}
    mapRef.once('click', _deselect);
  }

  // ── ADDRESS SEARCH (Nominatim geocoding) ──────────────────────────────────
  async function searchAddress(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=us`;
    try {
      const res  = await fetch(url, { headers:{ 'Accept-Language':'en' } });
      const data = await res.json();
      return data.map(r => ({
        label:    r.display_name,
        shortLabel: r.display_name.split(',').slice(0,2).join(',').trim(),
        lat:      parseFloat(r.lat),
        lng:      parseFloat(r.lon),
      }));
    } catch(e) { return []; }
  }

  function placeSearchPin(lat, lng, label) {
    clearSearchPin();
    const icon = L.divIcon({
      html: `<div class="search-pin"><div class="search-pin-head"></div><div class="search-pin-stem"></div></div>`,
      className: '',
      iconSize:  [24, 36],
      iconAnchor:[12, 36],
      popupAnchor:[0,-36],
    });
    searchPin = L.marker([lat,lng], { icon }).addTo(mapRef);
    searchPinData = { lat, lng, label };

    const div = document.createElement('div');
    div.className = 'point-popup';
    div.innerHTML = `
      <h3 style="color:#e05252">📍 ${_esc(label.split(',').slice(0,2).join(',').trim())}</h3>
      <div class="meta" style="margin-bottom:8px">${_esc(label)}</div>
      <button class="edit-btn" onclick="ParcelsLayer.saveSearchPinAsPoint()">Save as Point on Layer…</button>
      <button class="btn-cancel" style="margin-top:6px;width:100%;display:block;text-align:center" onclick="ParcelsLayer.clearSearchPin()">Dismiss</button>
    `;
    searchPin.bindPopup(div, { maxWidth:300 }).openPopup();
    mapRef.setView([lat,lng], Math.max(mapRef.getZoom(), 17));
  }

  function clearSearchPin() {
    if (searchPin) { mapRef.removeLayer(searchPin); searchPin=null; searchPinData=null; }
  }

  function saveSearchPinAsPoint() {
    if (!searchPinData) return;
    mapRef.closePopup();
    UI.openLayerPickerForPin(searchPinData.lat, searchPinData.lng, searchPinData.label, () => clearSearchPin());
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { init, toggleVisibility, searchParcels, flyToParcel, searchAddress, placeSearchPin, clearSearchPin, saveSearchPinAsPoint };
})();
