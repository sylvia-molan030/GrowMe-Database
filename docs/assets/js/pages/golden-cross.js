import { api } from '../api.js';
import { queryFilters } from '../filters.js';
import { bindCopyMaterials } from '../copy-material.js';
import { fmtCpi, fmtSubRate, fmtSubs, materialNameHtml } from '../material-metrics.js';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadHeatmapGrid() {
  return import('../heatmap-grid.js');
}

let survivalChart = null;
let scatterChart = null;
let decayChart = null;
let roasHistChart = null;

const NEW_SCHEMA_CUTOFF = '2026-06-29';

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

function renderKpis(summary, mode) {
  const title = mode === 'new' ? '上新素材成效统计（全量 · 按素材日期近 2 周）' : '账户内成效统计';
  return `
    <div class="section-title">${title}</div>
    <div class="kpi-grid kpi-grid-6">
      ${kpiCard('素材总数', summary.total_materials)}
      ${kpiCard('出单素材数', summary.ordered_materials)}
      ${kpiCard('总出单量', summary.total_orders)}
      ${kpiCard('素材出单率', `${summary.order_rate}%`)}
      ${kpiCard(`2单及以上素材率 (${summary.ge2_count}条)`, `${summary.ge2_rate}%`)}
      ${kpiCard('平均ROAS', summary.avg_roas ?? '-')}
    </div>
  `;
}

function primaryTheme(theme) {
  if (!theme || theme === '未知') return theme || '未知';
  let t = String(theme).toLowerCase().replace(/_lvl\d+.*$/i, '');
  const firstSeg = t.split('-')[0];
  return firstSeg.split(' ')[0] || firstSeg;
}

function directionNorm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchAudience(direction, fx) {
  if (!fx) return true;
  const d = directionNorm(direction);
  const f = directionNorm(fx);
  return d === f || d.startsWith(f) || f.startsWith(d);
}

