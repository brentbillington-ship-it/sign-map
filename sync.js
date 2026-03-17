// ─────────────────────────────────────────────────────────────────────────────
// sync.js — v3.3 — Delta saves, lazy photo loader
// ─────────────────────────────────────────────────────────────────────────────
const Sync = (() => {
  let lastHash = '';

  async function _get(params) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?${params}`, { redirect:'follow' });
    const data = await res.json().catch(() => ({}));
    if (data && data.error) {
      console.warn('GAS error:', data.error);
      if (typeof UI !== 'undefined') UI.toast('⚠ Save error — check connection');
    }
    return data;
  }

  // ── LOAD ──────────────────────────────────────────────────────────────────
  async function loadAll(onUpdate) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const res  = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=load`, { redirect:'follow' });
      const data = await res.json();
      const hash = JSON.stringify(data);
      if (hash === lastHash) return;
      lastHash = hash;
      onUpdate(data);
    } catch(e) { console.warn('Sync load failed:', e); }
  }

  function startRefresh(onUpdate) {
    loadAll(onUpdate);
    setInterval(() => loadAll(onUpdate), CONFIG.REFRESH_INTERVAL);
  }

  // ── DELTA: save one point (add or update) ─────────────────────────────────
  async function savePoint(layerId, pt) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const payload = JSON.stringify({ action:'savePoint', layerId, point:pt });
      await _get(`payload=${encodeURIComponent(payload)}`);
    } catch(e) { console.warn('savePoint failed:', e); }
  }

  // ── DELTA: delete one point ───────────────────────────────────────────────
  async function deletePoint(layerId, ptId) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const payload = JSON.stringify({ action:'deletePoint', layerId, ptId });
      await _get(`payload=${encodeURIComponent(payload)}`);
    } catch(e) { console.warn('deletePoint failed:', e); }
  }

  // ── BULK: save all points (chunked per layer to stay under URL limit) ──────
  async function savePoints(allPoints) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    for (const [layerId, pts] of Object.entries(allPoints)) {
      if (!pts || !pts.length) continue;
      // Split into chunks of 15 to stay safely under 8KB URL limit
      const CHUNK = 15;
      for (let i = 0; i < pts.length; i += CHUNK) {
        const chunk   = pts.slice(i, i + CHUNK);
        const append  = i > 0;
        const payload = JSON.stringify({ action:'saveLayer', layerId, points:chunk, append });
        try {
          await _get(`payload=${encodeURIComponent(payload)}`);
        } catch(e) { console.warn(`saveLayer chunk ${layerId}[${i}] failed:`, e); }
      }
    }
  }

  // ── ANNOTATIONS — chunked to stay under GAS URL limit ────────────────────
  async function saveAnnotations(annotations) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    const CHUNK = 10;
    for (let i = 0; i < Math.max(1, Math.ceil(annotations.length / CHUNK)); i++) {
      const chunk  = annotations.slice(i * CHUNK, (i + 1) * CHUNK);
      const append = i > 0;
      try {
        const payload = JSON.stringify({ action:'saveAnnotations', annotations: chunk, append });
        await _get(`payload=${encodeURIComponent(payload)}`);
      } catch(e) { console.warn(`saveAnnotations chunk ${i} failed:`, e); }
    }
  }

  // ── PRESENCE ──────────────────────────────────────────────────────────────
  async function sendHeartbeat(sessionId, name) {
    if (!CONFIG.APPS_SCRIPT_URL || !name) return;
    try {
      const payload = JSON.stringify({ action:'heartbeat', sessionId, name, ts:Date.now() });
      await _get(`payload=${encodeURIComponent(payload)}`);
    } catch(e) {}
  }

  async function loadPresence(onUpdate) {
    if (!CONFIG.APPS_SCRIPT_URL) return;
    try {
      const res  = await fetch(`${CONFIG.APPS_SCRIPT_URL}?action=presence`, { redirect:'follow' });
      const data = await res.json();
      onUpdate(data.presence || {});
    } catch(e) {}
  }

  function startPresence(sessionId, getName, onPresenceUpdate) {
    sendHeartbeat(sessionId, getName());
    if (!CONFIG.APPS_SCRIPT_URL) return;
    setInterval(() => sendHeartbeat(sessionId, getName()), CONFIG.PRESENCE_INTERVAL);
    setInterval(() => loadPresence(onPresenceUpdate), CONFIG.PRESENCE_INTERVAL);
  }

  // Aliases used by points.js
  const addPoint    = savePoint;
  const updatePoint = savePoint;

  // ── LAZY PHOTO LOADER ─────────────────────────────────────────────────────
  async function loadPhoto(ptId) {
    if (!CONFIG.APPS_SCRIPT_URL || !ptId) return null;
    try {
      const payload = JSON.stringify({ action:'getPhoto', ptId });
      const res = await fetch(`${CONFIG.APPS_SCRIPT_URL}?payload=${encodeURIComponent(payload)}`, { redirect:'follow' });
      const data = await res.json().catch(() => ({}));
      return (data && data.photo) ? data.photo : null;
    } catch(e) { return null; }
  }

  return { loadAll, startRefresh, addPoint, updatePoint, savePoint, deletePoint, savePoints, saveAnnotations, sendHeartbeat, startPresence, loadPhoto };
})();
