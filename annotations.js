// ─────────────────────────────────────────────────────────────────────────────
// annotations.js — v3.2 — Debounced dblclick, label prompts, ft-only measure,
//                         styled labels, Nearmap-style tool behaviour
// ─────────────────────────────────────────────────────────────────────────────

const Annotations = (() => {
  let mapRef        = null;
  let activeTool    = null;
  let drawPoints    = [];
  let drawLayer     = null;
  let ghostMarker   = null;
  let annotations   = [];
  let leafletAnns   = {};
  let mapLayerGroup = null;
  let onSave        = null;
  let _dblClickPending = false;

  let drawColor     = '#4da6ff';
  let drawThickness = 2;
  let drawLabel     = '';

  function init(map, onSaveCallback) {
    mapRef        = map;
    onSave        = onSaveCallback;
    mapLayerGroup = L.layerGroup().addTo(mapRef);
    map.on('click',     _onMapClick);
    map.on('mousemove', _onMouseMove);
    map.on('dblclick',  _onDblClick);
  }

  function loadFromSheets(data) {
    annotations = data || [];
    mapLayerGroup.clearLayers();
    leafletAnns  = {};
    annotations.forEach(_renderAnnotation);
  }

  function setDrawColor(c)     { drawColor = c; }
  function setDrawThickness(t) { drawThickness = Number(t); }
  function setDrawLabel(l)     { drawLabel = l; }

  function setTool(tool) {
    if (activeTool === tool) { clearTool(); return; }
    clearTool();
    activeTool = tool;
    drawPoints = [];
    document.querySelectorAll('.toolbar-btn[data-tool]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`tool-${tool}`);
    if (btn) btn.classList.add('active');
    _showOptionsBar(tool);
    _setStatusHint(tool);
    if (typeof Points !== 'undefined') Points.setDrawToolActive(true);
    if (typeof ParcelsLayer !== 'undefined') ParcelsLayer.setIdentifyMode(false);
    mapRef.getContainer().style.cursor = tool === 'erase' ? 'not-allowed' : 'crosshair';
  }

  function clearTool() {
    activeTool = null;
    drawPoints = [];
    _dblClickPending = false;
    if (drawLayer)  { mapRef.removeLayer(drawLayer);  drawLayer  = null; }
    if (ghostMarker){ mapRef.removeLayer(ghostMarker); ghostMarker= null; }
    document.querySelectorAll('.toolbar-btn[data-tool]').forEach(b => b.classList.remove('active'));
    mapRef.getContainer().style.cursor = 'default';
    _hideOptionsBar();
    _setStatusHint(null);
    if (typeof Points !== 'undefined') Points.setDrawToolActive(false);
  }

  function getActiveTool() { return activeTool; }

  function _showOptionsBar(tool) {
    const bar = document.getElementById('draw-options-bar');
    if (!bar) return;
    bar.style.display = tool && tool !== 'erase' ? 'flex' : 'none';
    const ci = document.getElementById('draw-color-input'); if(ci) ci.value = drawColor;
    const li = document.getElementById('draw-label-input');
    if (li) { li.value = drawLabel; li.placeholder = tool==='measure'?'Override distance label…':'Optional label…'; }
  }

  function _hideOptionsBar() {
    const bar = document.getElementById('draw-options-bar'); if (bar) bar.style.display='none';
  }

  function _setStatusHint(tool) {
    const hints = {
      line:    'Click to add points · Double-click to finish · Esc to cancel',
      shape:   'Click to draw shape · Double-click to close · Esc to cancel',
      text:    'Click map to place text · Esc to cancel',
      measure: 'Click to measure · Double-click to finish · Esc to cancel',
      erase:   'Click any annotation to delete · Esc to cancel',
    };
    const el = document.getElementById('toolbar-hint');
    if (el) { el.textContent = tool?hints[tool]||'':''; el.style.display = tool?'block':'none'; }
  }

  // ── GHOST CURSOR ─────────────────────────────────────────────────────────────
  function _updateGhost(latlng) {
    if (!activeTool || activeTool === 'erase') {
      if (ghostMarker) { mapRef.removeLayer(ghostMarker); ghostMarker = null; }
      return;
    }
    const ghostHtml = activeTool === 'text'
      ? `<div class="ghost-text">T</div>`
      : drawPoints.length === 0
        ? `<div class="ghost-cross"><div class="gc-h"></div><div class="gc-v"></div></div>`
        : `<div class="ghost-dot" style="background:${drawColor}"></div>`;
    const icon = L.divIcon({ html: ghostHtml, className:'', iconSize:[20,20], iconAnchor:[10,10] });
    if (!ghostMarker) {
      ghostMarker = L.marker(latlng, { icon, interactive:false, zIndexOffset:3000 }).addTo(mapRef);
    } else {
      ghostMarker.setLatLng(latlng);
      ghostMarker.setIcon(icon);
    }
  }

  // ── MAP EVENTS ───────────────────────────────────────────────────────────────
  function _onMapClick(e) {
    if (!activeTool) return;
    // Ignore click that's part of a double-click
    if (_dblClickPending) return;
    L.DomEvent.stopPropagation(e);
    if (activeTool === 'text')  { _placeText(e.latlng); return; }
    if (activeTool === 'erase') return;
    drawPoints.push(e.latlng);
    _updatePreview(null);
  }

  function _onMouseMove(e) {
    _updateGhost(e.latlng);
    if (!activeTool || !drawPoints.length) return;
    if (!['line','shape','measure'].includes(activeTool)) return;
    _updatePreview(e.latlng);
  }

  function _onDblClick(e) {
    if (!activeTool) return;
    L.DomEvent.stopPropagation(e);
    // Set flag so the click event that fires with dblclick is ignored
    _dblClickPending = true;
    setTimeout(() => { _dblClickPending = false; }, 300);
    // Remove the last point added by the second click of the double-click
    if (drawPoints.length > 1) drawPoints.pop();
    if (activeTool === 'line')    _finishLine();
    if (activeTool === 'shape')   _finishShape();
    if (activeTool === 'measure') _finishMeasure();
  }

  function _updatePreview(cursor) {
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer = null; }
    const pts = cursor ? [...drawPoints, cursor] : drawPoints;
    if (pts.length < 2) return;
    const style = { color:drawColor, weight:drawThickness, dashArray:'5,4', opacity:0.8 };
    drawLayer = (activeTool==='shape' && pts.length>=3)
      ? L.polygon(pts, {...style, fillColor:drawColor, fillOpacity:0.1}).addTo(mapRef)
      : L.polyline(pts, style).addTo(mapRef);
  }

  // ── LABEL PROMPT ─────────────────────────────────────────────────────────────
  function _promptLabel(defaultVal, onConfirm) {
    // Use the draw-label-input if it has a value, otherwise show an inline prompt
    const barVal = (document.getElementById('draw-label-input')?.value || '').trim();
    if (barVal) { onConfirm(barVal); return; }
    // Show a small floating prompt above the map
    const existing = document.getElementById('ann-label-prompt');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.id = 'ann-label-prompt';
    box.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:var(--panel);border:1px solid var(--border2);border-radius:8px;
      padding:16px;z-index:9999;display:flex;flex-direction:column;gap:10px;
      font-family:'DM Mono',monospace;font-size:12px;color:var(--text);min-width:260px;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);`;
    box.innerHTML = `
      <div style="font-size:11px;color:var(--muted2)">Add a label <span style="color:var(--muted2);font-size:10px">(optional)</span></div>
      <input id="ann-label-val" type="text" value="${_e(defaultVal)}" placeholder="Label…"
        style="background:var(--bg);border:1px solid var(--border2);color:var(--text);
               font-family:'DM Mono',monospace;font-size:12px;padding:6px 8px;border-radius:4px;outline:none;width:100%;"/>
      <div style="display:flex;gap:8px;">
        <button id="ann-label-ok" style="flex:1;padding:6px;background:var(--teal);color:#fff;border:none;border-radius:4px;font-family:'DM Mono',monospace;font-size:11px;cursor:pointer;">Save</button>
        <button id="ann-label-skip" style="padding:6px 10px;background:transparent;color:var(--muted);border:1px solid var(--border2);border-radius:4px;font-family:'DM Mono',monospace;font-size:11px;cursor:pointer;">No label</button>
      </div>`;
    document.body.appendChild(box);
    const inp = box.querySelector('#ann-label-val');
    setTimeout(() => inp.focus(), 50);
    const done = (val) => { box.remove(); onConfirm(val); };
    box.querySelector('#ann-label-ok').onclick   = () => done(inp.value.trim());
    box.querySelector('#ann-label-skip').onclick  = () => done('');
    inp.addEventListener('keydown', e => { if(e.key==='Enter') done(inp.value.trim()); if(e.key==='Escape') done(''); });
  }

  function _finishLine() {
    if (drawPoints.length < 2) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer=null; }
    const pts = drawPoints.slice();
    clearTool();
    _promptLabel('', label => {
      _saveAnnotation('line',{type:'LineString',coordinates:pts.map(p=>[p.lng,p.lat])},{color:drawColor,weight:drawThickness},label);
    });
  }

  function _finishShape() {
    if (drawPoints.length < 3) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer=null; }
    const pts = drawPoints.slice();
    clearTool();
    _promptLabel('', label => {
      const coords=[...pts,pts[0]].map(p=>[p.lng,p.lat]);
      _saveAnnotation('shape',{type:'Polygon',coordinates:[coords]},{color:drawColor,fillColor:drawColor,fillOpacity:0.15,weight:drawThickness},label);
    });
  }

  function _finishMeasure() {
    if (drawPoints.length < 2) { clearTool(); return; }
    if (drawLayer) { mapRef.removeLayer(drawLayer); drawLayer=null; }
    const pts = drawPoints.slice();
    let totalM = 0;
    for(let i=1;i<pts.length;i++) totalM += pts[i-1].distanceTo(pts[i]);
    const ft = totalM * 3.28084;
    const auto = `${Math.round(ft).toLocaleString()} ft`;
    clearTool();
    _promptLabel(auto, label => {
      _saveAnnotation('measure',{type:'LineString',coordinates:pts.map(p=>[p.lng,p.lat])},{color:drawColor||'#f5d76e',weight:drawThickness,dashArray:'6,4'},label||auto);
    });
  }

  function _placeText(latlng) {
    clearTool();
    _promptLabel('', label => {
      if (!label) return;
      _saveAnnotation('text',{type:'Point',coordinates:[latlng.lng,latlng.lat]},{color:drawColor},label);
    });
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────
  function _renderAnnotation(ann) {
    let lyr;
    const g=ann.geojson; const s=ann.style||{};
    if (ann.type==='text') {
      const[lng,lat]=g.coordinates;
      lyr=L.marker([lat,lng],{icon:L.divIcon({html:`<div class="ann-text" style="color:${s.color||'#fff'}">${_e(ann.label)}</div>`,className:'',iconAnchor:[0,0]})});
    } else if (ann.type==='shape') {
      const coords=g.coordinates[0].map(c=>[c[1],c[0]]);
      lyr=L.polygon(coords,{color:s.color||'#68949E',fillColor:s.fillColor||s.color||'#68949E',fillOpacity:s.fillOpacity??0.15,weight:s.weight??2});
    } else {
      const coords=g.coordinates.map(c=>[c[1],c[0]]);
      lyr=L.polyline(coords,{color:s.color||'#4da6ff',weight:s.weight??2,dashArray:s.dashArray||''});
      if(ann.label){
        const mid=coords[Math.floor(coords.length/2)];
        mapLayerGroup.addLayer(L.marker(mid,{
          icon:L.divIcon({
            html:`<div class="map-label ann-measure-label">${_e(ann.label)}</div>`,
            className:'',iconAnchor:[0,12]
          }),
          interactive:false
        }));
      }
    }
    lyr.on('click',e=>{
      if(activeTool==='erase'){L.DomEvent.stopPropagation(e);_erase(ann.id);return;}
      L.DomEvent.stopPropagation(e);
      const ll=e.latlng||(lyr.getLatLng?lyr.getLatLng():lyr.getBounds().getCenter());
      L.popup({maxWidth:220}).setLatLng(ll).setContent(`
        <div style="font-family:'DM Mono',monospace;font-size:11px;color:#e6edf3">
          <div style="font-weight:600;margin-bottom:5px;text-transform:capitalize">${_e(ann.type)}${ann.label?' — '+_e(ann.label):''}</div>
          ${ann.creator?`<div style="color:#8b949e;font-size:10px;margin-bottom:8px">by ${_e(ann.creator)}</div>`:''}
          <button class="btn-delete" style="width:100%" onclick="Annotations.erase('${ann.id}');window.map&&window.map.closePopup()">🗑 Delete</button>
        </div>
      `).openOn(mapRef);
    });
    mapLayerGroup.addLayer(lyr);
    leafletAnns[ann.id]=lyr;
  }

  function _erase(id) {
    annotations=annotations.filter(a=>a.id!==id);
    if(leafletAnns[id]){mapLayerGroup.removeLayer(leafletAnns[id]);delete leafletAnns[id];}
    onSave(annotations);
    if(typeof UI!=='undefined') UI.toast('Annotation deleted');
  }

  function erase(id){_erase(id);}

  function _saveAnnotation(type,geojson,style,label){
    const ann={id:'ann_'+Date.now(),type,geojson,style,label,creator:typeof Presence!=='undefined'?Presence.getCurrentUser():'',ts:Date.now()};
    annotations.push(ann);_renderAnnotation(ann);onSave(annotations);
    if(typeof UI!=='undefined') UI.toast(`${type.charAt(0).toUpperCase()+type.slice(1)} added`);
  }

  function _e(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  return{init,loadFromSheets,setTool,clearTool,getActiveTool,erase,setDrawColor,setDrawThickness,setDrawLabel};
})();
