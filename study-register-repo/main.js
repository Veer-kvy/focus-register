'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  shell
} = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const core = require('./src/js/core.js');
const floatLayout = require('./src/js/float-layout.js');

app.setName('Study Register');
app.setAppUserModelId('com.veervibes.studyregister');

const SRC_DIR = path.join(__dirname, 'src');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const POPOVER_SIZE = { width: 392, height: 656 };
const FLOAT_SIZE = 58;
const FLOAT_INSET = 7; // Matches the 44px button inset inside the 58px window (floating.css).
const FLOAT_BUTTON = FLOAT_SIZE - FLOAT_INSET * 2;
const FLOAT_PEEK = 16;
const FLOAT_PANEL_SIZE = { width: 430, height: 608 };
const FLOAT_SNAP_DISTANCE = 28;
const FLOAT_DOCK_MARGIN = 8;
const FLOAT_HANDLE_GUTTER = FLOAT_SIZE + FLOAT_DOCK_MARGIN;
const FLOAT_EDGE_PANEL_WIDTH = FLOAT_PANEL_SIZE.width + FLOAT_HANDLE_GUTTER;
const FLOAT_TUCK_DELAY = 1100;
const FLOAT_TUCK_SETTLE = 800;
const isMac = process.platform === 'darwin';

const DATA_DIR = process.env.STUDY_REGISTER_DATA_DIR
  ? path.resolve(process.env.STUDY_REGISTER_DATA_DIR)
  : path.join(app.getPath('appData'), 'Study Register');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'data.backup.json');
const FLOAT_FILE = path.join(DATA_DIR, 'floating.json');
app.setPath('userData', DATA_DIR);

let data = null;
let recoveredFromBackup = false;
let tray = null;
let popover = null;
let dashboard = null;
let routineWindow = null;
let floatingIcon = null;
let floatPanel = null;
let floatState = null;
let floatDrag = null;
let floatAnimTimer = null;
let floatFadeTimer = null;
let floatScreenTimer = null;
let floatTuckTimer = null;
let floatHovering = false;
let floatTucked = false;
let isQuitting = false;
let isFirstRun = false;
let modalDepth = 0;
let lastPopoverBlur = 0;
let schedulerTimer = null;
let precisionTimer = null;
let trayTimer = null;
let pendingRoutineTab = 'today';
let pendingRoutineFocus = null;
const liveNotifications = new Set();
const snoozeTimers = new Set();
const notificationPermission = {
  supported: Notification.isSupported(),
  status: 'unknown',
  checkedAt: null
};

const gotLock = process.env.STUDY_REGISTER_ALLOW_MULTI === '1' ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/* ------------------------------------------------------------------ */
/* Local data store                                                    */
/* ------------------------------------------------------------------ */

function loadData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let loaded = null;
  for (const [index, file] of [DATA_FILE, BACKUP_FILE].entries()) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      loaded = core.normalizeData(JSON.parse(raw));
      recoveredFromBackup = index > 0;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('[store] Could not read ' + file + ':', error.message);
    }
  }
  if (loaded) {
    data = loaded;
  } else {
    isFirstRun = true;
    data = core.defaultData();
    saveData();
  }
}

function saveData() {
  if (!data) return;
  data.meta.updatedAt = new Date().toISOString();
  const payload = JSON.stringify(data, null, 2);
  const tempFile = DATA_FILE + '.tmp';
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(tempFile, payload, { encoding: 'utf8', mode: 0o600 });
    // Rotate the previous file into the backup slot, but never promote a file
    // that failed to parse on load. A crash between the two renames leaves
    // data.json missing and the last good copy in the backup slot.
    if (!recoveredFromBackup && fs.existsSync(DATA_FILE)) {
      try {
        fs.renameSync(DATA_FILE, BACKUP_FILE);
      } catch (error) {
        console.error('[store] Backup rotation failed:', error.message);
      }
    }
    fs.renameSync(tempFile, DATA_FILE);
    recoveredFromBackup = false;
  } catch (error) {
    console.error('[store] Save failed:', error.message);
  }
}

function writeSafetyCopy(name) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error('[store] Safety copy failed:', error.message);
  }
}

function notificationPermissionSnapshot() {
  return {
    supported: notificationPermission.supported,
    status: notificationPermission.status,
    checkedAt: notificationPermission.checkedAt
  };
}

function snapshot() {
  return {
    state: data,
    meta: {
      dataPath: DATA_FILE,
      dataDir: DATA_DIR,
      version: app.getVersion(),
      platform: process.platform
    },
    routineNotifications: notificationPermissionSnapshot()
  };
}

function okState(extra) {
  return Object.assign({ ok: true }, snapshot(), extra || {});
}

function broadcast() {
  const payload = snapshot();
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('sr:state-changed', payload);
  });
}

/* ------------------------------------------------------------------ */
/* Window helpers                                                      */
/* ------------------------------------------------------------------ */

function secureWebPreferences() {
  return {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webviewTag: false,
    spellcheck: false,
    backgroundThrottling: false
  };
}

function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = pathToFileURL(SRC_DIR).href + path.sep;
    if (!url.startsWith(allowed)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function createPopover() {
  popover = new BrowserWindow({
    width: POPOVER_SIZE.width,
    height: POPOVER_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    roundedCorners: true,
    acceptFirstMouse: true,
    title: 'Study Register',
    webPreferences: secureWebPreferences()
  });

  hardenWindow(popover);
  popover.loadFile(path.join(SRC_DIR, 'index.html'));
  popover.setAlwaysOnTop(true, 'pop-up-menu');
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  popover.on('blur', () => {
    lastPopoverBlur = Date.now();
    setTimeout(() => {
      if (!popover || popover.isDestroyed()) return;
      if (modalDepth > 0 || popover.webContents.isDevToolsOpened()) return;
      if (popover.isVisible() && !popover.isFocused()) popover.hide();
    }, 140);
  });

  popover.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      popover.hide();
    }
  });

  popover.webContents.on('did-finish-load', () => {
    if (pendingRoutineFocus) {
      popover.webContents.send('sr:routine-focus', pendingRoutineFocus);
      pendingRoutineFocus = null;
    }
    if (isFirstRun || process.env.STUDY_REGISTER_SHOW_ON_START === '1') showPopover();
  });
}

function createDashboard() {
  if (dashboard && !dashboard.isDestroyed()) return dashboard;
  dashboard = new BrowserWindow({
    width: 1140,
    height: 790,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Study Register',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101114' : '#F4F5F8',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 22 },
    webPreferences: secureWebPreferences()
  });
  hardenWindow(dashboard);
  dashboard.loadFile(path.join(SRC_DIR, 'dashboard.html'));
  dashboard.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      dashboard.hide();
    }
  });
  dashboard.on('closed', () => {
    dashboard = null;
  });
  return dashboard;
}

function createRoutineWindow() {
  if (routineWindow && !routineWindow.isDestroyed()) return routineWindow;
  routineWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: 'My Routine',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101114' : '#F4F5F8',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 22 },
    webPreferences: secureWebPreferences()
  });
  hardenWindow(routineWindow);
  routineWindow.loadFile(path.join(SRC_DIR, 'routine.html'));
  routineWindow.webContents.on('did-finish-load', () => {
    routineWindow.webContents.send('sr:state-changed', snapshot());
    routineWindow.webContents.send('sr:routine-tab', { tab: pendingRoutineTab });
  });
  routineWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      routineWindow.hide();
    }
  });
  routineWindow.on('closed', () => {
    routineWindow = null;
  });
  return routineWindow;
}

function hideRoutineWindow() {
  if (routineWindow && !routineWindow.isDestroyed()) routineWindow.hide();
}

function positionPopover() {
  if (!popover || !tray) return;
  const trayBounds = tray.getBounds();
  const center = {
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2)
  };
  const display = screen.getDisplayNearestPoint(center);
  const area = display.workArea;
  const width = POPOVER_SIZE.width;
  const height = POPOVER_SIZE.height;
  let x = Math.round(center.x - width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 8);
  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - width - 8);
  if (y + height > area.y + area.height - 8) {
    y = Math.max(area.y + 8, trayBounds.y - height - 8);
  }
  popover.setPosition(x, y, false);
}

function showPopover() {
  if (!popover || popover.isDestroyed()) createPopover();
  hideFloatPanel();
  if (popover.isMinimized()) popover.restore();
  positionPopover();
  popover.show();
  popover.focus();
  popover.webContents.send('sr:state-changed', snapshot());
}

function hidePopover() {
  if (popover && !popover.isDestroyed()) popover.hide();
}

function togglePopover() {
  if (!popover || popover.isDestroyed()) {
    showPopover();
    return;
  }
  if (popover.isVisible()) {
    popover.hide();
    return;
  }
  if (Date.now() - lastPopoverBlur < 280) return;
  showPopover();
}

