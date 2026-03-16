// ─────────────────────────────────────────────────────────────────────────────
// Chaka Signs Map — Google Apps Script Backend v3.1
// Deploy: Web App → Execute as Me → Anyone can access
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_ID         = '1aBfll1stuWNXGD9Ez9vQnJ_uiJOt6zoVc-iNOjnE2nw';
const POINTS_SHEET     = 'Points';
const PRESENCE_SHEET   = 'Presence';
const ANNOTATIONS_SHEET = 'Annotations';

function doGet(e) {
  const params = e.parameter;
  let result;
  try {
    if      (params.action === 'load')        result = loadAll();
    else if (params.action === 'presence')    result = loadPresence();
    else if (params.payload) {
      const payload = JSON.parse(decodeURIComponent(params.payload));
      if      (payload.action === 'save')           result = savePoints(payload.points);
      else if (payload.action === 'saveAnnotations') result = saveAnnotations(payload.annotations);
      else if (payload.action === 'heartbeat')      result = saveHeartbeat(payload.sessionId, payload.name, payload.ts);
      else result = { error: 'Unknown payload action' };
    } else {
      result = { error: 'Unknown action' };
    }
  } catch(err) {
    result = { error: err.toString() };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── LOAD ALL (points + annotations in one call) ───────────────────────────────
function loadAll() {
  return {
    points:      loadPoints().points,
    annotations: loadAnnotations().annotations,
  };
}

// ── POINTS ────────────────────────────────────────────────────────────────────
function loadPoints() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(POINTS_SHEET);
  if (!sheet) return { points: {} };
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { points: {} };
  const points = {};
  for (let i = 1; i < data.length; i++) {
    const [id, layerId, lat, lng, name, notes] = data[i];
    if (!id || !layerId || isNaN(lat) || isNaN(lng)) continue;
    if (!points[layerId]) points[layerId] = [];
    points[layerId].push({
      id: String(id), lat: parseFloat(lat), lng: parseFloat(lng),
      name: String(name||''), notes: String(notes||'')
    });
  }
  return { points };
}

function savePoints(points) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(POINTS_SHEET) || ss.insertSheet(POINTS_SHEET);
  sheet.clearContents();
  sheet.appendRow(['id','layerId','lat','lng','name','notes']);
  const rows = [];
  Object.entries(points).forEach(([layerId, pts]) => {
    (pts||[]).forEach(pt => rows.push([
      String(pt.id), String(layerId), pt.lat, pt.lng,
      String(pt.name||''), String(pt.notes||'')
    ]));
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  return { success: true, count: rows.length };
}

// ── ANNOTATIONS ───────────────────────────────────────────────────────────────
function loadAnnotations() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(ANNOTATIONS_SHEET);
  if (!sheet) return { annotations: [] };
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { annotations: [] };
  const annotations = [];
  for (let i = 1; i < data.length; i++) {
    const [id, type, geojson, style, label, creator, ts] = data[i];
    if (!id) continue;
    try {
      annotations.push({
        id: String(id), type: String(type),
        geojson: JSON.parse(geojson),
        style: JSON.parse(style||'{}'),
        label: String(label||''),
        creator: String(creator||''),
        ts: Number(ts||0),
      });
    } catch(e) {}
  }
  return { annotations };
}

function saveAnnotations(annotations) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(ANNOTATIONS_SHEET) || ss.insertSheet(ANNOTATIONS_SHEET);
  sheet.clearContents();
  sheet.appendRow(['id','type','geojson','style','label','creator','ts']);
  const rows = (annotations||[]).map(a => [
    String(a.id), String(a.type),
    JSON.stringify(a.geojson),
    JSON.stringify(a.style||{}),
    String(a.label||''),
    String(a.creator||''),
    Number(a.ts||0),
  ]);
  if (rows.length) sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  return { success: true, count: rows.length };
}

// ── PRESENCE ──────────────────────────────────────────────────────────────────
function loadPresence() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(PRESENCE_SHEET);
  if (!sheet) return { presence: {} };
  const data   = sheet.getDataRange().getValues();
  const presence = {};
  const cutoff = Date.now() - 60000;
  for (let i = 1; i < data.length; i++) {
    const [sessionId, name, ts] = data[i];
    if (!sessionId || Number(ts) < cutoff) continue;
    presence[String(sessionId)] = { name: String(name), ts: Number(ts) };
  }
  return { presence };
}

function saveHeartbeat(sessionId, name, ts) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName(PRESENCE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PRESENCE_SHEET);
    sheet.appendRow(['sessionId','name','ts']);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sessionId)) {
      sheet.getRange(i+1, 2, 1, 2).setValues([[name, ts]]);
      return { ok: true };
    }
  }
  sheet.appendRow([String(sessionId), name, ts]);
  _prunePresence(sheet);
  return { ok: true };
}

function _prunePresence(sheet) {
  const cutoff = Date.now() - 120000;
  const data   = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (Number(data[i][2]) < cutoff) sheet.deleteRow(i+1);
  }
}
