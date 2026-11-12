'use strict';

/*
 * Live Electron smoke test.
 * Launches the real app against a throwaway data directory, drives the UI over
 * the Chrome DevTools Protocol, verifies entry/exit + persistence + crash
 * recovery, and captures screenshots for visual review.
 *
 * Usage: npm run smoke
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const core = require('../src/js/core.js');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = require('electron');
const APP_OVERRIDE = process.env.SMOKE_APP || '';
const PORT = Number(process.env.SMOKE_PORT || 9337);
const RUN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'study-register-smoke-'));
const SHOTS = path.join(ROOT, '.smoke', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const failures = [];
let child = null;
let DATA_DIR = '';
let logs = '';

function check(condition, message) {
  if (condition) {
    console.log('  ok  ' + message);
  } else {
    failures.push(message);
    console.log('  FAIL ' + message);
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function targets() {
  try {
    return await getJson('http://127.0.0.1:' + PORT + '/json/list');
  } catch (error) {
    return [];
  }
}

async function waitForTarget(fragment, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    const list = await targets();
    const found = list.find((item) => item.type === 'page' && item.url.includes(fragment));
    if (found) return found;
    await delay(150);
  }
  throw new Error('Timed out waiting for target ' + fragment);
}

class PageClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    this.ws = null;
  }

  static async connect(wsUrl) {
    const client = new PageClient(wsUrl);
    await client.open();
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Log.enable');
    return client;
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('CDP socket timeout')), 10000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error('CDP socket error: ' + (event.message || 'unknown')));
      });
      ws.addEventListener('message', (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch (error) { return; }
        if (message.id && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
          return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
          const detail = message.params.exceptionDetails;
          this.errors.push('exception: ' + (detail.exception ? detail.exception.description : detail.text));
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
          this.errors.push('console.error: ' + message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
        }
        if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
          this.errors.push('log: ' + message.params.entry.text);
        }
      });
    });
  }

  send(method, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP socket closed'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP call timed out: ' + method));
        }
      }, 15000);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      throw new Error('evaluate failed: ' + (detail.exception ? detail.exception.description : detail.text));
    }
    return result.result.value;
  }

  async waitFor(expression, timeoutMs, label) {
    const deadline = Date.now() + (timeoutMs || 8000);
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression);
        if (last) return last;
      } catch (error) {
        last = error.message;
      }
      await delay(120);
    }
    throw new Error('Timed out waiting for ' + (label || expression) + (last ? ' (last: ' + JSON.stringify(last) + ')' : ''));
  }

  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(SHOTS, name + '.png');
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log('  shot ' + path.relative(ROOT, file));
    return file;
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (error) { /* ignore */ }
    }
  }
}

