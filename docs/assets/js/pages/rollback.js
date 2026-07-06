import { api } from '../api.js';
import { escapeHtml } from '../heatmap-grid.js';

function formatWeekLabel(label) {
  if (!label) return label;
  return String(label).replace(/(\d{4})week$/i, '$1周');
}

function renderTable(rows, emptyText) {
  return `
    <div class="table-wrap">
      <table class="asset-table">
        <thead>
          <tr>
            <th>排名</th><th>素材</th><th>方向</th><th>设计师</th>
            <th>花费</th><th>购物</th><th>订阅</th><th>ROAS</th><th>CTR</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((r) => `
            <tr>
              <td>${r.rank}</td>
              <td class="cell-material-name">${escapeHtml(r.material_id)}</td>
              <td><span class="tag">${escapeHtml(r.direction || '-')}</span></td>
              <td>${escapeHtml(r.designer || '-')}</td>
              <td>$${r.spend}</td>
              <td style="color:#dc2626;font-weight:700">${r.purchases}</td>
              <td>${r.subscriptions || 0}</td>
              <td>${r.roas}</td>
              <td>${r.ctr}%</td>
              <td><span class="tag green">${escapeHtml(r.tag || '-')}</span></td>
            </tr>
          `).join('') : `<tr><td colspan="10" class="empty">${emptyText}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderWeekSummary(summary) {
  if (!summary) return '';
  return `
    <div class="kpi-grid kpi-grid-4" style="margin-bottom:12px">
      <div class="card kpi-card"><div class="kpi-title">素材数</div><div class="kpi-value">${summary.total_materials}</div></div>
      <div class="card kpi-card"><div class="kpi-title">出单素材</div><div class="kpi-value">${summary.ordered_materials}</div></div>
      <div class="card kpi-card"><div class="kpi-title">消耗</div><div class="kpi-value">$${summary.spend}</div></div>
      <div class="card kpi-card"><div class="kpi-title">购物 / 订阅</div><div class="kpi-value">${summary.purchases} / ${summary.subscriptions}</div></div>
    </div>
  `;
}

function renderHistoricalSection(data, activeWeek) {
  const blocks = data.historical_by_week || [];
  if (!blocks.length) {
    return `
      <div class="card">
        <div class="section-title">历史回滚素材 <span class="muted">（${escapeHtml(data.criteria.historical)}）</span></div>
        <div class="empty">暂无符合条件的回滚素材</div>
      </div>
    `;
  }

  const week = activeWeek && blocks.some((b) => b.week === activeWeek)
    ? activeWeek
    : blocks[blocks.length - 1].week;
  const current = blocks.find((b) => b.week === week) || blocks[0];

  return `
    <div class="card">
      <div class="section-title">历史回滚素材 <span class="muted">（按周 · ${escapeHtml(data.criteria.historical)}）</span></div>
      <p style="font-size:13px;color:#6b7280;margin:0 0 12px">
        来自回滚广告组投放数据，按素材所属周分组，仅展示有购物的素材。
      </p>
      <div class="week-tabs">
        ${blocks.map((b) => `
          <button class="tab ${b.week === week ? 'active' : ''}" data-rollback-week="${escapeHtml(b.week)}">${escapeHtml(formatWeekLabel(b.week))}</button>
        `).join('')}
      </div>
      ${renderWeekSummary(current.summary)}
      ${renderTable(current.materials, '该周暂无回滚出单素材')}
    </div>
  `;
}

export async function renderRollback(container, state = {}) {
  const data = await api.rollback();
  const recommendWeek = data.recommend_week || '最新周';
  const activeWeek = state.rollbackWeek || data.historical_weeks?.slice(-1)[0];

  container.innerHTML = `
    ${renderHistoricalSection(data, activeWeek)}
    <div class="card">
      <div class="section-title">
        ${escapeHtml(recommendWeek)} 可回滚推荐
        <span class="muted">（${escapeHtml(data.criteria.recommended)}）</span>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:0 0 12px">
        本周上新中「没跑起来但出了单」的素材，适合回滚再测。每周导入新周数据后自动更新。
      </p>
      ${renderTable(data.recommended, `「${escapeHtml(recommendWeek)}」暂无符合${escapeHtml(data.criteria.recommended || '条件')}的素材`)}
    </div>
  `;

  container.querySelectorAll('[data-rollback-week]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.rollbackWeek = btn.dataset.rollbackWeek;
      await renderRollback(container, state);
    });
  });
}
