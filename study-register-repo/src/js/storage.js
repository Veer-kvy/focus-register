/* Renderer-side store bridge. All persistence happens in the main process. */
(function () {
  'use strict';

  const listeners = new Set();
  let state = null;
  let meta = null;
  let notificationPermission = null;
  let wired = false;

  function apply(payload) {
    if (!payload || !payload.state) return;
    state = payload.state;
    if (payload.meta) meta = payload.meta;
    if (payload.routineNotifications) notificationPermission = payload.routineNotifications;
    listeners.forEach((listener) => {
      try {
        listener(state, meta);
      } catch (error) {
        console.error(error);
      }
    });
  }

  async function init() {
    const response = await window.sr.getState();
    if (!response || !response.ok) throw new Error((response && response.error) || 'Could not load your register.');
    apply(response);
    if (!wired) {
      wired = true;
      window.sr.onStateChanged((payload) => apply(payload));
    }
    return state;
  }

  async function call(method, ...args) {
    if (typeof window.sr[method] !== 'function') throw new Error('Unsupported action.');
    const response = await window.sr[method](...args);
    if (!response || !response.ok) throw new Error((response && response.error) || 'Could not complete that action.');
    if (response.state) apply(response);
    return response;
  }

  function subscribe(listener) {
    listeners.add(listener);
    if (state) listener(state, meta);
    return () => listeners.delete(listener);
  }

  function subject(id) {
    return state ? state.subjects.find((item) => item.id === id) : null;
  }

  function subjectColor(id, fallbackName) {
    const found = subject(id);
    if (found) return found.color;
    return window.SRCore.colorForName(fallbackName || 'Other');
  }

  function subjectName(id, fallbackName) {
    const found = subject(id);
    return found ? found.name : (fallbackName || 'Other');
  }

  window.SRStore = {
    init,
    call,
    subscribe,
    subject,
    subjectColor,
    subjectName,
    get state() { return state; },
    get meta() { return meta; },
    get notificationPermission() { return notificationPermission; }
  };
})();