function launch(extraEnv) {
  const env = {
    ...process.env,
    STUDY_REGISTER_DATA_DIR: DATA_DIR,
    STUDY_REGISTER_SHOW_ON_START: '1',
    STUDY_REGISTER_ALLOW_MULTI: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    ...(extraEnv || {})
  };
  const args = APP_OVERRIDE
    ? ['--remote-debugging-port=' + PORT]
    : [ROOT, '--remote-debugging-port=' + PORT];
  const proc = spawn(APP_OVERRIDE || ELECTRON, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  proc.on('exit', (code, signal) => {
    if (signal !== 'SIGKILL' && code !== 0 && code !== null) {
      console.log('electron exited code=' + code + ' signal=' + signal);
    }
  });
  return proc;
}

function dataFile() {
  return path.join(DATA_DIR, 'data.json');
}

function readData() {
  return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
}

function daysAgo(n, hour, minute) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function seedHistory() {
  const sessions = [];
  const plan = [
    [6, 'physics', 'Physics', 9, 0, 11, 15],
    [6, 'mathematics', 'Mathematics', 16, 0, 17, 30],
    [5, 'chemistry', 'Chemistry', 10, 0, 12, 0],
    [5, 'coding', 'Coding', 19, 0, 20, 45],
    [4, 'physics', 'Physics', 8, 30, 10, 0],
    [4, 'revision', 'Revision', 18, 0, 19, 40],
    [3, 'mathematics', 'Mathematics', 11, 0, 13, 20],
    [2, 'chemistry', 'Chemistry', 9, 30, 11, 0],
    [2, 'coding', 'Coding', 15, 0, 17, 10],
    [1, 'physics', 'Physics', 8, 0, 10, 30],
    [1, 'mathematics', 'Mathematics', 14, 0, 15, 15],
    [1, 'revision', 'Revision', 20, 0, 21, 0],
    [0, 'physics', 'Physics', 7, 30, 9, 0]
  ];
  plan.forEach((item, index) => {
    const entry = daysAgo(item[0], item[3], item[4]);
    const exit = daysAgo(item[0], item[5], item[6]);
    sessions.push({
      id: 'seed-' + index,
      subjectId: item[1],
      subjectName: item[2],
      entry: entry.toISOString(),
      exit: exit.toISOString(),
      createdAt: entry.toISOString()
    });
  });
  const base = core.defaultData();
  base.sessions = sessions;
  base.meta = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return core.normalizeData(base);
}

function minuteLabel(total) {
  const mins = ((Math.round(total) % 1440) + 1440) % 1440;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function seedRoutineDay() {
  const base = core.defaultData();
  const now = new Date();
  const day = core.weekdayId(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const routine = base.routine.routines[0];
  const slots = [];
  const stamp = now.toISOString();
  const addSlot = (id, title, type, subjectId, startMin, endMin) => {
    slots.push({
      id,
      title,
      type,
      subjectId,
      notes: '',
      start: minuteLabel(startMin),
      end: minuteLabel(endMin),
      createdAt: stamp
    });
  };

  if (nowMin >= 90) addSlot('seed-prev', 'Physics practice', 'physics', 'physics', nowMin - 120, nowMin - 90);
  addSlot('seed-current', 'Mathematics drill', 'mathematics', 'mathematics', Math.max(0, nowMin - 30), nowMin + 30);
  if (nowMin + 90 < 1440) addSlot('seed-next', 'Chemistry revision', 'chemistry', 'chemistry', nowMin + 60, nowMin + 90);
  routine.days[day] = slots;

  const prev = slots.find((slot) => slot.id === 'seed-prev');
  const previous = new Date(now);
  previous.setDate(previous.getDate() - 1);
  previous.setHours(21, 0, 0, 0);
  const previousExit = new Date(previous.getTime() + 40 * 60000);
  base.sessions = [{
    id: 'seed-routine-session',
    subjectId: 'physics',
    subjectName: 'Physics',
    entry: previous.toISOString(),
    exit: previousExit.toISOString(),
    createdAt: previous.toISOString()
  }];
  if (prev) {
    const entry = new Date(now);
    entry.setHours(Number(prev.start.slice(0, 2)), Number(prev.start.slice(3, 5)), 0, 0);
    const exit = new Date(now);
    exit.setHours(Number(prev.end.slice(0, 2)), Number(prev.end.slice(3, 5)), 0, 0);
    base.sessions.push({
      id: 'seed-routine-today',
      subjectId: 'physics',
      subjectName: 'Physics',
      entry: entry.toISOString(),
      exit: exit.toISOString(),
      createdAt: entry.toISOString()
    });
  }
  return core.normalizeData(base);
}

async function stop(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  const deadline = Date.now() + 6000;
  while (proc.exitCode === null && Date.now() < deadline) await delay(100);
  if (proc.exitCode === null) proc.kill('SIGKILL');
  await delay(400);
}

async function mouseEvent(page, type, x, y) {
  await page.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    pointerType: 'mouse'
  });
}

async function clickAt(page, x, y) {
  await mouseEvent(page, 'mousePressed', x, y);
  await delay(90);
  await mouseEvent(page, 'mouseReleased', x, y);
  await delay(260);
}

async function longPressAt(page, x, y) {
  await mouseEvent(page, 'mousePressed', x, y);
  await delay(650);
  await mouseEvent(page, 'mouseReleased', x, y);
  await delay(400);
}

async function dragAt(page, grabX, grabY, moveX, moveY, steps) {
  await mouseEvent(page, 'mousePressed', grabX, grabY);
  await delay(60);
  for (let index = 0; index < steps; index += 1) {
    await mouseEvent(page, 'mouseMoved', moveX, moveY);
    await delay(16);
  }
  await mouseEvent(page, 'mouseReleased', moveX, moveY);
  await delay(450);
}

/* Hover the bezel sliver so a tucked icon peeks out before interacting with it. */
async function revealFloater(floater) {
  const state = await floater.evaluate(`({
    x: window.screenX,
    width: window.innerWidth,
    avail: { x: window.screen.availLeft, width: window.screen.availWidth }
  })`);
  const visibleLeft = Math.max(0, state.avail.x - state.x);
  const visibleRight = Math.min(state.width, state.avail.x + state.avail.width - state.x);
  const overlap = (Math.max(visibleLeft, 7) + Math.min(visibleRight, 51)) / 2;
  const x = Math.min(Math.max(Math.round(overlap), 8), 50);
  await mouseEvent(floater, 'mouseMoved', x, 29);
  await delay(350);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  console.log('run dir: ' + RUN_ROOT);
  const DATA_DIR_A = path.join(RUN_ROOT, 'flow');
  const DATA_DIR_B = path.join(RUN_ROOT, 'seeded');
  const DATA_DIR_C = path.join(RUN_ROOT, 'routine');
  fs.mkdirSync(DATA_DIR_A, { recursive: true });
  fs.mkdirSync(DATA_DIR_B, { recursive: true });
  fs.mkdirSync(DATA_DIR_C, { recursive: true });

  DATA_DIR = DATA_DIR_A;

  // ---------- Phase 1: fresh install, entry/exit ----------
  console.log('\nPhase 1 · fresh launch, entry → exit');
  child = launch();
  let target = await waitForTarget('/index.html', 30000);
  let popover = await PageClient.connect(target.webSocketDebuggerUrl);
  await popover.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'store boot');

  const initial = await popover.evaluate(`({
    subjects: document.querySelectorAll('#subjectGrid .subject-chip:not(.is-add)').length,
    timer: document.getElementById('heroTimer').textContent,
    status: document.getElementById('statusText').textContent,
    entryDisabled: document.getElementById('entryBtn').disabled,
    exitDisabled: document.getElementById('exitBtn').disabled,
    today: document.getElementById('statTotal').textContent,
    dataPathShown: null
  })`);
  check(initial.subjects === 6, 'six default subjects rendered');
  check(initial.timer === '00:00:00', 'timer starts at 00:00:00');
  check(initial.entryDisabled === false, 'ENTRY enabled while idle');
  check(initial.exitDisabled === true, 'EXIT disabled while idle');
  await popover.screenshot('01-popover-idle');

  await popover.evaluate(`document.querySelector('#subjectGrid [data-subject="chemistry"]').click()`);
  await delay(250);
  const selected = await popover.evaluate(`document.querySelector('#subjectGrid .is-selected').getAttribute('data-subject')`);
  check(selected === 'chemistry', 'subject selection switches to Chemistry');

  await popover.evaluate(`document.getElementById('entryBtn').click()`);
  await popover.waitFor('Boolean(window.SRStore.state.activeSession)', 6000, 'active session');
  await delay(1600);
  const active = await popover.evaluate(`({
    status: document.getElementById('statusText').textContent,
    timer: document.getElementById('heroTimer').textContent,
    entryDisabled: document.getElementById('entryBtn').disabled,
    exitDisabled: document.getElementById('exitBtn').disabled,
    locked: !document.getElementById('subjectLockNote').classList.contains('hidden'),
    activeSubject: window.SRStore.state.activeSession.subjectId,
    liveTotal: document.getElementById('statTotal').textContent
  })`);
  check(active.status.includes('Chemistry'), 'hero shows the running subject');
  check(/^00:00:0[1-9]$/.test(active.timer), 'timer counts up from entry time (' + active.timer + ')');
  check(active.entryDisabled === true, 'ENTRY disabled while a session is running');
  check(active.exitDisabled === false, 'EXIT enabled while a session is running');
  check(active.locked === true, 'subject selector locks during a session');
  check(active.activeSubject === 'chemistry', 'active session persisted with the chosen subject');
  await popover.screenshot('02-popover-active');

  const beforeExit = readData();
  check(Boolean(beforeExit.activeSession), 'active session written to data.json immediately');
  check(beforeExit.sessions.length === 0, 'no finished session yet');

  await popover.evaluate(`document.getElementById('exitBtn').click()`);
  await popover.waitFor('window.SRStore.state.sessions.length === 1 && !window.SRStore.state.activeSession', 6000, 'session saved');
  await delay(500);
  const afterExit = await popover.evaluate(`({
    timer: document.getElementById('heroTimer').textContent,
    exitDisabled: document.getElementById('exitBtn').disabled,
    sessions: window.SRStore.state.sessions.length,
    recentRows: document.querySelectorAll('#recentList .recent-row').length,
    statSessions: document.getElementById('statSessions').textContent,
    totalNote: document.getElementById('statTotal').textContent
  })`);
  check(afterExit.timer === '00:00:00', 'timer resets after EXIT');
  check(afterExit.exitDisabled === true, 'EXIT disabled after saving');
  check(afterExit.sessions === 1, 'one session recorded');
  check(afterExit.recentRows >= 1, 'recent register shows the new session');
  await popover.screenshot('03-popover-recorded');

  const saved = readData();
  const session = saved.sessions[0];
  check(saved.activeSession === null, 'active session cleared on disk');
  check(session && session.subjectId === 'chemistry', 'saved session subject is Chemistry');
  check(session && new Date(session.exit) > new Date(session.entry), 'saved session has exit after entry');
  check(session && (new Date(session.exit) - new Date(session.entry)) >= 1000, 'saved duration comes from real timestamps');
  check(popover.errors.length === 0, 'no console or runtime errors in popover' + (popover.errors.length ? ': ' + popover.errors.join(' | ') : ''));

  // ---------- Phase 1b: discard flow ----------
  console.log('\nPhase 1b · discard requires confirmation');
  await popover.evaluate(`document.querySelector('#subjectGrid [data-subject="physics"]').click()`);
  await popover.evaluate(`document.getElementById('entryBtn').click()`);
  await popover.waitFor('Boolean(window.SRStore.state.activeSession)', 6000, 'session to discard');
  await popover.evaluate(`document.getElementById('discardBtn').click()`);
  await popover.waitFor(`Boolean(document.querySelector('.modal-root .modal-confirm-copy'))`, 4000, 'discard confirmation');
  const discardCopy = await popover.evaluate(`document.querySelector('.modal-root .modal-confirm-copy').textContent`);
  check(/discard/i.test(discardCopy) || /deleted/i.test(discardCopy), 'discard asks for confirmation');
  await delay(400);
  await popover.screenshot('03b-discard-confirm');
  await popover.evaluate(`document.querySelectorAll('.modal-root .modal-foot .btn')[0].click()`);
  await delay(350);
  check(Boolean(await popover.evaluate('window.SRStore.state.activeSession')), 'cancelling discard keeps the running session');
  await popover.evaluate(`document.getElementById('discardBtn').click()`);
  await popover.waitFor(`Boolean(document.querySelector('.modal-root .modal-confirm-copy'))`, 4000, 'discard confirmation again');
  await popover.evaluate(`document.querySelectorAll('.modal-root .modal-foot .btn')[1].click()`);
  await popover.waitFor('!window.SRStore.state.activeSession', 6000, 'session discarded');
  await delay(300);
  const afterDiscard = await popover.evaluate(`({
    sessions: window.SRStore.state.sessions.length,
    timer: document.getElementById('heroTimer').textContent
  })`);
  check(afterDiscard.sessions === 1, 'discard does not write a session to the register');
  check(afterDiscard.timer === '00:00:00', 'timer resets after discarding');

  // ---------- Phase 2: restart persistence ----------
  console.log('\nPhase 2 · restart keeps the register');
  popover.close();
  await stop(child);
  child = launch();
  target = await waitForTarget('/index.html', 30000);
  popover = await PageClient.connect(target.webSocketDebuggerUrl);
  await popover.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'store boot after restart');
  const restarted = await popover.evaluate(`({
    sessions: window.SRStore.state.sessions.length,
    recentRows: document.querySelectorAll('#recentList .recent-row').length,
    active: Boolean(window.SRStore.state.activeSession)
  })`);
  check(restarted.sessions === 1, 'session survives a clean restart');
  check(restarted.recentRows >= 1, 'recent list survives a clean restart');
  check(restarted.active === false, 'no phantom active session after restart');

  // ---------- Phase 3: crash recovery ----------
  console.log('\nPhase 3 · unexpected shutdown recovery');
  await popover.evaluate(`document.querySelector('#subjectGrid [data-subject="mathematics"]').click()`);
  await popover.evaluate(`document.getElementById('entryBtn').click()`);
  await popover.waitFor('Boolean(window.SRStore.state.activeSession)', 6000, 'active session before crash');
  const crashEntry = readData().activeSession.entry;
  await delay(1200);
  popover.close();
  child.kill('SIGKILL');
  await delay(600);
  child = launch();
  target = await waitForTarget('/index.html', 30000);
  popover = await PageClient.connect(target.webSocketDebuggerUrl);
  await popover.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'store boot after crash');
  await delay(900);
  const recovered = await popover.evaluate(`({
    active: window.SRStore.state.activeSession,
    status: document.getElementById('statusText').textContent,
    timer: document.getElementById('heroTimer').textContent,
    entryDisabled: document.getElementById('entryBtn').disabled,
    exitDisabled: document.getElementById('exitBtn').disabled
  })`);
  check(Boolean(recovered.active), 'active session recovered after SIGKILL');
  check(recovered.active && recovered.active.entry === crashEntry, 'recovered entry timestamp is unchanged');
  check(recovered.status.includes('Mathematics'), 'recovered session shows its subject');
  check(recovered.timer !== '00:00:00', 'recovered timer reflects real elapsed time (' + recovered.timer + ')');
  check(recovered.exitDisabled === false, 'recovered session can still be exited');
  await popover.evaluate(`document.getElementById('exitBtn').click()`);
  await popover.waitFor('window.SRStore.state.sessions.length === 2', 6000, 'recovered session saved');
  await delay(400);
  const two = readData();
  check(two.sessions.length === 2 && !two.activeSession, 'recovered session is recorded once and active cleared');
  await popover.screenshot('04-popover-after-recovery');

  // ---------- Phase 4: settings + theme ----------
  console.log('\nPhase 4 · settings, theme and subjects');
  await popover.evaluate(`window.SRStore.call('updateSettings', { appearance: 'light' })`);
  await delay(600);
  const light = await popover.evaluate(`({
    mode: window.SRStore.state.settings.appearance,
    scheme: window.matchMedia('(prefers-color-scheme: light)').matches,
    bg: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color
  })`);
  check(light.mode === 'light', 'appearance setting switches to Light');
  check(light.scheme === true, 'renderer follows the light color scheme');
  await popover.screenshot('05-popover-light');

  await popover.evaluate(`window.SRStore.call('addSubject', 'Organic Chemistry')`);
  await popover.waitFor(`window.SRStore.state.subjects.some((s) => s.name === 'Organic Chemistry')`, 5000, 'new subject');
  const addedSubject = await popover.evaluate(`({
    count: document.querySelectorAll('#subjectGrid .subject-chip:not(.is-add)').length,
    chips: Array.from(document.querySelectorAll('#subjectGrid .subject-chip:not(.is-add) .name')).map((el) => el.textContent)
  })`);
  check(addedSubject.count === 7, 'custom subject appears in the grid');
  check(addedSubject.chips.includes('Organic Chemistry'), 'custom subject name rendered');

  await popover.evaluate(`window.SRStore.call('renameSubject', window.SRStore.state.subjects.find((s) => s.name === 'Organic Chemistry').id, 'Organic Chem')`);
  await popover.waitFor(`window.SRStore.state.subjects.some((s) => s.name === 'Organic Chem')`, 5000, 'renamed subject');
  check(true, 'subject rename works');

  const targetId = await popover.evaluate(`window.SRStore.state.subjects.find((s) => s.name === 'Organic Chem').id`);
  await popover.evaluate(`window.SRStore.call('removeSubject', ${JSON.stringify(targetId)})`);
  await popover.waitFor(`!window.SRStore.state.subjects.some((s) => s.name === 'Organic Chem')`, 5000, 'subject removed');
  check(true, 'subject removal works');

  await popover.evaluate(`window.SRStore.call('updateSettings', { dailyTargetMinutes: 480, appearance: 'dark' })`);
  await delay(400);
  const settingsState = await popover.evaluate(`({
    target: window.SRStore.state.settings.dailyTargetMinutes,
    goal: document.getElementById('goalText').textContent,
    scheme: window.matchMedia('(prefers-color-scheme: dark)').matches
  })`);
  check(settingsState.target === 480, 'daily target persists in settings');
  check(settingsState.goal.includes('8h'), 'goal copy updates with the target');
  check(settingsState.scheme === true, 'appearance switches back to Dark');

  await popover.evaluate(`document.getElementById('settingsBtn').click()`);
  await popover.waitFor(`Boolean(document.querySelector('.modal-root .modal'))`, 4000, 'settings sheet');
  await delay(400);
  const settingsSheet = await popover.evaluate(`({
    sections: document.querySelectorAll('.modal-root .setting-group').length,
    target: document.getElementById('targetValue') ? document.getElementById('targetValue').textContent : '',
    dataPath: (document.querySelector('.modal-root .data-path .path') || {}).textContent || ''
  })`);
  check(settingsSheet.sections >= 5, 'settings sheet renders all groups');
  check(settingsSheet.dataPath.includes('data.json'), 'settings shows the local data path');
  await popover.screenshot('05b-settings-sheet');
  await popover.evaluate(`(() => { const body = document.querySelector('.modal-root .modal-body'); if (body) body.scrollTop = body.scrollHeight; })()`);
  await delay(350);
  await popover.screenshot('05d-settings-sheet-lower');
  await popover.evaluate(`document.querySelector('.modal-root .modal-close').click()`);
  await delay(300);
  await popover.screenshot('05c-popover-dark');

  // ---------- Phase 5: dashboard ----------
  console.log('\nPhase 5 · dashboard analytics');
  await popover.evaluate(`document.getElementById('dashboardBtn').click()`);
  const dashTarget = await waitForTarget('/dashboard.html', 10000);
  const dash = await PageClient.connect(dashTarget.webSocketDebuggerUrl);
  await dash.waitFor(`document.querySelectorAll('#barChart .bar-col').length > 0`, 10000, 'dashboard charts');
  await delay(600);
  const dashState = await dash.evaluate(`({
    kpiTotal: document.getElementById('kpiTotal').textContent,
    kpiSessions: document.getElementById('kpiSessions').textContent,
    bars: document.querySelectorAll('#barChart .bar-col').length,
    legend: document.querySelectorAll('#subjectLegend .legend-row').length,
    rows: document.querySelectorAll('#historyList .register-row').length,
    range: document.getElementById('rangeLabel').textContent
  })`);
  check(dashState.bars > 0, 'week chart renders bars');
  check(dashState.legend > 0, 'subject distribution renders a legend');
  check(dashState.rows >= 2, 'register lists recorded sessions');
  check(dashState.kpiSessions === '2', 'dashboard session count matches (' + dashState.kpiSessions + ')');
  await dash.screenshot('06-dashboard-week');

  await dash.evaluate(`document.querySelector('#rangeSwitch [data-range="today"]').click()`);
  await delay(600);
  await dash.screenshot('07-dashboard-today');
  const todayKpi = await dash.evaluate(`({ total: document.getElementById('kpiTotal').textContent, sessions: document.getElementById('kpiSessions').textContent })`);
  check(todayKpi.sessions === '2', 'today range counts both of today\'s sessions');

  await dash.evaluate(`document.querySelector('#rangeSwitch [data-range="all"]').click()`);
  await delay(500);
  await dash.screenshot('08-dashboard-all');
  const allKpi = await dash.evaluate(`document.getElementById('kpiSessions').textContent`);
  check(Number(allKpi) >= 2, 'all-time range includes every session (' + allKpi + ')');

  const filter = await dash.evaluate(`(() => {
    const input = document.getElementById('historySearch');
    input.value = 'Chemistry';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelectorAll('#historyList .register-row').length;
  })()`);
  await delay(300);
  check(filter >= 1, 'register search filters by subject');
  await dash.evaluate(`document.getElementById('historyClear').click()`);
  await delay(250);

  const editorOpened = await dash.evaluate(`(() => {
    const btn = document.querySelector('#historyList .register-row [data-edit]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await delay(500);
  const modalOpen = await dash.evaluate(`Boolean(document.querySelector('.modal-root .modal'))`);
  check(editorOpened && modalOpen, 'session editor opens from the register');
  if (modalOpen) {
    await dash.screenshot('09-dashboard-editor');
    await dash.evaluate(`(() => {
      const inputs = document.querySelectorAll('.modal-root input[type="datetime-local"]');
      if (inputs.length < 2) return;
      const pad = (n) => String(n).padStart(2, '0');
      const start = new Date(inputs[0].value);
      const exit = new Date(start.getTime() + 5 * 60000);
      inputs[1].value = exit.getFullYear() + '-' + pad(exit.getMonth() + 1) + '-' + pad(exit.getDate()) +
        'T' + pad(exit.getHours()) + ':' + pad(exit.getMinutes()) + ':' + pad(exit.getSeconds());
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelectorAll('.modal-root .modal-foot .btn')[1].click();
    })()`);
    await dash.waitFor(`window.SRStore.state.sessions.some((s) => new Date(s.exit) - new Date(s.entry) >= 300000)`, 6000, 'edited exit time saved');
    await delay(350);
    const editedState = await dash.evaluate(`({
      open: Boolean(document.querySelector('.modal-root .modal')),
      duration: document.querySelector('#historyList .register-row .row-duration').textContent,
      sessions: window.SRStore.state.sessions.length
    })`);
    check(!editedState.open, 'editor closes after saving');
    check(editedState.duration === '5m', 'edited duration recalculates from timestamps (' + editedState.duration + ')');

    const beforeDelete = editedState.sessions;
    const deleteOpened = await dash.evaluate(`(() => {
      const btn = document.querySelector('#historyList .register-row [data-delete]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await delay(350);
    const confirmOpen = await dash.evaluate(`Boolean(document.querySelector('.modal-root .modal-confirm-copy'))`);
    check(deleteOpened && confirmOpen, 'delete asks for confirmation');
    if (confirmOpen) {
      await dash.evaluate(`document.querySelectorAll('.modal-root .modal-foot .btn')[1].click()`);
      await dash.waitFor(`window.SRStore.state.sessions.length === ${beforeDelete - 1}`, 6000, 'session deleted');
      check(true, 'deleting a session removes exactly one record');
      await delay(300);
    }
  }

  check(dash.errors.length === 0, 'no console or runtime errors in dashboard' + (dash.errors.length ? ': ' + dash.errors.join(' | ') : ''));

  dash.close();
  popover.close();
  await stop(child);

  // ---------- Phase 6: seeded history for visual review ----------
  console.log('\nPhase 6 · seeded analytics visuals');
  fs.writeFileSync(path.join(DATA_DIR_B, 'data.json'), JSON.stringify(seedHistory(), null, 2));
  DATA_DIR = DATA_DIR_B;
  child = launch();
  target = await waitForTarget('/index.html', 30000);
  popover = await PageClient.connect(target.webSocketDebuggerUrl);
  await popover.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'seeded store boot');
  await delay(800);
  const seeded = await popover.evaluate(`({
    sessions: window.SRStore.state.sessions.length,
    total: document.getElementById('statTotal').textContent,
    streak: document.getElementById('streakText').textContent,
    recent: document.querySelectorAll('#recentList .recent-row').length
  })`);
  check(seeded.sessions === 13, 'seeded register loads all sessions');
  check(seeded.recent >= 1, 'seeded recent list renders');
  await popover.screenshot('10-popover-seeded');
  await popover.evaluate(`document.getElementById('scrollArea').scrollTop = 520`);
  await delay(350);
  await popover.screenshot('10b-popover-seeded-lower');
  await popover.evaluate(`document.getElementById('scrollArea').scrollTop = 0`);

  await popover.evaluate(`document.getElementById('dashboardBtn').click()`);
  const seededDashTarget = await waitForTarget('/dashboard.html', 10000);
  const seededDash = await PageClient.connect(seededDashTarget.webSocketDebuggerUrl);
  await seededDash.waitFor(`document.querySelectorAll('#barChart .bar-col').length > 0`, 10000, 'seeded charts');
  await delay(700);
  await seededDash.screenshot('11-dashboard-seeded-week');
  await seededDash.evaluate(`document.querySelector('#rangeSwitch [data-range="month"]').click()`);
  await delay(500);
  await seededDash.screenshot('12-dashboard-seeded-month');
  await seededDash.evaluate(`document.querySelector('#rangeSwitch [data-range="all"]').click()`);
  await delay(500);
  await seededDash.screenshot('13-dashboard-seeded-all');
  const seededKpis = await seededDash.evaluate(`({
    sessions: document.getElementById('kpiSessions').textContent,
    total: document.getElementById('kpiTotal').textContent,
    longest: document.getElementById('kpiLongest').textContent,
    average: document.getElementById('kpiAverage').textContent
  })`);
  check(Number(seededKpis.sessions) === 13, 'all-time view counts every seeded session');
  check(seededDash.errors.length === 0, 'no console errors on seeded dashboard' + (seededDash.errors.length ? ': ' + seededDash.errors.join(' | ') : ''));
  seededDash.close();
  popover.close();
  await stop(child);

  // ---------- Phase 7: My Routine ----------
  console.log('\nPhase 7 · My Routine timetable, register link, analytics and reminders');
  const seededRoutineData = seedRoutineDay();
  const seededWeekday = core.weekdayId(new Date());
  const seededSlots = seededRoutineData.routine.routines[0].days[seededWeekday];
  const seededSlotCount = seededSlots.length;
  const seededSessionCount = seededRoutineData.sessions.length;
  fs.writeFileSync(path.join(DATA_DIR_C, 'data.json'), JSON.stringify(seededRoutineData, null, 2));
  DATA_DIR = DATA_DIR_C;
  child = launch();
  target = await waitForTarget('/index.html', 30000);
  popover = await PageClient.connect(target.webSocketDebuggerUrl);
  await popover.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'routine seed boot');
  await popover.waitFor(`!document.getElementById('scheduleHint').classList.contains('hidden')`, 8000, 'scheduled activity hint');
  const hintState = await popover.evaluate(`({
    title: document.getElementById('scheduleTitle').textContent,
    meta: document.getElementById('scheduleMeta').textContent,
    action: document.getElementById('scheduleStart').textContent,
    selected: (document.querySelector('#subjectGrid .is-selected') || {}).getAttribute
      ? document.querySelector('#subjectGrid .is-selected').getAttribute('data-subject')
      : ''
  })`);
  check(/Mathematics/.test(hintState.title), 'popover surfaces the current scheduled activity (' + hintState.title + ')');
  check(hintState.selected === 'mathematics', 'scheduled subject is suggested before entry');
  check(/–/.test(hintState.meta), 'suggestion shows the scheduled time range');
  await popover.screenshot('14-popover-routine-hint');

  await popover.evaluate(`document.getElementById('scheduleStart').click()`);
  await popover.waitFor('Boolean(window.SRStore.state.activeSession)', 6000, 'session started from routine');
  await delay(600);
  const routineActive = await popover.evaluate(`({
    slotId: window.SRStore.state.activeSession.routineSlotId,
    date: window.SRStore.state.activeSession.routineDate,
    title: window.SRStore.state.activeSession.routineTitle,
    subject: window.SRStore.state.activeSession.subjectId,
    sub: document.getElementById('heroSub').textContent,
    hintHidden: document.getElementById('scheduleHint').classList.contains('hidden')
  })`);
  check(routineActive.slotId === 'seed-current', 'entry from a scheduled slot links the session to that slot');
  check(routineActive.subject === 'mathematics', 'entry uses the scheduled subject');
  check(/Routine · Mathematics drill/.test(routineActive.sub), 'register shows the routine activity while running');
  check(routineActive.hintHidden === true, 'schedule suggestion hides during a running session');
  await popover.screenshot('15-popover-routine-active');

  await delay(1300);
  await popover.evaluate(`document.getElementById('exitBtn').click()`);
  await popover.waitFor(`window.SRStore.state.sessions.length === ${seededSessionCount + 1}`, 6000, 'routine session recorded');
  await delay(400);
  const recordedRoutine = readData();
  const routineSessions = recordedRoutine.sessions.slice().sort((a, b) => new Date(a.entry) - new Date(b.entry));
  const latestSession = routineSessions[routineSessions.length - 1];
  check(latestSession && latestSession.routineSlotId === 'seed-current', 'recorded session keeps its routine slot association');
  check(latestSession && (new Date(latestSession.exit) - new Date(latestSession.entry)) >= 1000, 'recorded routine session uses real timestamps');
  const seededSessionAfter = recordedRoutine.sessions.find((item) => item.id === 'seed-routine-session');
  check(seededSessionAfter && seededSessionAfter.entry === seededRoutineData.sessions[0].entry,
    'starting a new session never rewrites earlier entries');

  await popover.evaluate(`document.getElementById('routineBtn').click()`);
  const routineTarget = await waitForTarget('/routine.html', 10000);
  const routine = await PageClient.connect(routineTarget.webSocketDebuggerUrl);
  await routine.waitFor(`document.querySelectorAll('.routine-nav-item').length === 5`, 10000, 'routine navigation');
  await routine.waitFor(`document.querySelectorAll('#viewToday .timeline-row').length === ${seededSlotCount}`, 10000, 'today timeline');
  await delay(600);
  const todayState = await routine.evaluate(`({
    header: document.getElementById('routineHeaderSub').textContent,
    navName: (document.querySelector('.routine-nav-item.is-active strong') || {}).textContent || '',
    rows: document.querySelectorAll('#viewToday .timeline-row').length,
    current: Boolean(document.querySelector('#viewToday .timeline-row.is-current')),
    statuses: Array.from(document.querySelectorAll('#viewToday .slot-status')).map((node) => node.textContent.trim()),
    heroTitle: (document.querySelector('#viewToday .today-now h2') || {}).textContent || '',
    planned: (document.querySelectorAll('#viewToday .today-stat strong')[0] || {}).textContent || '',
    actual: (document.querySelectorAll('#viewToday .today-stat strong')[1] || {}).textContent || ''
  })`);
  check(todayState.rows === seededSlotCount, 'today timeline lists every planned activity');
  check(todayState.current === true, 'today timeline marks the current activity');
  check(/Mathematics drill/.test(todayState.heroTitle), 'hero names the current scheduled activity');
  check(todayState.statuses.some((text) => /Completed|Missed|Now|Upcoming/.test(text)), 'timeline renders planned statuses');
  check(todayState.actual !== '', 'actual study time is rendered on the routine page');
  check(todayState.navName.trim().length > 0, 'navigation highlights the active section');
  await routine.screenshot('16-routine-today');

  await routine.evaluate(`document.querySelector('.routine-nav-item[data-tab="timetable"]').click()`);
  await routine.waitFor(`document.querySelectorAll('#viewTimetable .day-tab').length === 7`, 8000, 'weekday tabs');
  await delay(400);
  const timetableState = await routine.evaluate(`({
    rows: document.querySelectorAll('#viewTimetable .editor-row').length,
    tabs: document.querySelectorAll('#viewTimetable .day-tab').length,
    activeDay: (document.querySelector('#viewTimetable .day-tab.is-active') || {}).getAttribute
      ? document.querySelector('#viewTimetable .day-tab.is-active').getAttribute('data-day')
      : '',
    bar: (document.querySelector('#viewTimetable .bar-meta') || {}).textContent || ''
  })`);
  check(timetableState.rows === seededSlotCount, 'timetable editor lists the routine activities');
  check(timetableState.tabs === 7, 'all seven weekdays are editable');
  check(timetableState.activeDay === seededWeekday, 'editor opens on today\'s weekday');
  check(/study per week/.test(timetableState.bar), 'timetable header reports weekly study time');
  await routine.screenshot('17-routine-timetable');

  await routine.evaluate(`document.querySelector('#viewTimetable [data-action="add-slot"]').click()`);
  await routine.waitFor(`Boolean(document.querySelector('.modal-root .slot-form'))`, 5000, 'activity editor');
  const formFields = await routine.evaluate(`['#slotTitle', '#slotType', '#slotSubject', '#slotStart', '#slotEnd', '#slotNotes', '#slotDuration']
    .every((selector) => Boolean(document.querySelector('.modal-root ' + selector)))`);
  check(formFields === true, 'activity editor exposes name, type, subject, times, notes and duration');
  await routine.screenshot('18-routine-slot-editor');
  await routine.evaluate(`document.querySelector('.modal-root .modal-foot .btn.ghost').click()`);
  await delay(300);

  const routineId = await routine.evaluate(`window.SRStore.state.routine.routines[0].id`);
  const beforeRows = await routine.evaluate(`document.querySelectorAll('#viewTimetable .editor-row').length`);
  const addedSlotId = await routine.evaluate(`window.SRStore.call('saveRoutineSlot', ${JSON.stringify(routineId)}, ${JSON.stringify(seededWeekday)}, {title: 'Smoke focus block', type: 'revision', subjectId: 'revision', notes: '', start: '04:00', end: '04:30'}, {allowOverlap: true}).then((response) => response.slot.id)`);
  await routine.waitFor(`document.querySelectorAll('#viewTimetable .editor-row').length === ${beforeRows + 1}`, 6000, 'activity added');
  check(Boolean(addedSlotId), 'new activity is saved to the permanent routine');
  const overlapMessage = await routine.evaluate(`window.SRStore.call('saveRoutineSlot', ${JSON.stringify(routineId)}, ${JSON.stringify(seededWeekday)}, {title: 'Overlap probe', type: 'revision', subjectId: 'revision', notes: '', start: '00:00', end: '23:59'}, {allowOverlap: false}).then(() => '').catch((error) => error.message)`);
  check(/^Overlap:/.test(overlapMessage), 'overlapping activities are blocked with a clear warning');
  await routine.evaluate(`window.SRStore.call('deleteRoutineSlot', ${JSON.stringify(routineId)}, ${JSON.stringify(seededWeekday)}, ${JSON.stringify(addedSlotId)})`);
  await routine.waitFor(`document.querySelectorAll('#viewTimetable .editor-row').length === ${beforeRows}`, 6000, 'activity deleted');

  const copyTarget = await routine.evaluate(`window.SRCore.WEEKDAY_IDS.find((day) => day !== ${JSON.stringify(seededWeekday)})`);
  await routine.evaluate(`document.querySelector('#viewTimetable [data-action="copy-day"]').click()`);
  await routine.waitFor(`Boolean(document.querySelector('.modal-root .copy-day-form'))`, 5000, 'template modal');
  const templateUi = await routine.evaluate(`({
    chips: document.querySelectorAll('.modal-root .copy-day-chip').length,
    presets: document.querySelectorAll('.modal-root [data-preset]').length,
    sourceLocked: Boolean(document.querySelector('.modal-root .copy-day-chip[data-day="${seededWeekday}"]') && document.querySelector('.modal-root .copy-day-chip[data-day="${seededWeekday}"]').disabled),
    primary: (document.querySelector('.modal-root .modal-foot .btn.primary') || {}).textContent || ''
  })`);
  check(templateUi.chips === 7, 'template picker lists every weekday');
  check(templateUi.presets === 4, 'template picker offers weekday, weekend and all-day presets');
  check(templateUi.sourceLocked === true, 'the source weekday cannot also be a target');
  check(/^Copy to \d+ days?$/.test(templateUi.primary), 'template picker previews the copy target count');
  await delay(500);
  await routine.screenshot('18b-routine-template');

  await routine.evaluate(`document.querySelector('.modal-root [data-preset="none"]').click()`);
  await routine.evaluate(`document.querySelector('.modal-root .copy-day-chip[data-day="${copyTarget}"]').click()`);
  await routine.evaluate(`document.querySelector('.modal-root .modal-foot .btn.primary').click()`);
  await routine.waitFor(`window.SRStore.state.routine.routines[0].days[${JSON.stringify(copyTarget)}].length === ${seededSlotCount}`, 8000, 'template copied');
  const templateResult = await routine.evaluate(`(() => {
    const routine = window.SRStore.state.routine.routines[0];
    const source = routine.days[${JSON.stringify(seededWeekday)}];
    const copied = routine.days[${JSON.stringify(copyTarget)}];
    const signature = (list) => list.map((slot) => slot.start + '-' + slot.end + ' ' + slot.title + ' ' + (slot.subjectId || '')).join('|');
    return {
      matches: signature(copied) === signature(source),
      uniqueIds: copied.every((slot) => !source.some((item) => item.id === slot.id)),
      sourceCount: source.length,
      assigned: window.SRStore.state.routine.schedule[${JSON.stringify(copyTarget)}] === routine.id
    };
  })()`);
  check(templateResult.matches === true, 'copied day matches the template activities');
  check(templateResult.uniqueIds === true, 'copied activities receive independent ids');
  check(templateResult.sourceCount === seededSlotCount, 'the template source stays intact');
  check(templateResult.assigned === true, 'target weekday follows the template routine');

  await routine.waitFor(`document.querySelectorAll('.modal-root').length === 0`, 3000, 'template modal closed');
  await routine.evaluate(`document.querySelector('#viewTimetable .day-tab[data-day="${copyTarget}"]').click()`);
  await routine.waitFor(`document.querySelector('#viewTimetable .day-tab[data-day="${copyTarget}"].is-active')`, 5000, 'copied weekday opened');
  await routine.evaluate(`document.querySelector('#viewTimetable .editor-row [data-action="edit-slot-row"]').click()`);
  await routine.waitFor(`Boolean(document.querySelector('.modal-root .slot-form'))`, 5000, 'copied activity editor');
  await routine.evaluate(`(() => {
    const modals = document.querySelectorAll('.modal-root');
    const modal = modals[modals.length - 1];
    modal.querySelector('#slotTitle').value = 'Tuesday only';
    modal.querySelector('.modal-foot .btn.primary').click();
  })()`);
  await routine.waitFor(`window.SRStore.state.routine.routines[0].days[${JSON.stringify(copyTarget)}].some((slot) => slot.title === 'Tuesday only')`, 6000, 'copied weekday edited');
  const independence = await routine.evaluate(`(() => {
    const routine = window.SRStore.state.routine.routines[0];
    const source = routine.days[${JSON.stringify(seededWeekday)}];
    const target = routine.days[${JSON.stringify(copyTarget)}];
    return {
      sourceUntouched: !source.some((slot) => slot.title === 'Tuesday only'),
      targetCount: target.length,
      sourceCount: source.length
    };
  })()`);
  check(independence.sourceUntouched === true, 'editing one weekday never changes the template source');
  check(independence.targetCount === seededSlotCount && independence.sourceCount === seededSlotCount, 'each weekday keeps its own activity list');

  await routine.waitFor(`document.querySelectorAll('.modal-root').length === 0`, 3000, 'activity editor closed');
  await routine.evaluate(`document.querySelector('#viewTimetable [data-action="clear-day"]').click()`);
  await routine.waitFor(`Boolean(document.querySelector('.modal-root .modal-confirm-copy'))`, 5000, 'clear day confirmation');
  await delay(250);
  await routine.evaluate(`(() => {
    const modals = document.querySelectorAll('.modal-root');
    modals[modals.length - 1].querySelector('.modal-foot .btn.danger').click();
  })()`);
  await routine.waitFor(`window.SRStore.state.routine.routines[0].days[${JSON.stringify(copyTarget)}].length === 0`, 6000, 'copied weekday cleared');
  const afterClear = await routine.evaluate(`(() => {
    const routine = window.SRStore.state.routine.routines[0];
    return {
      sourceCount: routine.days[${JSON.stringify(seededWeekday)}].length,
      targetCount: routine.days[${JSON.stringify(copyTarget)}].length
    };
  })()`);
  check(afterClear.targetCount === 0, 'clear day empties only the selected weekday');
  check(afterClear.sourceCount === seededSlotCount, 'clearing one weekday leaves the others intact');
  await routine.evaluate(`window.SRStore.call('setDayRoutine', ${JSON.stringify(copyTarget)}, null)`);

  await routine.evaluate(`document.querySelector('.routine-nav-item[data-tab="weekly"]').click()`);
  await routine.waitFor(`document.querySelectorAll('#viewWeekly .week-row').length === 7`, 8000, 'weekly routine rows');
  await delay(400);
  const weeklyState = await routine.evaluate(`({
    rows: document.querySelectorAll('#viewWeekly .week-row').length,
    bars: document.querySelectorAll('#viewWeekly .week-bar-col').length,
    cards: document.querySelectorAll('#viewWeekly .routine-card-item').length
  })`);
  check(weeklyState.rows === 7 && weeklyState.bars === 7, 'weekly routine covers every weekday');
  check(weeklyState.cards >= 1, 'saved routines are listed');
  const weekendId = await routine.evaluate(`window.SRStore.call('saveRoutine', {name: 'Weekend revision'}).then((response) => response.routineId)`);
  check(Boolean(weekendId), 'a second routine can be created');
  await routine.evaluate(`window.SRStore.call('setDayRoutine', 'sat', ${JSON.stringify(weekendId)})`);
  await routine.waitFor(`window.SRStore.state.routine.schedule.sat === ${JSON.stringify(weekendId)}`, 6000, 'Saturday assignment');
  await delay(400);
  const assignedSaturday = await routine.evaluate(`document.querySelector('#viewWeekly [data-action="assign-day"][data-day="sat"]').value`);
  check(assignedSaturday === weekendId, 'Saturday can follow its own routine');
  await routine.screenshot('19-routine-weekly');
  await routine.evaluate(`window.SRStore.call('setDayRoutine', 'sat', null)`);
  await routine.evaluate(`window.SRStore.call('deleteRoutine', ${JSON.stringify(weekendId)})`);

  await routine.evaluate(`document.querySelector('.routine-nav-item[data-tab="analytics"]').click()`);
  await routine.waitFor(`document.querySelectorAll('#viewAnalytics .analytics-kpi').length === 6`, 8000, 'routine analytics');
  await delay(400);
  const analyticsState = await routine.evaluate(`({
    kpis: document.querySelectorAll('#viewAnalytics .analytics-kpi').length,
    compare: document.querySelectorAll('#viewAnalytics .compare-row').length,
    planned: (document.querySelector('#viewAnalytics .analytics-kpi strong') || {}).textContent || '',
    consistency: document.querySelectorAll('#viewAnalytics .consistency-row').length,
    missed: document.querySelectorAll('#viewAnalytics .missed-row').length
  })`);
  check(analyticsState.kpis === 6, 'routine analytics renders planned, actual, difference, completion, average and missed');
  check(analyticsState.compare >= 1, 'planned versus actual is broken down by subject');
  check(analyticsState.planned !== '0m' && analyticsState.planned !== '', 'planned study time comes from the timetable');
  await routine.screenshot('20-routine-analytics');

  await routine.evaluate(`document.querySelector('.routine-nav-item[data-tab="notifications"]').click()`);
  await routine.waitFor(`document.querySelectorAll('#viewNotifications .notify-section').length >= 3`, 8000, 'routine notification settings');
  await delay(400);
  const notifState = await routine.evaluate(`({
    permission: Boolean(document.querySelector('#viewNotifications .permission-card')),
    chips: document.querySelectorAll('#viewNotifications .notify-section .timing-chip').length,
    exact: (document.querySelector('#viewNotifications .timing-chip.is-exact') || {}).getAttribute
      ? document.querySelector('#viewNotifications .timing-chip.is-exact').getAttribute('aria-pressed')
      : '',
    enabled: (document.querySelector('#viewNotifications [data-action="toggle-enabled"]') || {}).getAttribute
      ? document.querySelector('#viewNotifications [data-action="toggle-enabled"]').getAttribute('aria-checked')
      : '',
    subjectRows: document.querySelectorAll('#viewNotifications .override-list .override-row').length
  })`);
  check(notifState.permission === true, 'notification permission card is present');
  check(notifState.chips === 5, 'all five timing choices are available');
  check(notifState.exact === 'true', 'exact start-time reminders are enabled by default');
  check(notifState.enabled === 'true', 'routine reminders are on by default');
  check(notifState.subjectRows >= 3, 'per-subject reminder preferences are listed');
  await routine.screenshot('21-routine-notifications');

  await routine.evaluate(`document.querySelector('#viewNotifications .notify-section [data-offset="5"]').click()`);
  await routine.waitFor(`window.SRStore.state.routine.notifications.timings.includes(5)`, 6000, 'five minute reminder');
  check(true, 'multiple reminder timings can be selected');
  await routine.evaluate(`document.querySelector('#viewNotifications .notify-section [data-offset="5"]').click()`);
  await routine.waitFor(`!window.SRStore.state.routine.notifications.timings.includes(5)`, 6000, 'five minute reminder removed');
  await routine.evaluate(`document.querySelector('#viewNotifications [data-action="toggle-enabled"]').click()`);
  await routine.waitFor(`window.SRStore.state.routine.notifications.enabled === false`, 6000, 'reminders disabled');
  await routine.evaluate(`document.querySelector('#viewNotifications [data-action="toggle-enabled"]').click()`);
  await routine.waitFor(`window.SRStore.state.routine.notifications.enabled === true`, 6000, 'reminders re-enabled');
  const permissionState = await routine.evaluate(`window.sr.notificationStatus().then((response) => response.permission || null)`);
  check(permissionState && ['granted', 'denied', 'unknown'].includes(permissionState.status), 'macOS notification permission status is reported');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = core.dateKey(tomorrow);
  await routine.evaluate(`window.SRStore.call('saveRoutineException', {date: ${JSON.stringify(tomorrowKey)}, kind: 'holiday', label: 'Smoke holiday', slots: []})`);
  await routine.waitFor(`window.SRStore.state.routine.exceptions.some((item) => item.label === 'Smoke holiday')`, 6000, 'temporary holiday saved');
  check(true, 'temporary holiday is stored without changing the routine');
  await routine.evaluate(`document.querySelector('.routine-nav-item[data-tab="today"]').click()`);
  await routine.waitFor(`document.querySelectorAll('#viewToday .exception-row').length >= 1`, 6000, 'exception list');
  const exceptionText = await routine.evaluate(`(document.querySelector('#viewToday .exception-list') || {}).textContent || ''`);
  check(/Smoke holiday/.test(exceptionText), 'temporary changes are visible on the routine page');
  await routine.screenshot('22-routine-temporary-change');
  await routine.evaluate(`window.SRStore.call('deleteRoutineException', ${JSON.stringify(tomorrowKey)})`);
  await routine.waitFor(`!window.SRStore.state.routine.exceptions.some((item) => item.label === 'Smoke holiday')`, 6000, 'temporary holiday removed');

  const editedData = readData();
  const untouchedSeed = editedData.sessions.find((item) => item.id === 'seed-routine-session');
  check(untouchedSeed && untouchedSeed.entry === seededRoutineData.sessions[0].entry,
    'editing the timetable never rewrites recorded sessions');
  check(Boolean(editedData.routine.dayPlans[core.dateKey(new Date())]), 'today\'s plan is snapshotted for history');
  check(routine.errors.length === 0, 'no console or runtime errors in My Routine' + (routine.errors.length ? ': ' + routine.errors.join(' | ') : ''));

  routine.close();
  popover.close();
  await stop(child);

  console.log('\nPhase 8 · routine persistence across restart');
  child = launch();
  target = await waitForTarget('/index.html', 30000);
  popover = await PageClient.connect(target.webSocketDebuggerUrl);
  await popover.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'restart boot');
  const persistedRoutine = readData();
  const persistedDays = persistedRoutine.routine.routines[0].days[seededWeekday];
  check(persistedDays.length === seededSlotCount, 'routine persists until the user changes it');
  check(persistedRoutine.sessions.filter((item) => item.routineSlotId).length >= 1, 'session-to-slot links survive a restart');
  await popover.evaluate(`document.getElementById('routineBtn').click()`);
  const restartRoutineTarget = await waitForTarget('/routine.html', 10000);
  const restartRoutine = await PageClient.connect(restartRoutineTarget.webSocketDebuggerUrl);
  await restartRoutine.waitFor(`document.querySelectorAll('#viewToday .timeline-row').length === ${seededSlotCount}`, 10000, 'restart timeline');
  await delay(500);
  check(true, 'My Routine reopens with the saved timetable after restart');
  await restartRoutine.screenshot('23-routine-after-restart');
  check(restartRoutine.errors.length === 0, 'no console errors after routine restart');
  restartRoutine.close();
  popover.close();
  await stop(child);

  // ---------- Phase 9: floating dashboard launcher ----------
  console.log('\nPhase 9 · floating launcher, snapping and compact dashboard');
  DATA_DIR = DATA_DIR_A;
  const registerCount = readData().sessions.length;
  child = launch();
  target = await waitForTarget('/index.html', 30000);
  popover = await PageClient.connect(target.webSocketDebuggerUrl);
  await popover.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'floating launch boot');
  const floatTarget = await waitForTarget('/floating.html', 12000);
  const floater = await PageClient.connect(floatTarget.webSocketDebuggerUrl);
  await floater.waitFor(`Boolean(document.getElementById('floatIcon'))`, 6000, 'floating icon rendered');
  await delay(500);

  const iconStart = await floater.evaluate(`({
    width: window.innerWidth,
    height: window.innerHeight,
    button: Math.round(document.getElementById('floatIcon').getBoundingClientRect().width),
    x: window.screenX,
    y: window.screenY,
    docked: document.body.classList.contains('is-docked'),
    visible: document.visibilityState,
    sliverHit: document.elementFromPoint(12, 29) === document.getElementById('floatIcon'),
    avail: { x: window.screen.availLeft, y: window.screen.availTop, width: window.screen.availWidth, height: window.screen.availHeight }
  })`);
  check(iconStart.width === 58 && iconStart.height === 58, 'floating icon window is compact (58×58)');
  check(iconStart.button === 44, 'floating icon renders a 44px circular button');
  check(iconStart.visible === 'visible', 'floating icon is visible after launch');
  check(iconStart.docked === true && iconStart.x > iconStart.avail.x + iconStart.avail.width / 2,
    'floating icon starts docked to the right edge');
  const startPeek = iconStart.avail.x + iconStart.avail.width - iconStart.x;
  check(startPeek > 0 && startPeek <= 24,
    'docked launcher starts tucked under the bezel (' + startPeek + 'px visible)');
  check(iconStart.sliverHit === true, 'the visible bezel sliver is hit-testable');
  await floater.screenshot('24-floating-icon-tucked');

  await revealFloater(floater);
  const revealedIcon = await floater.evaluate(`({
    x: window.screenX,
    avail: { x: window.screen.availLeft, width: window.screen.availWidth }
  })`);
  check(revealedIcon.x === revealedIcon.avail.x + revealedIcon.avail.width - 51,
    'hovering the sliver pops the icon flush to the screen edge');
  await floater.screenshot('24a-floating-icon-revealed');

  const idleIcon = await floater.evaluate(`({
    running: document.getElementById('floatIcon').classList.contains('is-running'),
    animations: ['.float-hand-hour', '.float-hand-minute']
      .map((selector) => getComputedStyle(document.querySelector(selector)).animationName),
    secondHand: Boolean(document.querySelector('.float-hand-second')),
    svg: Math.round(document.querySelector('.float-icon svg').getBoundingClientRect().width)
  })`);
  check(idleIcon.running === false && idleIcon.animations.join(',') === 'none,none',
    'clock hands rest at 4:00 with no session running');
  check(idleIcon.secondHand === false, 'the clock has no second hand');
  check(idleIcon.svg === 25, 'the clock glyph is enlarged to 25px');

  await popover.evaluate(`document.querySelector('#subjectGrid [data-subject="chemistry"]').click()`);
  await popover.evaluate(`document.getElementById('entryBtn').click()`);
  await popover.waitFor('Boolean(window.SRStore.state.activeSession)', 6000, 'session for the floating clock');
  await floater.waitFor(`document.getElementById('floatIcon').classList.contains('is-running')`, 6000, 'floating clock starts');
  await delay(250);
  const runningIcon = await floater.evaluate(`({
    running: document.getElementById('floatIcon').classList.contains('is-running'),
    animations: ['.float-hand-hour', '.float-hand-minute']
      .map((selector) => getComputedStyle(document.querySelector(selector)).animationName),
    durations: ['.float-hand-hour', '.float-hand-minute']
      .map((selector) => getComputedStyle(document.querySelector(selector)).animationDuration)
  })`);
  check(runningIcon.running === true, 'the floating clock marks the running session');
  check(runningIcon.animations.join(',') === 'float-clock-turn,float-clock-turn',
    'the hour and minute hands turn while the timer is running');
  check(runningIcon.durations.join(',') === '43200s,3600s',
    'the hands are geared like a real clock (12h / 1h)');
  await floater.screenshot('24b-floating-icon-running');

  await popover.evaluate(`document.getElementById('discardBtn').click()`);
  await popover.waitFor(`Boolean(document.querySelector('.modal-root .modal-confirm-copy'))`, 4000, 'discard the floating clock session');
  await popover.evaluate(`document.querySelectorAll('.modal-root .modal-foot .btn')[1].click()`);
  await popover.waitFor('!window.SRStore.state.activeSession', 6000, 'floating clock session discarded');
  await floater.waitFor(`!document.getElementById('floatIcon').classList.contains('is-running')`, 5000, 'floating clock stops');
  await delay(250);
  const stoppedIcon = await floater.evaluate(`({
    animations: ['.float-hand-hour', '.float-hand-minute']
      .map((selector) => getComputedStyle(document.querySelector(selector)).animationName)
  })`);
  check(stoppedIcon.animations.join(',') === 'none,none',
    'the clock hands stop when the timer stops');

  await revealFloater(floater);
  await clickAt(floater, 29, 29);
  const panelTarget = await waitForTarget('/dashboard.html?compact=1', 10000);
  const panel = await PageClient.connect(panelTarget.webSocketDebuggerUrl);
  await panel.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'compact dashboard boot');
  await panel.waitFor(`document.documentElement.classList.contains('is-compact')`, 5000, 'compact layout');
  await delay(650);
  const panelState = await panel.evaluate(`({
    compact: document.documentElement.classList.contains('is-compact'),
    edgeRight: document.documentElement.classList.contains('is-edge-right'),
    rail: parseInt(getComputedStyle(document.querySelector('.dash-shell')).paddingRight, 10),
    visible: document.visibilityState,
    focus: document.hasFocus(),
    kpis: document.querySelectorAll('.kpi-card').length,
    ranges: document.querySelectorAll('#rangeSwitch [data-range]').length,
    sessions: document.getElementById('kpiSessions').textContent,
    width: window.innerWidth,
    height: window.innerHeight,
    x: window.screenX,
    y: window.screenY,
    avail: { x: window.screen.availLeft, y: window.screen.availTop, width: window.screen.availWidth, height: window.screen.availHeight }
  })`);
  check(panelState.compact === true, 'floating panel reuses the dashboard in compact mode');
  check(panelState.visible === 'visible' && panelState.focus === true, 'clicking the floating icon opens and focuses the dashboard panel');
  check(panelState.kpis === 4 && panelState.ranges === 4, 'compact panel keeps the dashboard KPIs and range switcher');
  check(Number(panelState.sessions) >= 1, 'compact panel shows the existing register data (' + panelState.sessions + ' sessions)');
  check(panelState.edgeRight === true && panelState.rail === 66, 'docked launcher opens the panel flush to the right edge with a handle rail');
  check(panelState.x + panelState.width === panelState.avail.x + panelState.avail.width &&
    panelState.y === panelState.avail.y && panelState.height === panelState.avail.height,
    'edge panel fills the display work area');
  check(panelState.x >= panelState.avail.x && panelState.x + panelState.width <= panelState.avail.x + panelState.avail.width,
    'compact panel stays within horizontal screen bounds');
  check(panelState.y >= panelState.avail.y && panelState.y + panelState.height <= panelState.avail.y + panelState.avail.height,
    'compact panel stays within vertical screen bounds');
  await panel.screenshot('25-floating-panel');

  await clickAt(panel, 120, 150);
  check((await panel.evaluate('document.hasFocus()')) === true, 'clicking inside the panel keeps it open');

  await clickAt(floater, 29, 29);
  await delay(350);
  check((await panel.evaluate('document.hasFocus()')) === false, 'clicking the floating icon closes the panel');

  await mouseEvent(floater, 'mouseMoved', 2, 55);
  await delay(1600);
  const retucked = await floater.evaluate(`({
    x: window.screenX,
    docked: document.body.classList.contains('is-docked'),
    avail: { x: window.screen.availLeft, width: window.screen.availWidth }
  })`);
  check(retucked.docked === true && retucked.x === retucked.avail.x + retucked.avail.width - 23,
    'leaving the icon tucks it back under the bezel');

  const windowTargets = await targets();
  check(windowTargets.filter((item) => item.type === 'page' && item.url.includes('compact=1')).length === 1,
    'only one compact dashboard window exists');
  check(windowTargets.filter((item) => item.type === 'page' && item.url.includes('/floating.html')).length === 1,
    'only one floating icon window exists');

  await revealFloater(floater);
  const iconBeforeDrag = await floater.evaluate('({ x: window.screenX, y: window.screenY })');
  await dragAt(floater, 29, 29, 2, 29, 64);
  const iconAfterDrag = await floater.evaluate(`({
    x: window.screenX,
    y: window.screenY,
    docked: document.body.classList.contains('is-docked'),
    availX: window.screen.availLeft
  })`);
  check(iconAfterDrag.docked === true && iconAfterDrag.x <= iconAfterDrag.availX + 12,
    'dragging to the left edge snaps the icon to the dock');
  check(Math.abs(iconAfterDrag.y - iconBeforeDrag.y) <= 2,
    'edge snapping preserves the vertical position (' + iconBeforeDrag.y + ' → ' + iconAfterDrag.y + ')');
  const floatSaved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'floating.json'), 'utf8'));
  check(floatSaved.docked === 'left' && floatSaved.x === iconAfterDrag.availX + 8,
    'the docked rail position is written to floating.json');

  await revealFloater(floater);
  await clickAt(floater, 29, 29);
  await delay(550);
  const leftPanelState = await panel.evaluate(`({
    edgeLeft: document.documentElement.classList.contains('is-edge-left'),
    rail: parseInt(getComputedStyle(document.querySelector('.dash-shell')).paddingLeft, 10),
    width: window.innerWidth,
    x: window.screenX,
    availX: window.screen.availLeft
  })`);
  check(leftPanelState.edgeLeft === true && leftPanelState.rail === 66 && leftPanelState.x === leftPanelState.availX,
    'docked left opens the panel flush to the left edge');
  await revealFloater(floater);
  await clickAt(floater, 29, 29);
  await delay(350);

  await revealFloater(floater);
  await dragAt(floater, 29, 29, 56, 29, 14);
  await delay(600);
  const iconOut = await floater.evaluate('({ x: window.screenX, docked: document.body.classList.contains("is-docked") })');
  check(iconOut.docked === false && iconOut.x > 50, 'dragging outward undocks the floating icon');
  check((await panel.evaluate('document.visibilityState')) === 'visible', 'dragging a docked icon outward reveals the panel');
  const cardState = await panel.evaluate(`({
    edge: document.documentElement.classList.contains('is-edge'),
    width: window.innerWidth
  })`);
  check(cardState.edge === false && cardState.width === 430, 'undocked launcher returns to the compact floating card');
  await panel.screenshot('25b-floating-panel-outward');
  await clickAt(floater, 29, 29);
  await delay(350);

  const openTargets = await targets();
  const fullDashTarget = openTargets.find((item) => item.type === 'page' && item.url.endsWith('/dashboard.html'));
  check(Boolean(fullDashTarget), 'full dashboard window is ready for the double-click gesture');
  let fullDash = null;
  if (fullDashTarget) {
    fullDash = await PageClient.connect(fullDashTarget.webSocketDebuggerUrl);
    await fullDash.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'full dashboard boot');
    check((await fullDash.evaluate('document.hasFocus()')) === false, 'full dashboard starts hidden');
  }

  await revealFloater(floater);
  await clickAt(floater, 29, 29);
  await clickAt(floater, 29, 29);
  await delay(700);
  if (fullDash) {
    check((await fullDash.evaluate('document.hasFocus()')) === true, 'double-clicking the floating icon opens and focuses the full dashboard');
    check((await panel.evaluate('document.hasFocus()')) === false, 'double-click closes the compact panel');
    await fullDash.screenshot('25c-full-dashboard-double-click');
    await longPressAt(floater, 29, 29);
    check((await popover.evaluate('document.hasFocus()')) === true,
      'long-pressing the floating icon opens and focuses the quick popover');
    check((await fullDash.evaluate('document.hasFocus()')) === false,
      'long press closes the full dashboard');
    await popover.screenshot('25d-popover-long-press');
    fullDash.close();
  }

  check(readData().sessions.length === registerCount, 'floating state is stored separately from the study register');

  panel.close();
  floater.close();
  popover.close();
  await stop(child);

  console.log('\nPhase 10 · floating icon restores after restart');
  const savedFloat = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'floating.json'), 'utf8'));
  child = launch();
  target = await waitForTarget('/index.html', 30000);
  popover = await PageClient.connect(target.webSocketDebuggerUrl);
  await popover.waitFor('Boolean(window.SRStore && window.SRStore.state)', 10000, 'float restart boot');
  const restartFloatTarget = await waitForTarget('/floating.html', 12000);
  const restartFloater = await PageClient.connect(restartFloatTarget.webSocketDebuggerUrl);
  await restartFloater.waitFor(`Boolean(document.getElementById('floatIcon'))`, 6000, 'floating icon after restart');
  await delay(500);
  const restored = await restartFloater.evaluate(`({
    x: window.screenX,
    y: window.screenY,
    docked: document.body.classList.contains('is-docked'),
    visible: document.visibilityState,
    avail: { width: window.screen.availWidth, height: window.screen.availHeight }
  })`);
  check(Math.abs(restored.x - savedFloat.x) <= 2 && Math.abs(restored.y - savedFloat.y) <= 2,
    'floating icon position survives a restart (' + restored.x + ',' + restored.y + ')');
  check(restored.docked === (savedFloat.docked !== null), 'docked state survives a restart');
  check(restored.visible === 'visible', 'floating icon is visible again after restart');
  check(restored.x >= 0 && restored.x + 58 <= restored.avail.width, 'restored icon stays inside the screen');
  await restartFloater.screenshot('26-floating-restored');

  restartFloater.close();
  popover.close();
  await stop(child);

  console.log('\nScreenshots: ' + SHOTS);
  if (failures.length) {
    console.log('\nSMOKE FAILED (' + failures.length + '):');
    failures.forEach((item) => console.log(' - ' + item));
    if (logs.trim()) console.log('\nElectron output:\n' + logs.slice(-4000));
    process.exitCode = 1;
  } else {
    console.log('\nSMOKE PASSED · all checks green');
  }
}

main().catch(async (error) => {
  console.error('\nSMOKE ERROR:', error && error.stack ? error.stack : error);
  if (logs.trim()) console.error('\nElectron output:\n' + logs.slice(-4000));
  await stop(child);
  process.exitCode = 1;
});
