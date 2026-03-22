/**
 * ui.js — Gnoke GeoCompass
 * Pure UI utilities. No business logic, no state writes, no SQL.
 */

const UI = (() => {

  /* ── Toast ── */
  let _toastTimer = null;

  function toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    clearTimeout(_toastTimer);
    el.textContent = msg;
    el.className   = `show${type === 'err' ? ' err' : type === 'ok' ? ' ok' : ''}`;
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  /* ── Status chip ── */
  let _statusTimer = null;

  function status(msg, type = 'ok') {
    const el = document.getElementById('status-chip');
    if (!el) return;
    clearTimeout(_statusTimer);
    el.textContent = msg;
    el.className   = `show${type === 'err' ? ' err' : ''}`;
    _statusTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ── Loading overlay ── */
  function loading(show) {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  /* ── Modals ── */
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('show');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  }

  function initModalOverlayClose() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('show');
      });
    });
  }

  /* ── Table empty state ── */
  function empty(tbody, cols, msg = 'No records yet.') {
    tbody.innerHTML = `
      <tr>
        <td colspan="${cols}" class="empty-cell">${msg}</td>
      </tr>`;
  }

  /* ── Init ── */
  function init() {
    initModalOverlayClose();
  }

  return { toast, status, loading, openModal, closeModal, empty, init };

})();
