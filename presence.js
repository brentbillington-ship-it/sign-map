// ─────────────────────────────────────────────────────────────────────────────
// presence.js — Who's online
// ─────────────────────────────────────────────────────────────────────────────
const Presence = (() => {
  let sessionId   = localStorage.getItem('chakaSessionId') || ('sess_' + Date.now());
  let currentUser = '';
  localStorage.setItem('chakaSessionId', sessionId);
  function getSessionId()       { return sessionId; }
  function getCurrentUser()     { return currentUser; }
  function setCurrentUser(name) { currentUser = name; }
  function render(presenceData) {
    const bar = document.getElementById('presence-bar');
    bar.querySelectorAll('.presence-pill').forEach(el => el.remove());
    if (currentUser) bar.appendChild(_pill(currentUser, true));
    const now = Date.now();
    Object.entries(presenceData||{}).forEach(([sid, info]) => {
      if (sid === sessionId) return;
      if (now - info.ts > CONFIG.PRESENCE_TIMEOUT) return;
      bar.appendChild(_pill(info.name, false));
    });
  }
  function _pill(name, isMe) {
    const div = document.createElement('div');
    div.className = 'presence-pill';
    div.innerHTML = `<div class="presence-dot${isMe?' me':''}"></div>${_esc(name)}${isMe?' (you)':''}`;
    return div;
  }
  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  return { getSessionId, getCurrentUser, setCurrentUser, render };
})();
