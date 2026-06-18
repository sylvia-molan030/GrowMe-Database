/** GitHub Pages 静态模式：从 snapshot.json 读取数据并在前端过滤。 */

let snapshot = null;
let snapshotPromise = null;
let weeklyReportsCache = null;
let weeklyReportsPromise = null;

export const IS_STATIC = document.documentElement.dataset.static === 'true'
  || window.location.hostname.endsWith('github.io');

const BUILD_VER = document.documentElement.dataset.build || '';
const withCacheBust = (path) => {
  const url = new URL(path, window.location.href);
  if (BUILD_VER) url.searchParams.set('v', BUILD_VER);
  return url.href;
};
const DATA_URL = withCacheBust('./data/snapshot.json');
const WEEKLY_URL = withCacheBust('./data/weekly-reports.json');

async function fetchJSON(url, label) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`无法加载${label}: ${url}`);
  return res.json();
}

export async function loadSnapshot() {
  if (snapshot) return snapshot;
  if (!snapshotPromise) {
    snapshotPromise = fetchJSON(DATA_URL, '静态数据').then((data) => {
      snapshot = data;
      return data;
    });
  }
  return snapshotPromise;
}

async function loadWeeklyReports() {
  if (weeklyReportsCache) return weeklyReportsCache;
  if (!weeklyReportsPromise) {
    weeklyReportsPromise = (async () => {
      try {
        weeklyReportsCache = await fetchJSON(WEEKLY_URL, '周度报告');
        return weeklyReportsCache;
      } catch {
        await loadSnapshot();
        const reports = snapshot?.weekly_reports || {};
        const weeks = Object.keys(reports).sort((a, b) => {
          const key = (s) => { const m = s.match(/(\d{4})/); return m ? parseInt(m[1], 10) : 0; };
          return key(a) - key(b);
        });
        weeklyReportsCache = { weeks, reports };
        return weeklyReportsCache;
      }
    })();
  }
  return weeklyReportsPromise;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(`${v.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inRange(firstSeen, start, end) {
  const d = parseDate(firstSeen);
  if (!d) return true;
  const s = parseDate(start);
  const e = parseDate(end);
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
}

function matchFilters(item, filters) {
  const keys = ['direction', 'theme', 'optimization', 'stylization', 'pain_point', 'exercise_type', 'channel'];
  for (const key of keys) {
    const val = filters[key] || '全部';
    if (!val || val === '全部') continue;
    const itemVal = item[key];
    if (itemVal === undefined || itemVal === '' || itemVal === '未知') continue;
    if (itemVal !== val) return false;
  }
  return inRange(item.first_seen, filters.date_start, filters.date_end);
}

function pickMaterials(mode, scope, weeklyOnly) {
  const data = snapshot;
  let list = mode === 'new' || scope === 'weekly'
    ? [...data.materials_weekly]
    : [...data.materials_account];
  if (weeklyOnly) {
    const labels = new Set(data.meta.weekly_labels || []);
    list = list.filter((m) => labels.has(m.week_label));
  }
  return list;
}

function calcSummary(items) {
  const total = items.length;
  const ordered = items.filter((m) => m.purchases >= 1);
  const totalOrders = items.reduce((s, m) => s + m.purchases, 0);
  const ge2 = items.filter((m) => m.purchases >= 2);
  const ge5 = items.filter((m) => m.purchases >= 5);
  const roasVals = items.filter((m) => m.roas > 0).map((m) => m.roas);
  const ctrVals = items.filter((m) => m.ctr > 0).map((m) => m.ctr);
  const spendVals = items.filter((m) => m.spend > 0).map((m) => m.spend);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  return {
    total_materials: total,
    ordered_materials: ordered.length,
    total_orders: totalOrders,
    order_rate: total ? Math.round((ordered.length / total) * 10000) / 100 : 0,
    ge2_count: ge2.length,
    ge2_rate: total ? Math.round((ge2.length / total) * 10000) / 100 : 0,
    ge5_count: ge5.length,
    ge5_rate: total ? Math.round((ge5.length / total) * 10000) / 100 : 0,
    avg_roas: Math.round(avg(roasVals) * 100) / 100,
    avg_ctr: Math.round(avg(ctrVals) * 100) / 100,
    avg_spend: Math.round(avg(spendVals) * 100) / 100,
  };
}

function survivalTrend(items) {
  const byDay = {};
  items.forEach((m) => {
    if (!m.first_seen) return;
    if (!byDay[m.first_seen]) byDay[m.first_seen] = [];
    byDay[m.first_seen].push(m);
  });
  const dates = Object.keys(byDay).sort();
  return {
    dates,
    counts: dates.map((d) => byDay[d].length),
    survived_counts: dates.map((d) => byDay[d].filter((m) => m.purchases >= 1).length),
  };
}

function designerStats(items) {
  const by = {};
  items.forEach((m) => {
    const d = m.designer || '其他';
    if (!by[d]) by[d] = [];
    by[d].push(m);
  });
  const order = ['gy', 'wxx', 'fj', 'jql', '095KB', 'pingme', 'jpl', '其他'];
  return Object.entries(by)
    .map(([designer, list]) => {
      const ordered = list.filter((m) => m.purchases >= 1);
      const roasVals = list.filter((m) => m.roas > 0).map((m) => m.roas);
      return {
        designer,
        total_materials: list.length,
        ordered_materials: ordered.length,
        total_orders: list.reduce((s, m) => s + m.purchases, 0),
        order_rate: list.length ? Math.round((ordered.length / list.length) * 1000) / 10 : 0,
        avg_roas: roasVals.length
          ? Math.round((roasVals.reduce((a, b) => a + b, 0) / roasVals.length) * 100) / 100
          : 0,
        total_spend: Math.round(list.reduce((s, m) => s + m.spend, 0) * 100) / 100,
      };
    })
    .sort((a, b) => {
      const ai = order.indexOf(a.designer);
      const bi = order.indexOf(b.designer);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || b.total_orders - a.total_orders;
    });
}

function queryMaterials(filters, extra = {}) {
  const mode = extra.mode || 'account';
  const scope = extra.scope;
  const weeklyOnly = extra.weekly_only === true || extra.weekly_only === 'true';
  let items = pickMaterials(mode, scope, weeklyOnly).filter((m) => matchFilters(m, filters));

  const minOrders = Number(extra.min_orders || 0);
  if (minOrders > 0) items = items.filter((m) => m.purchases >= minOrders);

  const keyword = (extra.keyword || '').trim().toLowerCase();
  if (keyword) items = items.filter((m) => m.material_id.toLowerCase().includes(keyword));

  const sortBy = extra.sort_by || 'purchases';
  const sortDir = extra.sort_dir || 'desc';
  const reverse = sortDir !== 'asc';
  items.sort((a, b) => {
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    if (av < bv) return reverse ? 1 : -1;
    if (av > bv) return reverse ? -1 : 1;
    return 0;
  });

  const page = Number(extra.page || 1);
  const pageSize = Number(extra.page_size || 20);
  const total = items.length;
  const start = (page - 1) * pageSize;
  const rows = items.slice(start, start + pageSize).map((m, i) => ({ ...m, rank: start + i + 1 }));

  return { total, page, page_size: pageSize, rows };
}

export function createStaticApi() {
  return {
    meta: async () => {
      await loadSnapshot();
      return {
        ...snapshot.meta,
        generated_at: snapshot.generated_at,
        catalog: snapshot.meta.catalog,
      };
    },
    rescan: async () => {
      throw new Error('GitHub Pages 静态站点请推送 data_inputs 到 GitHub 触发自动部署');
    },
    summary: async (filters, mode) => {
      await loadSnapshot();
      const items = pickMaterials(mode).filter((m) => matchFilters(m, filters));
      return calcSummary(items);
    },
    survivalTrend: async (filters, mode) => {
      await loadSnapshot();
      const items = pickMaterials(mode).filter((m) => matchFilters(m, filters));
      return survivalTrend(items);
    },
    materials: async (filters, extra) => {
      await loadSnapshot();
      return queryMaterials(filters, extra);
    },
    designers: async (filters, mode) => {
      await loadSnapshot();
      const items = pickMaterials(mode).filter((m) => matchFilters(m, filters));
      return { rows: designerStats(items) };
    },
    weeklyReport: async (week) => {
      const { weeks, reports } = await loadWeeklyReports();
      const target = week && reports[week] ? week : weeks[weeks.length - 1];
      const report = reports[target] || null;
      if (report && !report.weeks) report.weeks = weeks;
      return { weeks, report };
    },
    rollback: async () => {
      await loadSnapshot();
      return snapshot.rollback || { period_label: '-', historical: [], recommended: [], recommend_week: null, criteria: {} };
    },
  };
}
