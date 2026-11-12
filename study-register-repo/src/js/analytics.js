/* Analytics dashboard: range filtering, KPI summary, bar chart and subject donut. */
(function () {
  'use strict';

  const core = window.SRCore;
  const ui = window.SRUI;

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function niceMax(ms) {
    const minimum = 3600000;
    const hours = Math.max(minimum, ms) / 3600000;
    const candidates = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 30, 36, 42, 48, 60, 72, 84, 100, 120, 160, 200, 240, 300];
    for (let i = 0; i < candidates.length; i += 1) {
      if (hours <= candidates[i]) return candidates[i] * 3600000;
    }
    return Math.ceil(hours / 100) * 100 * 3600000;
  }

  function yLabel(ms) {
    if (ms <= 0) return '0';
    return core.formatDuration(ms);
  }

  function hourLabel(hour) {
    if (hour === 0) return '12a';
    if (hour === 12) return '12p';
    if (hour < 12) return hour + 'a';
    return (hour - 12) + 'p';
  }

  function buildSeries(state, key, range, now) {
    if (key === 'today') {
      const today = core.dateKey(now);
      const hourly = core.hourlySeries(state.sessions, today);
      return {
        kind: 'hourly',
        subtitle: 'Hourly breakdown',
        items: hourly.map((bucket) => ({
          ms: bucket.ms,
          label: bucket.hour % 3 === 0 ? hourLabel(bucket.hour) : '',
          tooltip: core.pad2(bucket.hour) + ':00 – ' + core.pad2((bucket.hour + 1) % 24) + ':00',
          highlight: bucket.hour === now.getHours()
        }))
      };
    }
    if (key === 'week') {
      const daily = core.dailySeries(state.sessions, range.start, range.end);
      const todayKey = core.dateKey(now);
      return {
        kind: 'daily',
        subtitle: 'Daily breakdown',
        items: daily.map((bucket, index) => {
          const date = core.dateFromKey(bucket.date);
          return {
            ms: bucket.ms,
            label: WEEKDAYS[index % 7],
            tooltip: core.formatDayLabel(bucket.date, now) + ' · ' + core.formatDateMedium(date),
            highlight: bucket.date === todayKey
          };
        })
      };
    }
    if (key === 'month') {
      const daily = core.dailySeries(state.sessions, range.start, range.end);
      const todayKey = core.dateKey(now);
      return {
        kind: 'daily',
        subtitle: 'Daily breakdown',
        items: daily.map((bucket) => {
          const day = Number(bucket.date.slice(-2));
          return {
            ms: bucket.ms,
            label: day === 1 || day % 5 === 0 ? String(day) : '',
            tooltip: core.formatDayLabel(bucket.date, now) + ' · ' + core.formatDateMedium(core.dateFromKey(bucket.date)),
            highlight: bucket.date === todayKey
          };
        })
      };
    }

    const allMonths = core.monthlySeries(state.sessions, range.start, range.end);
    const months = allMonths.slice(-12);
    return {
      kind: 'monthly',
      subtitle: allMonths.length > 12 ? 'Last 12 months' : 'Monthly breakdown',
      items: months.map((bucket) => {
        const date = new Date(bucket.year, bucket.month, 1);
        return {
          ms: bucket.ms,
          label: new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date),
          tooltip: core.formatMonthYear(date),
          highlight: bucket.month === now.getMonth() && bucket.year === now.getFullYear()
        };
      })
    };
  }

  function renderBars(mount, series) {
    if (!series.items.length) {
      mount.innerHTML = '<div class="chart-empty">No study time in this range</div>';
      return;
    }
    const maxValue = series.items.reduce((max, item) => Math.max(max, item.ms), 0);
    const max = niceMax(maxValue);
    const columns = series.items.length;
    const columnStyle = 'grid-template-columns:repeat(' + columns + ',minmax(0,1fr))';
    const yRows = [1, 2 / 3, 1 / 3, 0].map((fraction) => yLabel(max * fraction));
    const labels = series.items.map((item) => '<span>' + (item.label ? ui.escapeHtml(item.label) : '') + '</span>').join('');
    const bars = series.items.map((item) => {
      const height = item.ms > 0 ? Math.max(2, (item.ms / max) * 100) : 0;
      const classes = ['bar-col'];
      if (item.highlight) classes.push('is-current');
      if (item.ms > 0) classes.push('has-value');
      return (
        '<div class="' + classes.join(' ') + '" title="' + ui.escapeHtml(item.tooltip + ' · ' + core.formatDuration(item.ms)) + '">' +
        '<div class="bar-fill" style="height:' + height.toFixed(2) + '%"></div>' +
        '<span class="bar-tip">' + ui.escapeHtml(core.formatDuration(item.ms)) + '</span>' +
        '</div>'
      );
    }).join('');

    mount.innerHTML =
      '<div class="chart-frame">' +
      '<div class="chart-y">' + yRows.map((label) => '<span>' + ui.escapeHtml(label) + '</span>').join('') + '</div>' +
      '<div class="chart-main">' +
      '<div class="chart-plot">' +
      '<div class="chart-grid"><i></i><i></i><i></i><i></i></div>' +
      '<div class="bars" style="' + columnStyle + '">' + bars + '</div>' +
      '</div>' +
      '<div class="chart-x" style="' + columnStyle + '">' + labels + '</div>' +
      '</div>' +
      '</div>';
  }

  function renderDonut(elements, distribution) {
    const circumference = 2 * Math.PI * 62;
    const total = distribution.total;
    if (!total) {
      elements.donutSvg.innerHTML =
        '<circle class="donut-track" cx="80" cy="80" r="62" fill="none" stroke-width="15"></circle>';
      elements.donutValue.textContent = '0m';
      elements.donutLabel.textContent = 'no time yet';
      elements.legend.innerHTML = '<div class="legend-empty">Study time in this range will appear here.</div>';
      return;
    }

    let offset = 0;
    const segments = distribution.list.map((item) => {
      const length = Math.max(0, item.pct * circumference - 2.2);
      const dash = length + ' ' + (circumference - length);
      const circle =
        '<circle cx="80" cy="80" r="62" fill="none" stroke="' + ui.escapeHtml(item.color) + '" stroke-width="15" ' +
        'stroke-dasharray="' + dash + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 80 80)" ' +
        'stroke-linecap="butt"><title>' + ui.escapeHtml(item.name + ' · ' + core.formatDuration(item.ms)) + '</title></circle>';
      offset += item.pct * circumference;
      return circle;
    }).join('');

    elements.donutSvg.innerHTML =
      '<circle class="donut-track" cx="80" cy="80" r="62" fill="none" stroke-width="15"></circle>' +
      segments;
    elements.donutValue.textContent = core.formatDuration(total);
    elements.donutLabel.textContent = distribution.list.length === 1 ? '1 subject' : distribution.list.length + ' subjects';

    elements.legend.innerHTML = distribution.list.map((item) => (
      '<div class="legend-row" style="--subject:' + ui.escapeHtml(item.color) + '">' +
      '<span class="legend-dot"></span>' +
      '<span class="legend-name"></span>' +
      '<span class="legend-duration">' + ui.escapeHtml(core.formatDuration(item.ms)) + '</span>' +
      '<span class="legend-pct">' + Math.round(item.pct * 100) + '%</span>' +
      '</div>'
    )).join('');

    const nameNodes = elements.legend.querySelectorAll('.legend-name');
    distribution.list.forEach((item, index) => {
      if (nameNodes[index]) nameNodes[index].textContent = item.name;
    });
  }

  function render(options) {
    const state = options.state;
    const key = options.key;
    const now = options.now || new Date();
    const elements = options.elements;
    const range = core.buildRange(key, state.sessions, now);
    const stats = core.rangeStats(state.sessions, range.start, range.end);
    const subjectNames = new Map(state.subjects.map((item) => [item.id, item.name]));
    const days = core.countDays(range.start, range.end, now);
    const streak = core.streakInfo(state.sessions, now);

    const inRange = core.sessionsInRange(state.sessions, range.start, range.end);
    let longest = null;
    let longestOverlap = 0;
    inRange.forEach((session) => {
      const overlap = core.overlapMs(session.entry, session.exit, range.start, range.end);
      if (overlap > longestOverlap) {
        longestOverlap = overlap;
        longest = session;
      }
    });

    elements.rangeLabel.textContent = core.rangeLabel(key, range, now);

    if (elements.streak) {
      elements.streak.classList.toggle('hidden', streak.count < 1);
      elements.streak.textContent = streak.count + '-day streak';
    }

    elements.kpi.total.textContent = core.formatDuration(stats.total);
    elements.kpi.totalNote.textContent = stats.activeDays
      ? stats.activeDays + (stats.activeDays === 1 ? ' active day' : ' active days')
      : 'No time recorded';

    elements.kpi.sessions.textContent = String(stats.count);
    elements.kpi.sessionsNote.textContent = stats.count
      ? core.formatDuration(stats.averagePerSession) + ' per session'
      : 'Nothing recorded';

    elements.kpi.average.textContent = core.formatDuration(stats.total / days);
    elements.kpi.averageNote.textContent = 'over ' + days + (days === 1 ? ' day' : ' days');

    elements.kpi.longest.textContent = longest ? core.formatDuration(core.sessionDuration(longest)) : '—';
    if (longest) {
      const label = subjectNames.get(longest.subjectId) || longest.subjectName || 'Session';
      elements.kpi.longestNote.textContent = label + ' · ' + core.formatDayLabel(core.dateKey(longest.entry), now);
    } else {
      elements.kpi.longestNote.textContent = 'No sessions yet';
    }

    elements.chartTotal.textContent = core.formatDuration(stats.total);
    const series = buildSeries(state, key, range, now);
    elements.chartSubtitle.textContent = series.subtitle;
    renderBars(elements.barChart, series);

    const distribution = core.subjectTotals(state.sessions, range.start, range.end, state.subjects);
    renderDonut(elements, distribution);
  }

  window.SRAnalytics = { render, buildSeries, niceMax };
})();
