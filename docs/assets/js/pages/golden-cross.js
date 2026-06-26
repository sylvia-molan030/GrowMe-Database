import { api } from '../api.js';
import { queryFilters } from '../filters.js';

let survivalChart = null;
let scatterChart = null;
let decayChart = null;
let roasHistChart = null;

function initChart(instance, el) {
  if (instance && instance.getDom && instance.getDom() !== el) {
    instance.dispose();
    instance = null;
  }
  return instance || echarts.init(el);
}

function kpiCard(title, value, sub = '') {
  return `
    <div class="card kpi-card">
      <div class="kpi-title">${title}</div>
      <div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>
  `;
}

function kpiCardWithClass(title, value, sub, cls) {
  return `
    <div class="${cls}">
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
      ${kpiCardWithClass('总消耗', `$${summary.total_spend || 0}`, '', 'card kpi-card kpi-card-spend')}
      ${kpiCardWithClass('平均CPA', `$${summary.avg_cpa || '-'}`, '', 'card kpi-card kpi-card-spend')}
      ${kpiCardWithClass('平均ROAS', summary.avg_roas || '-', '', 'card kpi-card kpi-card-spend')}
    </div>
  `;
}

function renderSurvivalChart(el, trend) {
  survivalChart = initChart(survivalChart, el);
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
  }, true);
}

function renderScatterChart(el, items) {
  const data = items
    .filter((m) => m.spend > 0 && m.purchases > 0)
    .map((m) => [m.spend, m.purchases, m.roas || 0, m.material_id]);

  if (data.length === 0) {
    el.innerHTML = '<div class="empty">当前筛选条件下无有效散点数据</div>';
    return;
  }

  el.innerHTML = '';
  scatterChart = initChart(scatterChart, el);
  scatterChart.setOption({
    tooltip: {
      formatter: (p) => `${p.data[3]}<br/>Spend: $${p.data[0]}<br/>Purchases: ${p.data[1]}<br/>ROAS: ${p.data[2]}`,
    },
    grid: { left: 60, right: 24, top: 24, bottom: 40 },
    xAxis: { name: '消耗 ($)', type: 'value', nameTextStyle: { fontSize: 12 } },
    yAxis: { name: '出单量', type: 'value', minInterval: 1, nameTextStyle: { fontSize: 12 } },
    series: [{
      type: 'scatter',
      data,
      symbolSize: (d) => Math.min(Math.max(Math.sqrt(d[1]) * 4, 4), 40),
      itemStyle: {
        color: (params) => {
          const roas = params.data[2];
          if (roas >= 2) return '#16a34a';
          if (roas >= 1) return '#ef9f27';
          return '#dc2626';
        },
        opacity: 0.65,
      },
    }],
  }, true);
}

function renderDecayChart(el, items) {
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="empty">暂无衰减数据</div>';
    return;
  }

  const byDay = {};
  items.forEach((m) => {
    if (!m.first_seen) return;
    const day = m.first_seen;
    if (!byDay[day]) byDay[day] = { total: 0, alive: 0 };
    byDay[day].total++;
    if (m.purchases >= 1) byDay[day].alive++;
  });

  const dates = Object.keys(byDay).sort();
  const rates = dates.map((d) => ({
    date: d,
    rate: Math.round((byDay[d].alive / byDay[d].total) * 1000) / 10,
  }));

  const smoothed = rates.map((r, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(rates.length - 1, i + 3); j++) {
      sum += rates[j].rate;
      count++;
    }
    return { date: r.date, rate: Math.round((sum / count) * 10) / 10 };
  });

  el.innerHTML = '';
  decayChart = initChart(decayChart, el);
  decayChart.setOption({
    tooltip: { trigger: 'axis', formatter: (p) => `${p[0].axisValue}<br/>出单率(7日平滑): ${p[0].data}%` },
    grid: { left: 48, right: 24, top: 24, bottom: 40 },
    xAxis: { type: 'category', data: smoothed.map((r) => r.date), axisLabel: { rotate: 30, fontSize: 10 } },
    yAxis: { type: 'value', name: '出单率 %', nameTextStyle: { fontSize: 12 } },
    series: [{
      type: 'line',
      data: smoothed.map((r) => r.rate),
      itemStyle: { color: '#7f77dd' },
      lineStyle: { width: 2 },
      symbol: 'circle',
      symbolSize: 3,
      areaStyle: { color: 'rgba(127,119,221,0.08)' },
    }],
  }, true);
}

