import { api } from '../api.js';
import { queryFilters } from '../filters.js';
import { bindCopyMaterials } from '../copy-material.js';
import { fmtCpi, fmtSubRate, fmtSubs, materialNameHtml } from '../material-metrics.js';

const TIERS = [
  { key: 0, label: '全部素材' },
  { key: 1, label: '出单素材箱 (>= 1 单)' },
  { key: 2, label: '潜力新星箱 (>= 2 单)' },
  { key: 5, label: '潜力爆款箱 (>= 5 单)' },
  { key: 10, label: '超级战神箱 (>= 10 单)' },
];

const SCOPE_MODES = [
  { key: 'account', label: '账户内成效', sub: '全部素材（全球+T1 已合并）' },
  { key: 'weekly', label: '上新素材成效', sub: '全量数据 · 按素材日期最近 2 周' },
];

function statusTag(status) {
  const cls = status === '增长期' ? 'green' : status === '炮灰' ? 'red' : status === '衰退期' ? 'orange' : 'gray';
  return `<span class="tag ${cls}">${status || '-'}</span>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function runSearch(state, container) {
  const input = container.querySelector('#asset-keyword-input');
  state.assetKeyword = (input?.value || '').trim();
  state.assetPage = 1;
  renderAssetLibrary(container, state);
}

function materialsQuery(state) {
  const q = queryFilters(state.filters);
  const scopeMode = state.assetScopeMode || 'weekly';
  if (scopeMode === 'account') {
    return { q, extra: { mode: 'account', scope: 'account' } };
  }
  const weeklyLabels = (state.meta?.recent_weekly_labels || state.meta?.weekly_labels?.slice(-2) || []).join('、');
  return {
    q,
    extra: {
      mode: 'new',
      scope: 'weekly',
      weekly_only: true,
    },
    weeklyLabels,
  };
}

export async function renderAssetLibrary(container, state) {
  const scopeMode = state.assetScopeMode || 'weekly';
  const tier = state.assetTier ?? 0;
  const page = state.assetPage || 1;
  const keyword = state.assetKeyword || '';
  const minOrders = keyword ? 0 : tier;

  const { q, extra, weeklyLabels } = materialsQuery(state);

  const data = await api.materials(q, {
    ...extra,
    min_orders: minOrders,
    keyword,
    sort_by: 'purchases',
    sort_dir: 'desc',
    page,
    page_size: 20,
  });

  const scopeMeta = SCOPE_MODES.find((m) => m.key === scopeMode);
  const subtitle = scopeMode === 'weekly'
    ? `全量近 2 周（按素材日期）：${weeklyLabels || '暂无'}`
    : scopeMeta.sub;

  container.innerHTML = `
    <div class="card">
      <div class="section-title">
        <span>核心资产晋级库 <span style="font-size:12px;color:#6b7280;font-weight:400">（${subtitle}）</span></span>
        <button class="btn" id="export-assets">导出 CSV</button>
      </div>
      <div class="tabs asset-scope-tabs">
        ${SCOPE_MODES.map((m) => `
          <button class="tab ${scopeMode === m.key ? 'active' : ''}" data-scope-mode="${m.key}">${m.label}</button>
        `).join('')}
      </div>
      <div class="toolbar asset-search-bar">
        <input class="input search-input" id="asset-keyword-input"
          placeholder="搜索素材全名，如 20260604、Learning、Mindset、fj_jql"
          value="${escapeHtml(keyword)}" />
        <button class="btn btn-primary" id="asset-search-btn">搜索素材</button>
        ${keyword ? '<button class="btn" id="asset-clear-search">清除</button>' : ''}
      </div>
      <div class="tabs">
        ${TIERS.map((t) => `
          <button class="tab ${tier === t.key && !keyword ? 'active' : ''}" data-tier="${t.key}">${t.label}</button>
        `).join('')}
      </div>
      ${keyword ? '<div style="font-size:12px;color:#6b7280;margin-bottom:10px">搜索模式：已在全部素材中匹配，不受档位限制</div>' : ''}
      <div class="table-wrap">
        <table class="asset-table">
          <thead>
            <tr>
              <th>排名</th><th>标准素材ID</th><th>用户人群 (FX)</th><th>总花费</th><th>期间总出单量</th>
              <th>订阅数</th><th>CPI</th><th>订阅率</th>
              <th>综合 CTR</th><th>综合 ROAS</th><th>跑量情况</th>
            </tr>
          </thead>
          <tbody>
            ${data.rows.map((r) => `
              <tr>
                <td>${r.rank}</td>
                <td>${materialNameHtml(r, escapeHtml, { nameClass: 'cell-material-name mat-detail-link' })}</td>
                <td><span class="tag">${escapeHtml(r.direction)}</span></td>
                <td>$${r.spend}</td>
                <td style="color:#dc2626;font-weight:700">${r.purchases}</td>
                <td style="color:#dc2626;font-weight:700">${fmtSubs(r.subscriptions)}</td>
                <td>${fmtCpi(r.cpi)}</td>
                <td>${fmtSubRate(r.subscription_rate)}</td>
                <td>${r.ctr}%</td>
                <td>${r.roas}</td>
                <td>${statusTag(r.scaling_status)}</td>
              </tr>
            `).join('') || `<tr><td colspan="11" class="empty">${keyword ? '未找到匹配素材' : '该档位暂无素材'}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        共 ${data.total} 条${keyword ? `（关键词: ${keyword}）` : ''} · 第 ${page} 页
        <button class="btn" id="asset-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn" id="asset-next" ${page * 20 >= data.total ? 'disabled' : ''}>下一页</button>
      </div>
    </div>
  `;

  bindCopyMaterials(container);

  container.querySelectorAll('[data-scope-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.assetScopeMode = btn.dataset.scopeMode;
      state.assetTier = 0;
      state.assetKeyword = '';
      state.assetPage = 1;
      renderAssetLibrary(container, state);
    });
  });

  container.querySelector('#asset-search-btn').addEventListener('click', () => runSearch(state, container));
  container.querySelector('#asset-keyword-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch(state, container);
  });
  container.querySelector('#asset-clear-search')?.addEventListener('click', () => {
    state.assetKeyword = '';
    state.assetPage = 1;
    renderAssetLibrary(container, state);
  });

  container.querySelectorAll('[data-tier]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.assetTier = Number(btn.dataset.tier);
      state.assetKeyword = '';
      state.assetPage = 1;
      renderAssetLibrary(container, state);
    });
  });

  container.querySelector('#asset-prev')?.addEventListener('click', () => {
    state.assetPage = Math.max(1, (state.assetPage || 1) - 1);
    renderAssetLibrary(container, state);
  });
  container.querySelector('#asset-next')?.addEventListener('click', () => {
    state.assetPage = (state.assetPage || 1) + 1;
    renderAssetLibrary(container, state);
  });

  container.querySelector('#export-assets').addEventListener('click', async () => {
    const { q, extra } = materialsQuery(state);
    const all = await api.materials(q, {
      ...extra,
      min_orders: minOrders,
      keyword,
      sort_by: 'purchases',
      sort_dir: 'desc',
      page: 1,
      page_size: 10000,
    });
    const header = ['排名', '素材ID', '方向', '花费', '出单量', '订阅数', 'CPI', '订阅率', 'CTR', 'ROAS', '跑量情况'];
    const lines = [header.join(',')].concat(
      all.rows.map((r) => [
        r.rank, `"${r.material_id}"`, r.direction, r.spend, r.purchases,
        r.subscriptions ?? 0, r.cpi ?? '', r.subscription_rate ?? '', r.ctr, r.roas, r.scaling_status,
      ].join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `growme_assets_${scopeMode}${keyword ? '_search' : `_ge${tier}`}.csv`;
    a.click();
  });
}
