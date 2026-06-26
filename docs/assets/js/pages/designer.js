import { api } from '../api.js';
import { queryFilters } from '../filters.js';

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let designerChart = null;

function drawDesignerChart(canvas, rows) {
  if (designerChart) designerChart.destroy();

  const top = rows.slice(0, 8);

  designerChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top.map((r) => r.designer),
      datasets: [
        {
          label: 'ROAS',
          data: top.map((r) => r.avg_roas || 0),
          backgroundColor: '#378add',
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          label: '出单率 %',
          data: top.map((r) => r.order_rate || 0),
          backgroundColor: '#ef9f27',
          borderRadius: 4,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}`,
          },
        },
      },
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'ROAS' },
          beginAtZero: true,
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: '出单率 %' },
          beginAtZero: true,
          grid: { drawOnChartArea: false },
        },
        x: { ticks: { maxRotation: 20, font: { size: 11 } } },
      },
    },
  });
}

export async function renderDesigner(container, state) {
  const q = queryFilters(state.filters);
  const { rows } = await api.designers(q, state.filters.mode);

  if (!rows || rows.length === 0) {
    container.innerHTML = '<div class="empty">暂无设计师数据</div>';
    return;
  }

  const totalSpend = rows.reduce((s, r) => s + (r.total_spend || 0), 0);
  const totalMats = rows.reduce((s, r) => s + (r.total_materials || 0), 0);
  const totalOrders = rows.reduce((s, r) => s + (r.total_orders || 0), 0);
  const bestDesigner = [...rows].sort((a, b) => (b.order_rate || 0) - (a.order_rate || 0))[0];

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
    <div class="section-title">设计师概览</div>
    <div class="kpi-grid">
      <div class="card kpi-card">
        <div class="kpi-title">设计师数</div>
        <div class="kpi-value">${rows.length}</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-title">总消耗</div>
        <div class="kpi-value">$${Math.round(totalSpend).toLocaleString()}</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-title">总素材数</div>
        <div class="kpi-value">${totalMats}</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-title">总出单量</div>
        <div class="kpi-value red">${totalOrders}</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-title">最高出单率</div>
        <div class="kpi-value green">${bestDesigner ? `${bestDesigner.order_rate}%` : '-'}</div>
        <div class="kpi-sub">${bestDesigner ? escapeHtml(bestDesigner.designer) : ''}</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-title">人均素材数</div>
        <div class="kpi-value">${Math.round(totalMats / rows.length)}</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">设计师关键指标对比</div>
      <div style="height:300px"><canvas id="designer-bar-chart" role="img" aria-label="设计师对比柱状图"></canvas></div>
    </div>

    <div class="card">
      <div class="section-title">
        设计师绩效明细
        <span style="font-size:12px;color:#6b7280;font-weight:400">（gy / wxx / fj / jql / 095KB / pingme / jpl）</span>
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

  setTimeout(() => {
    const canvas = container.querySelector('#designer-bar-chart');
    if (!canvas || rows.length === 0) return;
    if (window.Chart) {
      drawDesignerChart(canvas, rows);
    } else {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      s.onload = () => drawDesignerChart(canvas, rows);
      document.head.appendChild(s);
    }
  }, 50);
}