function openDashboard() {
  createDashboard();
  positionDashboard();
  hidePopover();
  hideRoutineWindow();
  hideFloatPanel();
  dashboard.show();
  dashboard.focus();
  dashboard.webContents.send('sr:state-changed', snapshot());
}

function positionDashboard() {
  if (!dashboard || dashboard.isDestroyed() || dashboard.isVisible()) return;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [width, height] = dashboard.getSize();
  dashboard.setPosition(
    Math.round(area.x + (area.width - width) / 2),
    Math.round(area.y + (area.height - height) / 2),
    false
  );
}

/* ------------------------------------------------------------------ */
/* Floating dashboard launcher                                         */
/* ------------------------------------------------------------------ */

function loadFloatState() {
  let saved = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(FLOAT_FILE, 'utf8'));
    if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      saved = {
        x: Math.round(parsed.x),
        y: Math.round(parsed.y),
        docked: parsed.docked === 'left' || parsed.docked === 'right' ? parsed.docked : null
      };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[float] Could not read state:', error.message);
  }
  if (saved) {
    floatState = saved;
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  floatState = {
    x: area.x + area.width - FLOAT_SIZE - FLOAT_DOCK_MARGIN,
    y: area.y + Math.round(area.height * 0.32),
    docked: 'right'
  };
}

function saveFloatState() {
  if (!floatState) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempFile = FLOAT_FILE + '.tmp';
    const payload = JSON.stringify({
      version: 1,
      x: floatState.x,
      y: floatState.y,
      docked: floatState.docked
    }, null, 2);
    fs.writeFileSync(tempFile, payload, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, FLOAT_FILE);
  } catch (error) {
    console.error('[float] Save failed:', error.message);
  }
}

function sendFloatState() {
  if (!floatingIcon || floatingIcon.isDestroyed()) return;
  floatingIcon.webContents.send('sr:float-state', {
    x: floatState ? floatState.x : null,
    y: floatState ? floatState.y : null,
    docked: floatState ? floatState.docked : null
  });
}

function displayAreaForPoint(x, y) {
  return screen.getDisplayNearestPoint({
    x: Math.round(x),
    y: Math.round(y)
  }).workArea;
}

/* Bezel auto-hide: the docked icon tucks under the physical screen edge and
 * peeks back out when the pointer reaches its sliver. floatState keeps the
 * canonical on-screen (rail) position so panels and restores stay stable. */

function floatPanelVisible() {
  return Boolean(floatPanel && !floatPanel.isDestroyed() && floatPanel.isVisible());
}

function floatCanTuck() {
  if (!floatState || (floatState.docked !== 'left' && floatState.docked !== 'right')) return false;
  const display = screen.getDisplayNearestPoint({
    x: Math.round(floatState.x + FLOAT_SIZE / 2),
    y: Math.round(floatState.y + FLOAT_SIZE / 2)
  });
  const union = floatLayout.unionBounds(screen.getAllDisplays().map((item) => item.bounds));
  const edge = floatState.docked === 'right'
    ? display.bounds.x + display.bounds.width
    : display.bounds.x;
  // Only a physical outer edge hides the icon; an inner edge would bury it on the next display.
  return floatState.docked === 'right'
    ? edge >= union.x + union.width - 1
    : edge <= union.x + 1;
}

function floatXForMode(side, area, mode) {
  if (side === 'right') {
    if (mode === 'tuck') return area.x + area.width - FLOAT_INSET - FLOAT_PEEK;
    if (mode === 'flush') return area.x + area.width - FLOAT_INSET - FLOAT_BUTTON;
    return area.x + area.width - FLOAT_SIZE - FLOAT_DOCK_MARGIN;
  }
  if (mode === 'tuck') return area.x - FLOAT_INSET - FLOAT_BUTTON + FLOAT_PEEK;
  if (mode === 'flush') return area.x - FLOAT_INSET;
  return area.x + FLOAT_DOCK_MARGIN;
}

function floatMoveTo(mode, immediate) {
  if (!floatingIcon || floatingIcon.isDestroyed() || !floatState) return;
  if (floatState.docked !== 'left' && floatState.docked !== 'right') return;
  const area = displayAreaForPoint(
    floatState.x + FLOAT_SIZE / 2,
    floatState.y + FLOAT_SIZE / 2
  );
  const x = Math.round(floatXForMode(floatState.docked, area, mode));
  const y = floatState.y;
  floatTucked = mode === 'tuck';
  if (immediate) {
    cancelFloatAnimation();
    floatingIcon.setPosition(x, y, false);
  } else {
    animateFloatTo(x, y);
  }
}

function tuckFloatIcon() {
  if (!floatCanTuck()) return;
  floatMoveTo('tuck', false);
}

function expandFloatIcon(mode, immediate) {
  if (!floatState || !floatState.docked) return;
  floatMoveTo(mode === 'rail' ? 'rail' : 'flush', Boolean(immediate));
}

function cancelFloatTuck() {
  if (!floatTuckTimer) return;
  clearTimeout(floatTuckTimer);
  floatTuckTimer = null;
}

function scheduleFloatTuck(delay, force) {
  cancelFloatTuck();
  floatTuckTimer = setTimeout(() => {
    floatTuckTimer = null;
    if (!floatCanTuck() || floatDrag || floatPanelVisible()) return;
    if (!force && floatHovering) return;
    tuckFloatIcon();
  }, Number.isFinite(delay) ? delay : FLOAT_TUCK_DELAY);
}

function setFloatHovering(hovering) {
  floatHovering = Boolean(hovering);
  if (floatHovering) {
    cancelFloatTuck();
    if (floatTucked) expandFloatIcon('flush');
    return;
  }
  if (!floatDrag) scheduleFloatTuck();
}

function createFloatingIcon() {
  if (floatingIcon && !floatingIcon.isDestroyed()) return floatingIcon;
  if (!floatState) loadFloatState();
  const area = displayAreaForPoint(floatState.x + FLOAT_SIZE / 2, floatState.y + FLOAT_SIZE / 2);
  const placement = floatLayout.restorePlacement(floatState, FLOAT_SIZE, area, { margin: FLOAT_DOCK_MARGIN });
  floatState = { x: placement.x, y: placement.y, docked: placement.docked };
  saveFloatState();
  const startX = floatCanTuck()
    ? Math.round(floatXForMode(placement.docked, area, 'tuck'))
    : placement.x;
  floatTucked = startX !== placement.x;

  floatingIcon = new BrowserWindow({
    width: FLOAT_SIZE,
    height: FLOAT_SIZE,
    x: startX,
    y: placement.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    acceptFirstMouse: true,
    title: 'Study Register',
    webPreferences: secureWebPreferences()
  });

  hardenWindow(floatingIcon);
  floatingIcon.loadFile(path.join(SRC_DIR, 'floating.html'));
  floatingIcon.setAlwaysOnTop(true, 'floating');
  floatingIcon.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingIcon.setPosition(startX, placement.y, false);

  floatingIcon.webContents.on('did-finish-load', () => {
    if (!floatingIcon || floatingIcon.isDestroyed()) return;
    floatingIcon.showInactive();
    sendFloatState();
  });

  floatingIcon.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      floatingIcon.hide();
    }
  });
  floatingIcon.on('closed', () => {
    floatingIcon = null;
  });
  return floatingIcon;
}

