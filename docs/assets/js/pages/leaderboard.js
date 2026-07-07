import { api } from '../api.js';
import { queryFilters } from '../filters.js';
import { bindMaterialDetailLinks } from '../material-detail.js';

let dirChart = null;

const DESIGNER_STYLES = {
  gy: { bg: '#dbeafe', color: '#1d4ed8' },
  wxx: { bg: '#fce7f3', color: '#be185d' },
  fj: { bg: '#d1fae5', color: '#047857' },
  jql: { bg: '#fef3c7', color: '#b45309' },
  '095kb': { bg: '#e0e7ff', color: '#4338ca' },
  pingme: { bg: '#ffedd5', color: '#c2410c' },
  jpl: { bg: '#f3e8ff', color: '#7e22ce' },
  czy: { bg: '#e0f2fe', color: '#0369a1' },
  joy: { bg: '#ccfbf1', color: '#0f766e' },
  thagirl: { bg: '#ffe4e6', color: '#be123c' },
};

const FALLBACK_PALETTE = [
  { bg: '#e0f2fe', color: '#0369a1' },
  { bg: '#ecfccb', color: '#4d7c0f' },
  { bg: '#fde68a', color: '#92400e' },
  { bg: '#ddd6fe', color: '#5b21b6' },
  { bg: '#fecdd3', color: '#9f1239' },
];

const BAR_COLORS = ['#378add', '#534ab7', '#1d9e75', '#ef9f27', '#d85a30', '#d4537e', '#639922', '#888780'];

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ensureChartJS(cb) {
  if (window.Chart) return cb();
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
  s.onload = cb;
  document.head.appendChild(s);
}

function extractFxDirection(materialId) {
  if (!materialId) return '未知';
  const match = String(materialId).match(/FX-([^_]+)/i);
  return match ? match[1] : '未知';
}

function designerStyle(designer) {
  const key = String(designer || '?').toLowerCase();
  if (DESIGNER_STYLES[key]) return DESIGNER_STYLES[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash + key.charCodeAt(i) * (i + 1)) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[hash];
}

function designerPill(designer) {
  const name = designer || '?';
  const { bg, color } = designerStyle(name);
  const label = name.length > 6 ? name.slice(0, 6) : name;
  return `<span class="pill pill-designer" style="background:${bg};color:${color};min-width:28px;width:auto;padding:0 8px" title="${name}">${label}</span>`;
}

function renderSummaryBar(allRows) {
  const sumOrders = allRows.reduce((s, m) => s + m.purchases, 0);
  const sumSpend = Math.round(allRows.reduce((s, m) => s + m.spend, 0));
  const roasItems = allRows.filter((m) => m.roas > 0);
  const ctrItems = allRows.filter((m) => m.ctr > 0);
  const avgROAS = roasItems.length
    ? Math.round(roasItems.reduce((s, m) => s + m.roas, 0) / roasItems.length * 100) / 100
    : 0;
  const avgCTR = ctrItems.length
    ? Math.round(ctrItems.reduce((s, m) => s + m.ctr, 0) / ctrItems.length * 100) / 100
    : 0;
  const orderRate = allRows.length
    ? Math.round(allRows.filter((m) => m.purchases >= 1).length / allRows.length * 1000) / 10
    : 0;

  return `
    <div class="card" style="margin-bottom:12px">
      <div class="summary-bar">
        <div class="summary-item"><span class="label">素材数</span><span class="value">${allRows.length}</span></div>
        <div class="summary-item"><span class="label">总出单</span><span class="value red">${sumOrders}</span></div>
        <div class="summary-item"><span class="label">总消耗</span><span class="value">$${sumSpend}</span></div>
        <div class="summary-item"><span class="label">平均ROAS</span><span class="value ${avgROAS >= 1.5 ? 'green' : 'red'}">${avgROAS}</span></div>
        <div class="summary-item"><span class="label">平均CTR</span><span class="value">${avgCTR}%</span></div>
        <div class="summary-item"><span class="label">出单率</span><span class="value">${orderRate}%</span></div>
      </div>
    </div>
  `;
}

