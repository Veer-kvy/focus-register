'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('sr', {
  platform: process.platform,

  getState: () => invoke('sr:get-state'),

  startSession: (subjectId, routineMeta) => invoke('sr:start-session', Object.assign({ subjectId }, routineMeta || {})),
  endSession: () => invoke('sr:end-session'),
  discardSession: () => invoke('sr:discard-session'),
  updateSession: (session) => invoke('sr:update-session', {
    id: session.id,
    entry: session.entry,
    exit: session.exit,
    subjectId: session.subjectId
  }),
  deleteSession: (id) => invoke('sr:delete-session', { id }),

  addSubject: (name) => invoke('sr:add-subject', { name }),
  renameSubject: (id, name) => invoke('sr:rename-subject', { id, name }),
  removeSubject: (id) => invoke('sr:remove-subject', { id }),

  updateSettings: (patch) => invoke('sr:update-settings', patch),

  openRoutine: (tab) => invoke('sr:open-routine', { tab }),
  saveRoutine: (routine) => invoke('sr:routine-save-routine', routine),
  deleteRoutine: (id) => invoke('sr:routine-delete-routine', { id }),
  setDefaultRoutine: (id) => invoke('sr:routine-set-default', { id }),
  setDayRoutine: (weekday, routineId) => invoke('sr:routine-set-day', { weekday, routineId }),
  saveRoutineSlot: (routineId, weekday, slot, options) => invoke('sr:routine-save-slot', Object.assign({
    routineId,
    weekday,
    slot
  }, options || {})),
  deleteRoutineSlot: (routineId, weekday, slotId) => invoke('sr:routine-delete-slot', { routineId, weekday, slotId }),
  clearRoutineDay: (routineId, weekday) => invoke('sr:routine-clear-day', { routineId, weekday }),
  copyRoutineDay: (routineId, sourceDay, targetDays, options) => invoke('sr:routine-copy-day', Object.assign({
    routineId,
    sourceDay,
    targetDays
  }, options || {})),
  saveRoutineException: (exception, options) => invoke('sr:routine-save-exception', Object.assign({ exception }, options || {})),
  deleteRoutineException: (idOrDate) => invoke('sr:routine-delete-exception', typeof idOrDate === 'string' && idOrDate.length === 10 ? { date: idOrDate } : { id: idOrDate }),
  setRoutineCompletion: (date, slotId, status) => invoke('sr:routine-set-completion', { date, slotId, status }),
  updateRoutineNotifications: (patch) => invoke('sr:routine-update-notifications', patch),
  notificationStatus: () => invoke('sr:routine-notification-status'),
  testRoutineNotification: () => invoke('sr:routine-test-notification'),
  openNotificationSettings: () => invoke('sr:routine-open-notification-settings'),

  exportCsv: () => invoke('sr:export-csv'),
  backupJson: () => invoke('sr:backup-json'),
  restoreJson: () => invoke('sr:restore-json'),
  resetData: (confirmText) => invoke('sr:reset-data', { confirm: confirmText }),
  revealData: () => invoke('sr:reveal-data'),
  copyDataPath: () => invoke('sr:copy-data-path'),

  openDashboard: () => invoke('sr:open-dashboard'),
  showPopover: () => invoke('sr:show-popover'),
  closePopover: () => invoke('sr:close-popover'),
  quit: () => invoke('sr:quit'),

  floatDragStart: (point) => invoke('sr:float-drag-start', {
    screenX: point ? point.screenX : 0,
    screenY: point ? point.screenY : 0
  }),
  floatDragMove: (point) => invoke('sr:float-drag-move', {
    screenX: point ? point.screenX : 0,
    screenY: point ? point.screenY : 0
  }),
  floatDragEnd: () => invoke('sr:float-drag-end'),
  floatHover: (hovering) => invoke('sr:float-hover', { hovering: Boolean(hovering) }),
  floatDoubleClick: () => invoke('sr:float-double-click'),
  floatLongPress: () => invoke('sr:float-long-press'),
  hideFloatPanel: () => invoke('sr:float-panel-hide'),

  onFloatState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sr:float-state', listener);
    return () => ipcRenderer.removeListener('sr:float-state', listener);
  },

  onFloatEdge: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sr:float-edge', listener);
    return () => ipcRenderer.removeListener('sr:float-edge', listener);
  },

  onStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sr:state-changed', listener);
    return () => ipcRenderer.removeListener('sr:state-changed', listener);
  },

  onRoutineFocus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sr:routine-focus', listener);
    return () => ipcRenderer.removeListener('sr:routine-focus', listener);
  },

  onRoutineTab: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sr:routine-tab', listener);
    return () => ipcRenderer.removeListener('sr:routine-tab', listener);
  }
});