function startFloatDrag(payload) {
  if (!floatingIcon || floatingIcon.isDestroyed()) return { ok: true };
  const screenX = Number(payload.screenX);
  const screenY = Number(payload.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return { ok: true };
  cancelFloatTuck();
  cancelFloatAnimation();
  if (floatTucked) {
    // Pull the sliver out to the screen edge first so the drag starts from the bezel face.
    expandFloatIcon('flush', true);
    floatHovering = true;
  }
  const [x, y] = floatingIcon.getPosition();
  floatDrag = {
    offsetX: screenX - x,
    offsetY: screenY - y,
    originX: x,
    originY: y,
    startDocked: floatState ? floatState.docked : null,
    panelWasVisible: Boolean(floatPanel && !floatPanel.isDestroyed() && floatPanel.isVisible())
  };
  return { ok: true };
}

function moveFloatDrag(payload) {
  if (!floatDrag || !floatingIcon || floatingIcon.isDestroyed()) return { ok: true };
  const screenX = Number(payload.screenX);
  const screenY = Number(payload.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return { ok: true };
  if (floatPanel && !floatPanel.isDestroyed() && floatPanel.isVisible()) hideFloatPanel();
  const bounds = floatLayout.unionBounds(screen.getAllDisplays().map((display) => display.workArea));
  const x = floatLayout.clamp(screenX - floatDrag.offsetX, bounds.x, bounds.x + bounds.width - FLOAT_SIZE);
  const y = floatLayout.clamp(screenY - floatDrag.offsetY, bounds.y, bounds.y + bounds.height - FLOAT_SIZE);
  floatingIcon.setPosition(Math.round(x), Math.round(y), false);
  return { ok: true };
}

function finishFloatDrag() {
  if (!floatDrag || !floatingIcon || floatingIcon.isDestroyed()) {
    floatDrag = null;
    return { ok: true };
  }
  const drag = floatDrag;
  floatDrag = null;
  const [x, y] = floatingIcon.getPosition();
  const moved = Math.hypot(x - drag.originX, y - drag.originY) > 4;

  if (!moved) {
    floatingIcon.setPosition(drag.originX, drag.originY, false);
    if (drag.panelWasVisible) hideFloatPanel();
    else openFloatPanel();
    return { ok: true };
  }

  const area = displayAreaForPoint(x + FLOAT_SIZE / 2, y + FLOAT_SIZE / 2);
  const snapped = floatLayout.resolveDock({ x, y }, FLOAT_SIZE, area, {
    snapDistance: FLOAT_SNAP_DISTANCE,
    margin: FLOAT_DOCK_MARGIN
  });
  animateFloatTo(snapped.x, snapped.y);
  floatState = { x: snapped.x, y: snapped.y, docked: snapped.docked };
  floatTucked = false;
  saveFloatState();
  sendFloatState();
  if (snapped.docked) {
    // A push against the bezel should tuck itself away shortly after the drop.
    if (floatCanTuck()) scheduleFloatTuck(FLOAT_TUCK_SETTLE, true);
  } else if (drag.startDocked) {
    openFloatPanel();
  }
  return { ok: true };
}

function cancelFloatAnimation() {
  if (!floatAnimTimer) return;
  clearInterval(floatAnimTimer);
  floatAnimTimer = null;
}

function animateFloatTo(x, y) {
  if (!floatingIcon || floatingIcon.isDestroyed()) return;
  cancelFloatAnimation();
  const [startX, startY] = floatingIcon.getPosition();
  if (startX === x && startY === y) return;
  const started = Date.now();
  const duration = 150;
  floatAnimTimer = setInterval(() => {
    if (!floatingIcon || floatingIcon.isDestroyed()) {
      cancelFloatAnimation();
      return;
    }
    const progress = Math.min(1, (Date.now() - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    floatingIcon.setPosition(
      Math.round(startX + (x - startX) * eased),
      Math.round(startY + (y - startY) * eased),
      false
    );
    if (progress >= 1) cancelFloatAnimation();
  }, 16);
}

function floatPanelEdgeSide() {
  return floatState && (floatState.docked === 'left' || floatState.docked === 'right')
    ? floatState.docked
    : null;
}

function sendFloatEdge(animate) {
  if (!floatPanel || floatPanel.isDestroyed()) return;
  floatPanel.webContents.send('sr:float-edge', {
    side: floatPanelEdgeSide(),
    animate: Boolean(animate)
  });
}

function createFloatPanel() {
  if (floatPanel && !floatPanel.isDestroyed()) return floatPanel;
  floatPanel = new BrowserWindow({
    width: FLOAT_PANEL_SIZE.width,
    height: FLOAT_PANEL_SIZE.height,
    show: false,
    frame: false,
    roundedCorners: true,
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    acceptFirstMouse: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101114' : '#F4F5F8',
    title: 'Study Register',
    webPreferences: secureWebPreferences()
  });

  hardenWindow(floatPanel);
  floatPanel.loadFile(path.join(SRC_DIR, 'dashboard.html'), { query: { compact: '1' } });
  floatPanel.setAlwaysOnTop(true, 'floating');
  floatPanel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  floatPanel.webContents.on('did-finish-load', () => {
    sendFloatEdge();
  });

  floatPanel.on('blur', () => {
    setTimeout(() => {
      if (!floatPanel || floatPanel.isDestroyed()) return;
      if (modalDepth > 0 || floatPanel.webContents.isDevToolsOpened()) return;
      if (floatPanel.isVisible() && !floatPanel.isFocused()) floatPanel.hide();
    }, 140);
  });

  floatPanel.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      floatPanel.hide();
    }
  });
  floatPanel.on('closed', () => {
    floatPanel = null;
  });
  return floatPanel;
}

function positionFloatPanel() {
  if (!floatPanel || floatPanel.isDestroyed()) return;
  const hasIcon = floatingIcon && !floatingIcon.isDestroyed();
  const icon = hasIcon ? floatingIcon.getBounds() : null;
  const side = floatPanelEdgeSide();
  const area = side && floatState
    ? displayAreaForPoint(floatState.x + FLOAT_SIZE / 2, floatState.y + FLOAT_SIZE / 2)
    : icon
      ? screen.getDisplayMatching(icon).workArea
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

  if (side) {
    const width = Math.min(FLOAT_EDGE_PANEL_WIDTH, area.width);
    const x = side === 'right' ? area.x + area.width - width : area.x;
    floatPanel.setBounds({ x, y: area.y, width, height: area.height });
    sendFloatEdge();
    return;
  }

  const width = FLOAT_PANEL_SIZE.width;
  const height = Math.max(320, Math.min(FLOAT_PANEL_SIZE.height, area.height - 16));
  floatPanel.setSize(width, height, false);

  let x;
  if (icon && icon.x + icon.width / 2 < area.x + area.width / 2) x = icon.x + icon.width + 12;
  else if (icon) x = icon.x - width - 12;
  else x = area.x + area.width - width - 12;
  x = Math.round(floatLayout.clamp(x, area.x + 8, Math.max(area.x + 8, area.x + area.width - width - 8)));

  const anchorY = icon ? icon.y + icon.height / 2 - height / 2 : area.y + 60;
  const y = Math.round(floatLayout.clamp(anchorY, area.y + 8, Math.max(area.y + 8, area.y + area.height - height - 8)));
  floatPanel.setPosition(x, y, false);
  sendFloatEdge();
}

function fadeInFloatPanel() {
  if (!floatPanel || floatPanel.isDestroyed()) return;
  if (floatFadeTimer) clearInterval(floatFadeTimer);
  floatPanel.setOpacity(0);
  let opacity = 0;
  floatFadeTimer = setInterval(() => {
    if (!floatPanel || floatPanel.isDestroyed()) {
      if (floatFadeTimer) clearInterval(floatFadeTimer);
      floatFadeTimer = null;
      return;
    }
    opacity = Math.min(1, opacity + 0.18);
    floatPanel.setOpacity(opacity);
    if (opacity >= 1) {
      clearInterval(floatFadeTimer);
      floatFadeTimer = null;
    }
  }, 16);
}

function raiseFloatingIcon() {
  if (!floatingIcon || floatingIcon.isDestroyed()) return;
  floatingIcon.setAlwaysOnTop(true, 'pop-up-menu');
  floatingIcon.moveTop();
}

function lowerFloatingIcon() {
  if (!floatingIcon || floatingIcon.isDestroyed()) return;
  floatingIcon.setAlwaysOnTop(true, 'floating');
}

function openFloatPanel() {
  createFloatPanel();
  if (floatPanel.isMinimized()) floatPanel.restore();
  cancelFloatTuck();
  positionFloatPanel();
  hidePopover();
  hideRoutineWindow();
  if (dashboard && !dashboard.isDestroyed() && dashboard.isVisible()) dashboard.hide();
  fadeInFloatPanel();
  floatPanel.show();
  floatPanel.focus();
  if (floatPanelEdgeSide()) {
    raiseFloatingIcon();
    expandFloatIcon('rail');
  } else {
    lowerFloatingIcon();
  }
  sendFloatEdge(true);
  floatPanel.webContents.send('sr:state-changed', snapshot());
}

function hideFloatPanel() {
  if (floatFadeTimer) {
    clearInterval(floatFadeTimer);
    floatFadeTimer = null;
  }
  if (floatPanel && !floatPanel.isDestroyed()) floatPanel.hide();
  lowerFloatingIcon();
  if (floatCanTuck()) scheduleFloatTuck();
}

function keepFloatVisible() {
  if (!floatingIcon || floatingIcon.isDestroyed() || !floatState || floatDrag) return;
  const area = displayAreaForPoint(floatState.x + FLOAT_SIZE / 2, floatState.y + FLOAT_SIZE / 2);
  const placement = floatLayout.restorePlacement(floatState, FLOAT_SIZE, area, {
    margin: FLOAT_DOCK_MARGIN
  });
  floatState = { x: placement.x, y: placement.y, docked: placement.docked };
  saveFloatState();
  sendFloatState();
  cancelFloatTuck();
  if (floatCanTuck()) {
    if (floatPanelVisible()) floatMoveTo('rail', true);
    else if (floatHovering) floatMoveTo('flush', true);
    else floatMoveTo('tuck', true);
  } else {
    floatTucked = false;
    floatingIcon.setPosition(placement.x, placement.y, false);
  }
  if (floatPanelVisible()) positionFloatPanel();
}

function scheduleFloatBoundsCheck() {
  if (floatScreenTimer) clearTimeout(floatScreenTimer);
  floatScreenTimer = setTimeout(() => {
    floatScreenTimer = null;
    keepFloatVisible();
  }, 180);
}


function openRoutine(tab) {
  pendingRoutineTab = ['today', 'timetable', 'weekly', 'analytics', 'notifications'].includes(tab) ? tab : 'today';
  const win = createRoutineWindow();
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [width, height] = win.getSize();
  if (!win.isVisible()) {
    win.setPosition(
      Math.round(area.x + (area.width - width) / 2),
      Math.round(area.y + (area.height - height) / 2),
      false
    );
  }
  hidePopover();
  if (dashboard && !dashboard.isDestroyed()) dashboard.hide();
  hideFloatPanel();
  win.show();
  win.focus();
  win.webContents.send('sr:state-changed', snapshot());
  win.webContents.send('sr:routine-tab', { tab: pendingRoutineTab });
}

function applyTheme() {
  nativeTheme.themeSource = data ? data.settings.appearance : 'system';
  const dark = nativeTheme.shouldUseDarkColors;
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.setBackgroundColor(dark ? '#101114' : '#F4F5F8');
  }
  if (routineWindow && !routineWindow.isDestroyed()) {
    routineWindow.setBackgroundColor(dark ? '#101114' : '#F4F5F8');
  }
  if (floatPanel && !floatPanel.isDestroyed()) {
    floatPanel.setBackgroundColor(dark ? '#101114' : '#F4F5F8');
  }
}

