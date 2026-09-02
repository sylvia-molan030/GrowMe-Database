import { api } from '../api.js';
import { queryFilters } from '../filters.js';
import { bindCopyMaterials } from '../copy-material.js';
import { fmtCpi, fmtSubRate, fmtSubs, inlineCostText, materialNameHtml, summaryMetricsFromRows } from '../material-metrics.js';

const DESIGNER_STYLES = {
  gy: { bg: '#dbeafe', color: '#1d4ed8' },
  fj: { bg: '#d1fae5', color: '#047857' },
  jql: { bg: '#fef3c7', color: '#b45309' },
  '095kb': { bg: '#e0e7ff', color: '#4338ca' },
  pingme: { bg: '#ffedd5', color: '#c2410c' },
  jpl: { bg: '#f3e8ff', color: '#7e22ce' },
  czy: { bg: '#e0f2fe', color: '#0369a1' },
  joy: { bg: '#ccfbf1', color: '#0f766e' },
  thagirl: { bg: '#ffe4e6', color: '#be123c' },
  cty: { bg: '#fef3c7', color: '#b45309' },
};

const FALLBACK_PALETTE = [
  { bg: '#e0f2fe', color: '#0369a1' },
  { bg: '#ecfccb', color: '#4d7c0f' },
  { bg: '#fde68a', color: '#92400e' },
  { bg: '#ddd6fe', color: '#5b21b6' },
  { bg: '#fecdd3', color: '#9f1239' },
];

const trendCharts = new Map();

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatRate(value) {
  if (value === null || value === undefined || value === '' || Number(value) <= 0) return '-';
  return `${Number(value).toFixed(2)}%`;
}

function designerStyle(designer) {
  const key = String(designer || '?').toLowerCase();
  if (key.startsWith('pingme_')) return DESIGNER_STYLES.pingme;
  if (DESIGNER_STYLES[key]) return DESIGNER_STYLES[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash + key.charCodeAt(i) * (i + 1)) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[hash];
}

function designerPill(designer) {
  const name = designer || '?';
  const { bg, color } = designerStyle(name);
  const label = name.length > 6 ? name.slice(0, 6) : name;
  return `<span class="pill pill-designer" style="background:${bg};color:${color};min-width:28px;width:auto;padding:0 8px" title="${escapeHtml(name)}">${escapeHtml(label)}</span>`;
}

function statusTag(status) {
  const cls = status === '增长期' ? 'green' : status === '炮灰' ? 'red' : status === '衰退期' ? 'orange' : 'gray';
  return `<span class="tag ${cls}">${escapeHtml(status || '-')}</span>`;
}

function roasClass(roas) {
  return Number(roas) > 0 && Number(roas) < 0.4 ? 'roas-low' : '';
}

async function fetchMaterialTrends() {
  const ver = document.documentElement.dataset.build || '';
  const url = new URL('data/material-daily-trends.json', window.location.href);
  if (ver) url.searchParams.set('v', ver);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return res.json();
  } catch {
    /* ignore */
  }
  if (typeof api?.materialDailyTrends === 'function') {
    try {
      return await api.materialDailyTrends();
    } catch {
      /* ignore */
    }
  }
  return { snapshot_date: null, trends: {} };
}

function renderSummaryBar(allRows) {
  const sumOrders = allRows.reduce((s, m) => s + m.purchases, 0);
  const sumSpend = Math.round(allRows.reduce((s, m) => s + m.spend, 0));
  const roasItems = allRows.filter((m) => m.roas > 0);
  const avgROAS = roasItems.length
    ? Math.round(roasItems.reduce((s, m) => s + m.roas, 0) / roasItems.length * 100) / 100
    : 0;
  const orderRate = allRows.length
    ? Math.round(allRows.filter((m) => m.purchases >= 1).length / allRows.length * 1000) / 10
    : 0;
  const subMetrics = summaryMetricsFromRows(allRows);

  return `
    <div class="card" style="margin-bottom:12px">
      <div class="summary-bar">
        <div class="summary-item"><span class="label">素材数</span><span class="value">${allRows.length}</span></div>
        <div class="summary-item"><span class="label">总出单</span><span class="value red">${sumOrders}</span></div>
        <div class="summary-item"><span class="label">总消耗</span><span class="value">$${sumSpend}</span></div>
        <div class="summary-item"><span class="label">总订阅数</span><span class="value red">${subMetrics.total_subscriptions}</span></div>
        <div class="summary-item"><span class="label">素材订阅率</span><span class="value">${subMetrics.subscription_rate}%</span></div>
        <div class="summary-item"><span class="label">平均CPI</span><span class="value">${fmtCpi(subMetrics.avg_cpi)}</span></div>
        <div class="summary-item"><span class="label">平均ROAS</span><span class="value ${avgROAS >= 0.4 ? 'green' : 'red'}">${avgROAS}</span></div>
        <div class="summary-item"><span class="label">出单率</span><span class="value">${orderRate}%</span></div>
      </div>
    </div>
  `;
}

