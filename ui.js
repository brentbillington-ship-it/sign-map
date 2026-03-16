// ─────────────────────────────────────────────────────────────────────────────
// ui.js — Sidebar, login, toast, search, context menu, KMZ import, location
// ─────────────────────────────────────────────────────────────────────────────

const UI = (() => {
  let mapRef        = null;
  let kmzLayers     = {};
  let kmzCounter    = 0;
  let locationMarker   = null;
  let locationWatchId  = null;
  let onLoggedIn    = null;
  let _labelsLayer  = null;
  let _streetLabels = null;
  let _pendingPinSave = null;

  // ── INIT ────────────────────────────────────────────────────────────────────
  function init(map, streetLabelsLayer, onLoginCallback) {
    mapRef        = map;
    _streetLabels = streetLabelsLayer;
    onLoggedIn    = onLoginCallback;
    document.getElementById('login-pw').addEventListener('keydown',   e => { if(e.key==='Enter') doLogin(); });
    document.getElementById('login-name').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-pw').focus(); });
    document.addEventListener('click', hideCtxMenu);
    buildSidebar();
    checkSavedAuth();
    _initSearch();
  }

  function toggleStreetLabels(show) {
    if (!_streetLabels) return;
    if (show) mapRef.addLayer(_streetLabels);
    else      mapRef.removeLayer(_streetLabels);
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
      if (e.key === 'Escape') { input.value=''; box.innerHTML=''; box.style.display='none'; ParcelsLayer.clearSearchPin(); }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#search-wrap')) { box.style.display='none'; }
    });
  }

  async function _runSearch(q) {
    const box = document.getElementById('search-results');
    box.innerHTML = '<div class="sr-item sr-loading">Searching…</div>';
    box.style.display = 'block';

    const results = [];

    // Parcel search
    const parcelHits = ParcelsLayer.searchParcels(q);
    parcelHits.forEach(r => {
      const p = r.props;
      const label = [p.owner, p.addr1, p.addr2, p.name].filter(Boolean).join(' · ') || 'Parcel';
      results.push({ type:'parcel', label, layer:r.layer });
    });

    // Address geocode search
    const addrHits = await ParcelsLayer.searchAddress(q + ', Coppell TX');
    addrHits.forEach(r => results.push({ type:'address', label:r.shortLabel, full:r.label, lat:r.lat, lng:r.lng }));

    box.innerHTML = '';
    if (!results.length) {
      box.innerHTML = '<div class="sr-item sr-empty">No results</div>';
      return;
    }

    results.slice(0,10).forEach(r => {
      const div = document.createElement('div');
      div.className = 'sr-item';
      const icon = r.type === 'parcel' ? '🏠' : '📍';
      div.innerHTML = `<span class="sr-icon">${icon}</span><span class="sr-label">${_esc(r.label)}</span>`;
      div.addEventListener('click', () => {
        box.style.display='none';
        document.getElementById('search-input').value = r.label;
        if (r.type === 'parcel') { ParcelsLayer.flyToParcel(r.layer); }
        else { ParcelsLayer.placeSearchPin(r.lat, r.lng, r.full||r.label); }
      });
      box.appendChild(div);
    });
  }

  // ── LAYER PICKER FOR PIN SAVE ─────────────────────────────────────────────
  function openLayerPickerForPin(lat, lng, label, onDone) {
    _pendingPinSave = { lat, lng, label, onDone };
    const modal = document.getElementById('layer-pick-modal');
    const sel   = document.getElementById('lp-layer-select');
    sel.innerHTML = Object.values(Layers.getDefs()).map(d=>
      `<option value="${d.id}">${_esc(d.name)}</option>`
    ).join('');
    sel.value = UI.getActiveLayerId();
    document.getElementById('lp-name').value = label.split(',').slice(0,2).join(',').trim();
    modal.classList.add('open');
  }

  function confirmLayerPick() {
    if (!_pendingPinSave) return;
    const layerId = document.getElementById('lp-layer-select').value;
    const name    = (document.getElementById('lp-name').value||'').trim() || _pendingPinSave.label;
    const ptId    = 'pt_' + Date.now();
    Layers.pushUndo(Layers.getAllPoints());
    Layers.addPoint(layerId, { id:ptId, lat:_pendingPinSave.lat, lng:_pendingPinSave.lng, name, notes:'' });
    Layers.renderLayer(layerId, null, null);
    Sync.savePoints(Layers.getAllPoints());
    toast(`Saved to "${Layers.getDef(layerId).name}"`);
    if (_pendingPinSave.onDone) _pendingPinSave.onDone();
    _pendingPinSave = null;
    document.getElementById('layer-pick-modal').classList.remove('open');
  }

  function closeLayerPick() {
    _pendingPinSave = null;
    document.getElementById('layer-pick-modal').classList.remove('open');
  }

  // ── SIDEBAR BUILD ────────────────────────────────────────────────────────────
  function buildSidebar() {
    _buildLayerRows('large-layers-list','large');
    _buildLayerRows('small-layers-list','small');
    buildLayerSelect();
    _buildParcelRow();
  }

  function _buildLayerRows(containerId, group) {
    const c = document.getElementById(containerId); if (!c) return;
    c.innerHTML = '';
    Object.values(Layers.getDefs()).filter(d=>d.group===group).forEach(def=>c.appendChild(_layerRow(def)));
  }

  function _buildCustomRows() {
    const c = document.getElementById('custom-layers-list'); if (!c) return;
    c.innerHTML='';
    let has=false;
    Object.values(Layers.getDefs()).filter(d=>d.group==='custom').forEach(def=>{ c.appendChild(_layerRow(def,true)); has=true; });
    document.getElementById('custom-layers-section').style.display=has?'block':'none';
  }

  function _layerRow(def, isCustom=false) {
    const row=document.createElement('div');
    row.className='layer-row'+(Layers.isVisible(def.id)?'':' hidden-layer');
    row.id=`row-${def.id}`;
    const ic=def.shape==='circle';
    row.innerHTML=`
      <div class="layer-toggle checked" id="tog-${def.id}">✓</div>
      <div class="layer-icon${ic?' circle':''}" style="background:${def.color}"></div>
      <span class="layer-name">${_esc(def.name)}</span>
      <span class="layer-count" id="cnt-${def.id}"></span>
      ${isCustom?`<button class="layer-remove" onclick="UI.removeCustomLayer('${def.id}',event)">×</button>`:''}
    `;
    row.addEventListener('click', e=>{
      if(e.target.classList.contains('layer-toggle')||e.target.classList.contains('layer-remove')) return;
      setActiveLayer(def.id); toast(`Active: ${def.name}`);
    });
    row.querySelector('.layer-toggle').addEventListener('click', e=>{ e.stopPropagation(); Layers.toggleVisibility(def.id); });
    return row;
  }

  function _buildParcelRow() {
    const c=document.getElementById('parcel-layer-row'); if(!c) return;
    c.innerHTML=`
      <div class="layer-row" id="row-parcels" onclick="ParcelsLayer.toggleVisibility()">
        <div class="layer-toggle checked" id="tog-parcels">✓</div>
        <div class="layer-icon" style="background:#f5d76e;border-radius:2px"></div>
        <span class="layer-name">Property Lines</span>
        <span style="font-size:9px;color:var(--muted);margin-left:auto;padding-right:2px">read-only</span>
      </div>
    `;
  }

  function buildLayerSelect() {
    const sel=document.getElementById('active-layer-select'); if(!sel) return;
    const prev=sel.value; sel.innerHTML='';
    Object.values(Layers.getDefs()).forEach(def=>{
      const opt=document.createElement('option'); opt.value=def.id; opt.textContent=def.name; sel.appendChild(opt);
    });
    const saved=Layers.getActiveLayer();
    if(saved&&Layers.getDef(saved)) sel.value=saved;
    else if(prev&&Layers.getDef(prev)) sel.value=prev;
  }

  function setActiveLayer(id) { document.getElementById('active-layer-select').value=id; Layers.saveActiveLayer(id); }
  function getActiveLayerId() { return document.getElementById('active-layer-select').value; }

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
    buildLayerSelect(); _buildCustomRows(); setActiveLayer(id);
    closeAddLayer(); toast(`Layer "${name}" added`);
  }

  function removeCustomLayer(layerId,e) {
    e.stopPropagation();
    if(!confirm(`Remove "${Layers.getDef(layerId).name}"? All points will be lost.`)) return;
    Layers.removeCustomLayer(layerId); buildLayerSelect(); _buildCustomRows();
    Sync.savePoints(Layers.getAllPoints());
  }

  // ── LABELS ───────────────────────────────────────────────────────────────────
  function initLabels(labelsLayer) { _labelsLayer = labelsLayer; }

  function toggleLabels(show) {
    if (_labelsLayer) { if(show) mapRef.addLayer(_labelsLayer); else mapRef.removeLayer(_labelsLayer); }
    Layers.toggleLabels(show);
  }

  // ── MY LOCATION ───────────────────────────────────────────────────────────────
  function toggleMyLocation() {
    const btn=document.getElementById('location-btn');
    if(locationWatchId!==null){
      navigator.geolocation.clearWatch(locationWatchId); locationWatchId=null;
      if(locationMarker){mapRef.removeLayer(locationMarker);locationMarker=null;}
      btn.classList.remove('active'); return;
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
      locationMarker.bindPopup(`<div style="font-family:'DM Mono',monospace;font-size:11px;color:#e6edf3">📍 You are here<br>±${Math.round(accuracy)}m</div>`);
    },()=>{toast('Location unavailable');btn.classList.remove('active');locationWatchId=null;},{enableHighAccuracy:true,maximumAge:5000});
  }

  // ── KMZ / GEOJSON IMPORT ──────────────────────────────────────────────────────
  function triggerKmzUpload() { document.getElementById('kmz-file-input').click(); }

  async function handleKmzUpload(event) {
    const file=event.target.files[0]; if(!file) return;
    event.target.value='';
    const name=file.name.replace(/\.(kmz|kml|geojson|json)$/i,'');
    toast(`Loading ${name}…`);

    let isGeoJSON = file.name.toLowerCase().match(/\.(geojson|json)$/);
    let geojson;

    try {
      if(isGeoJSON){
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

    // Check if it has point features that should go to a layer
    const hasPoints = geojson.features && geojson.features.some(f=>f.geometry&&f.geometry.type==='Point');
    const hasShapes = geojson.features && geojson.features.some(f=>f.geometry&&f.geometry.type!=='Point');

    if(hasPoints){
      // Prompt: which layer?
      _showImportLayerPicker(name, geojson, hasShapes);
    } else {
      _loadAsOverlay(name, geojson);
    }
  }

  function _showImportLayerPicker(name, geojson, hasShapes) {
    const modal=document.getElementById('import-layer-modal');
    const sel=document.getElementById('imp-layer-select');
    sel.innerHTML=Object.values(Layers.getDefs()).map(d=>`<option value="${d.id}">${_esc(d.name)}</option>`).join('');
    sel.value=getActiveLayerId();
    modal._geojson=geojson; modal._name=name; modal._hasShapes=hasShapes;
    modal.classList.add('open');
  }

  function confirmImportLayer() {
    const modal=document.getElementById('import-layer-modal');
    const layerId=document.getElementById('imp-layer-select').value;
    const geojson=modal._geojson; const hasShapes=modal._hasShapes; const name=modal._name;
    modal.classList.remove('open');

    Layers.pushUndo(Layers.getAllPoints());
    let count=0;
    (geojson.features||[]).forEach(f=>{
      if(!f.geometry||f.geometry.type!=='Point') return;
      const [lng,lat]=f.geometry.coordinates;
      const p=f.properties||{};
      const ptName=p.name||p.NAME||p.label||p.LABEL||'';
      const ptNotes=p.notes||p.description||p.DESCRIPTION||'';
      Layers.addPoint(layerId,{id:'pt_'+Date.now()+'_'+(count++),lat,lng,name:ptName,notes:ptNotes});
    });
    Layers.renderLayer(layerId,null,null);
    Sync.savePoints(Layers.getAllPoints());
    toast(`${count} points added to "${Layers.getDef(layerId).name}"`);

    if(hasShapes) _loadAsOverlay(name, geojson);
  }

  function closeImportLayer() { document.getElementById('import-layer-modal').classList.remove('open'); }

  function _loadAsOverlay(name, geojson) {
    const kmzId='kmz_'+(++kmzCounter);
    const lyr=L.geoJSON(geojson,{
      style:{color:'#f5d76e',weight:2,fillColor:'#f5d76e',fillOpacity:0.12},
      pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:6,color:'#f5d76e',fillColor:'#f5d76e',fillOpacity:0.8,weight:1}),
      onEachFeature:(f,l)=>l.bindPopup(`<div style="font-family:'DM Mono',monospace;font-size:12px;color:#e6edf3">${_esc(f.properties?.name||'Feature')}</div>`),
    }).addTo(mapRef);
    kmzLayers[kmzId]={name,lyr};
    _addKmzRow(kmzId,name);
    toast(`${name} loaded as overlay`);
    try{mapRef.fitBounds(lyr.getBounds(),{padding:[30,30],maxZoom:CONFIG.MAX_ZOOM});}catch(e){}
  }

  function _addKmzRow(kmzId,name){
    document.getElementById('kmz-layers-section').style.display='block';
    const row=document.createElement('div');
    row.className='layer-row kmz-layer-row'; row.id=`kmz-row-${kmzId}`;
    row.innerHTML=`
      <div class="layer-toggle checked" id="kmz-tog-${kmzId}">✓</div>
      <div class="layer-icon" style="background:#f5d76e;border-radius:2px"></div>
      <span class="layer-name" style="font-size:10px">${_esc(name)}</span>
      <button class="kmz-remove" onclick="UI.removeKmzLayer('${kmzId}',event)">×</button>
    `;
    row.querySelector('.layer-toggle').addEventListener('click',e=>{e.stopPropagation();_toggleKmz(kmzId);});
    document.getElementById('kmz-layers-list').appendChild(row);
  }

  function _toggleKmz(kmzId){
    const entry=kmzLayers[kmzId]; const tog=document.getElementById(`kmz-tog-${kmzId}`);
    if(mapRef.hasLayer(entry.lyr)){mapRef.removeLayer(entry.lyr);tog.classList.remove('checked');tog.textContent='';}
    else{mapRef.addLayer(entry.lyr);tog.classList.add('checked');tog.textContent='✓';}
  }

  function removeKmzLayer(kmzId,e){
    e.stopPropagation(); mapRef.removeLayer(kmzLayers[kmzId].lyr); delete kmzLayers[kmzId];
    document.getElementById(`kmz-row-${kmzId}`).remove();
    if(!Object.keys(kmzLayers).length) document.getElementById('kmz-layers-section').style.display='none';
  }

  // ── CONTEXT MENU ─────────────────────────────────────────────────────────────
  let _ctxCbs={};
  function showCtxMenu(mouseEvent,opts){
    _ctxCbs=opts;
    document.getElementById('ctx-place-label').textContent=opts.placeLabel||'Place point here';
    document.getElementById('ctx-paste-item').style.display=opts.hasCopy?'flex':'none';
    const m=document.getElementById('ctx-menu');
    m.style.display='block'; m.style.left=mouseEvent.clientX+'px'; m.style.top=mouseEvent.clientY+'px';
  }
  function hideCtxMenu(){ document.getElementById('ctx-menu').style.display='none'; }
  function ctxPlace(){ hideCtxMenu(); if(_ctxCbs.onPlace) _ctxCbs.onPlace(); }
  function ctxPaste(){ hideCtxMenu(); if(_ctxCbs.onPaste) _ctxCbs.onPaste(); }

  // ── LOGIN ─────────────────────────────────────────────────────────────────────
  function doLogin(){
    const name=(document.getElementById('login-name').value||'').trim();
    const pw=document.getElementById('login-pw').value;
    const err=document.getElementById('login-err');
    if(!name){err.textContent='Please enter your name.';err.style.display='block';return;}
    if(pw!==CONFIG.MAP_PASSWORD){err.textContent='Wrong password.';err.style.display='block';return;}
    localStorage.setItem('chakaUser',name); localStorage.setItem('chakaAuth','ok');
    _showMap(name);
  }
  function doLogout(){ localStorage.removeItem('chakaAuth'); localStorage.removeItem('chakaUser'); location.reload(); }
  function checkSavedAuth(){
    const auth=localStorage.getItem('chakaAuth'); const name=localStorage.getItem('chakaUser');
    if(auth==='ok'&&name){_showMap(name);}
  }
  function _showMap(name){
    Presence.setCurrentUser(name);
    document.getElementById('login-overlay').style.display='none';
    document.getElementById('user-bar-name-val').textContent=name;
    document.getElementById('login-name').value=name;
    if(onLoggedIn) onLoggedIn(name);
  }

  // ── TOAST ─────────────────────────────────────────────────────────────────────
  function toast(msg){
    const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show');
    setTimeout(()=>el.classList.remove('show'),2500);
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────────
  function exportGeoJSON(){
    const features=[];
    Object.entries(Layers.getAllPoints()).forEach(([layerId,pts])=>{
      const def=Layers.getDef(layerId);
      (pts||[]).forEach(pt=>features.push({
        type:'Feature',geometry:{type:'Point',coordinates:[pt.lng,pt.lat]},
        properties:{layer:layerId,layerName:def?.name||layerId,name:pt.name,notes:pt.notes,id:pt.id}
      }));
    });
    const blob=new Blob([JSON.stringify({type:'FeatureCollection',features},null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='chaka-signs-export.geojson'; a.click();
    toast('Exported!');
  }

  function _esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return {
    init, buildSidebar, buildLayerSelect, setActiveLayer, getActiveLayerId,
    initLabels, toggleLabels, toggleStreetLabels, toggleMyLocation,
    openAddLayer, closeAddLayer, updateAlbPreview, confirmAddLayer, removeCustomLayer,
    triggerKmzUpload, handleKmzUpload, removeKmzLayer,
    confirmImportLayer, closeImportLayer,
    openLayerPickerForPin, confirmLayerPick, closeLayerPick,
    showCtxMenu, hideCtxMenu, ctxPlace, ctxPaste,
    doLogin, doLogout,
    toast, exportGeoJSON,
  };
})();
