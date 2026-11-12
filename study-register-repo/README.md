# Study Register

A premium, local-first study attendance register that lives in the macOS menu bar. Pick a subject, press **ENTRY**, study, press **EXIT** — the exact entry and exit times are recorded and the duration is calculated from timestamps, never from a ticking counter.

It also keeps a permanent weekly routine: schedule your activities once, get exact-time reminders when each one starts, start a session straight from the schedule, and compare planned time with what you actually recorded.

A small floating clock button stays above other apps so the dashboard is always one click away.

Built with Electron, vanilla HTML/CSS/JavaScript and a timestamp-based core. No accounts, no cloud, no telemetry.

---

## Requirements

- macOS 12 (Monterey) or later
- Apple silicon (arm64 build)
- Node.js 20+ and npm (only for building from source)

## Install

1. Open `Study-Register-1.0.0-arm64.dmg`.
2. Drag **Study Register** into **Applications**.
3. Open **Study Register** from Applications.

The app has no Dock icon by design. It appears as a clock icon in the menu bar. If this is the first launch, the popover opens automatically; afterwards click the menu bar icon any time.

> The build is ad-hoc signed, not notarized. If macOS blocks the first launch, right-click the app in Finder and choose **Open**, or allow it under **System Settings → Privacy & Security**.

## Use

1. Click the menu bar icon.
2. Select a subject chip (Physics, Chemistry, Mathematics, Coding, Revision, Other — or your own).
3. Press **ENTRY**. The timer, ring and live totals run from the recorded entry timestamp.
4. Press **EXIT** when finished. The session is written to the register immediately.
5. Open **Routine** to build the weekly timetable, follow today's schedule and manage reminders.
6. Open **Dashboard** for analytics and the full register, or **Settings** for goals, appearance, notifications, subjects, backup and export.

### Menu bar popover

- Live HH:MM:SS timer plus subject and entry time.
- While a session is running, the menu bar shows the live elapsed time next to the icon and clears it again on Exit or Discard.
- Daily goal ring and progress bar.
- Today's study time, session count, longest session and average.
- Streak badge, recent sessions, quick access to the dashboard.
- Subject selection is locked while a session is running.
- **Discard** (trash button in the hero card) asks for confirmation before throwing away a running session.

### My Routine

Open **My Routine** from the repeat icon in the popover header, the **Routine** footer button, or the routine icon in the dashboard header. The timetable is permanent: it survives restarts and is never reset at midnight — only today's progress moves on.

**Today's Schedule** shows every planned activity as *Upcoming*, *Now*, *Completed*, *Missed* or *Skipped*, with the current and next block, time remaining and planned versus actual hours. You can start or exit a session, mark an activity completed or skipped, and undo that mark. The popover suggests the scheduled subject when you open it; choosing a slot there links the real ENTRY/EXIT session to that activity for planned-versus-actual comparison. The recorded entry and exit times are never rewritten to match the timetable.

**Edit Timetable** manages one or more routines (one is the default) with activities per weekday. Each activity has a name, type (Physics, Chemistry, Mathematics, Coding, Revision, Coaching/Classes, Homework, Break, Personal, Sleep, Other), optional subject, start and end time, automatic duration, and notes. Activities can be edited, deleted and reordered, may cross midnight, and are warned about when they overlap. Every weekday has its own independent activity list: editing Monday never changes Tuesday. Changes apply from today forward for that weekday; recorded sessions and past days keep their original plan. **Clear** empties the selected weekday after confirmation without touching the other days.

**Weekly Routine** assigns a routine to each weekday, so weekdays and weekends can differ, with planned hours per weekday and per week.

**Templates** — open any day with activities and choose **Use as template** to copy its full schedule to other weekdays in one step. Select individual days or use the *Weekdays*, *Weekend* or *All other days* presets, and optionally make those days follow the routine. Replacing an existing day asks for confirmation in the picker; recorded sessions and past days are never changed. Each copied day is an independent copy, so you can then edit, add to, or clear any weekday without changing the others. The copy button on each Weekly Routine row opens the same picker.