/* ------------------------------------------------------------------ */
/* Tray                                                                */
/* ------------------------------------------------------------------ */

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Study Register', click: () => showPopover() },
    { label: 'Open My Routine', click: () => openRoutine('today') },
    { label: 'Open Dashboard', click: () => openDashboard() },
    { type: 'separator' },
    { label: 'Quit Study Register', accelerator: 'Command+Q', registerAccelerator: false, click: () => app.quit() }
  ]);
}

function updateTrayClock() {
  if (!tray || tray.isDestroyed()) return;
  const active = data && data.activeSession;
  if (!active) {
    if (trayTimer) {
      clearInterval(trayTimer);
      trayTimer = null;
    }
    if (tray.getTitle()) tray.setTitle('');
    tray.setToolTip('Study Register');
    return;
  }
  const entry = new Date(active.entry).getTime();
  const elapsed = Number.isFinite(entry) ? Math.max(0, Date.now() - entry) : 0;
  const text = core.formatTimer(elapsed);
  tray.setTitle(text, { fontType: 'monospacedDigit' });
  tray.setToolTip((active.subjectName ? active.subjectName + ' · ' : '') + text + ' · running');
  if (!trayTimer) trayTimer = setInterval(updateTrayClock, 1000);
}

function createTray() {
  const iconPath = path.join(SRC_DIR, 'assets', 'icons', 'trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) console.warn('[tray] Template icon missing at ' + iconPath);
  tray = new Tray(icon);
  tray.setToolTip('Study Register');
  tray.setIgnoreDoubleClickEvents(true);
  tray.on('click', togglePopover);
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
  updateTrayClock();
}

function createAppMenu() {
  const template = [
    {
      label: 'Study Register',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Open Study Register', accelerator: 'Command+Shift+R', click: () => showPopover() },
        { label: 'Open My Routine', accelerator: 'Command+Shift+M', click: () => openRoutine('today') },
        { label: 'Open Dashboard', accelerator: 'Command+D', click: () => openDashboard() },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

function notify(title, body) {
  if (!data.settings.notifications.enabled || !Notification.isSupported()) return;
  try {
    const notification = new Notification({ title, body, silent: false });
    notification.on('click', () => showPopover());
    notification.show();
  } catch (error) {
    console.error('[notify]', error.message);
  }
}

function notifySessionStart(subjectName) {
  if (!data.settings.notifications.onStart) return;
  notify('Study session started', subjectName + ' · the clock is running.');
}

function notifySessionEnd(subjectName, durationMs) {
  if (!data.settings.notifications.onEnd) return;
  notify('Session recorded', subjectName + ' · ' + core.formatDurationLong(durationMs) + '.');
}

function notifyTargetReached(totalMs) {
  if (!data.settings.notifications.onTarget) return;
  notify('Daily study target reached', core.formatDuration(totalMs) + ' studied today. Well done.');
}

/* ------------------------------------------------------------------ */
/* My Routine notifications and scheduler                              */
/* ------------------------------------------------------------------ */

function markNotificationPermission(status) {
  if (!status) return;
  const changed = notificationPermission.status !== status;
  notificationPermission.status = status;
  notificationPermission.checkedAt = new Date().toISOString();
  if (changed) broadcast();
}

function routineSubjectForItem(item) {
  const direct = data.subjects.find((subject) => subject.id === item.subjectId);
  if (direct) return direct;
  const title = String(item.slotTitle || '').toLowerCase();
  const byTitle = title ? data.subjects.find((subject) => subject.name.toLowerCase() === title) : null;
  if (byTitle) return byTitle;
  const type = core.activityType(item.slotType || 'other');
  const byType = data.subjects.find((subject) => subject.id === type.id || subject.name.toLowerCase() === type.label.toLowerCase());
  if (byType) return byType;
  return data.subjects.find((subject) => subject.id === data.settings.defaultSubjectId) || data.subjects[0] || null;
}

function focusPopoverItem(payload) {
  pendingRoutineFocus = payload;
  showPopover();
  if (popover && !popover.isDestroyed() && !popover.webContents.isLoading()) {
    popover.webContents.send('sr:routine-focus', payload);
    pendingRoutineFocus = null;
  }
}

function beginSessionForSubject(subject, routineMeta, sendStartNotification) {
  if (!subject) throw new Error('Choose a subject before starting.');
  if (data.activeSession) throw new Error('A session is already running.');
  data.activeSession = {
    id: core.slugId('active'),
    subjectId: subject.id,
    subjectName: subject.name,
    entry: new Date().toISOString(),
    routineSlotId: routineMeta ? routineMeta.slotId : null,
    routineDate: routineMeta ? routineMeta.date : null,
    routineTitle: routineMeta ? routineMeta.title : null
  };
  saveData();
  updateTrayClock();
  if (sendStartNotification) notifySessionStart(subject.name);
  broadcast();
  return data.activeSession;
}

function startSessionFromRoutine(item) {
  if (data.activeSession) {
    focusPopoverItem({
      subjectId: data.activeSession.subjectId,
      slotId: item.slotId,
      date: item.date,
      title: item.slotTitle,
      alreadyActive: true
    });
    return;
  }
  const subject = routineSubjectForItem(item);
  if (!subject) {
    showPopover();
    return;
  }
  const routineMeta = item.kind === 'missed' || item.kind === 'end'
    ? null
    : { slotId: item.slotId, date: item.date, title: item.slotTitle };
  beginSessionForSubject(subject, routineMeta, false);
  focusPopoverItem({
    subjectId: subject.id,
    slotId: item.slotId,
    date: item.date,
    title: item.slotTitle,
    alreadyActive: false
  });
  tickRoutineNotifications();
}

function reminderStillRelevant(item) {
  if (!data || !data.routine || !item) return false;
  if (data.activeSession) return false;
  const now = new Date();
  const summary = core.routineDaySummary(data.routine, item.date, data.sessions, data.activeSession, now);
  if (!summary || summary.holiday) return false;
  const slot = summary.slots.find((entry) => entry.id === item.slotId && entry.planDate === item.date);
  if (!slot) return false;
  if (slot.completion && slot.completion.status === 'skipped') return false;
  if (slot.actualMs > 0) return false;
  if ((item.kind === 'start' || item.kind === 'upcoming') && slot.endAt <= now.getTime()) return false;
  return true;
}

function snoozedReminder(item) {
  const now = new Date();
  const startAt = new Date(item.fireAt).getTime() + (Number(item.offsetMinutes) || 0) * 60000;
  if (!Number.isFinite(startAt)) {
    return Object.assign({}, item, { key: item.key + ':snooze:' + now.getTime() });
  }
  const remaining = Math.ceil((startAt - now.getTime()) / 60000);
  const start = new Date(startAt);
  const clock = core.formatClock(core.minuteString(start.getHours() * 60 + start.getMinutes()));
  let title = item.title;
  let body = item.body;
  if (item.kind === 'start' || item.kind === 'upcoming') {
    if (remaining <= 0) {
      title = item.study ? 'Time to Study – ' + item.slotTitle : item.slotTitle + ' starts now';
      body = item.study
        ? 'Your scheduled ' + item.slotTitle + ' session starts now. Open Study Register and mark your Entry.'
        : 'Your scheduled ' + item.slotTitle.toLowerCase() + ' starts now at ' + clock + '.';
    } else {
      title = 'Up next – ' + item.slotTitle;
      body = item.slotTitle + ' starts in ' + remaining + ' minutes at ' + clock + '.';
    }
  }
  return Object.assign({}, item, { key: item.key + ':snooze:' + now.getTime(), title, body });
}

function snoozeRoutineNotification(item) {
  const timer = setTimeout(() => {
    snoozeTimers.delete(timer);
    if (!reminderStillRelevant(item)) return;
    showRoutineNotification(snoozedReminder(item));
  }, 5 * 60000);
  snoozeTimers.add(timer);
}

function routineActionList(item) {
  const actions = [];
  if (item.study && item.kind !== 'end') actions.push({ id: 'start', text: 'Start Session' });
  if (item.kind !== 'end') actions.push({ id: 'snooze', text: 'Snooze 5 Minutes' });
  actions.push({ id: 'dismiss', text: 'Dismiss' });
  return actions;
}

function showRoutineNotification(item) {
  if (!Notification.isSupported()) return false;
  const actionList = routineActionList(item);
  let notification;
  try {
    notification = new Notification({
      id: item.key,
      groupId: 'study-routine',
      title: item.title,
      subtitle: 'My Routine',
      body: item.body,
      actions: actionList.map((action) => ({ type: 'button', text: action.text })),
      closeButtonText: 'Dismiss'
    });
  } catch (error) {
    console.error('[routine-notify]', error.message);
    return false;
  }
  liveNotifications.add(notification);
  let settled = false;
  const release = () => {
    if (settled) return;
    settled = true;
    liveNotifications.delete(notification);
  };
  notification.on('show', () => markNotificationPermission('granted'));
  notification.on('failed', (_event, error) => {
    markNotificationPermission('denied');
    release();
    console.error('[routine-notify] Delivery failed:', error || 'permission denied');
  });
  notification.on('close', release);
  notification.on('click', () => {
    release();
    openRoutine('today');
  });
  notification.on('action', (details, legacyIndex) => {
    release();
    const index = details && Number.isFinite(details.actionIndex) ? details.actionIndex : legacyIndex;
    const action = actionList[index];
    if (!action) return;
    if (action.id === 'start') startSessionFromRoutine(item);
    else if (action.id === 'snooze') snoozeRoutineNotification(item);
  });
  try {
    notification.show();
  } catch (error) {
    release();
    markNotificationPermission('denied');
    console.error('[routine-notify]', error.message);
    return false;
  }
  return true;
}

function tickRoutineNotifications() {
  if (!data || !data.routine) return;
  const now = new Date();
  const todayKey = core.dateKey(now);
  const previousPlan = data.routine.dayPlans[todayKey] || null;
  core.refreshDayPlans(data.routine, now);
  core.ensureDayPlan(data.routine, now, now);
  let changed = (data.routine.dayPlans[todayKey] || null) !== previousPlan;

  const due = core.dueNotifications(data.routine, data.sessions, data.activeSession, now);
  if (due.length) {
    due.forEach((item) => {
      showRoutineNotification(item);
      data.routine.notifyLog.push({
        key: item.key,
        kind: item.kind,
        sentAt: new Date().toISOString(),
        date: item.date,
        slotId: item.slotId
      });
    });
    if (data.routine.notifyLog.length > 500) data.routine.notifyLog = data.routine.notifyLog.slice(-500);
    changed = true;
  }

  if (changed) {
    saveData();
    broadcast();
  }
  armRoutineScheduler();
}

function armRoutineScheduler() {
  if (precisionTimer) clearTimeout(precisionTimer);
  precisionTimer = null;
  if (!data || !data.routine || !schedulerTimer) return;
  const now = new Date();
  const next = core.nextNotificationAt(data.routine, now);
  const delay = next ? Math.max(500, Math.min(next - now.getTime(), 5 * 60000)) : 5 * 60000;
  precisionTimer = setTimeout(() => {
    precisionTimer = null;
    tickRoutineNotifications();
  }, delay);
}

function startRoutineScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (precisionTimer) clearTimeout(precisionTimer);
  precisionTimer = null;
  schedulerTimer = setInterval(tickRoutineNotifications, 60000);
  tickRoutineNotifications();
  powerMonitor.on('resume', () => tickRoutineNotifications());
  powerMonitor.on('unlock-screen', () => tickRoutineNotifications());
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function isTrustedSender(event) {
  const sender = event.sender;
  if (!sender) return false;
  const window = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.id === sender.id);
  if (!window) return false;
  const frame = event.senderFrame;
  const url = (frame && frame.url) || sender.getURL();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    return decodeURIComponent(parsed.pathname).startsWith(SRC_DIR + path.sep);
  } catch (error) {
    return false;
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      if (!isTrustedSender(event)) return { ok: false, error: 'Request rejected.' };
      return await fn(payload && typeof payload === 'object' ? payload : {}, event);
    } catch (error) {
      const message = error && error.message ? error.message : 'Something went wrong.';
      console.error('[ipc] ' + channel + ': ' + message);
      return { ok: false, error: message };
    }
  });
}

