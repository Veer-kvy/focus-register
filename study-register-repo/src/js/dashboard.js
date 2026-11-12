/* Analytics window controller. */
(function () {
  'use strict';

  const core = window.SRCore;
  const ui = window.SRUI;
  const store = window.SRStore;

  const compact = new URLSearchParams(window.location.search).get('compact') === '1';
  if (compact) {
    document.documentElement.classList.add('is-compact');
    document.body.classList.add('is-compact');
    if (window.sr && window.sr.onFloatEdge) {
      window.sr.onFloatEdge((payload) => {
        const side = payload && payload.side;
        const root = document.documentElement;
        const edge = side === 'left' || side === 'right';
        root.classList.toggle('is-edge', edge);
        root.classList.toggle('is-edge-left', side === 'left');
        root.classList.toggle('is-edge-right', side === 'right');
        if (payload && payload.animate && edge) {
          root.classList.remove('is-revealing');
          void root.offsetWidth;
          root.classList.add('is-revealing');
        } else if (!edge) {
          root.classList.remove('is-revealing');
        }
      });
    }
  }

  const els = {
    rangeLabel: document.getElementById('rangeLabel'),
    rangeSwitch: document.getElementById('rangeSwitch'),
    streak: document.getElementById('dashStreak'),
    kpiTotal: document.getElementById('kpiTotal'),
    kpiTotalNote: document.getElementById('kpiTotalNote'),
    kpiSessions: document.getElementById('kpiSessions'),
    kpiSessionsNote: document.getElementById('kpiSessionsNote'),
    kpiAverage: document.getElementById('kpiAverage'),
    kpiAverageNote: document.getElementById('kpiAverageNote'),
    kpiLongest: document.getElementById('kpiLongest'),
    kpiLongestNote: document.getElementById('kpiLongestNote'),
    chartSubtitle: document.getElementById('chartSubtitle'),
    chartTotal: document.getElementById('chartTotal'),
    barChart: document.getElementById('barChart'),
    donutSvg: document.getElementById('donutSvg'),
    donutValue: document.getElementById('donutValue'),
    donutLabel: document.getElementById('donutLabel'),
    subjectLegend: document.getElementById('subjectLegend'),
    historyList: document.getElementById('historyList'),
    historyCount: document.getElementById('historyCount'),
    historySearch: document.getElementById('historySearch'),
    historyDate: document.getElementById('historyDate'),
    historyClear: document.getElementById('historyClear'),
    version: document.getElementById('dashVersion')
  };

  let rangeKey = 'week';
  let currentDay = core.dateKey(new Date());

  const register = window.SRHistory.mountRegister({
    elements: {
      list: els.historyList,
      count: els.historyCount,
      search: els.historySearch,
      date: els.historyDate,
      clear: els.historyClear
    }
  });

  function render(state, meta) {
    if (!state) return;
    currentDay = core.dateKey(new Date());
    if (meta && meta.version) els.version.textContent = 'Study Register ' + meta.version;
    window.SRAnalytics.render({
      state,
      key: rangeKey,
      now: new Date(),
      elements: {
        rangeLabel: els.rangeLabel,
        streak: els.streak,
        kpi: {
          total: els.kpiTotal,
          totalNote: els.kpiTotalNote,
          sessions: els.kpiSessions,
          sessionsNote: els.kpiSessionsNote,
          average: els.kpiAverage,
          averageNote: els.kpiAverageNote,
          longest: els.kpiLongest,
          longestNote: els.kpiLongestNote
        },
        chartSubtitle: els.chartSubtitle,
        chartTotal: els.chartTotal,
        barChart: els.barChart,
        donutSvg: els.donutSvg,
        donutValue: els.donutValue,
        donutLabel: els.donutLabel,
        legend: els.subjectLegend
      }
    });
    register.render(state);
  }

  function setRange(next) {
    rangeKey = next;
    els.rangeSwitch.querySelectorAll('[data-range]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-range') === next);
    });
    render(store.state, store.meta);
  }

  function bind() {
    els.rangeSwitch.addEventListener('click', (event) => {
      const button = event.target.closest('[data-range]');
      if (button) setRange(button.getAttribute('data-range'));
    });
    document.getElementById('settingsBtn').addEventListener('click', () => window.SRSettings.open());
    document.getElementById('routineBtn').addEventListener('click', () => {
      window.sr.openRoutine('analytics').catch(() => {});
    });
    document.getElementById('trackerBtn').addEventListener('click', () => {
      window.sr.showPopover().catch(() => {});
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (document.getElementById('modalRoot').childElementCount > 0) return;
      if (compact) window.sr.hideFloatPanel().catch(() => {});
      else window.sr.showPopover().catch(() => {});
    });

    setInterval(() => {
      const day = core.dateKey(new Date());
      if (day !== currentDay && store.state) render(store.state, store.meta);
    }, 30000);
  }

  async function boot() {
    ui.hydrateIcons();
    bind();
    setRange(rangeKey);
    store.subscribe((state, meta) => render(state, meta));
    try {
      await store.init();
    } catch (error) {
      ui.toast(error.message || 'Could not load analytics', 'error', 5000);
    }
  }

  boot();
})();
