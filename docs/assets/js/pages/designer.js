import { api } from '../api.js';
import { queryFilters } from '../filters.js';

export async function renderDesigner(container, state) {
  const q = queryFilters(state.filters);
  const { rows } = await api.designers(q, state.filters.mode);

  const body = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span class="pill">${r.designer}</span></td>
      <td>${r.total_materials}</td>
      <td>${r.ordered_materials}</td>
      <td>${r.total_orders}</td>
      <td>${r.order_rate}%</td>
      <td>${r.avg_roas}</td>
      <td>$${r.total_spend}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="card">
      <div class="section-title">
        设计师绩效看板
        <span style="font-size:12px;color:#6b7280;font-weight:400">（gy / wxx / fj / jql / 095KB / pingme / jpl）</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>排名</th><th>设计师</th><th>素材总数</th><th>出单素材数</th>
              <th>总出单量</th><th>出单率</th><th>平均 ROAS</th><th>总消耗</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="8" class="empty">暂无设计师数据</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}
