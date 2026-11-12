/* Timestamp-based live timer. Elapsed time is always derived from Date.now(). */
(function () {
  'use strict';

  const core = window.SRCore;

  function elapsed(active, now) {
    if (!active) return 0;
    const entry = new Date(active.entry).getTime();
    if (!Number.isFinite(entry)) return 0;
    return Math.max(0, (now || Date.now()) - entry);
  }

  function activeTodayMs(active, now) {
    if (!active) return 0;
    const entry = new Date(active.entry).getTime();
    if (!Number.isFinite(entry)) return 0;
    const dayStart = core.startOfDay(new Date(now || Date.now())).getTime();
    return Math.max(0, (now || Date.now()) - Math.max(entry, dayStart));
  }

  function create(onTick) {
    let active = null;
    let todayBaseMs = 0;
    let targetMs = 0;
    let handle = null;

    function frame() {
      const now = Date.now();
      const running = elapsed(active, now);
      const todayMs = todayBaseMs + activeTodayMs(active, now);
      const progress = targetMs > 0 ? Math.min(1, todayMs / targetMs) : 0;
      onTick({
        now,
        active,
        elapsed: running,
        todayMs,
        targetMs,
        progress
      });
    }

    return {
      update(next) {
        active = next.active || null;
        todayBaseMs = Math.max(0, next.todayBaseMs || 0);
        targetMs = Math.max(0, next.targetMs || 0);
        frame();
      },
      start() {
        if (handle) return;
        frame();
        handle = setInterval(frame, 250);
      },
      stop() {
        if (!handle) return;
        clearInterval(handle);
        handle = null;
      },
      refresh: frame
    };
  }

  window.SRTimer = { create, elapsed, activeTodayMs };
})();
