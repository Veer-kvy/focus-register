/* Settings sheet: goal, defaults, appearance, notifications, subjects and data. */
(function () {
  'use strict';

  const core = window.SRCore;
  const ui = window.SRUI;
  const store = window.SRStore;

  function targetLabel(minutes) {
    return Math.floor(minutes / 60) + 'h ' + core.pad2(minutes % 60) + 'm';
  }

  function openSettings() {
    const modal = ui.openModal({
      title: 'Settings',
      subtitle: 'Everything is stored locally on this Mac.',
      wide: true,
      footer: [{ label: 'Done', className: 'primary', onClick: () => modal.close() }]
    });

    function currentState() {
      return store.state;
    }

    function renderBody() {
      const state = currentState();
      const meta = store.meta || {};
      const minutes = state.settings.dailyTargetMinutes;
      modal.body.innerHTML =
        '<div class="settings-body">' +
        '<section class="setting-group">' +
        '<div class="setting-title">' + ui.icon('target') + 'Study goal</div>' +
        '<div class="target-editor">' +
        '<div class="target-display"><span class="value" id="targetValue">' + ui.escapeHtml(targetLabel(minutes)) + '</span><span class="suffix">daily target</span></div>' +
        '<div class="stepper"><button type="button" data-step="-15" aria-label="Decrease target">−</button><button type="button" data-step="15" aria-label="Increase target">+</button></div>' +
        '</div>' +
        '<div class="preset-row">' +
        [120, 240, 360, 480].map((preset) => '<button type="button" class="preset-chip' + (minutes === preset ? ' is-active' : '') + '" data-preset="' + preset + '">' + preset / 60 + 'h</button>').join('') +
        '</div>' +
        '</section>' +

        '<section class="setting-group">' +
        '<div class="setting-title">' + ui.icon('spark') + 'Defaults</div>' +
        '<div class="setting-row">' +
        '<div class="setting-copy"><strong>Default subject</strong><span>Preselected when the register opens</span></div>' +
        '<div class="setting-control"><select class="select" id="defaultSubjectSelect" style="width:132px">' +
        state.subjects.map((subject) => '<option value="' + ui.escapeHtml(subject.id) + '"' + (subject.id === state.settings.defaultSubjectId ? ' selected' : '') + '>' + ui.escapeHtml(subject.name) + '</option>').join('') +
        '</select></div></div>' +
        '<div class="setting-row">' +
        '<div class="setting-copy"><strong>Appearance</strong><span>Match macOS or keep a fixed theme</span></div>' +
        '<div class="segmented" id="appearanceControl">' +
        ['dark', 'light', 'system'].map((mode) => '<button type="button" data-appearance="' + mode + '" class="' + (state.settings.appearance === mode ? 'is-active' : '') + '">' + (mode === 'dark' ? 'Dark' : mode === 'light' ? 'Light' : 'System') + '</button>').join('') +
        '</div></div>' +
        '</section>' +

        '<section class="setting-group">' +
        '<div class="setting-title">' + ui.icon('info') + 'Notifications</div>' +
        '<div class="setting-row">' +
        '<div class="setting-copy"><strong>Allow notifications</strong><span>Show macOS alerts for session events</span></div>' +
        '<div class="setting-control"><button type="button" class="switch" role="switch" data-notif="enabled" aria-checked="' + state.settings.notifications.enabled + '" aria-label="Allow notifications"></button></div>' +
        '</div>' +
        '<div class="setting-row">' +
        '<div class="setting-copy"><strong>Session started</strong><span>Confirm when the timer starts</span></div>' +
        '<div class="setting-control"><button type="button" class="switch" role="switch" data-notif="onStart" aria-checked="' + state.settings.notifications.onStart + '" aria-label="Session started notification"></button></div>' +
        '</div>' +
        '<div class="setting-row">' +
        '<div class="setting-copy"><strong>Session recorded</strong><span>Show the saved duration after EXIT</span></div>' +
        '<div class="setting-control"><button type="button" class="switch" role="switch" data-notif="onEnd" aria-checked="' + state.settings.notifications.onEnd + '" aria-label="Session recorded notification"></button></div>' +
        '</div>' +
        '<div class="setting-row">' +
        '<div class="setting-copy"><strong>Daily target reached</strong><span>Notify when the study goal is reached</span></div>' +
        '<div class="setting-control"><button type="button" class="switch" role="switch" data-notif="onTarget" aria-checked="' + state.settings.notifications.onTarget + '" aria-label="Daily target notification"></button></div>' +
        '</div>' +
        '</section>' +

        '<section class="setting-group">' +
        '<div class="setting-title">' + ui.icon('layers') + 'Subjects</div>' +
        '<div class="subject-manage-list" id="subjectManageList"></div>' +
        '<div class="add-subject-row">' +
        '<input class="input" id="newSubjectInput" type="text" maxlength="32" placeholder="Add a subject" autocomplete="off" spellcheck="false">' +
        '<button class="btn small" type="button" id="addSubjectBtn">' + ui.icon('plus') + 'Add</button>' +
        '</div>' +
        '</section>' +

        '<section class="setting-group">' +
        '<div class="setting-title">' + ui.icon('database') + 'Your data</div>' +
        '<div class="data-actions">' +
        '<button class="btn" type="button" id="backupBtn">' + ui.icon('download') + 'Back up</button>' +
        '<button class="btn" type="button" id="restoreBtn">' + ui.icon('upload') + 'Restore</button>' +
        '<button class="btn" type="button" id="exportBtn">' + ui.icon('list') + 'Export CSV</button>' +
        '<button class="btn" type="button" id="revealBtn">' + ui.icon('folder') + 'Show in Finder</button>' +
        '</div>' +
        '<div class="data-path"><span>' + ui.icon('lock') + '</span><span class="path" title="' + ui.escapeHtml(meta.dataPath || '') + '">' + ui.escapeHtml(meta.dataPath || 'Stored locally') + '</span>' +
        '<button class="icon-text-btn" type="button" id="copyPathBtn">Copy</button></div>' +
        '</section>' +

        '<section class="setting-group">' +
        '<div class="danger-zone">' +
        '<div class="setting-row">' +
        '<div class="setting-copy"><strong>Reset all data</strong><span>Deletes sessions, subjects and settings. A safety copy is saved first.</span></div>' +
        '<div class="setting-control"><button class="btn small danger" type="button" id="resetBtn">Reset</button></div>' +
        '</div></div>' +
        '</section>' +

        '<section class="setting-group">' +
        '<div class="about-block">' +
        '<div class="about-icon"><img src="assets/icons/appIcon.png" alt=""></div>' +
        '<div class="about-copy"><strong>Study Register ' + ui.escapeHtml(meta.version || '') + '</strong><span>Local-first. No account, no cloud, no telemetry.</span></div>' +
        '<div class="spacer"></div>' +
        '<button class="icon-text-btn" type="button" id="quitSettingsBtn">' + ui.icon('power') + 'Quit</button>' +
        '</div>' +
        '</section>' +
        '</div>';

      const list = modal.body.querySelector('#subjectManageList');
      renderSubjectList(list);
      bindEvents();
      syncNotificationState(minutes);
    }

    function renderSubjectList(list) {
      const state = currentState();
      list.innerHTML = state.subjects.map((subject) => (
        '<div class="subject-manage-row" data-id="' + ui.escapeHtml(subject.id) + '" style="--subject:' + ui.escapeHtml(subject.color) + '">' +
        '<span class="dot"></span>' +
        '<span class="subject-name"></span>' +
        '<div class="row-actions">' +
        '<button class="mini-icon-btn" type="button" data-rename="' + ui.escapeHtml(subject.id) + '" title="Rename subject" aria-label="Rename subject">' + ui.icon('pencil') + '</button>' +
        '<button class="mini-icon-btn danger" type="button" data-remove="' + ui.escapeHtml(subject.id) + '" title="Remove subject" aria-label="Remove subject">' + ui.icon('trash') + '</button>' +
        '</div></div>'
      )).join('');
      const names = list.querySelectorAll('.subject-name');
      state.subjects.forEach((subject, index) => {
        if (names[index]) names[index].textContent = subject.name;
      });
    }

    function refreshSubjectSelect() {
      const select = modal.body.querySelector('#defaultSubjectSelect');
      if (!select) return;
      const state = currentState();
      select.innerHTML = state.subjects.map((subject) => '<option value="' + ui.escapeHtml(subject.id) + '"' + (subject.id === state.settings.defaultSubjectId ? ' selected' : '') + '>' + ui.escapeHtml(subject.name) + '</option>').join('');
    }

    function applySettings(patch) {
      return store.call('updateSettings', patch).catch((error) => {
        ui.toast(error.message, 'error');
        throw error;
      });
    }

    function syncTargetUI(minutes) {
      const value = modal.body.querySelector('#targetValue');
      if (value) value.textContent = targetLabel(minutes);
      modal.body.querySelectorAll('[data-preset]').forEach((button) => {
        button.classList.toggle('is-active', Number(button.getAttribute('data-preset')) === minutes);
      });
    }

    function syncNotificationState(minutes) {
      const notifications = currentState().settings.notifications;
      modal.body.querySelectorAll('[data-notif]').forEach((button) => {
        const key = button.getAttribute('data-notif');
        button.setAttribute('aria-checked', String(Boolean(notifications[key])));
        if (key !== 'enabled') button.disabled = !notifications.enabled;
      });
      const appearance = currentState().settings.appearance;
      modal.body.querySelectorAll('[data-appearance]').forEach((button) => {
        button.classList.toggle('is-active', button.getAttribute('data-appearance') === appearance);
      });
      syncTargetUI(minutes);
    }

    function rerenderSubjects() {
      const list = modal.body.querySelector('#subjectManageList');
      if (list) renderSubjectList(list);
      refreshSubjectSelect();
    }

    function bindEvents() {
      modal.body.querySelectorAll('[data-step]').forEach((button) => {
        button.addEventListener('click', async () => {
          const step = Number(button.getAttribute('data-step'));
          const current = currentState().settings.dailyTargetMinutes;
          const next = core.clamp(current + step, 15, 1440);
          if (next === current) return;
          syncTargetUI(next);
          try {
            await applySettings({ dailyTargetMinutes: next });
          } catch (error) {
            syncTargetUI(currentState().settings.dailyTargetMinutes);
          }
        });
      });

      modal.body.querySelectorAll('[data-preset]').forEach((button) => {
        button.addEventListener('click', async () => {
          const preset = Number(button.getAttribute('data-preset'));
          syncTargetUI(preset);
          try {
            await applySettings({ dailyTargetMinutes: preset });
          } catch (error) {
            syncTargetUI(currentState().settings.dailyTargetMinutes);
          }
        });
      });

      const defaultSelect = modal.body.querySelector('#defaultSubjectSelect');
      if (defaultSelect) {
        defaultSelect.addEventListener('change', async () => {
          const previous = currentState().settings.defaultSubjectId;
          try {
            await applySettings({ defaultSubjectId: defaultSelect.value });
          } catch (error) {
            defaultSelect.value = previous;
          }
        });
      }

      modal.body.querySelectorAll('[data-appearance]').forEach((button) => {
        button.addEventListener('click', async () => {
          const mode = button.getAttribute('data-appearance');
          modal.body.querySelectorAll('[data-appearance]').forEach((item) => item.classList.toggle('is-active', item === button));
          try {
            await applySettings({ appearance: mode });
          } catch (error) {
            syncNotificationState(currentState().settings.dailyTargetMinutes);
          }
        });
      });

      modal.body.querySelectorAll('[data-notif]').forEach((button) => {
        button.addEventListener('click', async () => {
          const key = button.getAttribute('data-notif');
          const next = !currentState().settings.notifications[key];
          button.setAttribute('aria-checked', String(next));
          try {
            await applySettings({ notifications: { [key]: next } });
            syncNotificationState(currentState().settings.dailyTargetMinutes);
          } catch (error) {
            syncNotificationState(currentState().settings.dailyTargetMinutes);
          }
        });
      });

      const subjectList = modal.body.querySelector('#subjectManageList');
      subjectList.addEventListener('click', async (event) => {
        const renameButton = event.target.closest('[data-rename]');
        if (renameButton) {
          beginRename(renameButton.getAttribute('data-rename'));
          return;
        }
        const removeButton = event.target.closest('[data-remove]');
        if (removeButton) removeSubject(removeButton.getAttribute('data-remove'));
      });

      const addButton = modal.body.querySelector('#addSubjectBtn');
      const newInput = modal.body.querySelector('#newSubjectInput');
      const addSubject = async () => {
        const name = newInput.value.trim();
        if (!name) {
          newInput.focus();
          return;
        }
        try {
          await store.call('addSubject', name);
          newInput.value = '';
          rerenderSubjects();
          ui.toast('Subject added', 'success');
        } catch (error) {
          ui.toast(error.message, 'error');
        }
      };
      addButton.addEventListener('click', addSubject);
      newInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addSubject();
        }
      });

      modal.body.querySelector('#backupBtn').addEventListener('click', async () => {
        try {
          const response = await store.call('backupJson');
          if (!response.canceled) ui.toast('Backup saved · ' + response.count + ' sessions', 'success');
        } catch (error) {
          ui.toast(error.message, 'error');
        }
      });

      modal.body.querySelector('#restoreBtn').addEventListener('click', async () => {
        const confirmed = await ui.confirm({
          title: 'Restore from a backup?',
          message: 'Your current register will be replaced by the backup file you choose. A safety copy of the current data is saved first.',
          confirmLabel: 'Choose backup',
          danger: false
        });
        if (!confirmed) return;
        try {
          const response = await store.call('restoreJson');
          if (response.canceled) return;
          modal.close();
          ui.toast('Backup restored · ' + response.restored + ' sessions', 'success');
        } catch (error) {
          ui.toast(error.message, 'error');
        }
      });

      modal.body.querySelector('#exportBtn').addEventListener('click', async () => {
        try {
          const response = await store.call('exportCsv');
          if (!response.canceled) ui.toast('CSV exported · ' + response.count + ' sessions', 'success');
        } catch (error) {
          ui.toast(error.message, 'error');
        }
      });

      modal.body.querySelector('#revealBtn').addEventListener('click', () => {
        store.call('revealData').catch((error) => ui.toast(error.message, 'error'));
      });

      modal.body.querySelector('#copyPathBtn').addEventListener('click', async () => {
        try {
          await window.sr.copyDataPath();
          ui.toast('Data path copied', 'success');
        } catch (error) {
          ui.toast('Could not copy the path', 'error');
        }
      });

      modal.body.querySelector('#resetBtn').addEventListener('click', async () => {
        const confirmed = await ui.confirm({
          title: 'Reset all data?',
          message: 'This permanently deletes every session, subject and setting. A safety copy is written to the data folder before the reset.',
          confirmLabel: 'Reset everything',
          requireText: 'RESET'
        });
        if (!confirmed) return;
        try {
          await store.call('resetData', 'RESET');
          modal.close();
          ui.toast('All data reset', 'success');
        } catch (error) {
          ui.toast(error.message, 'error');
        }
      });

      const quitButton = modal.body.querySelector('#quitSettingsBtn');
      if (quitButton) quitButton.addEventListener('click', () => window.sr.quit());
    }

    function beginRename(id) {
      const row = modal.body.querySelector('.subject-manage-row[data-id="' + CSS.escape(id) + '"]');
      if (!row) return;
      const subject = currentState().subjects.find((item) => item.id === id);
      if (!subject) return;
      const nameNode = row.querySelector('.subject-name');
      if (!nameNode) return;
      const input = document.createElement('input');
      input.className = 'rename-input';
      input.type = 'text';
      input.maxLength = 32;
      input.value = subject.name;
      nameNode.replaceWith(input);
      input.focus();
      input.select();

      let settled = false;
      const cancel = () => {
        if (settled) return;
        settled = true;
        rerenderSubjects();
      };
      const commit = async () => {
        if (settled) return;
        const name = input.value.trim();
        if (!name || name === subject.name) {
          cancel();
          return;
        }
        settled = true;
        try {
          await store.call('renameSubject', id, name);
          rerenderSubjects();
          ui.toast('Subject renamed', 'success');
        } catch (error) {
          ui.toast(error.message, 'error');
          rerenderSubjects();
        }
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', commit);
    }

    async function removeSubject(id) {
      const state = currentState();
      const subject = state.subjects.find((item) => item.id === id);
      if (!subject) return;
      const confirmed = await ui.confirm({
        title: 'Remove ' + subject.name + '?',
        message: 'The subject disappears from the picker. Sessions already recorded keep their historical label.',
        confirmLabel: 'Remove subject'
      });
      if (!confirmed) return;
      try {
        await store.call('removeSubject', id);
        rerenderSubjects();
        syncNotificationState(currentState().settings.dailyTargetMinutes);
        ui.toast('Subject removed', 'success');
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    }

    renderBody();
    return modal;
  }

  window.SRSettings = { open: openSettings };
})();
