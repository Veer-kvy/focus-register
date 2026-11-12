/*
 * Floating dashboard icon geometry.
 * Pure functions shared by the Electron main process and the test suite.
 * No DOM, no Node APIs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SRFloatLayout = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function unionBounds(areas) {
    if (!Array.isArray(areas) || !areas.length) return { x: 0, y: 0, width: 0, height: 0 };
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    areas.forEach((area) => {
      left = Math.min(left, area.x);
      top = Math.min(top, area.y);
      right = Math.max(right, area.x + area.width);
      bottom = Math.max(bottom, area.y + area.height);
    });
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function clampToArea(position, size, area) {
    const maxX = Math.max(area.x, area.x + area.width - size);
    const maxY = Math.max(area.y, area.y + area.height - size);
    return {
      x: Math.round(clamp(position.x, area.x, maxX)),
      y: Math.round(clamp(position.y, area.y, maxY))
    };
  }

  function resolveDock(position, size, area, options) {
    const config = options || {};
    const snapDistance = Number.isFinite(config.snapDistance) ? config.snapDistance : 28;
    const margin = Number.isFinite(config.margin) ? config.margin : 8;
    const inside = clampToArea(position, size, area);
    const leftGap = inside.x - area.x;
    const rightGap = area.x + area.width - (inside.x + size);
    if (leftGap <= snapDistance) {
      return { x: Math.round(area.x + margin), y: inside.y, docked: 'left' };
    }
    if (rightGap <= snapDistance) {
      return { x: Math.round(area.x + area.width - size - margin), y: inside.y, docked: 'right' };
    }
    return { x: inside.x, y: inside.y, docked: null };
  }

  function restorePlacement(state, size, area, options) {
    const config = options || {};
    const margin = Number.isFinite(config.margin) ? config.margin : 8;
    const inside = clampToArea(state, size, area);
    if (state.docked === 'left') {
      return { x: Math.round(area.x + margin), y: inside.y, docked: 'left' };
    }
    if (state.docked === 'right') {
      return { x: Math.round(area.x + area.width - size - margin), y: inside.y, docked: 'right' };
    }
    return { x: inside.x, y: inside.y, docked: null };
  }

  return {
    clamp,
    unionBounds,
    clampToArea,
    resolveDock,
    restorePlacement
  };
});
