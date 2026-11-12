/* Study register rendering: compact recent list and full searchable register. */
(function () {
  'use strict';

  const core = window.SRCore;
  const ui = window.SRUI;
  const store = window.SRStore;

  function colorFor(state, session) {
    const subject = state.subjects.find((item) => item.id === session.subjectId);
    return (subject && subject.color) || core.colorForName(session.subjectName || 'Other');
  }

  function nameFor(state, session) {
    const subject = state.subjects.find((item) => item.id === session.subjectId);
    return (subject && subject.name) || session.subjectName || 'Other';
  }

  function renderRecent(container, state, now) {
    const moment = now || new Date();
    const todayKey = core.dateKey(moment);
    let list = state.sessions.filter((session) => core.dateKey(session.entry) === todayKey);
    list = list.slice(-3).reverse();
    const showingToday = list.length > 0;
    if (!list.length) list = state.sessions.slice(-3).reverse();

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-compact';
      empty.innerHTML =
        '<span>' + ui.icon('list') + '</span>' +
        '<div><strong>Your register is empty</strong>Select a subject and press ENTRY to record your first session.</div>';
      container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    list.forEach((session) => {
      const entryKey = core.dateKey(session.entry);
      const exitKey = core.dateKey(session.exit);
      const row = document.createElement('div');
      row.className = 'recent-row';
      row.style.setProperty('--subject', colorFor(state, session));
      const timePrefix = showingToday ? '' : core.formatDayLabel(entryKey, moment) + ' · ';
      const nextDay = exitKey !== entryKey ? ' <span class="recent-day">next day</span>' : '';
      row.innerHTML =
        '<span class="dot"></span>' +
        '<div class="recent-main">' +
        '<span class="recent-name"></span>' +
        '<span class="recent-time"></span>' +
        '</div>' +
        '<span class="recent-duration"></span>';
      row.querySelector('.recent-name').textContent = nameFor(state, session);
      row.querySelector('.recent-time').innerHTML =
        ui.escapeHtml(timePrefix + core.formatTime(session.entry)) +
        ' → ' +
        ui.escapeHtml(core.formatTime(session.exit)) +
        nextDay;
      row.querySelector('.recent-duration').textContent = core.formatDuration(core.sessionDuration(session));
      fragment.appendChild(row);
    });

    container.replaceChildren(fragment);
  }

  function mountRegister(options) {
    const els = options.elements;
    let query = '';
    let dateFilter = '';
    let currentState = null;

    function setCount(shown, total) {
      if (!els.count) return;
      if (!total) els.count.textContent = 'No sessions yet';
      else if (shown === total) els.count.textContent = total + (total === 1 ? ' session' : ' sessions');
      else els.count.textContent = shown + ' of ' + total + ' sessions';
    }

    function groupSessions(state, sessions) {
      const groups = new Map();
      sessions.forEach((session) => {
        const key = core.dateKey(session.entry);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(session);
      });
      return Array.from(groups.entries())
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([key, items]) => ({
          key,
          items: items.slice().sort((a, b) => new Date(b.entry) - new Date(a.entry)),
          total: items.reduce((sum, item) => sum + core.sessionDuration(item), 0)
        }));
    }

    function render(state) {
      currentState = state;
      const now = new Date();
      const needle = query.trim().toLowerCase();
      const filtered = state.sessions.filter((session) => {
        if (dateFilter && core.dateKey(session.entry) !== dateFilter) return false;
        if (!needle) return true;
        const label = nameFor(state, session).toLowerCase();
        const raw = String(session.subjectName || '').toLowerCase();
        const day = core.formatDateMedium(session.entry).toLowerCase();
        return label.includes(needle) || raw.includes(needle) || day.includes(needle);
      });
      setCount(filtered.length, state.sessions.length);

      if (els.clear) els.clear.classList.toggle('hidden', !dateFilter && !query);

      if (!filtered.length) {
        const empty = state.sessions.length
          ? ui.emptyState({
              icon: 'search',
              title: 'No matching sessions',
              message: 'Try a different subject or clear the date filter.',
              actionLabel: 'Clear filters',
              onAction: () => {
                query = '';
                dateFilter = '';
                if (els.search) els.search.value = '';
                if (els.date) els.date.value = '';
                render(currentState);
              }
            })
          : ui.emptyState({
              icon: 'calendar',
              title: 'No sessions recorded yet',
              message: 'Open the menu bar register, choose a subject and press ENTRY. Finished sessions will appear here with exact entry and exit times.'
            });
        els.list.replaceChildren(empty);
        return;
      }

      const groups = groupSessions(state, filtered);
      els.list.innerHTML = groups.map((group) => {
        const dayLabel = core.formatDayLabel(group.key, now);
        const dayDate = core.formatDateMedium(core.dateFromKey(group.key));
        const rows = group.items.map((session) => {
          const entryKey = core.dateKey(session.entry);
          const exitKey = core.dateKey(session.exit);
          const nextDay = exitKey !== entryKey ? '<span class="overnight-tag">next day</span>' : '';
          return (
            '<div class="register-row" style="--subject:' + ui.escapeHtml(colorFor(state, session)) + '">' +
            '<div class="row-subject"><span class="dot"></span><span class="row-name"></span></div>' +
            '<div class="row-times"><span class="time-in">' + ui.escapeHtml(core.formatTime(session.entry)) + '</span>' +
            '<span class="time-arrow">→</span>' +
            '<span class="time-out">' + ui.escapeHtml(core.formatTime(session.exit)) + '</span>' + nextDay + '</div>' +
            '<div class="row-duration">' + ui.escapeHtml(core.formatDuration(core.sessionDuration(session))) + '</div>' +
            '<div class="row-actions">' +
            '<button class="mini-icon-btn" type="button" data-edit="' + ui.escapeHtml(session.id) + '" title="Edit session" aria-label="Edit session">' + ui.icon('pencil') + '</button>' +
            '<button class="mini-icon-btn danger" type="button" data-delete="' + ui.escapeHtml(session.id) + '" title="Delete session" aria-label="Delete session">' + ui.icon('trash') + '</button>' +
            '</div>' +
            '</div>'
          );
        });
        const rowNodes = rows.join('');
        return (
          '<div class="register-group">' +
          '<div class="register-day">' +
          '<div class="day-main"><span class="day-label">' + ui.escapeHtml(dayLabel) + '</span>' +
          '<span class="day-date">' + ui.escapeHtml(dayDate) + '</span></div>' +
          '<span class="day-total">' + ui.escapeHtml(core.formatDuration(group.total)) + ' · ' + group.items.length + (group.items.length === 1 ? ' session' : ' sessions') + '</span>' +
          '</div>' +
          '<div class="register-rows">' + rowNodes + '</div>' +
          '</div>'
        );
      }).join('');

      // Fill subject names through text nodes (never interpolate user text into HTML).
      const rowElements = els.list.querySelectorAll('.register-row');
      let index = 0;
      groups.forEach((group) => {
        group.items.forEach((session) => {
          const node = rowElements[index];
          if (node) {
            const nameNode = node.querySelector('.row-name');
            if (nameNode) nameNode.textContent = nameFor(state, session);
          }
          index += 1;
        });
      });
    }

    function editSession(id) {
      const session = currentState.sessions.find((item) => item.id === id);
      if (!session) return;
      ui.openSessionEditor({
        session,
        subjects: currentState.subjects,
        onSave: async (payload) => {
          await store.call('updateSession', payload);
        }
      });
    }

    async function deleteSession(id) {
      const session = currentState.sessions.find((item) => item.id === id);
      if (!session) return;
      const label = nameFor(currentState, session);
      const confirmed = await ui.confirm({
        title: 'Delete this session?',
        message: 'Delete ' + label + ' · ' + core.formatDateMedium(session.entry) + ' (' +
          core.formatDuration(core.sessionDuration(session)) + ')? This cannot be undone.',
        confirmLabel: 'Delete session'
      });
      if (!confirmed) return;
      try {
        await store.call('deleteSession', id);
        ui.toast('Session deleted', 'success');
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    }

    if (els.search) {
      els.search.addEventListener('input', () => {
        query = els.search.value;
        render(currentState);
      });
    }
    if (els.date) {
      els.date.addEventListener('change', () => {
        dateFilter = els.date.value;
        render(currentState);
      });
    }
    if (els.clear) {
      els.clear.addEventListener('click', () => {
        query = '';
        dateFilter = '';
        if (els.search) els.search.value = '';
        if (els.date) els.date.value = '';
        render(currentState);
      });
    }
    if (els.list) {
      els.list.addEventListener('click', (event) => {
        const editButton = event.target.closest('[data-edit]');
        if (editButton) {
          editSession(editButton.getAttribute('data-edit'));
          return;
        }
        const deleteButton = event.target.closest('[data-delete]');
        if (deleteButton) deleteSession(deleteButton.getAttribute('data-delete'));
      });
    }

    return {
      render,
      reset() {
        query = '';
        dateFilter = '';
        if (els.search) els.search.value = '';
        if (els.date) els.date.value = '';
        if (currentState) render(currentState);
      }
    };
  }

  window.SRHistory = { renderRecent, mountRegister, nameFor, colorFor };
})();
