import { api } from '../api.js';
import { queryFilters } from '../filters.js';

function renderTable(rows, sortBy, sortDir) {
  const arrow = (col) => (sortBy === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');
  const body = rows.map((r) => `
    <tr>
      <td>${r.rank}</td>
      <td title="${r.material_id}">${r.material_id}</td>
      <td>${r.first_seen || '-'}</td>
      <td><span class="pill">${(r.designer || '?').slice(0, 3).toUpperCase()}</span></td>
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
            <th data-sort="first_seen" class="${sortBy === 'first_seen' ? 'sorted' : ''}">首次上线日${arrow('first_seen')}</th>
            <th>设计师</th>
            <th>编号</th>
            <th data-sort="spend" class="${sortBy === 'spend' ? 'sorted' : ''}">累计消耗${arrow('spend')}</th>
            <th data-sort="purchases" class="${sortBy === 'purchases' ? 'sorted' : ''}">期间总出单量${arrow('purchases')}</th>
            <th data-sort="roas" class="${sortBy === 'roas' ? 'sorted' : ''}">综合 ROAS${arrow('roas')}</th>
            <th data-sort="ctr" class="${sortBy === 'ctr' ? 'sorted' : ''}">综合 CTR${arrow('ctr')}</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="9" class="empty">暂无数据</td></tr>'}</tbody>
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

  const data = await api.materials(q, { keyword, sort_by: sortBy, sort_dir: sortDir, page, page_size: 20 });

  container.innerHTML = `
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
    const all = await api.materials(q, { keyword, sort_by: sortBy, sort_dir: sortDir, page: 1, page_size: 5000 });
    const header = ['排名', '素材ID', '首次上线日', '设计师', '编号', '消耗', '出单量', 'ROAS', 'CTR'];
    const lines = [header.join(',')].concat(
      all.rows.map((r) => [r.rank, `"${r.material_id}"`, r.first_seen, r.designer, r.serial_code, r.spend, r.purchases, r.roas, r.ctr].join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'growme_leaderboard.csv';
    a.click();
  });
}
