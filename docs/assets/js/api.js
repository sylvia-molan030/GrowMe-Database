import { IS_STATIC, createStaticApi, loadSnapshot } from './static-api.js';

const API_BASE = '';

export async function fetchJSON(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

export function buildQuery(filters, extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  return params.toString();
}

const liveApi = {
  meta: () => fetchJSON('/api/meta'),
  rescan: () => fetchJSON('/api/rescan', { method: 'POST' }),
  summary: (filters, mode) => fetchJSON(`/api/summary?${buildQuery(filters, { mode })}`),
  survivalTrend: (filters, mode) => fetchJSON(`/api/survival-trend?${buildQuery(filters, { mode })}`),
  crossRubricHeatmap: (filters, mode) => fetchJSON(`/api/cross-rubric-heatmap?${buildQuery(filters, { mode })}`),
  heatmap: (filters, yAxis, xAxis) => fetchJSON(`/api/heatmap?${buildQuery(filters, { y_axis: yAxis, x_axis: xAxis })}`),
  materials: (filters, extra) => fetchJSON(`/api/materials?${buildQuery(filters, extra)}`),
  designers: (filters, mode) => fetchJSON(`/api/designers?${buildQuery(filters, { mode })}`),
  weeklyReport: (week) => fetchJSON(`/api/weekly-report${week ? `?week=${encodeURIComponent(week)}` : ''}`),
  materialDailyTrends: () => fetchJSON('/api/material-daily-trends'),
  upload: async (fileList) => {
    const fd = new FormData();
    [...fileList].forEach((f) => fd.append('files', f));
    const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data.detail;
      const msg = Array.isArray(d) ? d.map((x) => x.msg || x).join('; ') : (d || `上传失败: ${res.status}`);
      throw new Error(msg);
    }
    return data;
  },
};

let apiImpl = liveApi;

export async function initApi() {
  if (IS_STATIC) {
    await loadSnapshot();
    apiImpl = createStaticApi();
    return 'static';
  }
  try {
    await fetchJSON('/api/health');
    return 'live';
  } catch {
    await loadSnapshot();
    apiImpl = createStaticApi();
    return 'static-fallback';
  }
}

export const api = {
  meta: (...args) => apiImpl.meta(...args),
  rescan: (...args) => apiImpl.rescan(...args),
  summary: (...args) => apiImpl.summary(...args),
  survivalTrend: (...args) => apiImpl.survivalTrend(...args),
  crossRubricHeatmap: (...args) => apiImpl.crossRubricHeatmap(...args),
  heatmap: (...args) => liveApi.heatmap(...args),
  materials: (...args) => apiImpl.materials(...args),
  designers: (...args) => apiImpl.designers(...args),
  weeklyReport: (...args) => apiImpl.weeklyReport(...args),
  materialDailyTrends: (...args) => apiImpl.materialDailyTrends(...args),
  upload: (...args) => liveApi.upload(...args),
};

export { IS_STATIC };
