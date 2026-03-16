// ─────────────────────────────────────────────────────────────────────────────
// ui.js — v3.1c — Full UI with custom dropdown, drag reorder, opacity, search
// ─────────────────────────────────────────────────────────────────────────────

const UI = (() => {
  let mapRef        = null;
  let kmzLayers     = {};
  let kmzCounter    = 0;
  let locationMarker   = null;
  let locationWatchId  = null;
  let onLoggedIn    = null;
  let _streetLabels = null;
  let _pendingPinSave = null;
  let _sidebarCollapsed = false;
  let _coordsEl = null;
  let _dragSrc  = null;  // drag reorder source id

  // ── INIT ────────────────────────────────────────────────────────────────────
  function init(map, streetLabelsLayer, onLoginCallback) {
    mapRef        = map;
    _streetLabels = streetLabelsLayer;
    onLoggedIn    = onLoginCallback;
    document.getElementById('login-pw').addEventListener('keydown',   e => { if(e.key==='Enter') doLogin(); });
    document.getElementById('login-name').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-pw').focus(); });
    document.addEventListener('click', e => {
      hideCtxMenu();
      // Close custom dropdown if click outside
      if (!e.target.closest('#custom-layer-dropdown')) _closeLayerDropdown();
    });
    buildSidebar();
    _initCoords();
    _initSearch();
    checkSavedAuth();
  }

  // ── COORDS DISPLAY ───────────────────────────────────────────────────────────
  function _initCoords() {
    _coordsEl = document.getElementById('coords-display');
    if (!_coordsEl || !mapRef) return;
    mapRef.on('mousemove', e => {
      const lat = e.latlng.lat.toFixed(5);
      const lng = e.latlng.lng.toFixed(5);
      _coordsEl.textContent = `${lat}, ${lng}`;
    });
  }

  // ── SIDEBAR COLLAPSE ─────────────────────────────────────────────────────────
  function toggleSidebar() {
    _sidebarCollapsed = !_sidebarCollapsed;
    const sidebar = document.getElementById('sidebar');
    const btn     = document.getElementById('collapse-btn');
    sidebar.classList.toggle('collapsed', _sidebarCollapsed);
    if (btn) btn.textContent = _sidebarCollapsed ? '›' : '‹';
    setTimeout(() => mapRef.invalidateSize(), 310);
  }

  // ── SEARCH ──────────────────────────────────────────────────────────────────
  let _searchTimeout = null;
  function _initSearch() {
    const input = document.getElementById('search-input');
    const box   = document.getElementById('search-results');
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(_searchTimeout);
      const q = input.value.trim();
      if (!q) { box.innerHTML=''; box.style.display='none'; return; }
      _searchTimeout = setTimeout(() => _runSearch(q), 300);
    });
    input.addEventListener('keydown', e => {
      if (e.key==='Escape') { input.value=''; box.style.display='none'; ParcelsLayer.clearSearchPin(); }
    });
  }

  async function _runSearch(q) {
    const box = document.getElementById('search-results');
    box.innerHTML = '<div class="sr-item sr-loading">Searching…</div>';
    box.style.display = 'block';
    const results = [];
    ParcelsLayer.searchParcels(q).forEach(r => {
      const p = r.props;
      results.push({ type:'parcel', label:[p.owner,p.addr1,p.addr2,p.name].filter(Boolean).join(' · ')||'Parcel', layer:r.layer });
    });
    const addrHits = await ParcelsLayer.searchAddress(q + ', Coppell TX');
    addrHits.forEach(r => results.push({ type:'address', label:r.shortLabel, full:r.label, lat:r.lat, lng:r.lng }));
    box.innerHTML = '';
    if (!results.length) { box.innerHTML='<div class="sr-item sr-empty">No results</div>'; return; }
    results.slice(0,10).forEach(r => {
      const div = document.createElement('div');
      div.className = 'sr-item';
      div.innerHTML = `<span class="sr-icon">${r.type==='parcel'?'🏠':'📍'}</span><span class="sr-label">${_esc(r.label)}</span>`;
      div.addEventListener('click', () => {
        box.style.display='none';
        document.getElementById('search-input').value = r.label;
        if (r.type==='parcel') ParcelsLayer.flyToParcel(r.layer);
        else ParcelsLayer.placeSearchPin(r.lat, r.lng, r.full||r.label);
      });
      box.appendChild(div);
    });
  }

  // ── CUSTOM LAYER DROPDOWN (with swatches) ─────────────────────────────────
  function _buildLayerDropdown() {
    const wrap = document.getElementById('custom-layer-dropdown');
    if (!wrap) return;
    const activeId = Layers.getActiveLayer();
    const def = Layers.getDef(activeId);

    // Trigger button
    wrap.innerHTML = `
      <button id="layer-dropdown-btn" onclick="UI._toggleLayerDropdown(event)">
        ${def ? `<span class="dd-swatch" style="background:${def.color};border-radius:${def.shape==='circle'?'50%':'2px'}"></span><span class="dd-label">${_esc(def.name)}</span>` : 'Select layer'}
        <span class="dd-arrow">▾</span>
        <span class="dd-badge" id="active-layer-badge">${(Layers.getPoints(activeId)||[]).length||''}</span>
      </button>
      <div id="layer-dropdown-list" style="display:none">
        ${Layers.getOrder().filter(id=>Layers.getDef(id)).map(id => {
          const d = Layers.getDef(id);
          const cnt = (Layers.getPoints(id)||[]).length;
          return `<div class="dd-option${id===activeId?' selected':''}" onclick="UI._selectLayer('${id}')">
            <span class="dd-swatch" style="background:${d.color};border-radius:${d.shape==='circle'?'50%':'2px'}"></span>
            <span class="dd-label">${_esc(d.name)}</span>
            ${cnt?`<span class="dd-cnt">${cnt}</span>`:''}
          </div>`;
        }).join('')}
      </div>
    `;
    // Hidden input for compatibility
    let hidden = document.getElementById('active-layer-select-hidden');
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden'; hidden.id = 'active-layer-select-hidden';
      wrap.appendChild(hidden);
    }
    hidden.value = activeId;
  }

  function _toggleLayerDropdown(e) {
    e.stopPropagation();
    const list = document.getElementById('layer-dropdown-list');
    if (list) list.style.display = list.style.display==='none' ? 'block' : 'none';
  }

  function _closeLayerDropdown() {
    const list = document.getElementById('layer-dropdown-list');
    if (list) list.style.display = 'none';
  }

  function _selectLayer(id) {
    Layers.saveActiveLayer(id);
    _buildLayerDropdown();
    _closeLayerDropdown();
    toast(`Active: ${Layers.getDef(id)?.name}`);
    Layers._updateAllCounts();
  }

  function setActiveLayer(id) { Layers.saveActiveLayer(id); _buildLayerDropdown(); }
  function getActiveLayerId() {
    const h = document.getElementById('active-layer-select-hidden');
    return h ? h.value : Layers.getActiveLayer();
  }

  // ── SIDEBAR BUILD ────────────────────────────────────────────────────────────
  function buildSidebar() {
    rebuildLayerLists();
    _buildLayerDropdown();
    _buildParcelRow();
  }

  function rebuildLayerLists() {
    ['large-layers-list','small-layers-list','custom-layers-list'].forEach(id => {
      const el = document.getElementById(id); if (el) el.innerHTML = '';
    });
    let hasCustom = false;
    // Use layerOrder for correct ordering
    Layers.getOrder().forEach(id => {
      const def = Layers.getDef(id);
      if (!def) return;
      if (def.group==='large')       document.getElementById('large-layers-list')?.appendChild(_layerRow(def));
      else if (def.group==='small')  document.getElementById('small-layers-list')?.appendChild(_layerRow(def));
      else if (def.group==='custom') { document.getElementById('custom-layers-list')?.appendChild(_layerRow(def, true)); hasCustom=true; }
    });
    const cs = document.getElementById('custom-layers-section');
    if (cs) cs.style.display = hasCustom ? 'block' : 'none';
    _buildLayerDropdown();
  }

  function _layerRow(def, isCustom=false) {
    const row = document.createElement('div');
    row.className = 'layer-row' + (Layers.isVisible(def.id)?'':' hidden-layer');
    row.id = `row-${def.id}`;
    row.draggable = true;
    const isCircle = def.shape==='circle';
    const opacity  = Math.round(Layers.getOpacity(def.id)*100);
    row.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <div class="layer-toggle checked" id="tog-${def.id}">✓</div>
      <div class="layer-icon${isCircle?' circle':''}" style="background:${def.color}"></div>
      <span class="layer-name">${_esc(def.name)}</span>
      <span class="layer-count" id="cnt-${def.id}"></span>
      ${isCustom?`<button class="layer-remove" onclick="UI.removeCustomLayer('${def.id}',event)" title="Remove">×</button>`:''}
    `;
    // Opacity slider (shown on hover via CSS, built as expandable)
    const opRow = document.createElement('div');
    opRow.className = 'opacity-row';
    opRow.id = `op-row-${def.id}`;
    opRow.innerHTML = `<span class="op-label">Opacity</span><input type="range" min="10" max="100" value="${opacity}" class="op-slider" oninput="UI.setLayerOpacity('${def.id}',this.value/100)"><span class="op-val">${opacity}%</span>`;

    // Click row = set active layer
    row.addEventListener('click', e => {
      if (['layer-toggle','drag-handle','layer-remove','op-slider'].some(c=>e.target.classList.contains(c))) return;
      _selectLayer(def.id);
      // Toggle opacity row
      opRow.classList.toggle('visible');
    });

    row.querySelector('.layer-toggle').addEventListener('click', e => { e.stopPropagation(); Layers.toggleVisibility(def.id); });

    // Right-click = zoom to layer
    row.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      Layers.zoomToLayer(def.id);
    });

    // Drag reorder
    row.addEventListener('dragstart', e => { _dragSrc = def.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    row.addEventListener('dragend',   () => { _dragSrc=null; row.classList.remove('dragging'); });
    row.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect='move'; row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop',      e => { e.preventDefault(); row.classList.remove('drag-over'); if(_dragSrc && _dragSrc!==def.id) Layers.reorderLayer(_dragSrc, def.id); });

    const wrap = document.createElement('div');
    wrap.className = 'layer-row-wrap';
    wrap.appendChild(row);
    wrap.appendChild(opRow);
    return wrap;
  }

  function setLayerOpacity(layerId, val) {
    Layers.setOpacity(layerId, val);
    const opRow = document.getElementById(`op-row-${layerId}`);
    if (opRow) {
      const valEl = opRow.querySelector('.op-val');
      if (valEl) valEl.textContent = Math.round(val*100)+'%';
    }
  }

  function _buildParcelRow() {
    const c = document.getElementById('parcel-layer-row'); if (!c) return;
    c.innerHTML = `
      <div class="layer-row" id="row-parcels" onclick="ParcelsLayer.toggleVisibility()">
        <span class="drag-handle" style="opacity:0.2;cursor:default">⠿</span>
        <div class="layer-toggle checked" id="tog-parcels">✓</div>
        <div class="layer-icon" style="background:#f5d76e;border-radius:2px"></div>
        <span class="layer-name">Property Lines</span>
        <span style="font-size:9px;color:var(--muted);margin-left:auto;padding-right:2px">read-only</span>
      </div>
    `;
  }

  // ── CUSTOM LAYER ─────────────────────────────────────────────────────────────
  function openAddLayer()  { document.getElementById('add-layer-modal').classList.add('open'); }
  function closeAddLayer() { document.getElementById('add-layer-modal').classList.remove('open'); }

  function updateAlbPreview() {
    const color=document.getElementById('alb-color').value;
    const shape=document.getElementById('alb-shape').value;
    const prev=document.getElementById('alb-preview');
    prev.style.background=color; prev.style.borderRadius=shape==='circle'?'50%':'2px';
    document.getElementById('alb-color-hex').textContent=color;
  }

  function confirmAddLayer() {
    const name=(document.getElementById('alb-name').value||'').trim();
    const color=document.getElementById('alb-color').value;
    const shape=document.getElementById('alb-shape').value;
    if(!name){alert('Please enter a layer name.');return;}
    const id=Layers.addCustomLayer(name,color,shape);
    rebuildLayerLists(); _selectLayer(id);
    closeAddLayer(); toast(`Layer "${name}" added`);
  }

  function removeCustomLayer(layerId,e) {
    e.stopPropagation();
    if(!confirm(`Remove "${Layers.getDef(layerId)?.name}"? All points will be lost.`)) return;
    Layers.removeCustomLayer(layerId); rebuildLayerLists();
    Sync.savePoints(Layers.getAllPoints());
  }

  // ── LAYER PICKER FOR PIN SAVE ─────────────────────────────────────────────
  function openLayerPickerForPin(lat, lng, label, onDone) {
    _pendingPinSave = { lat, lng, label, onDone };
    const modal = document.getElementById('layer-pick-modal');
    const sel   = document.getElementById('lp-layer-select');
    sel.innerHTML = Layers.getOrder().filter(id=>Layers.getDef(id)).map(id=>{
      const d=Layers.getDef(id);
      return `<option value="${d.id}">${_esc(d.name)}</option>`;
    }).join('');
    sel.value = getActiveLayerId();
    document.getElementById('lp-name').value = label.split(',').slice(0,2).join(',').trim();
    modal.classList.add('open');
  }

  function confirmLayerPick() {
    if (!_pendingPinSave) return;
    const layerId = document.getElementById('lp-layer-select').value;
    const name    = (document.getElementById('lp-name').value||'').trim()||_pendingPinSave.label;
    const user    = Presence.getCurrentUser();
    const now     = new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});
    const ptId    = 'pt_'+Date.now();
    Layers.pushUndo(Layers.getAllPoints());
    Layers.addPoint(layerId, { id:ptId, lat:_pendingPinSave.lat, lng:_pendingPinSave.lng, name, notes:'', addedBy:user, addedAt:now, editedBy:'', editedAt:'' });
    Layers.renderLayer(layerId, null, null);
    Sync.savePoints(Layers.getAllPoints());
    toast(`Saved to "${Layers.getDef(layerId)?.name}"`);
    if (_pendingPinSave.onDone) _pendingPinSave.onDone();
    _pendingPinSave = null;
    document.getElementById('layer-pick-modal').classList.remove('open');
  }

  function closeLayerPick() { _pendingPinSave=null; document.getElementById('layer-pick-modal').classList.remove('open'); }

  // ── LABELS / STREET LABELS ───────────────────────────────────────────────────
  function toggleLabels(show)       { Layers.toggleLabels(show); }
  function toggleStreetLabels(show) { if(_streetLabels){if(show)mapRef.addLayer(_streetLabels);else mapRef.removeLayer(_streetLabels);} }

  // ── MY LOCATION ───────────────────────────────────────────────────────────────
  function toggleMyLocation() {
    const btn=document.getElementById('location-btn');
    if(locationWatchId!==null){
      navigator.geolocation.clearWatch(locationWatchId);locationWatchId=null;
      if(locationMarker){mapRef.removeLayer(locationMarker);locationMarker=null;}
      btn.classList.remove('active');return;
    }
    if(!navigator.geolocation){toast('Geolocation not supported');return;}
    btn.classList.add('active');
    locationWatchId=navigator.geolocation.watchPosition(pos=>{
      const{latitude:lat,longitude:lng,accuracy}=pos.coords;
      if(!locationMarker){
        locationMarker=L.marker([lat,lng],{
          icon:L.divIcon({html:`<div class="loc-dot"><div class="loc-pulse"></div></div>`,className:'',iconSize:[20,20],iconAnchor:[10,10]}),
          zIndexOffset:2000
        }).addTo(mapRef);
        mapRef.setView([lat,lng],Math.max(mapRef.getZoom(),16));
      } else locationMarker.setLatLng([lat,lng]);
      locationMarker.bindPopup(`<div style="font-family:'DM Mono',monospace;font-size:11px;color:#e6edf3">📍 You<br>±${Math.round(accuracy)}m</div>`);
    },()=>{toast('Location unavailable');btn.classList.remove('active');locationWatchId=null;},{enableHighAccuracy:true,maximumAge:5000});
  }

  // ── KMZ / GEOJSON IMPORT ──────────────────────────────────────────────────────
  function triggerKmzUpload() { document.getElementById('kmz-file-input').click(); }

  async function handleKmzUpload(event) {
    const file=event.target.files[0]; if(!file) return;
    event.target.value='';
    const name=file.name.replace(/\.(kmz|kml|geojson|json)$/i,'');
    toast(`Loading ${name}…`);
    let geojson;
    try {
      if(file.name.toLowerCase().match(/\.(geojson|json)$/)){
        geojson=JSON.parse(await file.text());
      } else {
        let kmlText;
        if(file.name.toLowerCase().endsWith('.kmz')){
          const zip=await JSZip.loadAsync(file);
          const kf=Object.values(zip.files).find(f=>f.name.toLowerCase().endsWith('.kml'));
          if(!kf){toast('No KML in KMZ');return;}
          kmlText=await kf.async('string');
        } else kmlText=await file.text();
        geojson=toGeoJSON.kml(new DOMParser().parseFromString(kmlText,'text/xml'));
      }
    } catch(e){toast('Failed to read file');return;}

    const hasPoints=geojson.features?.some(f=>f.geometry?.type==='Point');
    if(hasPoints){ _showImportLayerPicker(name,geojson); }
    else { _loadAsOverlay(name,geojson); }
  }

  function _showImportLayerPicker(name,geojson) {
    const modal=document.getElementById('import-layer-modal');
    const sel=document.getElementById('imp-layer-select');
    sel.innerHTML=Layers.getOrder().filter(id=>Layers.getDef(id)).map(id=>`<option value="${id}">${_esc(Layers.getDef(id).name)}</option>`).join('');
    sel.value=getActiveLayerId(); modal._geojson=geojson; modal._name=name;
    modal.classList.add('open');
  }

  function confirmImportLayer() {
    const modal=document.getElementById('import-layer-modal');
    const layerId=document.getElementById('imp-layer-select').value;
    const geojson=modal._geojson; const name=modal._name;
    modal.classList.remove('open');
    Layers.pushUndo(Layers.getAllPoints());
    const user=Presence.getCurrentUser();
    const now=new Date().toLocaleString('en-US',{timeZone:'America/Chicago'});
    let count=0;
    (geojson.features||[]).forEach(f=>{
      if(!f.geometry||f.geometry.type!=='Point') return;
      const[lng,lat]=f.geometry.coordinates; const p=f.properties||{};
      Layers.addPoint(layerId,{id:'pt_'+Date.now()+'_'+(count++),lat,lng,name:p.name||p.NAME||'',notes:p.notes||p.description||'',addedBy:user,addedAt:now,editedBy:'',editedAt:''});
    });
    Layers.renderLayer(layerId,null,null);
    Sync.savePoints(Layers.getAllPoints());
    toast(`${count} points added to "${Layers.getDef(layerId)?.name}"`);
    const hasShapes=geojson.features?.some(f=>f.geometry?.type!=='Point');
    if(hasShapes) _loadAsOverlay(name,geojson);
  }

  function closeImportLayer() { document.getElementById('import-layer-modal').classList.remove('open'); }

  function _loadAsOverlay(name,geojson) {
    const kmzId='kmz_'+(++kmzCounter);
    const lyr=L.geoJSON(geojson,{
      style:{color:'#f5d76e',weight:2,fillColor:'#f5d76e',fillOpacity:0.12},
      pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:5,color:'#f5d76e',fillColor:'#f5d76e',fillOpacity:0.8,weight:1}),
      onEachFeature:(f,l)=>l.bindPopup(`<div style="font-family:'DM Mono',monospace;font-size:12px;color:#e6edf3">${_esc(f.properties?.name||'Feature')}</div>`),
    }).addTo(mapRef);
    kmzLayers[kmzId]={name,lyr};
    _addKmzRow(kmzId,name);
    toast(`${name} loaded`);
    try{mapRef.fitBounds(lyr.getBounds(),{padding:[30,30],maxZoom:CONFIG.MAX_ZOOM});}catch(e){}
  }

  function _addKmzRow(kmzId,name) {
    document.getElementById('kmz-layers-section').style.display='block';
    const row=document.createElement('div'); row.className='layer-row kmz-layer-row'; row.id=`kmz-row-${kmzId}`;
    row.innerHTML=`<div class="layer-toggle checked" id="kmz-tog-${kmzId}">✓</div><div class="layer-icon" style="background:#f5d76e;border-radius:2px"></div><span class="layer-name" style="font-size:10px">${_esc(name)}</span><button class="kmz-remove" onclick="UI.removeKmzLayer('${kmzId}',event)">×</button>`;
    row.querySelector('.layer-toggle').addEventListener('click',e=>{e.stopPropagation();_toggleKmz(kmzId);});
    document.getElementById('kmz-layers-list').appendChild(row);
  }

  function _toggleKmz(kmzId) {
    const e=kmzLayers[kmzId]; const t=document.getElementById(`kmz-tog-${kmzId}`);
    if(mapRef.hasLayer(e.lyr)){mapRef.removeLayer(e.lyr);t.classList.remove('checked');t.textContent='';}
    else{mapRef.addLayer(e.lyr);t.classList.add('checked');t.textContent='✓';}
  }

  function removeKmzLayer(kmzId,e) {
    e.stopPropagation(); mapRef.removeLayer(kmzLayers[kmzId].lyr); delete kmzLayers[kmzId];
    document.getElementById(`kmz-row-${kmzId}`).remove();
    if(!Object.keys(kmzLayers).length) document.getElementById('kmz-layers-section').style.display='none';
  }

  // ── CONTEXT MENU ─────────────────────────────────────────────────────────────
  let _ctxCbs={};
  function showCtxMenu(ev,opts) {
    _ctxCbs=opts;
    document.getElementById('ctx-place-label').textContent=opts.placeLabel||'Place point here';
    document.getElementById('ctx-paste-item').style.display=opts.hasCopy?'flex':'none';
    const m=document.getElementById('ctx-menu');
    m.style.display='block'; m.style.left=ev.clientX+'px'; m.style.top=ev.clientY+'px';
  }
  function hideCtxMenu()  { document.getElementById('ctx-menu').style.display='none'; }
  function ctxPlace()     { hideCtxMenu(); if(_ctxCbs.onPlace) _ctxCbs.onPlace(); }
  function ctxPaste()     { hideCtxMenu(); if(_ctxCbs.onPaste) _ctxCbs.onPaste(); }
  function ctxStreetView(){ hideCtxMenu(); if(_ctxCbs.onStreetView) _ctxCbs.onStreetView(); }

  // ── LOGIN ─────────────────────────────────────────────────────────────────────
  function doLogin() {
    const name=(document.getElementById('login-name').value||'').trim();
    const pw=document.getElementById('login-pw').value;
    const err=document.getElementById('login-err');
    if(!name){err.textContent='Please enter your name.';err.style.display='block';return;}
    if(pw!==CONFIG.MAP_PASSWORD){err.textContent='Wrong password.';err.style.display='block';return;}
    localStorage.setItem('chakaUser',name); localStorage.setItem('chakaAuth','ok');
    _showMap(name);
  }
  function doLogout() { localStorage.removeItem('chakaAuth'); localStorage.removeItem('chakaUser'); location.reload(); }
  function checkSavedAuth() {
    const auth=localStorage.getItem('chakaAuth'); const name=localStorage.getItem('chakaUser');
    if(auth==='ok'&&name) _showMap(name);
  }
  function _showMap(name) {
    Presence.setCurrentUser(name);
    document.getElementById('login-overlay').style.display='none';
    document.getElementById('user-bar-name-val').textContent=name;
    document.getElementById('login-name').value=name;
    if(onLoggedIn) onLoggedIn(name);
  }

  // ── TOAST ─────────────────────────────────────────────────────────────────────
  function toast(msg) {
    const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show');
    setTimeout(()=>el.classList.remove('show'),2500);
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────────
  function exportGeoJSON() {
    const features=[];
    Object.entries(Layers.getAllPoints()).forEach(([layerId,pts])=>{
      const def=Layers.getDef(layerId);
      (pts||[]).forEach(pt=>features.push({
        type:'Feature',geometry:{type:'Point',coordinates:[pt.lng,pt.lat]},
        properties:{layer:layerId,layerName:def?.name||layerId,name:pt.name,notes:pt.notes,id:pt.id,addedBy:pt.addedBy||'',addedAt:pt.addedAt||''}
      }));
    });
    const blob=new Blob([JSON.stringify({type:'FeatureCollection',features},null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='chaka-signs-export.geojson'; a.click();
    toast('Exported!');
  }

  function _esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return {
    init, buildSidebar, rebuildLayerLists, setActiveLayer, getActiveLayerId,
    toggleLabels, toggleStreetLabels, toggleMyLocation, toggleSidebar,
    setLayerOpacity,
    openAddLayer, closeAddLayer, updateAlbPreview, confirmAddLayer, removeCustomLayer,
    triggerKmzUpload, handleKmzUpload, removeKmzLayer,
    confirmImportLayer, closeImportLayer,
    openLayerPickerForPin, confirmLayerPick, closeLayerPick,
    showCtxMenu, hideCtxMenu, ctxPlace, ctxPaste, ctxStreetView,
    doLogin, doLogout,
    toast, exportGeoJSON,
    _toggleLayerDropdown, _selectLayer,
  };
})();