**Routine Analytics** compares planned versus recorded time for the last week, month or all time: planned, actual, difference, completion percentage, daily average, missed slots, a subject breakdown, your most consistent slots and a missed-slot list. No points, coins, badges or leaderboards.

**Temporary changes** add a holiday or a one-off custom day without touching the permanent routine. Days already lived keep a snapshot of what was planned at the time.

**Routine reminders** alert you at each activity's exact scheduled time. Exact-time reminders are on by default for every activity; 5, 10, 15 and 30-minute early reminders can be added and combined. A global switch, per-subject preferences and per-activity overrides control them, and any subject or activity can be muted. Notifications offer **Start Session** (opens the register with the subject selected, without creating a duplicate session), **Snooze 5 Minutes** and **Dismiss**. Reminders are de-duplicated, suppressed once a session starts or an activity is skipped, and respect holidays; the scheduler recalculates after sleep/wake, at midnight, on timezone changes, and whenever the timetable or preferences change. An optional missed-slot reminder is off by default. The Notifications page shows macOS permission status, a **Test Notification** button and a shortcut to System Settings when permission is denied.

### Dashboard

- Ranges: **Today**, **This week** (Mon–Sun), **This month**, **All time** (monthly breakdown).
- Study time bars, subject distribution donut, KPI cards and active-day counts.
- Full register with subject search, date filter, inline edit (entry/exit times and subject) and delete with confirmation.
- Newest first, grouped by day, with an automatic "next day" tag for sessions that cross midnight.

### Floating launcher

A small circular clock button floats above normal windows, so the dashboard stays reachable while you work in another app. It is a separate slim window, not a second copy of the app — there is only ever one.

- **Click** the button to open the dashboard, or click it again (or anywhere outside the panel) to close it. While docked, the dashboard slides out from that edge as a tall panel with the clock button resting in a handle rail at the screen edge. While undocked, it opens as a compact floating card next to the button.
- **Double-click** the button to open the full dashboard window instead of the compact panel. The compact panel, if open, closes.
- **Long-press** the button (hold for half a second, then release) to open the quick Study Register popover for entry/exit and today's controls. A held press never counts as a click, and any open dashboard or panel closes.
- While a study session is running, the button becomes a working clock: the hour and minute hands set themselves to the current time and turn at real clock speeds (12 hours and 1 hour per turn). The hands rest at 4:00 when the session stops.
- **Drag** it anywhere on screen. A drag never counts as a click, so moving the button cannot open or close the panel by accident.
- **Snap** it to the left or right edge by releasing near that edge. It keeps its vertical position and, when that edge is the outer edge of the screen, tucks itself under the bezel so only a thin sliver of the button stays visible. Brush the sliver and the button pops back out, flush with the edge; move the pointer away and it slips back under. Pull it inward to free it from the dock.
- The tucked button stays out while the edge panel is open and while you are dragging it. Edges that face another display keep the button in the visible handle rail instead of hiding it there.
- **Drag a docked button outward** and the compact dashboard opens as soon as it leaves the dock.
- The compact panel is the existing dashboard — same KPIs, ranges, charts and register — sized for the small window. It is clamped inside the screen and never covers the button.
- The last position and docked side are remembered across restarts. If a display is disconnected or the resolution changes, the button is moved back into the visible area of a connected display.

### Settings

- Daily target (15 minutes to 24 hours, with 2h/4h/6h/8h presets).
- Default subject and appearance (**Dark**, **Light**, **System**). Dark is the default.
- Notifications: master switch plus start, session-recorded and target-reached events.
- Subject management: add, rename, remove (at least one subject must remain; a running subject cannot be removed).
- Backup JSON, restore JSON, export CSV, reveal the data folder, copy the data path.
- Reset all data with typed confirmation.

### Keyboard

| Shortcut | Action |
| --- | --- |
| `Esc` | Close popover or active dialog |
| `⌘Q` | Quit |
| `⌘⇧R` | Open the menu bar register |
| `⌘⇧M` | Open My Routine |
| `⌘D` | Open the dashboard |

## Data and reliability

All data is stored on this Mac:

```
~/Library/Application Support/Study Register/data.json
```

Supporting files in the same folder:

