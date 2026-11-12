'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../src/js/float-layout.js');

const SIZE = 58;
const AREA = { x: 0, y: 24, width: 1440, height: 876 };

test('snaps to the left edge and keeps the vertical position', () => {
  const result = layout.resolveDock({ x: 18, y: 300 }, SIZE, AREA, { snapDistance: 28, margin: 8 });
  assert.deepEqual(result, { x: 8, y: 300, docked: 'left' });
});

test('snaps to the right edge when released near it', () => {
  const result = layout.resolveDock({ x: 1440 - SIZE - 20, y: 420 }, SIZE, AREA, { snapDistance: 28, margin: 8 });
  assert.deepEqual(result, { x: 1440 - SIZE - 8, y: 420, docked: 'right' });
});

test('stays undocked away from both edges', () => {
  const result = layout.resolveDock({ x: 600, y: 300 }, SIZE, AREA, { snapDistance: 28, margin: 8 });
  assert.deepEqual(result, { x: 600, y: 300, docked: null });
});

test('never leaves the display work area', () => {
  const result = layout.resolveDock({ x: 5000, y: -900 }, SIZE, AREA, { snapDistance: 28, margin: 8 });
  assert.deepEqual(result, { x: 1440 - SIZE - 8, y: 24, docked: 'right' });
});

test('restores a docked side flush to the saved edge', () => {
  const left = layout.restorePlacement({ x: 1300, y: 400, docked: 'left' }, SIZE, AREA, { margin: 8 });
  assert.deepEqual(left, { x: 8, y: 400, docked: 'left' });
  const right = layout.restorePlacement({ x: 12, y: 400, docked: 'right' }, SIZE, AREA, { margin: 8 });
  assert.deepEqual(right, { x: 1440 - SIZE - 8, y: 400, docked: 'right' });
});

test('restores a floating icon and clamps it onto the current display', () => {
  const shown = layout.restorePlacement({ x: 620, y: 310, docked: null }, SIZE, AREA, { margin: 8 });
  assert.deepEqual(shown, { x: 620, y: 310, docked: null });
  const rescued = layout.restorePlacement({ x: -2000, y: 5000, docked: null }, SIZE, AREA, { margin: 8 });
  assert.deepEqual(rescued, { x: 0, y: 24 + 876 - SIZE, docked: null });
});

test('dragging bounds span every connected display', () => {
  const bounds = layout.unionBounds([
    { x: 0, y: 24, width: 1440, height: 876 },
    { x: 1440, y: 0, width: 1920, height: 1080 }
  ]);
  assert.deepEqual(bounds, { x: 0, y: 0, width: 3360, height: 1080 });
});

test('clamp handles inverted ranges safely', () => {
  assert.equal(layout.clamp(10, 0, -5), 0);
  assert.equal(layout.clamp(-3, 0, 10), 0);
  assert.equal(layout.clamp(50, 0, 10), 10);
});
