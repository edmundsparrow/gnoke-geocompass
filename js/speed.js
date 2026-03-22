/**
 * speed.js — Gnoke GeoCompass
 * GPS Speedometer module. TYPE C tool — no database.
 *
 * Owns:
 *   - Analog SVG speedometer dial (0–240 km/h)
 *   - GPS speed reading via Geolocation API (coords.speed → m/s → km/h)
 *   - Smooth needle animation (rAF interpolation)
 *   - Stats: current, average, max speed; trip meter; odometer
 *   - Unit toggle: km/h ↔ mph
 *   - Trip reset
 *
 * Public API:
 *   Speedometer.init()     → mount SVG, start GPS watcher, start rAF loop
 *   Speedometer.destroy()  → clean up watcher and rAF
 *   Speedometer.reset()    → reset trip stats (not odometer)
 */

const Speedometer = (() => {

  /* ── Config ── */
  const MAX_KMH   = 240;
  const DIAL_START_DEG = 135;   /* angle where 0 km/h sits  (bottom-left) */
  const DIAL_SWEEP_DEG = 270;   /* full sweep to max speed   */

  /* ── State ── */
  let _watchId      = null;
  let _animFrame    = null;
  let _currentSpeed = 0;    /* km/h, raw from GPS */
  let _needleAngle  = DIAL_START_DEG;  /* smoothed, in SVG degrees */
  let _unit         = 'kmh';  /* 'kmh' | 'mph' */

  let _maxSpeed     = 0;
  let _totalSpeed   = 0;
  let _speedSamples = 0;
  let _tripKm       = 0;   /* resets on Reset Trip */
  let _odoKm        = 0;   /* persisted in localStorage, never resets */
  let _lastPos      = null;

  const ODO_KEY   = 'gnoke_geocompass_odometer';
  const UNIT_KEY  = 'gnoke_geocompass_speed_unit';

  /* ── Unit helpers ── */
  function _toDisplay(kmh) {
    return _unit === 'mph' ? kmh * 0.621371 : kmh;
  }
  function _unitLabel() {
    return _unit === 'mph' ? 'mph' : 'km/h';
  }
  function _maxDisplay() {
    return _unit === 'mph' ? Math.round(MAX_KMH * 0.621371 / 10) * 10 : MAX_KMH;
  }

  /* ── Haversine (local copy for distance between GPS fixes) ── */
  function _haversine(lat1, lon1, lat2, lon2) {
    const R    = 6371e3;
    const toR  = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1);
    const dLon = toR(lon2 - lon1);
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(toR(lat1)) * Math.cos(toR(lat2)) *
                 Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── SVG dial builder ── */
  function _buildDial() {
    const CX = 150, CY = 150, R_OUTER = 140, R_TICK_OUTER = 132;

    /* Speed labels: every 20 km/h */
    const LABELS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240];

    /* Ticks: every 10 km/h = major, every 5 = minor */
    let ticks = '';
    for (let s = 0; s <= MAX_KMH; s += 5) {
      const angle = DIAL_START_DEG + (s / MAX_KMH) * DIAL_SWEEP_DEG;
      const rad   = (angle - 90) * Math.PI / 180;
      const major = s % 20 === 0;
      const mid   = s % 10 === 0 && !major;
      const r1    = major ? R_TICK_OUTER - 14 : mid ? R_TICK_OUTER - 8 : R_TICK_OUTER - 5;
      const x1    = (CX + r1              * Math.cos(rad)).toFixed(2);
      const y1    = (CY + r1              * Math.sin(rad)).toFixed(2);
      const x2    = (CX + R_TICK_OUTER    * Math.cos(rad)).toFixed(2);
      const y2    = (CY + R_TICK_OUTER    * Math.sin(rad)).toFixed(2);
      const col   = major ? '#d4d4d4' : mid ? 'rgba(200,200,200,.55)' : 'rgba(180,180,180,.3)';
      const sw    = major ? '2' : '1';
      ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}"/>`;
    }

    /* Speed number labels */
    let labels = '';
    LABELS.forEach(s => {
      const angle = DIAL_START_DEG + (s / MAX_KMH) * DIAL_SWEEP_DEG;
      const rad   = (angle - 90) * Math.PI / 180;
      const r     = R_TICK_OUTER - 26;
      const x     = (CX + r * Math.cos(rad)).toFixed(2);
      const y     = (CY + r * Math.sin(rad) + 4).toFixed(2);
      labels += `<text x="${x}" y="${y}" text-anchor="middle"
        fill="rgba(220,220,220,0.9)" font-size="11" font-weight="600"
        font-family="'DM Mono',monospace">${s}</text>`;
    });

    /* Colour arc — green → amber → red */
    function _arcPath(startSpd, endSpd, colour) {
      const a1  = (DIAL_START_DEG + (startSpd / MAX_KMH) * DIAL_SWEEP_DEG - 90) * Math.PI / 180;
      const a2  = (DIAL_START_DEG + (endSpd   / MAX_KMH) * DIAL_SWEEP_DEG - 90) * Math.PI / 180;
      const R   = R_TICK_OUTER + 4;
      const x1  = (CX + R * Math.cos(a1)).toFixed(2);
      const y1  = (CY + R * Math.sin(a1)).toFixed(2);
      const x2  = (CX + R * Math.cos(a2)).toFixed(2);
      const y2  = (CY + R * Math.sin(a2)).toFixed(2);
      const lg  = (endSpd - startSpd) / MAX_KMH * DIAL_SWEEP_DEG > 180 ? 1 : 0;
      return `<path d="M${x1},${y1} A${R},${R} 0 ${lg},1 ${x2},${y2}"
        fill="none" stroke="${colour}" stroke-width="4" stroke-linecap="round" opacity="0.35"/>`;
    }

    const arcs = _arcPath(0, 80, '#4ade80') +
                 _arcPath(80, 160, '#fbbf24') +
                 _arcPath(160, 240, '#f87171');

    return `
<svg id="speed-dial-svg" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"
     style="width:100%;height:100%;display:block;">
  <defs>
    <radialGradient id="spd-bg" cx="45%" cy="38%">
      <stop offset="0%"   stop-color="#1a2535"/>
      <stop offset="100%" stop-color="#0a0f18"/>
    </radialGradient>
    <filter id="spd-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="needle-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Outer shadow -->
  <circle cx="${CX}" cy="${CY+4}" r="${R_OUTER+4}" fill="rgba(0,0,0,.35)"/>

  <!-- Face -->
  <circle cx="${CX}" cy="${CY}" r="${R_OUTER}" fill="url(#spd-bg)"/>

  <!-- Bezel -->
  <circle cx="${CX}" cy="${CY}" r="${R_OUTER}"   fill="none" stroke="#2a3a50" stroke-width="3"/>
  <circle cx="${CX}" cy="${CY}" r="${R_OUTER-4}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="0.8"/>

  <!-- Colour arcs -->
  ${arcs}

  <!-- Tick marks -->
  ${ticks}

  <!-- Speed numbers -->
  ${labels}

  <!-- Unit label -->
  <text id="spd-unit-label" x="${CX}" y="${CY+34}"
    text-anchor="middle" fill="rgba(200,200,200,.55)"
    font-size="11" font-family="'DM Mono',monospace" letter-spacing="0.1em">km/h</text>

  <!-- Needle -->
  <g id="spd-needle"
     style="transform-origin:${CX}px ${CY}px; transform:rotate(${DIAL_START_DEG - 90}deg);">
    <!-- Needle body -->
    <polygon points="${CX},${CY-112} ${CX-4},${CY+18} ${CX},${CY+28} ${CX+4},${CY+18}"
             fill="#ef4444" filter="url(#needle-glow)"/>
    <!-- Highlight -->
    <polygon points="${CX},${CY-112} ${CX+1.5},${CY-40} ${CX},${CY+28} ${CX},${CY-112}"
             fill="rgba(255,255,255,.18)"/>
  </g>

  <!-- Hub cap -->
  <circle cx="${CX}" cy="${CY}" r="14" fill="#1a2535"/>
  <circle cx="${CX}" cy="${CY}" r="10" fill="#2a3a50"/>
  <circle cx="${CX}" cy="${CY}" r="5"  fill="#ef4444"/>
  <circle cx="${CX}" cy="${CY}" r="2.5" fill="#ff6b6b"/>
</svg>`;
  }

  /* ── Needle angle from speed ── */
  function _angleFromSpeed(kmh) {
    const clamped = Math.max(0, Math.min(kmh, MAX_KMH));
    return DIAL_START_DEG - 90 + (clamped / MAX_KMH) * DIAL_SWEEP_DEG;
  }

  /* ── DOM update ── */
  function _el(id) { return document.getElementById(id); }

  function _updateDOM() {
    const displaySpd  = _toDisplay(_currentSpeed);
    const displayMax  = _toDisplay(_maxSpeed);
    const displayAvg  = _speedSamples > 0
      ? _toDisplay(_totalSpeed / _speedSamples)
      : 0;
    const ul = _unitLabel();

    /* Big speed number */
    const bigEl = _el('spd-current');
    if (bigEl) bigEl.textContent = displaySpd.toFixed(1);

    const unitEl = _el('spd-current-unit');
    if (unitEl) unitEl.textContent = ul;

    /* Stats */
    const avgEl  = _el('spd-avg');
    const maxEl  = _el('spd-max');
    const tripEl = _el('spd-trip');
    const odoEl  = _el('spd-odo');
    const avgUEl = _el('spd-avg-unit');
    const maxUEl = _el('spd-max-unit');

    if (avgEl)  avgEl.textContent  = displayAvg.toFixed(1);
    if (maxEl)  maxEl.textContent  = displayMax.toFixed(1);
    if (tripEl) tripEl.textContent = _tripKm.toFixed(2);
    if (odoEl)  odoEl.textContent  = _odoKm.toFixed(2);
    if (avgUEl) avgUEl.textContent = ul;
    if (maxUEl) maxUEl.textContent = ul;

    /* Dial unit label */
    const dialUEl = _el('spd-unit-label');
    if (dialUEl) dialUEl.textContent = ul;

    /* GPS status */
    const statEl = _el('spd-status');
    if (statEl) {
      if (!navigator.geolocation) {
        statEl.textContent = '⚠ GPS not available on this device';
      }
    }
  }

  /* ── rAF animation loop ── */
  function _animate() {
    const target  = _angleFromSpeed(_currentSpeed);
    const diff    = target - _needleAngle;
    _needleAngle += diff * 0.12;  /* smooth interpolation */

    const needle = _el('spd-needle');
    if (needle) {
      needle.style.transform = `rotate(${_needleAngle.toFixed(2)}deg)`;
    }

    _updateDOM();
    _animFrame = requestAnimationFrame(_animate);
  }

  /* ── GPS watcher ── */
  function _startGPS() {
    const statEl = _el('spd-status');
    const dotEl  = _el('spd-gps-dot');

    if (!navigator.geolocation) {
      if (statEl) statEl.textContent = '⚠ GPS not supported on this device';
      if (dotEl)  dotEl.classList.add('error');
      return;
    }

    if (statEl) statEl.textContent = 'Waiting for GPS signal…';

    _watchId = navigator.geolocation.watchPosition(
      pos => {
        const { speed, latitude: la, longitude: lo } = pos.coords;

        /* Speed in m/s from GPS, convert to km/h */
        const kmh = (speed != null && speed >= 0) ? speed * 3.6 : 0;
        _currentSpeed = kmh;

        /* Update stats */
        if (kmh > 0.5) {   /* ignore noise below 0.5 km/h */
          _speedSamples++;
          _totalSpeed += kmh;
          if (kmh > _maxSpeed) _maxSpeed = kmh;
        }

        /* Distance from last fix */
        if (_lastPos) {
          const d = _haversine(_lastPos.lat, _lastPos.lon, la, lo) / 1000;
          if (d < 0.5) {   /* sanity cap — ignore GPS jumps > 500m between fixes */
            _tripKm += d;
            _odoKm  += d;
            _saveOdo();
          }
        }
        _lastPos = { lat: la, lon: lo };

        if (statEl) {
          statEl.textContent = speed != null
            ? `GPS active · ±${Math.round(pos.coords.accuracy)}m`
            : 'GPS active · speed unavailable (indoor?)';
        }
        if (dotEl) { dotEl.classList.remove('error'); dotEl.classList.add('active'); }
      },
      err => {
        _currentSpeed = 0;
        const msgs = { 1: 'GPS permission denied', 2: 'Position unavailable', 3: 'GPS timeout' };
        if (statEl) statEl.textContent = `⚠ ${msgs[err.code] || 'GPS error'}`;
        if (dotEl)  { dotEl.classList.remove('active'); dotEl.classList.add('error'); }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  /* ── Odometer persistence ── */
  function _loadOdo() {
    const v = parseFloat(localStorage.getItem(ODO_KEY));
    _odoKm = isNaN(v) ? 0 : v;
  }
  function _saveOdo() {
    localStorage.setItem(ODO_KEY, _odoKm.toFixed(3));
  }

  /* ── Public API ── */

  function init() {
    _loadOdo();
    _unit = localStorage.getItem(UNIT_KEY) || 'kmh';

    const wrap = _el('speed-dial-container');
    if (wrap) wrap.innerHTML = _buildDial();

    _startGPS();
    if (_animFrame) cancelAnimationFrame(_animFrame);
    _animFrame = requestAnimationFrame(_animate);
  }

  function destroy() {
    if (_animFrame) cancelAnimationFrame(_animFrame);
    if (_watchId != null) navigator.geolocation.clearWatch(_watchId);
    _animFrame = null;
    _watchId   = null;
  }

  function reset() {
    _tripKm       = 0;
    _maxSpeed     = 0;
    _totalSpeed   = 0;
    _speedSamples = 0;
    _lastPos      = null;
  }

  function toggleUnit() {
    _unit = _unit === 'kmh' ? 'mph' : 'kmh';
    localStorage.setItem(UNIT_KEY, _unit);
    /* Update toggle button label */
    const btn = _el('btn-unit-toggle');
    if (btn) btn.textContent = _unit === 'kmh' ? 'Switch to mph' : 'Switch to km/h';
  }

  return { init, destroy, reset, toggleUnit };

})();