function trendTableHtml(trend) {
  if (!trend?.dates?.length) return '';
  return `
    <table class="trend-mini-table">
      <thead><tr><th>日期</th><th>日消耗</th><th>ROAS</th></tr></thead>
      <tbody>
        ${trend.dates.map((d, i) => `
          <tr>
            <td>${escapeHtml(d.slice(5))}</td>
            <td>$${trend.spend_daily[i]}</td>
            <td class="${roasClass(trend.roas[i])}">${trend.roas[i]}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderTrendChart(el, trend) {
  if (!window.echarts || !trend?.dates?.length) return;
  const chart = window.echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['日消耗', 'ROAS'], top: 0 },
    grid: { left: 48, right: 48, top: 36, bottom: 28 },
    xAxis: { type: 'category', data: trend.dates.map((d) => d.slice(5)), axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '消耗 $', splitLine: { lineStyle: { type: 'dashed' } } },
      { type: 'value', name: 'ROAS', splitLine: { show: false } },
    ],
    series: [
      {
        name: '日消耗',
        type: 'bar',
        data: trend.spend_daily,
        itemStyle: { color: '#1677ff', borderRadius: [3, 3, 0, 0] },
      },
      {
        name: 'ROAS',
        type: 'line',
        yAxisIndex: 1,
        data: trend.roas,
        smooth: true,
        itemStyle: { color: '#ef9f27' },
        lineStyle: { width: 2 },
      },
    ],
  }, true);
  return chart;
}

