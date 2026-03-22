/**
 * state.js — Gnoke GeoCompass
 * Single source of truth for all runtime state.
 */

const State = (() => {

  const today = new Date().toISOString().split('T')[0];

  const DEFAULTS = {
    /* Navigation */
    activePage        : 'compass-page',

    /* Date */
    today             : today,

    /* Compass */
    compassEnabled    : false,
    heading           : 0,         // current smoothed heading (degrees)

    /* GPS */
    gpsLat            : null,
    gpsLon            : null,
    gpsAccuracy       : null,
    gpsActive         : false,

    /* Destination */
    destLat           : null,
    destLon           : null,
    destName          : null,

    /* Search */
    searchResults     : [],
    searchStatus      : '',
  };

  let _state    = { ...DEFAULTS };
  const _listeners = {};

  function get(key) {
    return _state[key];
  }

  function set(key, value) {
    _state[key] = value;
    (_listeners[key] || []).forEach(fn => fn(value));
  }

  function on(key, callback) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(callback);
  }

  function reset() {
    _state = { ...DEFAULTS };
  }

  return { get, set, on, reset, DEFAULTS };

})();
