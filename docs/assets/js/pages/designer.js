import { api } from '../api.js';
import { queryFilters } from '../filters.js';

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderDesigner(container, state) {
  const q = queryFilters(state.filters);
  const { rows } = await api.designers(q, state.filters.mode);

  if (!rows || rows.length === 0) {
    container.innerHTML = '<div class="empty">暂无设计师数据</div>';
    return;
  }

  const body = rows.map((r, i) => {
    const roasColor = (r.avg_roas || 0) >= 1.5 ? 'green' : (r.avg_roas || 0) >= 1 ? '' : 'red';
    return `
    <tr>
      <td>${i + 1}</td>
      <td><span class="pill">${escapeHtml(r.designer)}</span></td>
      <td>$${r.total_spend || 0}</td>
      <td>${r.total_materials || 0}</td>
      <td>${r.ordered_materials || 0}</td>
      <td>${r.total_orders || 0}</td>
      <td>${r.order_rate || 0}%</td>
      <td class="${roasColor}">${r.avg_roas || 0}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card">
      <div class="section-title">
        设计师绩效明细
        <span style="font-size:12px;color:#6b7280;font-weight:400">（gy / wxx / fj / jql / 095KB / pingme / jpl / czy）</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>排名</th><th>设计师</th><th>总消耗</th><th>素材总数</th><th>出单素材数</th>
              <th>总出单量</th><th>出单率</th><th>平均 ROAS</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `;
}