function renderTable(rows, sortBy, sortDir, trends, openTrendId) {
  const arrow = (col) => (sortBy === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');
  const body = rows.map((r) => {
    const midKey = String(r.material_id || '').trim().toLowerCase();
    const trend = trends[midKey];
    const isOpen = openTrendId === midKey;
    return `
      <tr class="leaderboard-row" data-mid="${escapeHtml(midKey)}">
        <td>${r.rank}</td>
        <td>${materialNameHtml(r, escapeHtml, { metricsText: inlineCostText(r) })}</td>
        <td>${designerPill(r.designer)}</td>
        <td>${escapeHtml(r.serial_code || '-')}</td>
        <td>$${r.spend}</td>
        <td>${r.purchases}</td>
        <td>${fmtSubs(r.subscriptions)}</td>
        <td>${fmtCpi(r.cpi)}</td>
        <td>${fmtSubRate(r.subscription_rate)}</td>
        <td class="${roasClass(r.roas)}">${r.roas}</td>
        <td>${formatRate(r.hook_rate)}</td>
        <td>${formatRate(r.retention_rate)}</td>
        <td>${statusTag(r.scaling_status)}</td>
        <td><button type="button" class="btn btn-sm trend-toggle ${isOpen ? 'active' : ''}" data-trend-toggle="${escapeHtml(midKey)}">${isOpen ? '收起' : '趋势'}</button></td>
      </tr>
      <tr class="trend-row ${isOpen ? '' : 'hidden'}" data-trend-row="${escapeHtml(midKey)}">
        <td colspan="14">
          <div class="trend-panel">
            ${trend?.dates?.length
              ? `<div class="trend-chart" id="trend-chart-${r.rank}" style="height:220px"></div>${trendTableHtml(trend)}`
              : '<div class="empty trend-empty">暂无历史快照。连续多日更新全量数据后，将在此展示日消耗（柱）与 ROAS（线）。</div>'}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="table-wrap leaderboard-table-wrap">
      <table id="leaderboard-table">
        <thead>
          <tr>
            <th>排名</th>
            <th>素材全称 (标准素材ID)</th>
            <th>设计师</th>
            <th>编号</th>
            <th data-sort="spend" class="${sortBy === 'spend' ? 'sorted' : ''}">累计消耗${arrow('spend')}</th>
            <th data-sort="purchases" class="${sortBy === 'purchases' ? 'sorted' : ''}">期间总出单量${arrow('purchases')}</th>
            <th data-sort="subscriptions" class="${sortBy === 'subscriptions' ? 'sorted' : ''}">订阅数${arrow('subscriptions')}</th>
            <th data-sort="cpi" class="${sortBy === 'cpi' ? 'sorted' : ''}">CPI${arrow('cpi')}</th>
            <th data-sort="subscription_rate" class="${sortBy === 'subscription_rate' ? 'sorted' : ''}">订阅率${arrow('subscription_rate')}</th>
            <th data-sort="roas" class="${sortBy === 'roas' ? 'sorted' : ''}">综合 ROAS${arrow('roas')}</th>
            <th data-sort="hook_rate" class="${sortBy === 'hook_rate' ? 'sorted' : ''}">吸睛率${arrow('hook_rate')}</th>
            <th data-sort="retention_rate" class="${sortBy === 'retention_rate' ? 'sorted' : ''}">持续播放率${arrow('retention_rate')}</th>
            <th>放量状态</th>
            <th>每日趋势</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="14" class="empty">暂无数据</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function runSearch(state, container) {
  const input = container.querySelector('#keyword-input');
  state.keyword = (input?.value || '').trim();
  state.tablePage = 1;
  renderLeaderboard(container, state);
}

function destroyTrendCharts() {
  trendCharts.forEach((c) => c.dispose?.());
  trendCharts.clear();
}

function paintOpenTrend(container, trends, openTrendId, rows) {
  if (!openTrendId) return;
  const row = rows.find((r) => String(r.material_id || '').trim().toLowerCase() === openTrendId);
  if (!row) return;
  const trend = trends[openTrendId];
  const el = container.querySelector(`#trend-chart-${row.rank}`);
  if (!el || !trend?.dates?.length) return;
  if (trendCharts.has(openTrendId)) {
    trendCharts.get(openTrendId).dispose();
  }
  const chart = renderTrendChart(el, trend);
  if (chart) trendCharts.set(openTrendId, chart);
}

export async function renderLeaderboard(container, state) {
  destroyTrendCharts();
  const q = queryFilters(state.filters);
  const keyword = state.keyword || '';
  const sortBy = state.sortBy || 'purchases';
  const sortDir = state.sortDir || 'desc';
  const page = state.tablePage || 1;
  const openTrendId = state.openTrendId || null;

  const [data, allData, trendsPayload] = await Promise.all([
    api.materials(q, { keyword, sort_by: sortBy, sort_dir: sortDir, page, page_size: 20, mode: state.filters.mode }),
    api.materials(q, { keyword, sort_by: sortBy, sort_dir: sortDir, page: 1, page_size: 9999, mode: state.filters.mode }),
    fetchMaterialTrends(),
  ]);
  const trends = trendsPayload?.trends || {};
  const allRows = allData.rows || [];
  const summaryBar = renderSummaryBar(allRows);

  container.innerHTML = `
    ${summaryBar}
    <div class="card">
      <div class="section-title">
        <span>模块 A · 爆款素材战神榜</span>
        <button class="btn" id="export-csv">导出 CSV</button>
      </div>
      <div class="toolbar">
        <input class="input search-input" id="keyword-input"
          placeholder="搜索素材名关键词，如 0605、Learning、Mindset、fj"
          value="${escapeHtml(keyword)}" />
        <button class="btn btn-primary" id="search-btn">搜索</button>
        ${keyword ? '<button class="btn" id="clear-search">清除</button>' : ''}
      </div>
      ${renderTable(data.rows, sortBy, sortDir, trends, openTrendId)}
      <div class="pagination">
        共 ${data.total} 条${keyword ? `（关键词: ${escapeHtml(keyword)}）` : ''} · 第 ${page} 页
        <button class="btn" id="prev-page" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn" id="next-page" ${page * 20 >= data.total ? 'disabled' : ''}>下一页</button>
      </div>
    </div>
  `;

  bindCopyMaterials(container);
  paintOpenTrend(container, trends, openTrendId, data.rows);

  container.querySelector('#search-btn').addEventListener('click', () => runSearch(state, container));
  container.querySelector('#keyword-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch(state, container);
  });
  container.querySelector('#clear-search')?.addEventListener('click', () => {
    state.keyword = '';
    state.tablePage = 1;
    renderLeaderboard(container, state);
  });

  container.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortBy === col) {
        state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        state.sortBy = col;
        state.sortDir = 'desc';
      }
      state.tablePage = 1;
      renderLeaderboard(container, state);
    });
  });

  container.querySelectorAll('[data-trend-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mid = btn.dataset.trendToggle;
      state.openTrendId = state.openTrendId === mid ? null : mid;
      renderLeaderboard(container, state);
    });
  });

  container.querySelector('#prev-page')?.addEventListener('click', () => {
    state.tablePage = Math.max(1, (state.tablePage || 1) - 1);
    renderLeaderboard(container, state);
  });
  container.querySelector('#next-page')?.addEventListener('click', () => {
    state.tablePage = (state.tablePage || 1) + 1;
    renderLeaderboard(container, state);
  });

  container.querySelector('#export-csv').addEventListener('click', async () => {
    const all = await api.materials(q, {
      keyword, sort_by: sortBy, sort_dir: sortDir, page: 1, page_size: 5000, mode: state.filters.mode,
    });
    const header = ['排名', '素材ID', '设计师', '编号', '消耗', '出单量', '订阅数', 'CPI', '订阅率', 'ROAS', '吸睛率', '持续播放率', '放量状态'];
    const lines = [header.join(',')].concat(
      all.rows.map((r) => [
        r.rank, `"${r.material_id}"`, r.designer, r.serial_code, r.spend, r.purchases,
        r.subscriptions ?? 0, r.cpi ?? '', r.subscription_rate ?? '', r.roas,
        r.hook_rate || '', r.retention_rate || '', r.scaling_status || '',
      ].join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'growme_leaderboard.csv';
    a.click();
  });
}
