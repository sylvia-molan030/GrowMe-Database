const ATTR_FIELDS = [
  { key: 'direction', label: '方向' },
  { key: 'theme', label: '主题' },
  { key: 'optimization', label: '优化点' },
  { key: 'stylization', label: '风格化' },
  { key: 'pain_point', label: '痛点' },
  { key: 'exercise_type', label: '锻炼类型' },
];

export function createDefaultFilters(meta) {
  return applyPreset({
    preset: 'all',
    date_start: meta.data_date_start || meta.default_date_start,
    date_end: meta.data_date_end || meta.default_date_end,
    mode: 'account',
    direction: '全部',
    theme: '全部',
    optimization: '全部',
    stylization: '全部',
    pain_point: '全部',
    exercise_type: '全部',
    channel: 'ALL',
  }, 'all', meta);
}

function shiftDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dataAnchor(meta) {
  return meta?.data_date_end || meta?.default_date_end || new Date().toISOString().slice(0, 10);
}

export function applyPreset(filters, preset, meta = {}) {
  const anchor = dataAnchor(meta);
  const dataStart = meta?.data_date_start || filters.date_start;
  const copy = { ...filters, preset };
  if (preset === 'yesterday') {
    const y = shiftDays(anchor, -1);
    copy.date_start = y;
    copy.date_end = y;
  } else if (preset === '7d') {
    copy.date_start = shiftDays(anchor, -6);
    copy.date_end = anchor;
  } else if (preset === '30d') {
    copy.date_start = shiftDays(anchor, -29);
    copy.date_end = anchor;
  } else if (preset === 'all') {
    copy.date_start = dataStart;
    copy.date_end = anchor;
  }
  return copy;
}

export function renderFilters(container, state, onChange) {
  const { filters, meta } = state;
  const options = meta.filter_options || {};

  container.innerHTML = `
    <div class="filter-row">
      <span class="filter-label">时间</span>
      <div class="chip-group" id="preset-chips">
        ${['all', 'custom', 'yesterday', '7d', '30d'].map((p) => {
          const labels = { all: '全部', custom: '自定义', yesterday: '昨天', '7d': '近7天', '30d': '近30天' };
          return `<button class="chip ${filters.preset === p ? 'active' : ''}" data-preset="${p}">${labels[p]}</button>`;
        }).join('')}
      </div>
      <span style="font-size:12px;color:#6b7280">按素材名前缀日期</span>
      <input class="date-input" type="date" id="date-start" value="${filters.date_start}" />
      <span>—</span>
      <input class="date-input" type="date" id="date-end" value="${filters.date_end}" />
      <div class="toggle-group">
        <button class="toggle-btn ${filters.mode === 'account' ? 'active' : ''}" data-mode="account">账户内成效</button>
        <button class="toggle-btn ${filters.mode === 'new' ? 'active' : ''}" data-mode="new">上新素材成效（近2周）</button>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">属性</span>
      ${ATTR_FIELDS.map((f) => `
        <select class="select" data-key="${f.key}">
          <option value="全部">全部</option>
          ${(options[f.key] || []).filter((v) => v !== '全部').map((v) => `
            <option value="${v}" ${filters[f.key] === v ? 'selected' : ''}>${v}</option>
          `).join('')}
        </select>
      `).join('')}
      <select class="select" data-key="channel" disabled title="全球与 T1 已按素材名合并统计">
        <option value="ALL" selected>全球+T1（已合并）</option>
      </select>
    </div>
  `;

  container.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = applyPreset(filters, btn.dataset.preset, meta);
      onChange(next);
    });
  });

  container.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      const next = { ...filters, mode };
      if (mode === 'new') {
        next.preset = 'all';
        next.date_start = meta.weekly_date_start || meta.weekly_default_date_start || next.date_start;
        next.date_end = meta.weekly_date_end || meta.weekly_default_date_end || next.date_end;
      } else {
        next.preset = 'all';
        next.date_start = meta.data_date_start || meta.default_date_start || next.date_start;
        next.date_end = meta.data_date_end || meta.default_date_end || next.date_end;
      }
      onChange(next);
    });
  });

  container.querySelectorAll('select[data-key]').forEach((sel) => {
    sel.addEventListener('change', () => onChange({ ...filters, [sel.dataset.key]: sel.value }));
  });

  ['date-start', 'date-end'].forEach((id) => {
    container.querySelector(`#${id}`).addEventListener('change', (e) => {
      const key = id === 'date-start' ? 'date_start' : 'date_end';
      onChange({ ...filters, preset: 'custom', [key]: e.target.value });
    });
  });
}

export function queryFilters(filters) {
  const { preset, mode, channel, ...rest } = filters;
  // 数据已限定 WW，静态快照素材行未必带 channel，传 WW 会把线上数据全滤掉
  return rest;
}
