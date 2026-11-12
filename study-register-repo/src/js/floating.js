/* Floating launcher: drag to move, click to toggle the compact dashboard. */
(function () {
  'use strict';

  const icon = document.getElementById('floatIcon');
  if (!icon || !window.sr) return;

  const DOUBLE_CLICK_MS = 500;
  const LONG_PRESS_MS = 500;
  const PRESS_SLOP = 4;

  let drag = null;
  let moveFrame = 0;
  let lastClickAt = 0;
  let holdTimer = 0;
  let longPressReady = false;

  function cancelHold() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
    if (longPressReady) {
      longPressReady = false;
      icon.classList.remove('is-holding');
    }
  }

  function armLongPress() {
    holdTimer = 0;
    if (!drag) return;
    if (Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY) > PRESS_SLOP) return;
    longPressReady = true;
    icon.classList.add('is-holding');
  }

  function flushMove() {
    moveFrame = 0;
    if (!drag) return;
    window.sr.floatDragMove({ screenX: drag.lastX, screenY: drag.lastY }).catch(() => {});
  }

  function begin(event) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    longPressReady = false;
    drag = {
      id: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY
    };
    try {
      icon.setPointerCapture(event.pointerId);
    } catch (error) {
      /* pointer capture is best-effort */
    }
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    icon.classList.add('is-dragging');
    window.sr.floatDragStart({ screenX: event.screenX, screenY: event.screenY }).catch(() => {});
    holdTimer = setTimeout(armLongPress, LONG_PRESS_MS);
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    if (Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY) > PRESS_SLOP) {
      cancelHold();
    }
    if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
  }

  function finish(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    const wasLongPress = longPressReady;
    cancelHold();
    if (moveFrame) {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      window.sr.floatDragMove({ screenX: current.lastX, screenY: current.lastY }).catch(() => {});
    }
    icon.classList.remove('is-dragging');
    try {
      icon.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* pointer already released */
    }
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', finish, true);
    window.removeEventListener('pointercancel', finish, true);

    if (wasLongPress) {
      lastClickAt = 0;
      window.sr.floatLongPress().catch(() => {});
      return;
    }

    const moved = Math.hypot(current.lastX - current.startX, current.lastY - current.startY) > PRESS_SLOP;
    if (!moved && lastClickAt && Date.now() - lastClickAt <= DOUBLE_CLICK_MS) {
      lastClickAt = 0;
      window.sr.floatDoubleClick().catch(() => {});
      return;
    }
    lastClickAt = moved ? 0 : Date.now();
    window.sr.floatDragEnd().catch(() => {});
  }

  icon.addEventListener('pointerdown', begin);
  icon.addEventListener('contextmenu', (event) => event.preventDefault());

  /* Hover arms the bezel peek: the main process expands the tucked icon and
   * schedules it back under the edge once the pointer moves on. */
  let hovering = false;

  function reportHover(next) {
    if (next === hovering) return;
    hovering = next;
    window.sr.floatHover(next).catch(() => {});
  }

  icon.addEventListener('pointerenter', () => reportHover(true));
  icon.addEventListener('pointerleave', () => reportHover(false));

  const hands = {
    hour: icon.querySelector('.float-hand-hour'),
    minute: icon.querySelector('.float-hand-minute')
  };

  let running = false;

  function setClockAngle(hand, degrees) {
    if (hand) hand.style.setProperty('--clock-from', degrees.toFixed(3) + 'deg');
  }

  function alignHandsToNow() {
    const now = new Date();
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;
    setClockAngle(hands.hour, hours * 30);
    setClockAngle(hands.minute, minutes * 6);
  }

  function applyTimerState(state) {
    const next = Boolean(state && state.activeSession);
    if (next && !running) alignHandsToNow();
    running = next;
    icon.classList.toggle('is-running', next);
    icon.setAttribute('aria-label', next
      ? 'Study session running — open the Study Register dashboard'
      : 'Open the Study Register dashboard');
  }

  window.sr.onStateChanged((payload) => applyTimerState(payload && payload.state));
  window.sr.getState().then((payload) => applyTimerState(payload && payload.state)).catch(() => {});

  window.sr.onFloatState((payload) => {
    if (!payload) return;
    document.body.classList.toggle('is-docked', Boolean(payload.docked));
  });
})();