function renderDirectionBar(rows) {
  const byDir = {};
  (rows || []).forEach((m) => {
    const dir = m.direction || extractFxDirection(m.material_id);
    if (!byDir[dir]) byDir[dir] = { total: 0, ordered: 0 };
    byDir[dir].total++;
    if (m.purchases >= 1) byDir[dir].ordered++;
  });

  const dirs = Object.entries(byDir)
    .filter(([, v]) => v.total >= 5)
    .map(([label, v]) => ({
      label: label.length > 8 ? `${label.slice(0, 8)}…` : label,
      rate: v.total ? Math.round((v.ordered / v.total) * 1000) / 10 : 0,
      total: v.total,
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);

  return {
    html: `
      <div class="card">
        <div class="section-title">各方向出单率对比 (Top 8) <span class="muted" style="font-size:12px;font-weight:400">（FX- 用户人群，素材 ≥5 条才计入）</span></div>
        <div style="height:260px">
          ${dirs.length
            ? '<canvas id="dir-chart" role="img" aria-label="方向出单率柱状图"></canvas>'
            : '<div class="empty" style="padding:40px 0">当前筛选下无满足 ≥5 条素材的方向</div>'}
        </div>
      </div>
    `,
    dirs,
  };
}

function paintDirectionChart(container, dirs) {
  setTimeout(() => {
    const canvas = container.querySelector('#dir-chart');
    if (!canvas || !dirs.length) return;
    ensureChartJS(() => {
      if (dirChart) dirChart.destroy();
      dirChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: dirs.map((d) => d.label),
          datasets: [{
            label: '出单率 %',
            data: dirs.map((d) => d.rate),
            backgroundColor: dirs.map((_, i) => BAR_COLORS[i] || '#888780'),
            borderRadius: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'x',
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, title: { display: true, text: '出单率 %' } },
            x: { ticks: { maxRotation: 30, font: { size: 11 } } },
          },
        },
      });
    });
  }, 50);
}

function renderTable(rows, sortBy, sortDir) {
  const arrow = (col) => (sortBy === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');
  const body = rows.map((r) => `
    <tr>
      <td>${r.rank}</td>
      <td class="cell-material-name mat-detail-link" title="${escapeHtml(r.material_id)}">${escapeHtml(r.material_id)}</td>
      <td>${designerPill(r.designer)}</td>
      <td>${r.serial_code || '-'}</td>
      <td>$${r.spend}</td>
      <td>${r.purchases}</td>
      <td>${r.roas}</td>
      <td>${r.ctr}%</td>
    </tr>
  `).join('');

  return `
    <div class="table-wrap">
      <table id="leaderboard-table">
        <thead>
          <tr>
            <th>排名</th>
            <th>素材全称 (标准素材ID)</th>
            <th>设计师</th>
            <th>编号</th>
            <th data-sort="spend" class="${sortBy === 'spend' ? 'sorted' : ''}">累计消耗${arrow('spend')}</th>
            <th data-sort="purchases" class="${sortBy === 'purchases' ? 'sorted' : ''}">期间总出单量${arrow('purchases')}</th>
            <th data-sort="roas" class="${sortBy === 'roas' ? 'sorted' : ''}">综合 ROAS${arrow('roas')}</th>
            <th data-sort="ctr" class="${sortBy === 'ctr' ? 'sorted' : ''}">综合 CTR${arrow('ctr')}</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="8" class="empty">暂无数据</td></tr>'}</tbody>
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

export async function renderLeaderboard(container, state) {
  const q = queryFilters(state.filters);
  const keyword = state.keyword || '';
  const sortBy = state.sortBy || 'purchases';
  const sortDir = state.sortDir || 'desc';
  const page = state.tablePage || 1;

  const data = await api.materials(q, {
    keyword, sort_by: sortBy, sort_dir: sortDir, page, page_size: 20, mode: state.filters.mode,
  });

  const allData = await api.materials(q, {
    keyword, sort_by: sortBy, sort_dir: sortDir, page: 1, page_size: 9999, mode: state.filters.mode,
  });
  const allRows = allData.rows || [];
  const { html: directionBarHtml, dirs } = renderDirectionBar(allRows);
  const summaryBar = renderSummaryBar(allRows);

  container.innerHTML = `
    ${summaryBar}
    ${directionBarHtml}
    <div class="card">
      <div class="section-title">
        <span>模块 A · 爆款素材战神榜</span>
        <button class="btn" id="export-csv">导出 CSV</button>
      </div>
      <div class="toolbar">
        <input class="input search-input" id="keyword-input"
          placeholder="搜索素材名关键词，如 0605、Learning、Mindset、fj"
          value="${keyword}" />
        <button class="btn btn-primary" id="search-btn">搜索</button>
        ${keyword ? '<button class="btn" id="clear-search">清除</button>' : ''}
      </div>
      ${renderTable(data.rows, sortBy, sortDir)}
      <div class="pagination">
        共 ${data.total} 条${keyword ? `（关键词: ${keyword}）` : ''} · 第 ${page} 页
        <button class="btn" id="prev-page" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn" id="next-page" ${page * 20 >= data.total ? 'disabled' : ''}>下一页</button>
      </div>
    </div>
  `;

  paintDirectionChart(container, dirs);
  bindMaterialDetailLinks(container, data.rows);

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
    const header = ['排名', '素材ID', '设计师', '编号', '消耗', '出单量', 'ROAS', 'CTR'];
    const lines = [header.join(',')].concat(
      all.rows.map((r) => [r.rank, `"${r.material_id}"`, r.designer, r.serial_code, r.spend, r.purchases, r.roas, r.ctr].join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'growme_leaderboard.csv';
    a.click();
  });
}