- `data.backup.json` — rotating previous copy, used automatically if `data.json` cannot be read.
- `data.before-restore.json` — safety copy written before a restore.
- `data.before-reset.json` — safety copy written before a reset.
- `floating.json` — position and docked side of the floating launcher. It is separate from `data.json`, so moving the button never touches your study record.

Reliability details:

- Saves are atomic (write to a temp file, rotate the previous file to the backup slot, rename into place).
- The active session is persisted the moment you press ENTRY, so closing the app, restarting it or an unexpected shutdown does not lose the entry time.
- On relaunch the active session is restored and the timer continues from the original entry timestamp.
- Durations are always recomputed from entry/exit timestamps. Sessions that cross midnight are split across days for daily totals while staying one record in the register.
- Totals only include actually recorded sessions.
- History is never reset by an update; new versions normalize existing data without discarding valid records.
- CSV export is Excel-friendly (UTF-8 BOM, CRLF, quoted fields).

Routine timetables, weekday assignments, temporary changes, reminder preferences, notification history, per-day plan snapshots and session-to-activity links are stored in the same `data.json` file. Reminders are scheduled locally by the app; no scheduled time leaves this Mac.

Uninstalling the app does not delete your data. Remove the folder above manually if you want a clean slate.

## Privacy and security

- Local only. No external servers, remote scripts, analytics or telemetry.
- Renderer windows use context isolation, sandboxing, no Node integration and a restrictive Content Security Policy.
- The preload exposes a small, fixed API — no raw filesystem or IPC access.
- Every IPC request is validated against the app's own local windows and files.
- Filesystem access is limited to the app's data folder, plus the JSON/CSV files you explicitly choose in a native save/open dialog.
- Navigation and new windows are blocked.
- Study data files are written with owner-only permissions (`0600`).

## Build from source

```bash
npm install
npm start          # run the app in development
npm test           # 49 core logic tests (timestamps, midnight splits, analytics, normalization, CSV, routine planning, templates, reminders and launcher geometry)
npm run smoke      # live Electron run: entry/exit, restart, crash recovery, themes, register, dashboard, My Routine, floating launcher
npm run pack       # unpacked macOS arm64 app in dist/
npm run dist       # icons + DMG in dist/
```

The smoke test launches the real app against a throwaway data directory via the Chrome DevTools Protocol, drives the UI, kills the process to verify recovery, and writes screenshots to `.smoke/shots/`.

If your npm cache is unavailable, install with a project-local cache:

```bash
npm install --cache ./.npm-cache
```

## Project structure

```
main.js                 Electron main process: windows, tray, IPC, storage, notifications, routine scheduler
preload.js              contextBridge API (window.sr)
src/
  index.html            Menu bar popover
  dashboard.html        Analytics and register window (also used for the compact panel)
  routine.html          My Routine window
  floating.html         Floating launcher button
  css/style.css         Design system, popover, modals, settings
  css/dashboard.css     Dashboard layout and charts
  css/compact.css       Compact layout for the floating dashboard panel
  css/floating.css      Floating launcher button
  css/routine.css       My Routine layout, timeline and timetable editor
  js/core.js            Pure timestamp/statistics/normalization/CSV/routine logic (shared + tested)
  js/float-layout.js    Pure clamping, edge-snap and restore geometry for the launcher (shared + tested)
  js/storage.js         Renderer store and IPC calls
  js/timer.js           Timestamp-derived live timer
  js/history.js         Register and recent list
  js/analytics.js       Charts, KPIs and range switching
  js/settings.js        Settings sheet
  js/app.js             Popover controller
  js/dashboard.js       Dashboard controller
  js/floating.js        Floating launcher drag controller
  js/routine.js         My Routine controller
scripts/generate-assets.js  App icon and template tray icons
scripts/smoke.js            Live Electron verification
tests/core.test.js          Register, statistics and normalization tests
tests/routine.test.js       Routine planning, reminders and analytics tests
tests/float-layout.test.js  Launcher snapping, clamping and restore tests
build/                      Generated .icns/.png icons
```

Version 1.0.0 · bundle identifier `com.veervibes.studyregister` · macOS arm64