async function withModalDialog(fn) {
  modalDepth += 1;
  try {
    return await fn();
  } finally {
    modalDepth = Math.max(0, modalDepth - 1);
  }
}

function activeDialogWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) return focused;
  if (dashboard && !dashboard.isDestroyed() && dashboard.isVisible()) return dashboard;
  return popover && !popover.isDestroyed() ? popover : undefined;
}

function findRoutineOrThrow(id) {
  const routine = data.routine.routines.find((item) => item.id === id);
  if (!routine) throw new Error('That routine no longer exists.');
  return routine;
}

function assertWeekday(value) {
  if (!core.WEEKDAY_IDS.includes(value)) throw new Error('Choose a valid weekday.');
  return value;
}

function allRoutineSlots() {
  const list = [];
  data.routine.routines.forEach((routine) => {
    core.WEEKDAY_IDS.forEach((day) => {
      (routine.days[day] || []).forEach((slot) => list.push(slot));
    });
  });
  data.routine.exceptions.forEach((exception) => {
    (exception.slots || []).forEach((slot) => list.push(slot));
  });
  return list;
}

function prepareRoutineSlot(raw, seen) {
  if (!raw || typeof raw !== 'object') throw new Error('That activity is invalid.');
  if (core.clockMinutes(raw.start) == null || core.clockMinutes(raw.end) == null) {
    throw new Error('Enter a valid start and end time.');
  }
  if (raw.start === raw.end) throw new Error('End time must be different from the start time.');
  if (raw.type !== undefined && !core.ACTIVITY_TYPES.some((item) => item.id === raw.type)) {
    throw new Error('Choose a valid activity type.');
  }
  if (raw.subjectId && !data.subjects.some((subject) => subject.id === raw.subjectId)) {
    throw new Error('Choose a valid subject.');
  }
  return core.normalizeRoutineSlot(raw, data.subjects, seen || new Set(), 'other');
}

function routineMetaFromPayload(payload) {
  if (!payload.routineSlotId || !payload.routineDate) return null;
  const date = String(payload.routineDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !core.dateFromKey(date)) return null;
  const plan = core.planForDate(data.routine, date);
  if (!plan || plan.holiday) return null;
  const slot = plan.slots.find((item) => item.id === payload.routineSlotId);
  if (!slot) return null;
  return { slotId: slot.id, date, title: slot.title };
}

function validateNotificationTimings(raw) {
  if (!Array.isArray(raw)) throw new Error('Choose valid reminder timings.');
  const timings = raw.map((value) => Number(value));
  if (timings.some((value) => !core.NOTIFICATION_OFFSETS.includes(value))) {
    throw new Error('Choose reminder timings from the available options.');
  }
  return Array.from(new Set(timings)).sort((a, b) => a - b);
}

function validateNotificationPrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid reminder preferences.');
  const out = {};
  Object.entries(raw).slice(0, 500).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid reminder preferences.');
    const id = String(key).slice(0, 80);
    if (!id) throw new Error('Invalid reminder preferences.');
    out[id] = {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : null,
      timings: value.timings === null || value.timings === undefined ? null : validateNotificationTimings(value.timings)
    };
  });
  return out;
}

function commitRoutine(invalidatePlans) {
  const now = new Date();
  core.refreshDayPlans(data.routine, now);
  if (invalidatePlans) core.invalidateDayPlans(data.routine, now);
  core.ensureDayPlan(data.routine, now, now);
  saveData();
  broadcast();
  tickRoutineNotifications();
}

