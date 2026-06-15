import { api } from '../api.js';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTable(rows, emptyText) {
  return `
    <div class="table-wrap">
      <table class="asset-table">
        <thead>
          <tr>
            <th>排名</th><th>素材</th><th>方向</th><th>设计师</th>
            <th>购物</th><th>订阅</th><th>花费</th><th>ROAS</th><th>CTR</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((r) => `
            <tr>
              <td>${r.rank}</td>
              <td class="cell-material-name">${escapeHtml(r.material_id)}</td>
              <td><span class="tag">${escapeHtml(r.direction || '-')}</span></td>
              <td>${escapeHtml(r.designer || '-')}</td>
              <td style="color:#dc2626;font-weight:700">${r.purchases}</td>
              <td>${r.subscriptions || 0}</td>
              <td>$${r.spend}</td>
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

export async function renderRollback(container) {
  const data = await api.rollback();
  const week = data.recommend_week || '最新周';

  container.innerHTML = `
    <div class="card">
      <div class="section-title">
        历史回滚素材 <span class="muted">（${escapeHtml(data.period_label)} · ${data.criteria.historical}）</span>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:0 0 12px">
        来自回滚广告组投放数据，仅展示有购物的素材。
      </p>
      ${renderTable(data.historical, '暂无符合条件的回滚素材')}
    </div>

    <div class="card">
      <div class="section-title">
        ${escapeHtml(week)} 可回滚推荐
        <span class="muted">（${escapeHtml(data.criteria.recommended)}）</span>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:0 0 12px">
        本周上新中「没跑起来但出了单」的素材，适合回滚再测。每周导入新周数据后自动更新。
      </p>
      ${renderTable(data.recommended, `「${escapeHtml(week)}」暂无符合${escapeHtml(data.criteria.recommended || '条件')}的素材`)}
    </div>
  `;
}
