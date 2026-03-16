// ─────────────────────────────────────────────────────────────────────────────
// Chaka Signs Map — Google Apps Script Backend v3.1f
// Deploy: Web App → Execute as Me → Anyone can access
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_ID          = '1aBfll1stuWNXGD9Ez9vQnJ_uiJOt6zoVc-iNOjnE2nw';
const POINTS_SHEET      = 'Points';
const PRESENCE_SHEET    = 'Presence';
const ANNOTATIONS_SHEET = 'Annotations';

// Column order in Points sheet
const COLS = ['id','layerId','lat','lng','name','notes','addedBy','addedAt','editedBy','editedAt'];

function doGet(e) {
  const params = e.parameter;
  let result;
  try {
    if (params.action === 'load') {
      result = loadAll();
    } else if (params.action === 'presence') {
      result = loadPresence();
    } else if (params.payload) {
      const payload = JSON.parse(decodeURIComponent(params.payload));
      const a = payload.action;
      if      (a === 'addPoint')    result = addPoint(payload.layerId, payload.point);
      else if (a === 'updatePoint') result = updatePoint(payload.layerId, payload.point);
      else if (a === 'deletePoint') result = deletePoint(payload.layerId, payload.ptId);
      else if (a === 'heartbeat')   result = saveHeartbeat(payload.sessionId, payload.name, payload.ts);
      else if (a === 'saveAnnotations') result = saveAnnotations(payload.annotations);
      // Legacy full-save fallback (small datasets only)
      else if (a === 'save')        result = saveAllPoints(payload.points);
      else result = { error: 'Unknown action: ' + a };
    } else {
      result = { error: 'No action' };
    }
  } catch(err) {
    result = { error: err.toString() };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── LOAD ──────────────────────────────────────────────────────────────────────
function loadAll() {
  return {
    points:      loadPoints(),
    annotations: loadAnnotations(),
  };
}

function loadPoints() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(POINTS_SHEET);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  const hdr = data[0].map(h => String(h).trim());
  const points = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    hdr.forEach((h, j) => { obj[h] = String(row[j]||''); });
    const { id, layerId, lat, lng } = obj;
    if (!id || !layerId || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) continue;
    if (!points[layerId]) points[layerId] = [];
    points[layerId].push({ ...obj, lat: parseFloat(lat), lng: parseFloat(lng) });
  }
  return points;
}

// ── DELTA SAVES ───────────────────────────────────────────────────────────────
function _getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(POINTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(POINTS_SHEET);
    sheet.appendRow(COLS);
  }
  // Ensure header row exists
  const first = sheet.getRange(1,1,1,1).getValue();
  if (first !== 'id') sheet.insertRowBefore(1).getRange(1,1,1,COLS.length).setValues([COLS]);
  return sheet;
}

function _pointToRow(pt) {
  return COLS.map(k => k === 'lat' || k === 'lng' ? Number(pt[k]||0) : String(pt[k]||''));
}

function addPoint(layerId, pt) {
  const sheet = _getSheet();
  // Check if id already exists (avoid duplicates)
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(pt.id)) {
      // Already exists — update instead
      return updatePoint(layerId, pt);
    }
  }
  const row = _pointToRow({ ...pt, layerId });
  sheet.appendRow(row);
  return { ok: true, action: 'added' };
}

function updatePoint(layerId, pt) {
  const sheet = _getSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(pt.id)) {
      const row = _pointToRow({ ...pt, layerId });
      sheet.getRange(i+1, 1, 1, COLS.length).setValues([row]);
      return { ok: true, action: 'updated', row: i+1 };
    }
  }
  // Not found — add it
  return addPoint(layerId, pt);
}

function deletePoint(layerId, ptId) {
  const sheet = _getSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(ptId)) {
      sheet.deleteRow(i+1);
      return { ok: true, action: 'deleted' };
    }
  }
  return { ok: true, action: 'not_found' };
}

// ── LEGACY FULL SAVE (fallback for small datasets) ────────────────────────────
function saveAllPoints(points) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(POINTS_SHEET) || ss.insertSheet(POINTS_SHEET);
  sheet.clearContents();
  sheet.appendRow(COLS);
  const rows = [];
  Object.entries(points||{}).forEach(([layerId, pts]) => {
    (pts||[]).forEach(pt => rows.push(_pointToRow({...pt, layerId})));
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, COLS.length).setValues(rows);
  return { ok: true, count: rows.length };
}

// ── ANNOTATIONS ───────────────────────────────────────────────────────────────
function loadAnnotations() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(ANNOTATIONS_SHEET);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const anns = [];
  for (let i = 1; i < data.length; i++) {
    const [id, type, geojson, style, label, creator, ts] = data[i];
    if (!id) continue;
    try {
      anns.push({ id:String(id), type:String(type), geojson:JSON.parse(geojson),
        style:JSON.parse(style||'{}'), label:String(label||''),
        creator:String(creator||''), ts:Number(ts||0) });
    } catch(e) {}
  }
  return anns;
}

function saveAnnotations(annotations) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(ANNOTATIONS_SHEET) || ss.insertSheet(ANNOTATIONS_SHEET);
  sheet.clearContents();
  sheet.appendRow(['id','type','geojson','style','label','creator','ts']);
  const rows = (annotations||[]).map(a => [
    String(a.id), String(a.type), JSON.stringify(a.geojson),
    JSON.stringify(a.style||{}), String(a.label||''),
    String(a.creator||''), Number(a.ts||0)
  ]);
  if (rows.length) sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  return { ok: true, count: rows.length };
}

// ── PRESENCE ──────────────────────────────────────────────────────────────────
function loadPresence() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(PRESENCE_SHEET);
  if (!sheet) return {};
  const data    = sheet.getDataRange().getValues();
  const cutoff  = Date.now() - 60000;
  const presence = {};
  for (let i = 1; i < data.length; i++) {
    const [sid, name, ts] = data[i];
    if (!sid || Number(ts) < cutoff) continue;
    presence[String(sid)] = { name:String(name), ts:Number(ts) };
  }
  return presence;
}

function saveHeartbeat(sessionId, name, ts) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(PRESENCE_SHEET);
  if (!sheet) { sheet = ss.insertSheet(PRESENCE_SHEET); sheet.appendRow(['sessionId','name','ts']); }
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sessionId)) {
      sheet.getRange(i+1, 2, 1, 2).setValues([[name, ts]]);
      return { ok: true };
    }
  }
  sheet.appendRow([String(sessionId), name, ts]);
  // Prune stale rows
  const d2 = sheet.getDataRange().getValues();
  const cutoff = Date.now() - 120000;
  for (let i = d2.length - 1; i >= 1; i--) {
    if (Number(d2[i][2]) < cutoff) sheet.deleteRow(i+1);
  }
  return { ok: true };
}
