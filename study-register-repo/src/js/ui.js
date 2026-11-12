/* Shared UI primitives: icons, toasts, modals, confirmations, session editor. */
(function () {
  'use strict';

  const core = window.SRCore;

  const ICONS = {
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    chart: '<path d="M3.5 20.5h17"/><path d="M6.5 20.5v-6.2M11.5 20.5V8.6M16.5 20.5v-3.4"/>',
    trash: '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5"/><path d="M6.5 6.5l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12.1"/><path d="M10 10.5v6M14 10.5v6"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10" rx="2.4"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.2" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.75V12l2.9 1.85"/>',
    layers: '<path d="m12 3.5 8.5 4.4L12 12.3 3.5 7.9 12 3.5Z"/><path d="m3.5 12.1 8.5 4.4 8.5-4.4"/><path d="m3.5 16.2 8.5 4.4 8.5-4.4"/>',
    hourglass: '<path d="M7 3.5h10M7 20.5h10"/><path d="M8 3.5v2.2c0 2 1.4 3.4 4 6.3 2.6-2.9 4-4.3 4-6.3V3.5"/><path d="M8 20.5v-2.2c0-2 1.4-3.4 4-6.3 2.6 2.9 4 4.3 4 6.3v2.2"/>',
    flame: '<path d="M12 21c3.6 0 6-2.5 6-6 0-2.7-1.6-5.2-4.1-7.6.2 1.9-.5 3.4-1.9 4.2.2-3.6-1.3-6.4-3.5-8.1.2 3.6-2.5 5.7-2.5 9.9 0 4.1 2.4 7.6 6 7.6Z"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
    power: '<path d="M12 3.5v8"/><path d="M6.6 6.8a7.5 7.5 0 1 0 10.8 0"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    check: '<path d="m5 12.5 4.4 4.4L19 8.2"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    pencil: '<path d="M4.5 19.5h4l10-10a2.4 2.4 0 0 0-3.4-3.4l-10 10v3.4Z"/><path d="m13.8 7.4 2.8 2.8"/>',
    download: '<path d="M12 3.5v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 17.5v2a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-2"/>',
    upload: '<path d="M12 15V4"/><path d="M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 17.5v2a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-2"/>',
    folder: '<path d="M3.5 7.6A1.6 1.6 0 0 1 5.1 6h4l2 2.3h7.8a1.6 1.6 0 0 1 1.6 1.6v8.5a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6V7.6Z"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/>',
    calendar: '<rect x="3.5" y="5.2" width="17" height="15.3" rx="2.2"/><path d="M3.5 9.7h17M8.3 3.2v4M15.7 3.2v4"/>',
    arrowRight: '<path d="M4.5 12h15"/><path d="m14 6.5 5.5 5.5L14 17.5"/>',
    target: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    alert: '<path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9.3v5.1"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5"/><circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5V10h-5.5"/>',
    database: '<ellipse cx="12" cy="5.8" rx="7.3" ry="2.8"/><path d="M4.7 5.8v6.2c0 1.5 3.3 2.8 7.3 2.8s7.3-1.3 7.3-2.8V5.8"/><path d="M4.7 12v6.2c0 1.5 3.3 2.8 7.3 2.8s7.3-1.3 7.3-2.8V12"/>',
    list: '<path d="M9 6.5h12M9 12h12M9 17.5h12"/><circle cx="4.3" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.3" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.3" cy="17.5" r="1.1" fill="currentColor" stroke="none"/>',
    spark: '<path d="M12 3.2l1.9 5.1 5.1 1.9-5.1 1.9L12 17.2l-1.9-5.1L5 10.2l5.1-1.9L12 3.2Z"/><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
    trend: '<path d="M3.5 16.5 8 12l3.5 3.5L20 7"/><path d="M15 7h5v5"/>',
    repeat: '<path d="m17 2.5 4 4-4 4"/><path d="M3 11.5v-1a4 4 0 0 1 4-4h14"/><path d="m7 21.5-4-4 4-4"/><path d="M21 12.5v1a4 4 0 0 1-4 4H3"/>',
    bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
    bellOff: '<path d="M18 9a6 6 0 0 0-8.4-5.4"/><path d="M6.1 6.1A6 6 0 0 0 6 9c0 5-2 6-2 6h13"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/><path d="m4 4 16 16"/>',
    book: '<path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2Z"/><path d="M12 6.5v13"/>',
    coffee: '<path d="M5 8.5h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-6Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v2M11.5 3.5v2M15 3.5v2"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronUp: '<path d="m6 15 6-6 6 6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    skip: '<path d="m5 5 9 7-9 7V5Z"/><path d="M18 5v14"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'
  };

  function icon(name, size) {
    const body = ICONS[name] || '';
    const dimension = size ? ' width="' + size + '" height="' + size + '"' : '';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"' + dimension + ' aria-hidden="true">' + body + '</svg>';
  }

  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((node) => {
      const name = node.getAttribute('data-icon');
      if (!name) return;
      node.innerHTML = icon(name);
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(message, type, timeout) {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const node = document.createElement('div');
    node.className = 'toast ' + (type || 'info');
    node.innerHTML = '<span>' + icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info') + '</span><span class="toast-text"></span>';
    node.querySelector('.toast-text').textContent = String(message);
    root.appendChild(node);
    while (root.children.length > 2) root.firstElementChild.remove();
    const delay = timeout || 2800;
    setTimeout(() => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 200);
    }, delay);
  }

  const modalLayers = [];

  function openModal(options) {
    const config = Object.assign({ title: '', subtitle: '', body: null, footer: [], wide: false, focusCancel: false, onClose: null }, options || {});
    const layer = document.createElement('div');
    layer.className = 'modal-root';
    layer.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal' + (config.wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><div><h2 class="modal-title"></h2><p class="modal-subtitle"></p></div>' +
      '<button class="modal-close" type="button" aria-label="Close">' + icon('close') + '</button></div>' +
      '<div class="modal-body"></div>' +
      '<div class="modal-foot"></div>' +
      '</div>';
    layer.querySelector('.modal-title').textContent = config.title;
    const subtitle = layer.querySelector('.modal-subtitle');
    subtitle.textContent = config.subtitle;
    if (!config.subtitle) subtitle.remove();

    const body = layer.querySelector('.modal-body');
    if (typeof config.body === 'string') body.innerHTML = config.body;
    else if (config.body instanceof Node) body.appendChild(config.body);

    const foot = layer.querySelector('.modal-foot');
    const footerButtons = config.footer || [];
    if (!footerButtons.length) foot.remove();
    footerButtons.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ' + (item.className || '');
      if (item.icon) button.innerHTML = icon(item.icon) + '<span></span>';
      else button.textContent = item.label || 'Button';
      if (item.icon) button.querySelector('span').textContent = item.label || '';
      if (item.disabled) button.disabled = true;
      button.addEventListener('click', () => {
        if (item.onClick) item.onClick({ button, modal: api });
      });
      foot.appendChild(button);
    });

    document.getElementById('modalRoot').appendChild(layer);
    modalLayers.push(layer);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      layer.classList.add('is-leaving');
      document.removeEventListener('keydown', onKeyDown);
      setTimeout(() => layer.remove(), 140);
      const index = modalLayers.indexOf(layer);
      if (index >= 0) modalLayers.splice(index, 1);
      if (config.onClose) config.onClose();
    }

    function onKeyDown(event) {
      if (event.key === 'Escape' && modalLayers[modalLayers.length - 1] === layer) {
        const blocked = layer.querySelector('[data-block-close="true"]');
        if (!blocked) {
          event.preventDefault();
          close();
        }
      }
      if (event.key === 'Tab') trapFocus(event, layer);
    }

    document.addEventListener('keydown', onKeyDown);
    layer.querySelector('.modal-close').addEventListener('click', close);
    layer.querySelector('.modal-backdrop').addEventListener('click', () => {
      if (!layer.querySelector('[data-block-close="true"]')) close();
    });
    layer.querySelector('.modal').addEventListener('mousedown', (event) => event.stopPropagation());

    requestAnimationFrame(() => {
      const focusTarget = (config.focusCancel && foot.querySelector('.btn')) ||
        body.querySelector('input, select, textarea, button') ||
        foot.querySelector('.btn:last-child') ||
        layer.querySelector('.modal-close');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    });

    const api = { layer, el: layer.querySelector('.modal'), body, foot, close };
    return api;
  }

  function trapFocus(event, layer) {
    const focusables = Array.from(layer.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
      .filter((node) => node.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function confirm(options) {
    const config = Object.assign({ title: 'Are you sure?', message: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel', danger: true, requireText: null }, options || {});
    return new Promise((resolve) => {
      const body = document.createElement('div');
      const copy = document.createElement('p');
      copy.className = 'modal-confirm-copy';
      copy.textContent = config.message;
      body.appendChild(copy);
      let input = null;
      if (config.requireText) {
        const field = document.createElement('div');
        field.className = 'field';
        field.style.marginTop = '12px';
        field.innerHTML = '<label>Type ' + escapeHtml(config.requireText) + ' to confirm</label>';
        input = document.createElement('input');
        input.className = 'input';
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = config.requireText;
        field.appendChild(input);
        body.appendChild(field);
      }

      let settled = false;
      const modal = openModal({
        title: config.title,
        body,
        footer: [
          {
            label: config.cancelLabel,
            className: 'ghost',
            onClick: () => {
              settled = true;
              modal.close();
              resolve(false);
            }
          },
          {
            label: config.confirmLabel,
            className: config.danger ? 'danger' : 'primary',
            disabled: Boolean(config.requireText),
            onClick: ({ button }) => {
              if (config.requireText && input.value.trim() !== config.requireText) {
                input.focus();
                return;
              }
              button.disabled = true;
              settled = true;
              modal.close();
              resolve(config.requireText ? input.value.trim() : true);
            }
          }
        ],
        focusCancel: !config.requireText,
        onClose: () => {
          if (!settled) resolve(false);
        }
      });

      if (input) {
        const confirmButton = modal.foot.querySelectorAll('.btn')[1];
        input.addEventListener('input', () => {
          confirmButton.disabled = input.value.trim() !== config.requireText;
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && input.value.trim() === config.requireText) {
            confirmButton.click();
          }
        });
      }
    });
  }

  function openSessionEditor(options) {
    const session = options.session;
    const subjects = options.subjects || [];
    const body = document.createElement('div');
    body.className = 'editor-grid';
    body.innerHTML =
      '<div class="field"><label for="editorSubject">Subject</label><select class="select" id="editorSubject"></select></div>' +
      '<div class="editor-times">' +
      '<div class="field"><label for="editorEntry">Entry</label><input class="input" type="datetime-local" id="editorEntry" step="1"></div>' +
      '<div class="field"><label for="editorExit">Exit</label><input class="input" type="datetime-local" id="editorExit" step="1"></div>' +
      '</div>' +
      '<div class="editor-duration"><span>Recorded duration</span><strong id="editorDuration">—</strong></div>' +
      '<div class="form-error" id="editorError" role="alert"></div>';
    const select = body.querySelector('#editorSubject');
    subjects.forEach((subject) => {
      const option = document.createElement('option');
      option.value = subject.id;
      option.textContent = subject.name;
      if (subject.id === session.subjectId) option.selected = true;
      select.appendChild(option);
    });
    if (!subjects.some((s) => s.id === session.subjectId)) {
      const option = document.createElement('option');
      option.value = session.subjectId;
      option.textContent = session.subjectName || 'Removed subject';
      option.selected = true;
      select.appendChild(option);
    }
    const entryInput = body.querySelector('#editorEntry');
    const exitInput = body.querySelector('#editorExit');
    const durationNode = body.querySelector('#editorDuration');
    const errorNode = body.querySelector('#editorError');
    entryInput.value = core.toLocalInputValue(session.entry);
    exitInput.value = core.toLocalInputValue(session.exit);

    function preview() {
      const entry = core.fromLocalInputValue(entryInput.value);
      const exit = core.fromLocalInputValue(exitInput.value);
      if (!entry || !exit) {
        durationNode.textContent = '—';
        return;
      }
      if (exit.getTime() <= entry.getTime()) {
        durationNode.textContent = 'Invalid';
        return;
      }
      durationNode.textContent = core.formatDurationLong(exit.getTime() - entry.getTime());
    }
    entryInput.addEventListener('input', preview);
    exitInput.addEventListener('input', preview);
    preview();

    const modal = openModal({
      title: 'Edit session',
      subtitle: 'Correct the entry or exit time. Totals update immediately.',
      body,
      footer: [
        { label: 'Cancel', className: 'ghost', onClick: () => modal.close() },
        {
          label: 'Save changes',
          className: 'primary',
          onClick: async ({ button }) => {
            const entry = core.fromLocalInputValue(entryInput.value);
            const exit = core.fromLocalInputValue(exitInput.value);
            errorNode.textContent = '';
            if (!entry || !exit) {
              errorNode.textContent = 'Enter both an entry and exit time.';
              return;
            }
            if (exit.getTime() <= entry.getTime()) {
              errorNode.textContent = 'Exit time must be after entry time.';
              return;
            }
            button.disabled = true;
            button.textContent = 'Saving…';
            try {
              await options.onSave({
                id: session.id,
                subjectId: select.value,
                entry: entry.toISOString(),
                exit: exit.toISOString()
              });
              modal.close();
              toast('Session updated', 'success');
            } catch (error) {
              errorNode.textContent = error.message;
              button.disabled = false;
              button.textContent = 'Save changes';
            }
          }
        }
      ]
    });
    return modal;
  }

  function emptyState(options) {
    const node = document.createElement('div');
    node.className = 'empty-state';
    node.innerHTML =
      '<div class="empty-icon">' + icon(options.icon || 'clock') + '</div>' +
      '<strong></strong><p></p>';
    node.querySelector('strong').textContent = options.title || '';
    node.querySelector('p').textContent = options.message || '';
    if (options.actionLabel) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small';
      button.textContent = options.actionLabel;
      button.addEventListener('click', options.onAction || (() => {}));
      node.appendChild(button);
    }
    return node;
  }

  window.SRUI = {
    icon,
    icons: ICONS,
    hydrateIcons,
    escapeHtml,
    toast,
    openModal,
    confirm,
    openSessionEditor,
    emptyState
  };
})();