function renderROASHistogram(el, items) {
  const roasValues = items.filter((m) => m.spend > 0 && m.roas > 0).map((m) => m.roas);
  if (roasValues.length === 0) {
    el.innerHTML = '<div class="empty">无有效 ROAS 数据</div>';
    return;
  }

  const buckets = [
    { label: '0-0.5', min: 0, max: 0.5 },
    { label: '0.5-1', min: 0.5, max: 1 },
    { label: '1-1.5', min: 1, max: 1.5 },
    { label: '1.5-2', min: 1.5, max: 2 },
    { label: '2-3', min: 2, max: 3 },
    { label: '3-5', min: 3, max: 5 },
    { label: '5-10', min: 5, max: 10 },
    { label: '10+', min: 10, max: Infinity },
  ];
  const dist = buckets.map((b) => ({
    label: b.label,
    count: roasValues.filter((v) => v >= b.min && v < b.max).length,
  }));

  el.innerHTML = '';
  roasHistChart = initChart(roasHistChart, el);
  roasHistChart.setOption({
    tooltip: { trigger: 'axis', formatter: (p) => `ROAS ${p[0].name}<br/>素材数: ${p[0].data}` },
    grid: { left: 48, right: 24, top: 24, bottom: 40 },
    xAxis: { type: 'category', data: dist.map((d) => d.label), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: '素材数', minInterval: 1 },
    series: [{
      type: 'bar',
      data: dist.map((d) => d.count),
      itemStyle: {
        color: (params) => {
          const idx = params.dataIndex;
          if (idx <= 2) return '#dc2626';
          if (idx <= 4) return '#ef9f27';
          return '#16a34a';
        },
        borderRadius: [4, 4, 0, 0],
      },
    }],
  }, true);
}

export async function renderGoldenCross(container, state) {
  const q = queryFilters(state.filters);
  const [summary, trend, materialList] = await Promise.all([
    api.summary(q, state.filters.mode),
    api.survivalTrend(q, state.filters.mode),
    api.materials(q, { mode: state.filters.mode, page_size: 9999 }),
  ]);

  container.innerHTML = `
    ${renderKpis(summary, state.filters.mode)}
    <div class="card">
      <div class="section-title">First-Seen 成活趋势图 <span style="font-size:12px;color:#6b7280;font-weight:400">（按素材名前缀日期，非报告日期）</span></div>
      <div id="survival-chart" class="chart"></div>
    </div>
    <div class="card">
      <div class="section-title">素材效率四象限 <span style="font-size:12px;color:#6b7280;font-weight:400">（气泡 = 出单量，颜色 = ROAS）</span></div>
      <div id="scatter-chart" class="chart" style="height:420px"></div>
    </div>
    <div class="card">
      <div class="section-title">素材出单率趋势 <span style="font-size:12px;color:#6b7280;font-weight:400">（7日移动平均）</span></div>
      <div id="decay-chart" class="chart"></div>
    </div>
    <div class="card">
      <div class="section-title">ROAS 分布直方图 <span style="font-size:12px;color:#6b7280;font-weight:400">（每个区间的素材数量）</span></div>
      <div id="roas-hist-chart" class="chart"></div>
    </div>
  `;

  renderSurvivalChart(container.querySelector('#survival-chart'), trend);
  if (materialList?.rows) {
    renderScatterChart(container.querySelector('#scatter-chart'), materialList.rows);
    renderDecayChart(container.querySelector('#decay-chart'), materialList.rows);
    renderROASHistogram(container.querySelector('#roas-hist-chart'), materialList.rows);
  }
  window.addEventListener('resize', () => {
    survivalChart && survivalChart.resize();
    scatterChart && scatterChart.resize();
    decayChart && decayChart.resize();
    roasHistChart && roasHistChart.resize();
  });
}
