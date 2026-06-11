import { api } from '../api.js';
import { queryFilters } from '../filters.js';

let survivalChart = null;

function kpiCard(title, value, sub = '') {
  return `
    <div class="card kpi-card">
      <div class="kpi-title">${title}</div>
      <div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>
  `;
}

function renderKpis(summary, mode) {
  const title = mode === 'new' ? '上新素材成效统计' : '账户内成效统计';
  return `
    <div class="section-title">${title}</div>
    <div class="kpi-grid">
      ${kpiCard('素材总数', summary.total_materials)}
      ${kpiCard('出单素材数', summary.ordered_materials)}
      ${kpiCard('总出单量', summary.total_orders)}
      ${kpiCard('素材出单率', `${summary.order_rate}%`)}
      ${kpiCard(`2单及以上素材率 (${summary.ge2_count}条)`, `${summary.ge2_rate}%`)}
      ${kpiCard(`5单及以上素材率 (${summary.ge5_count}条)`, `${summary.ge5_rate}%`)}
    </div>
  `;
}

function renderSurvivalChart(el, trend) {
  if (!survivalChart) survivalChart = echarts.init(el);
  survivalChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['每日素材数', '成活数（有购物）'] },
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: trend.dates },
    yAxis: { type: 'value', name: '数量', minInterval: 1 },
    series: [
      {
        name: '每日素材数',
        type: 'bar',
        data: trend.counts,
        itemStyle: { color: '#1677ff' },
      },
      {
        name: '成活数（有购物）',
        type: 'line',
        data: trend.survived_counts,
        itemStyle: { color: '#16a34a' },
        lineStyle: { width: 2 },
        symbol: 'circle',
        symbolSize: 6,
      },
    ],
  });
}

export async function renderGoldenCross(container, state) {
  const q = queryFilters(state.filters);
  const [summary, trend] = await Promise.all([
    api.summary(q, state.filters.mode),
    api.survivalTrend(q, state.filters.mode),
  ]);

  container.innerHTML = `
    ${renderKpis(summary, state.filters.mode)}
    <div class="card">
      <div class="section-title">First-Seen 成活趋势图 <span style="font-size:12px;color:#6b7280;font-weight:400">（按素材名前缀日期，非报告日期）</span></div>
      <div id="survival-chart" class="chart"></div>
    </div>
  `;

  renderSurvivalChart(container.querySelector('#survival-chart'), trend);
  window.addEventListener('resize', () => survivalChart && survivalChart.resize());
}