function registerIpc() {
  handle('sr:get-state', () => okState());
  handle('sr:open-routine', (payload) => {
    openRoutine(payload.tab);
    return { ok: true };
  });

  handle('sr:start-session', (payload) => {
    if (data.activeSession) throw new Error('A session is already running.');
    const subject = data.subjects.find((item) => item.id === payload.subjectId);
    if (!subject) throw new Error('Choose a subject before starting.');
    beginSessionForSubject(subject, routineMetaFromPayload(payload), true);
    tickRoutineNotifications();
    return okState();
  });

  handle('sr:end-session', () => {
    const active = data.activeSession;
    if (!active) throw new Error('There is no active session to exit.');
    const now = new Date();
    const entry = new Date(active.entry);
    const safeEntry = entry < now ? entry : now;
    let session = {
      id: core.slugId('session'),
      subjectId: active.subjectId,
      subjectName: active.subjectName,
      entry: safeEntry.toISOString(),
      exit: now.toISOString(),
      createdAt: new Date().toISOString(),
      routineSlotId: active.routineSlotId || null,
      routineDate: active.routineDate || null,
      routineTitle: active.routineTitle || null
    };
    core.ensureDayPlan(data.routine, now, now);
    if (!session.routineSlotId) session = core.linkSessionToRoutine(data.routine, session, now);
    const before = core.totalForDate(data.sessions, core.dateKey(now));
    data.sessions.push(session);
    data.sessions.sort((a, b) => new Date(a.entry) - new Date(b.entry));
    data.activeSession = null;
    saveData();
    updateTrayClock();
    tickRoutineNotifications();
    notifySessionEnd(session.subjectName, core.sessionDuration(session));
    const targetMs = data.settings.dailyTargetMinutes * 60000;
    const after = core.totalForDate(data.sessions, core.dateKey(now));
    if (after >= targetMs && before < targetMs) notifyTargetReached(after);
    broadcast();
    return okState({ completed: session });
  });

  handle('sr:discard-session', () => {
    if (!data.activeSession) throw new Error('There is no active session.');
    data.activeSession = null;
    saveData();
    updateTrayClock();
    broadcast();
    return okState();
  });

  handle('sr:update-session', (payload) => {
    const session = data.sessions.find((item) => item.id === payload.id);
    if (!session) throw new Error('That session no longer exists.');
    const entry = new Date(payload.entry);
    const exit = new Date(payload.exit);
    if (Number.isNaN(entry.getTime()) || Number.isNaN(exit.getTime())) throw new Error('Enter valid entry and exit times.');
    if (exit.getTime() <= entry.getTime()) throw new Error('Exit time must be after entry time.');
    const subject = data.subjects.find((item) => item.id === payload.subjectId);
    if (!subject) throw new Error('Choose a valid subject.');
    session.entry = entry.toISOString();
    session.exit = exit.toISOString();
    session.subjectId = subject.id;
    session.subjectName = subject.name;
    data.sessions.sort((a, b) => new Date(a.entry) - new Date(b.entry));
    saveData();
    broadcast();
    return okState();
  });

  handle('sr:delete-session', (payload) => {
    const index = data.sessions.findIndex((item) => item.id === payload.id);
    if (index === -1) throw new Error('That session no longer exists.');
    data.sessions.splice(index, 1);
    saveData();
    broadcast();
    return okState();
  });

  handle('sr:add-subject', (payload) => {
    const name = core.sanitizeSubjectName(payload.name);
    if (!name) throw new Error('Give the subject a name.');
    if (data.subjects.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('That subject already exists.');
    }
    if (data.subjects.length >= 24) throw new Error('You can have up to 24 subjects.');
    const subject = {
      id: core.slugId('subject'),
      name,
      color: core.COLOR_PALETTE[data.subjects.length % core.COLOR_PALETTE.length]
    };
    data.subjects.push(subject);
    saveData();
    broadcast();
    return okState({ subject });
  });

  handle('sr:rename-subject', (payload) => {
    const subject = data.subjects.find((item) => item.id === payload.id);
    if (!subject) throw new Error('That subject no longer exists.');
    const name = core.sanitizeSubjectName(payload.name);
    if (!name) throw new Error('Give the subject a name.');
    if (data.subjects.some((item) => item.id !== subject.id && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Another subject already uses that name.');
    }
    const previous = subject.name;
    subject.name = name;
    data.sessions.forEach((session) => {
      if (session.subjectId === subject.id) session.subjectName = name;
    });
    if (data.activeSession && data.activeSession.subjectId === subject.id) data.activeSession.subjectName = name;
    saveData();
    broadcast();
    return okState({ renamedFrom: previous });
  });

  handle('sr:remove-subject', (payload) => {
    if (data.subjects.length <= 1) throw new Error('Keep at least one subject.');
    const index = data.subjects.findIndex((item) => item.id === payload.id);
    if (index === -1) throw new Error('That subject no longer exists.');
    if (data.activeSession && data.activeSession.subjectId === payload.id) {
      throw new Error('Exit the running session before removing its subject.');
    }
    data.subjects.splice(index, 1);
    if (data.settings.defaultSubjectId === payload.id) {
      data.settings.defaultSubjectId = data.subjects[0].id;
    }
    data.routine.routines.forEach((routine) => {
      core.WEEKDAY_IDS.forEach((day) => {
        (routine.days[day] || []).forEach((slot) => {
          if (slot.subjectId === payload.id) slot.subjectId = null;
        });
      });
    });
    data.routine.exceptions.forEach((exception) => {
      (exception.slots || []).forEach((slot) => {
        if (slot.subjectId === payload.id) slot.subjectId = null;
      });
    });
    delete data.routine.notifications.subjects[payload.id];
    saveData();
    broadcast();
    return okState();
  });

  handle('sr:update-settings', (payload) => {
    const next = JSON.parse(JSON.stringify(data.settings));
    if (payload.dailyTargetMinutes !== undefined) {
      const minutes = Number(payload.dailyTargetMinutes);
      if (!Number.isFinite(minutes)) throw new Error('Enter a valid daily target.');
      next.dailyTargetMinutes = core.clamp(Math.round(minutes), 15, 1440);
    }
    if (payload.defaultSubjectId !== undefined) {
      if (!data.subjects.some((item) => item.id === payload.defaultSubjectId)) throw new Error('Choose a valid default subject.');
      next.defaultSubjectId = payload.defaultSubjectId;
    }
    if (payload.appearance !== undefined) {
      if (!['dark', 'light', 'system'].includes(payload.appearance)) throw new Error('Choose a valid appearance.');
      next.appearance = payload.appearance;
    }
    if (payload.notifications !== undefined) {
      if (typeof payload.notifications !== 'object' || payload.notifications === null) throw new Error('Invalid notification settings.');
      ['enabled', 'onStart', 'onEnd', 'onTarget'].forEach((key) => {
        if (payload.notifications[key] !== undefined) next.notifications[key] = Boolean(payload.notifications[key]);
      });
    }
    data.settings = core.normalizeSettings(next, data.subjects);
    applyTheme();
    saveData();
    broadcast();
    return okState();
  });

  handle('sr:routine-save-routine', (payload) => {
    const name = core.sanitizeRoutineText(payload.name, 48);
    if (!name) throw new Error('Give the routine a name.');
    if (data.routine.routines.some((routine) => routine.id !== payload.id && routine.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Another routine already uses that name.');
    }
    let routine;
    if (payload.id) {
      routine = findRoutineOrThrow(payload.id);
      routine.name = name;
    } else {
      if (data.routine.routines.length >= 12) throw new Error('You can have up to 12 routines.');
      routine = { id: core.slugId('routine'), name, isDefault: false, days: {} };
      core.WEEKDAY_IDS.forEach((day) => { routine.days[day] = []; });
      data.routine.routines.push(routine);
    }
    commitRoutine(true);
    return okState({ routineId: routine.id });
  });

  handle('sr:routine-delete-routine', (payload) => {
    if (data.routine.routines.length <= 1) throw new Error('Keep at least one routine.');
    const index = data.routine.routines.findIndex((routine) => routine.id === payload.id);
    if (index === -1) throw new Error('That routine no longer exists.');
    const [removed] = data.routine.routines.splice(index, 1);
    core.WEEKDAY_IDS.forEach((day) => {
      if (data.routine.schedule[day] === removed.id) data.routine.schedule[day] = null;
    });
    core.WEEKDAY_IDS.forEach((day) => {
      (removed.days[day] || []).forEach((slot) => {
        delete data.routine.notifications.activities[slot.id];
      });
    });
    if (data.routine.defaultRoutineId === removed.id) {
      const next = data.routine.routines[0];
      next.isDefault = true;
      data.routine.defaultRoutineId = next.id;
    }
    commitRoutine(true);
    return okState();
  });

  handle('sr:routine-set-default', (payload) => {
    const routine = findRoutineOrThrow(payload.id);
    data.routine.routines.forEach((item) => { item.isDefault = item.id === routine.id; });
    data.routine.defaultRoutineId = routine.id;
    commitRoutine(true);
    return okState();
  });

  handle('sr:routine-set-day', (payload) => {
    const weekday = assertWeekday(payload.weekday);
    data.routine.schedule[weekday] = payload.routineId ? findRoutineOrThrow(payload.routineId).id : null;
    commitRoutine(true);
    return okState();
  });

  handle('sr:routine-save-slot', (payload) => {
    const routine = findRoutineOrThrow(payload.routineId);
    const weekday = assertWeekday(payload.weekday);
    const raw = payload.slot && typeof payload.slot === 'object' ? payload.slot : null;
    if (!raw) throw new Error('That activity is invalid.');
    const list = routine.days[weekday] || (routine.days[weekday] = []);
    const existingIndex = raw.id ? list.findIndex((item) => item.id === raw.id) : -1;
    if (raw.id && existingIndex === -1) throw new Error('That activity is not on this day.');
    const slot = prepareRoutineSlot(raw);
    if (existingIndex === -1 && allRoutineSlots().some((item) => item.id === slot.id)) {
      slot.id = core.slugId('slot');
    }
    const candidate = list.filter((item) => item.id !== slot.id).concat(slot);
    const testRoutine = Object.assign({}, routine, {
      days: Object.assign({}, routine.days, { [weekday]: candidate })
    });
    const conflicts = core.findRoutineConflicts(testRoutine)
      .filter((pair) => pair.a.id === slot.id || pair.b.id === slot.id);
    if (conflicts.length && payload.allowOverlap !== true) {
      const pair = conflicts[0];
      const other = pair.a.id === slot.id ? pair.b : pair.a;
      const dayLabel = (core.WEEKDAYS.find((day) => day.id === other.day) || {}).label || other.day;
      const startText = core.formatClock(core.minuteString(other.start));
      const endText = core.formatClock(core.minuteString(other.end)) + (other.overnight ? ' next day' : '');
      throw new Error('Overlap: “' + other.title + '” already runs ' + startText + ' – ' + endText +
        ' on ' + dayLabel + '. Adjust this time or save with overlap.');
    }
    if (existingIndex === -1) list.push(slot);
    else list.splice(existingIndex, 1, slot);
    list.sort((a, b) => core.clockMinutes(a.start) - core.clockMinutes(b.start) || core.clockMinutes(a.end) - core.clockMinutes(b.end));
    commitRoutine(true);
    return okState({ slot });
  });

  handle('sr:routine-delete-slot', (payload) => {
    const routine = findRoutineOrThrow(payload.routineId);
    const weekday = assertWeekday(payload.weekday);
    const list = routine.days[weekday] || [];
    const index = list.findIndex((item) => item.id === payload.slotId);
    if (index === -1) throw new Error('That activity no longer exists.');
    const [removed] = list.splice(index, 1);
    delete data.routine.notifications.activities[removed.id];
    commitRoutine(true);
    return okState();
  });

  handle('sr:routine-clear-day', (payload) => {
    const routine = findRoutineOrThrow(payload.routineId);
    const weekday = assertWeekday(payload.weekday);
    const list = routine.days[weekday] || [];
    if (!list.length) return okState({ removed: 0 });
    list.forEach((slot) => {
      delete data.routine.notifications.activities[slot.id];
    });
    routine.days[weekday] = [];
    commitRoutine(true);
    return okState({ removed: list.length });
  });

  handle('sr:routine-copy-day', (payload) => {
    const routine = findRoutineOrThrow(payload.routineId);
    const sourceDay = assertWeekday(payload.sourceDay);
    const source = routine.days[sourceDay] || [];
    const sourceLabel = (core.WEEKDAYS.find((day) => day.id === sourceDay) || {}).label || sourceDay;
    if (!source.length) throw new Error('Add at least one activity to ' + sourceLabel + ' before copying it.');
    const targets = Array.from(new Set((Array.isArray(payload.targetDays) ? payload.targetDays : [])
      .filter((day) => core.WEEKDAY_IDS.includes(day) && day !== sourceDay)));
    if (!targets.length) throw new Error('Choose at least one other day.');
    const usedIds = new Set(allRoutineSlots().map((slot) => slot.id));
    const nextDays = Object.assign({}, routine.days);
    const copies = [];
    targets.forEach((day) => {
      const clones = core.cloneRoutineSlots(source, usedIds);
      nextDays[day] = clones;
      clones.forEach((copy, index) => copies.push({ day, copy, sourceId: source[index].id }));
    });
    const copyIds = new Set(copies.map((item) => item.copy.id));
    const conflicts = core.findRoutineConflicts(Object.assign({}, routine, { days: nextDays }))
      .filter((pair) => copyIds.has(pair.a.id) || copyIds.has(pair.b.id));
    if (conflicts.length && payload.allowOverlap !== true) {
      const pair = conflicts[0];
      const copied = copyIds.has(pair.a.id) ? pair.a : pair.b;
      const other = copyIds.has(pair.a.id) ? pair.b : pair.a;
      const otherLabel = (core.WEEKDAYS.find((day) => day.id === other.day) || {}).label || other.day;
      throw new Error('Overlap on ' + otherLabel + ': “' + copied.title + '” shares time with “' + other.title +
        '”. Adjust the template times or copy anyway.');
    }
    targets.forEach((day) => {
      (routine.days[day] || []).forEach((slot) => {
        delete data.routine.notifications.activities[slot.id];
      });
    });
    copies.forEach((item) => {
      const pref = data.routine.notifications.activities[item.sourceId];
      if (pref) data.routine.notifications.activities[item.copy.id] = JSON.parse(JSON.stringify(pref));
    });
    targets.forEach((day) => { routine.days[day] = nextDays[day]; });
    const assigned = payload.assignDays !== false;
    if (assigned) targets.forEach((day) => { data.routine.schedule[day] = routine.id; });
    commitRoutine(true);
    return okState({ days: targets, activities: source.length, assigned });
  });

  handle('sr:routine-save-exception', (payload) => {
    const raw = payload.exception && typeof payload.exception === 'object' ? payload.exception : payload;
    const date = String(raw.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !core.dateFromKey(date)) throw new Error('Choose a valid date.');
    if (raw.kind !== 'holiday' && raw.kind !== 'custom') throw new Error('Choose a valid exception type.');
    const kind = raw.kind;
    const label = core.sanitizeRoutineText(raw.label, 48) || (kind === 'holiday' ? 'Holiday' : 'Custom day');
    let slots = [];
    if (kind === 'custom') {
      if (!Array.isArray(raw.slots) || !raw.slots.length) throw new Error('Add at least one activity for a custom day.');
      const seen = new Set();
      slots = raw.slots.slice(0, 60)
        .map((item) => prepareRoutineSlot(item, seen))
        .sort((a, b) => core.clockMinutes(a.start) - core.clockMinutes(b.start));
      const conflicts = core.findDayConflicts(slots);
      if (conflicts.length && payload.allowOverlap !== true) {
        const pair = conflicts[0];
        throw new Error('Overlap: “' + pair.a.title + '” and “' + pair.b.title + '” use the same time on this day.');
      }
    }
    const existing = data.routine.exceptions.find((item) => item.date === date);
    if (existing) {
      existing.kind = kind;
      existing.label = label;
      existing.slots = slots;
    } else {
      data.routine.exceptions.push({ id: core.slugId('exception'), date, kind, label, slots });
      data.routine.exceptions.sort((a, b) => a.date.localeCompare(b.date));
      if (data.routine.exceptions.length > 400) data.routine.exceptions = data.routine.exceptions.slice(-400);
    }
    commitRoutine(true);
    return okState({ date });
  });

  handle('sr:routine-delete-exception', (payload) => {
    const index = data.routine.exceptions.findIndex((item) => (
      (payload.id && item.id === payload.id) || (payload.date && item.date === payload.date)
    ));
    if (index === -1) throw new Error('That exception no longer exists.');
    data.routine.exceptions.splice(index, 1);
    commitRoutine(true);
    return okState();
  });

  handle('sr:routine-set-completion', (payload) => {
    const date = String(payload.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !core.dateFromKey(date)) throw new Error('Choose a valid date.');
    const status = payload.status === 'done' || payload.status === 'skipped' ? payload.status : null;
    const plan = data.routine.dayPlans[date] || core.planForDate(data.routine, date);
    if (!plan || plan.holiday) throw new Error('There is no routine on that day.');
    const slot = plan.slots.find((item) => item.id === payload.slotId);
    if (!slot) throw new Error('That routine activity no longer exists.');
    const day = data.routine.completions[date] || (data.routine.completions[date] = {});
    if (status) day[slot.id] = { status, at: new Date().toISOString() };
    else delete day[slot.id];
    if (!Object.keys(day).length) delete data.routine.completions[date];
    commitRoutine(false);
    return okState();
  });

  handle('sr:routine-update-notifications', (payload) => {
    const patch = payload.notifications && typeof payload.notifications === 'object' ? payload.notifications : payload;
    const next = JSON.parse(JSON.stringify(data.routine.notifications));
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) next.enabled = Boolean(patch.enabled);
    if (Object.prototype.hasOwnProperty.call(patch, 'missedReminder')) next.missedReminder = Boolean(patch.missedReminder);
    if (Object.prototype.hasOwnProperty.call(patch, 'completionReminder')) next.completionReminder = Boolean(patch.completionReminder);
    if (Object.prototype.hasOwnProperty.call(patch, 'timings')) next.timings = validateNotificationTimings(patch.timings);
    if (Object.prototype.hasOwnProperty.call(patch, 'subjects')) next.subjects = validateNotificationPrefs(patch.subjects);
    if (Object.prototype.hasOwnProperty.call(patch, 'activities')) next.activities = validateNotificationPrefs(patch.activities);
    const normalized = core.normalizeRoutineData({
      routines: data.routine.routines,
      schedule: data.routine.schedule,
      notifications: next
    }, data.subjects);
    data.routine.notifications = normalized.notifications;
    commitRoutine(false);
    return okState();
  });

  handle('sr:routine-notification-status', () => ({
    ok: true,
    permission: notificationPermissionSnapshot()
  }));

  handle('sr:routine-test-notification', async () => {
    if (!Notification.isSupported()) throw new Error('Notifications are not supported on this system.');
    let notification;
    try {
      notification = new Notification({
        id: 'study-register-test-' + Date.now(),
        title: 'Study Register notifications',
        subtitle: 'My Routine',
        body: 'Routine reminders are ready. You will be notified at your scheduled activities.',
        actions: [{ type: 'button', text: 'Dismiss' }],
        closeButtonText: 'Dismiss'
      });
    } catch (error) {
      throw new Error('Notifications could not be created: ' + error.message);
    }
    liveNotifications.add(notification);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      liveNotifications.delete(notification);
    };
    notification.on('show', () => markNotificationPermission('granted'));
    notification.on('failed', (_event, error) => {
      markNotificationPermission('denied');
      release();
      console.error('[routine-notify] Test notification failed:', error || 'permission denied');
    });
    notification.on('close', release);
    notification.show();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { ok: true, permission: notificationPermissionSnapshot() };
  });

  handle('sr:routine-open-notification-settings', async () => {
    if (process.platform !== 'darwin') {
      throw new Error('Open your system notification settings and allow notifications for Study Register.');
    }
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
    } catch (error) {
      try {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications');
      } catch (fallbackError) {
        throw new Error('Could not open System Settings. Open Notifications and allow Study Register.');
      }
    }
    return { ok: true };
  });

  handle('sr:export-csv', async () => {
    if (!data.sessions.length) throw new Error('There are no sessions to export yet.');
    const result = await withModalDialog(() => dialog.showSaveDialog(activeDialogWindow(), {
      title: 'Export study history',
      defaultPath: path.join(app.getPath('documents'), 'study-register-' + core.dateKey(new Date()) + '.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    }));
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    await fs.promises.writeFile(result.filePath, core.buildCsv(data.sessions), 'utf8');
    return { ok: true, path: result.filePath, count: data.sessions.length };
  });

  handle('sr:backup-json', async () => {
    const result = await withModalDialog(() => dialog.showSaveDialog(activeDialogWindow(), {
      title: 'Back up Study Register',
      defaultPath: path.join(app.getPath('documents'), 'study-register-backup-' + core.dateKey(new Date()) + '.json'),
      filters: [{ name: 'JSON backup', extensions: ['json'] }]
    }));
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const backup = Object.assign({}, data, {
      backupCreatedAt: new Date().toISOString(),
      backupApp: 'Study Register'
    });
    await fs.promises.writeFile(result.filePath, JSON.stringify(backup, null, 2), { encoding: 'utf8', mode: 0o600 });
    return { ok: true, path: result.filePath, count: data.sessions.length };
  });

  handle('sr:restore-json', async () => {
    const result = await withModalDialog(() => dialog.showOpenDialog(activeDialogWindow(), {
      title: 'Restore Study Register backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON backup', extensions: ['json'] }]
    }));
    if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true };
    const file = result.filePaths[0];
    const stat = await fs.promises.stat(file);
    if (stat.size > 25 * 1024 * 1024) throw new Error('That backup file is too large.');
    const raw = await fs.promises.readFile(file, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error('That file is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.subjects)) {
      throw new Error('That file is not a Study Register backup.');
    }
    const restored = core.normalizeData(parsed);
    writeSafetyCopy('data.before-restore.json');
    data = restored;
    applyTheme();
    saveData();
    updateTrayClock();
    broadcast();
    tickRoutineNotifications();
    return okState({ restored: data.sessions.length });
  });

  handle('sr:reset-data', (payload) => {
    if (payload.confirm !== 'RESET') throw new Error('Type RESET to confirm.');
    writeSafetyCopy('data.before-reset.json');
    data = core.defaultData();
    applyTheme();
    saveData();
    updateTrayClock();
    broadcast();
    tickRoutineNotifications();
    return okState();
  });

  handle('sr:reveal-data', () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) shell.showItemInFolder(DATA_FILE);
    else shell.openPath(DATA_DIR);
    return { ok: true };
  });

  handle('sr:copy-data-path', () => {
    clipboard.writeText(DATA_FILE);
    return { ok: true };
  });

  handle('sr:open-dashboard', () => {
    openDashboard();
    return { ok: true };
  });

  handle('sr:float-drag-start', (payload) => startFloatDrag(payload));
  handle('sr:float-drag-move', (payload) => moveFloatDrag(payload));
  handle('sr:float-drag-end', () => finishFloatDrag());
  handle('sr:float-hover', (payload) => {
    setFloatHovering(payload.hovering);
    return { ok: true };
  });
  handle('sr:float-double-click', () => {
    floatDrag = null;
    openDashboard();
    return { ok: true };
  });
  handle('sr:float-long-press', () => {
    floatDrag = null;
    if (dashboard && !dashboard.isDestroyed()) dashboard.hide();
    showPopover();
    return { ok: true };
  });
  handle('sr:float-panel-hide', () => {
    hideFloatPanel();
    return { ok: true };
  });

  handle('sr:close-popover', () => {
    hidePopover();
    return { ok: true };
  });

  handle('sr:show-popover', () => {
    if (dashboard && !dashboard.isDestroyed()) dashboard.hide();
    showPopover();
    return { ok: true };
  });

  handle('sr:quit', () => {
    isQuitting = true;
    app.quit();
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

if (gotLock) {
  app.on('second-instance', () => showPopover());

  app.whenReady().then(() => {
    if (isMac) {
      app.setActivationPolicy('accessory');
      if (app.dock) app.dock.hide();
    }
    loadData();
    applyTheme();
    nativeTheme.on('updated', () => {
      const color = nativeTheme.shouldUseDarkColors ? '#101114' : '#F4F5F8';
      if (dashboard && !dashboard.isDestroyed()) dashboard.setBackgroundColor(color);
      if (routineWindow && !routineWindow.isDestroyed()) routineWindow.setBackgroundColor(color);
      if (floatPanel && !floatPanel.isDestroyed()) floatPanel.setBackgroundColor(color);
    });
    app.setAboutPanelOptions({
      applicationName: 'Study Register',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright © 2026 Veer Vibes',
      credits: 'A quiet, local-first study register for your menu bar.'
    });
    createAppMenu();
    registerIpc();
    createTray();
    createPopover();
    createDashboard();
    createFloatingIcon();
    screen.on('display-added', scheduleFloatBoundsCheck);
    screen.on('display-removed', scheduleFloatBoundsCheck);
    screen.on('display-metrics-changed', scheduleFloatBoundsCheck);
    startRoutineScheduler();
  });

  app.on('activate', () => {
    if (app.isReady()) togglePopover();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    if (precisionTimer) {
      clearTimeout(precisionTimer);
      precisionTimer = null;
    }
    if (trayTimer) {
      clearInterval(trayTimer);
      trayTimer = null;
    }
    snoozeTimers.forEach((timer) => clearTimeout(timer));
    snoozeTimers.clear();
    if (floatAnimTimer) {
      clearInterval(floatAnimTimer);
      floatAnimTimer = null;
    }
    if (floatFadeTimer) {
      clearInterval(floatFadeTimer);
      floatFadeTimer = null;
    }
    if (floatScreenTimer) {
      clearTimeout(floatScreenTimer);
      floatScreenTimer = null;
    }
    if (floatTuckTimer) {
      clearTimeout(floatTuckTimer);
      floatTuckTimer = null;
    }
    floatDrag = null;
    saveFloatState();
    saveData();
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