function usesNewSchema(firstSeen) {
  return Boolean(firstSeen && firstSeen >= NEW_SCHEMA_CUTOFF);
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

function genePoolMaterials(allRows, fx, zt) {
  return (allRows || []).filter((m) => {
    if (!usesNewSchema(m.first_seen)) return false;
    if (fx && !matchAudience(m.direction, fx)) return false;
    if (zt && primaryTheme(m.theme) !== String(zt).toLowerCase()) return false;
    return true;
  });
}

function defaultGenePair(heatmap) {
  if (!heatmap?.cells?.length) return { fx: '', zt: '' };
  const ordered = [...heatmap.cells].sort((a, b) => {
    if (b.ordered !== a.ordered) return b.ordered - a.ordered;
    return b.rate - a.rate;
  });
  const pick = ordered.find((c) => c.ordered > 0) || ordered[0];
  return { fx: pick.y, zt: pick.x };
}

function renderGeneProbeShell(heatmap, probe) {
  const dirs = heatmap?.y_values || [];
  const themes = heatmap?.x_values || [];
  if (!dirs.length || !themes.length) {
    return `
      <div class="card" id="gene-probe-card">
        <div class="section-title">爆款基因素材探测箱（下钻联动）</div>
        <div class="empty">当前筛选下暂无可用的方向 × 主题组合</div>
      </div>
    `;
  }

  const fx = probe.fx && dirs.includes(probe.fx) ? probe.fx : dirs[0];
  const zt = probe.zt && themes.includes(probe.zt) ? probe.zt : themes[0];
  probe.fx = fx;
  probe.zt = zt;

  return `
    <div class="card" id="gene-probe-card">
      <div class="section-title">爆款基因素材探测箱（下钻联动）</div>
      <div class="gene-probe-filters">
        <label class="gene-field">
          <span>方向 (FX)</span>
          <select id="gene-fx" class="select">
            ${dirs.map((d) => `<option value="${escapeHtml(d)}" ${d === fx ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
          </select>
        </label>
        <label class="gene-field">
          <span>主题 (ZT)</span>
          <select id="gene-zt" class="select">
            ${themes.map((t) => `<option value="${escapeHtml(t)}" ${t === zt ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
          </select>
        </label>
        <span class="gene-tag" id="gene-tag">${escapeHtml(fx)} × ${escapeHtml(zt)}</span>
      </div>
      <div id="gene-probe-body"></div>
    </div>
  `;
}

function renderGeneProbeBody(container, allRows, probe) {
  const body = container.querySelector('#gene-probe-body');
  if (!body) return;

  const pool = genePoolMaterials(allRows, probe.fx, probe.zt);
  const ordered = pool.filter((m) => (m.purchases || 0) >= 1);
  const tab = probe.tab === 'all' ? 'all' : 'ordered';
  const list = tab === 'all' ? pool : ordered;

  const sortKey = probe.sortBy || 'purchases';
  const sortDir = probe.sortDir || 'desc';
  const dir = sortDir === 'asc' ? 1 : -1;
  list.sort((a, b) => ((a[sortKey] || 0) - (b[sortKey] || 0)) * dir);

  const pageSize = probe.pageSize || 10;
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  probe.page = Math.min(Math.max(1, probe.page || 1), pages);
  const start = (probe.page - 1) * pageSize;
  const pageRows = list.slice(start, start + pageSize);

  const sortMark = (key) => {
    if (probe.sortBy !== key) return '';
    return probe.sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  body.innerHTML = `
    <div class="tabs gene-tabs">
      <button class="tab ${tab === 'ordered' ? 'active' : ''}" data-gene-tab="ordered">出单素材 (${ordered.length})</button>
      <button class="tab ${tab === 'all' ? 'active' : ''}" data-gene-tab="all">全部素材 (${pool.length})</button>
    </div>
    <div class="table-wrap">
      <table class="data-table gene-probe-table">
        <thead>
          <tr>
            <th>标准素材ID（点击复制）</th>
            <th>首次上线日</th>
            <th class="sortable" data-sort="purchases">总出单量${sortMark('purchases')}</th>
            <th class="sortable" data-sort="subscriptions">订阅数${sortMark('subscriptions')}</th>
            <th class="sortable" data-sort="cpi">CPI${sortMark('cpi')}</th>
            <th class="sortable" data-sort="subscription_rate">订阅率${sortMark('subscription_rate')}</th>
            <th class="sortable" data-sort="ctr">综合 CTR${sortMark('ctr')}</th>
            <th class="sortable" data-sort="roas">综合 ROAS${sortMark('roas')}</th>
          </tr>
        </thead>
        <tbody>
          ${pageRows.map((m) => `
            <tr>
              <td>${materialNameHtml(m, escapeHtml, { innerTag: 'span', nameClass: 'mat-copy' })}</td>
              <td>${escapeHtml(m.first_seen || '-')}</td>
              <td class="num-strong">${Math.round(m.purchases || 0)}</td>
              <td class="num-strong">${fmtSubs(m.subscriptions)}</td>
              <td>${fmtCpi(m.cpi)}</td>
              <td>${fmtSubRate(m.subscription_rate)}</td>
              <td>${Number(m.ctr || 0).toFixed(2)}%</td>
              <td>${Number(m.roas || 0).toFixed(2)}</td>
            </tr>
          `).join('') || `<tr><td colspan="8" class="empty">该组合下暂无素材</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="pagination gene-pager">
      <span>共 ${list.length} 条 · 第 ${probe.page} / ${pages} 页</span>
      <div class="pager-actions">
        <button class="btn" id="gene-prev" ${probe.page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn" id="gene-next" ${probe.page >= pages ? 'disabled' : ''}>下一页</button>
        <select class="select" id="gene-page-size">
          ${[10, 20, 50].map((n) => `<option value="${n}" ${pageSize === n ? 'selected' : ''}>${n} 条/页</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  body.querySelectorAll('[data-gene-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      probe.tab = btn.dataset.geneTab;
      probe.page = 1;
      renderGeneProbeBody(container, allRows, probe);
    });
  });
  body.querySelectorAll('[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (probe.sortBy === key) {
        probe.sortDir = probe.sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        probe.sortBy = key;
        probe.sortDir = 'desc';
      }
      renderGeneProbeBody(container, allRows, probe);
    });
  });
  body.querySelector('#gene-prev')?.addEventListener('click', () => {
    probe.page = Math.max(1, probe.page - 1);
    renderGeneProbeBody(container, allRows, probe);
  });
  body.querySelector('#gene-next')?.addEventListener('click', () => {
    probe.page += 1;
    renderGeneProbeBody(container, allRows, probe);
  });
  body.querySelector('#gene-page-size')?.addEventListener('change', (e) => {
    probe.pageSize = Number(e.target.value);
    probe.page = 1;
    renderGeneProbeBody(container, allRows, probe);
  });
  bindCopyMaterials(body);
}

function bindGeneProbe(container, heatmap, allRows, probe) {
  const sync = () => {
    const tag = container.querySelector('#gene-tag');
    if (tag) tag.textContent = `${probe.fx} × ${probe.zt}`;
    const fxSel = container.querySelector('#gene-fx');
    const ztSel = container.querySelector('#gene-zt');
    if (fxSel) fxSel.value = probe.fx;
    if (ztSel) ztSel.value = probe.zt;
    container.querySelectorAll('.cross-cube-cell, .cross-table-row').forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.fx === probe.fx && tr.dataset.zt === probe.zt);
    });
    container.querySelectorAll('.direction-row').forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.fx === probe.fx);
    });
    renderGeneProbeBody(container, allRows, probe);
  };

  container.querySelector('#gene-fx')?.addEventListener('change', (e) => {
    probe.fx = e.target.value;
    probe.page = 1;
    sync();
  });
  container.querySelector('#gene-zt')?.addEventListener('change', (e) => {
    probe.zt = e.target.value;
    probe.page = 1;
    sync();
  });
  container.querySelectorAll('.cross-cube-cell, .cross-table-row').forEach((tr) => {
    const go = () => {
      probe.fx = tr.dataset.fx;
      probe.zt = tr.dataset.zt;
      probe.page = 1;
      probe.tab = 'ordered';
      sync();
      container.querySelector('#gene-probe-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  });
  container.querySelectorAll('.direction-row').forEach((tr) => {
    const go = () => {
      probe.fx = tr.dataset.fx;
      probe.page = 1;
      probe.tab = 'ordered';
      sync();
      container.querySelector('#gene-probe-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  });
  sync();
}

export async function renderGoldenCross(container, state) {
  const { renderCrossRubricHeatmap, renderAudienceDirectionTable } = await loadHeatmapGrid();
  const q = queryFilters(state.filters);
  const [summary, trend, materialList, crossHeatmap] = await Promise.all([
    api.summary(q, state.filters.mode),
    api.survivalTrend(q, state.filters.mode),
    api.materials(q, { mode: state.filters.mode, page_size: 9999 }),
    api.crossRubricHeatmap(q, state.filters.mode),
  ]);

  if (!state.geneProbe) {
    const def = defaultGenePair(crossHeatmap);
    state.geneProbe = {
      fx: def.fx,
      zt: def.zt,
      tab: 'ordered',
      page: 1,
      pageSize: 10,
      sortBy: 'purchases',
      sortDir: 'desc',
    };
  } else if (crossHeatmap?.y_values?.length) {
    if (!crossHeatmap.y_values.includes(state.geneProbe.fx)
      || !crossHeatmap.x_values.includes(state.geneProbe.zt)) {
      const def = defaultGenePair(crossHeatmap);
      state.geneProbe.fx = def.fx;
      state.geneProbe.zt = def.zt;
    }
  }

  const allRows = materialList?.rows || [];

  container.innerHTML = `
    ${renderKpis(summary, state.filters.mode)}
    <div class="card">
      <div class="section-title">First-Seen 成活趋势图 <span style="font-size:12px;color:#6b7280;font-weight:400">（按素材名前缀日期，非报告日期）</span></div>
      <div id="survival-chart" class="chart"></div>
    </div>
    ${renderCrossRubricHeatmap(crossHeatmap, { hideIfEmpty: true, clickable: true })}
    ${renderAudienceDirectionTable(crossHeatmap, { hideIfEmpty: true, clickable: true })}
    ${renderGeneProbeShell(crossHeatmap, state.geneProbe)}
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
  if (allRows.length) {
    renderScatterChart(container.querySelector('#scatter-chart'), allRows);
    renderDecayChart(container.querySelector('#decay-chart'), allRows);
    renderROASHistogram(container.querySelector('#roas-hist-chart'), allRows);
  }
  if (crossHeatmap?.cells?.length) {
    bindGeneProbe(container, crossHeatmap, allRows, state.geneProbe);
  }

  window.addEventListener('resize', () => {
    survivalChart && survivalChart.resize();
    scatterChart && scatterChart.resize();
    decayChart && decayChart.resize();
    roasHistChart && roasHistChart.resize();
  });
}
