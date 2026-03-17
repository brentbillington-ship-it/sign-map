// ─────────────────────────────────────────────────────────────────────────────
// parcels_layer.js — v3.2 — parcelPane below markerPane, pane-level pointer-events
// ─────────────────────────────────────────────────────────────────────────────

const ParcelsLayer = (() => {
  let mapRef         = null;
  let geojsonLayer   = null;
  let selectedLayer  = null;
  let visible        = true;
  let identifyActive = true;
  let searchPin      = null;
  let searchPinData  = null;
  let parcelPaneEl   = null;

  const STYLE_DEFAULT  = { color:'#f5d76e', weight:1.2, opacity:0.6, fillOpacity:0.0 };
  const STYLE_HOVER    = { weight:2, color:'#ffe066', fillOpacity:0.06 };
  const STYLE_SELECTED = { weight:2.5, color:'#ffffff', fillColor:'#ffffff', fillOpacity:0.15 };

  const STREET_SUFFIXES = /\b(st|ave|blvd|dr|ln|rd|ct|cir|pl|way|pkwy|hwy|fwy|loop|run|trail|trl|bend|cv|cove|pass|xing|crossing|hollow|hl|hill|ridge|pt|point|park|row|sq|square|ter|terrace|walk|path)\b/i;

  function _isAddress(s) { return s && (/^\d/.test(s.trim()) || STREET_SUFFIXES.test(s)); }

  function _scrub(raw) {
    const name  = (raw.name  || '').trim();
    const owner = (raw.owner || '').trim();
    let addr1   = (raw.addr1 || '').trim();
    let addr2   = (raw.addr2 || '').trim();
    const coowners = [];
    if (addr1 && !_isAddress(addr1) && /^[A-Z\s&,\.]+$/.test(addr1) && addr1.length > 3) {
      coowners.push(addr1); addr1 = '';
    }
    if (addr2 && !_isAddress(addr2) && /^[A-Z\s&,\.]+$/.test(addr2) && addr2.length > 3) {
      coowners.push(addr2); addr2 = '';
    }
    let fullOwner = owner;
    coowners.forEach(co => {
      if (!owner.includes(co.trim())) fullOwner += (fullOwner ? ' ' : '') + co.trim();
    });
    return { name, owner: fullOwner, addr1, addr2 };
  }

  function init(map) {
    mapRef = map;
    if (typeof PARCELS_GEOJSON === 'undefined') return;

    // Create a dedicated pane BELOW markerPane (600) so markers always win clicks
    parcelPaneEl = map.createPane('parcelPane');
    parcelPaneEl.style.zIndex = 350;

    geojsonLayer = L.geoJSON(PARCELS_GEOJSON, {
      pane: 'parcelPane',
      style: () => ({...STYLE_DEFAULT}),
      onEachFeature: (feature, layer) => {
        layer.on({
          mouseover: e => { if (!identifyActive || e.target===selectedLayer) return; e.target.setStyle(STYLE_HOVER); },
          mouseout:  e => { if (!identifyActive || e.target===selectedLayer) return; geojsonLayer.resetStyle(e.target); },
          click:     e => { if (!identifyActive) return; _select(feature, layer, e); },
        });
      },
    }).addTo(mapRef);
  }

  // ── IDENTIFY MODE ────────────────────────────────────────────────────────────
  // Toggle pointer-events on the entire pane — one DOM op instead of 16k
  function setIdentifyMode(active) {
    identifyActive = active;
    if (parcelPaneEl) {
      parcelPaneEl.style.pointerEvents = active ? 'auto' : 'none';
    }
    if (!active) _deselect();
  }

  function isIdentifyActive() { return identifyActive; }

  function _select(feature, layer, e) {
    if (selectedLayer && selectedLayer !== layer) geojsonLayer.resetStyle(selectedLayer);
    selectedLayer = layer;
    layer.setStyle(STYLE_SELECTED);
    layer.bringToFront();
    const p    = _scrub(feature.properties || {});
    const addr = [p.addr1, p.addr2].filter(Boolean).join(', ') || '—';
    L.popup({ maxWidth:280 })
      .setLatLng(e.latlng)
      .setContent(`<div class="parcel-popup">
        <div class="parcel-title">${_e(p.owner||'Unknown Owner')}</div>
        ${p.name ? `<div style="font-size:9px;color:#8b949e;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em">${_e(p.name)}</div>` : ''}
        <table class="parcel-table">
          <tr><td>Address</td><td>${_e(addr)}</td></tr>
        </table>
        <div class="parcel-actions" style="margin-top:7px">
          <button class="parcel-sv-btn" onclick="Points.streetViewAt(${e.latlng.lat},${e.latlng.lng})">📷 Street View</button>
        </div>
        <div class="parcel-note">Read-only</div>
      </div>`)
      .openOn(mapRef);
    mapRef.once('click', _deselect);
    mapRef.once('popupclose', _deselect);
  }

  function _deselect() {
    if (selectedLayer) { geojsonLayer.resetStyle(selectedLayer); selectedLayer = null; }
  }

  function toggleVisibility() {
    visible = !visible;
    if (visible) mapRef.addLayer(geojsonLayer); else mapRef.removeLayer(geojsonLayer);
    const tog = document.getElementById('tog-parcels');
    const row = document.getElementById('row-parcels');
    if (tog) { tog.classList.toggle('checked',visible); tog.textContent=visible?'✓':''; }
    if (row) row.classList.toggle('hidden-layer',!visible);
  }

  function searchParcels(query) {
    if (!geojsonLayer || !query) return [];
    const normalize = s => (s||'').toLowerCase().replace(/&/g,' and ').replace(/\band\b/g,' and ').replace(/\s+/g,' ').trim();
    const q = normalize(query);
    const words = q.split(' ').filter(Boolean);
    const results = [];
    geojsonLayer.eachLayer(layer => {
      const p = _scrub(layer.feature.properties||{});
      const haystack = normalize([p.owner, p.addr1, p.addr2, p.name].join(' '));
      if (words.every(w => haystack.includes(w)))
        results.push({ layer, props:p });
    });
    return results.slice(0,8);
  }

  function flyToParcel(layer) {
    _deselect(); selectedLayer=layer; layer.setStyle(STYLE_SELECTED); layer.bringToFront();
    try { mapRef.fitBounds(layer.getBounds(),{maxZoom:18,padding:[40,40]}); } catch(e){}
    mapRef.once('click',_deselect);
  }

  async function searchAddress(query) {
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=us`,{headers:{'Accept-Language':'en'}});
      const data = await res.json();
      return data.map(r=>({label:r.display_name,shortLabel:r.display_name.split(',').slice(0,2).join(',').trim(),lat:parseFloat(r.lat),lng:parseFloat(r.lon)}));
    } catch(e){return[];}
  }

  function placeSearchPin(lat,lng,label) {
    clearSearchPin();
    searchPin=L.marker([lat,lng],{icon:L.divIcon({html:`<div class="search-pin"><div class="search-pin-head"></div><div class="search-pin-stem"></div></div>`,className:'',iconSize:[24,36],iconAnchor:[12,36],popupAnchor:[0,-38]})}).addTo(mapRef);
    searchPinData={lat,lng,label};
    const div=document.createElement('div'); div.className='point-popup';
    div.innerHTML=`<h3 style="color:#e05252">📍 ${_e(label.split(',').slice(0,2).join(',').trim())}</h3><div class="meta" style="margin-bottom:8px">${_e(label)}</div><button class="edit-btn" onclick="ParcelsLayer.saveSearchPinAsPoint()">Save as Point…</button><button class="btn-cancel" style="margin-top:6px;width:100%;display:block;text-align:center" onclick="ParcelsLayer.clearSearchPin()">Dismiss</button>`;
    searchPin.bindPopup(div,{maxWidth:300}).openPopup();
    mapRef.setView([lat,lng],Math.max(mapRef.getZoom(),17));
  }

  function clearSearchPin() { if(searchPin){mapRef.removeLayer(searchPin);searchPin=null;searchPinData=null;} }
  function saveSearchPinAsPoint() { if(!searchPinData) return; mapRef.closePopup(); UI.openLayerPickerForPin(searchPinData.lat,searchPinData.lng,searchPinData.label,()=>clearSearchPin()); }

  function _e(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  return { init, toggleVisibility, setIdentifyMode, isIdentifyActive, searchParcels, flyToParcel, searchAddress, placeSearchPin, clearSearchPin, saveSearchPinAsPoint };
})();
