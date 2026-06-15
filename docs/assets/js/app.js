import { api, initApi, IS_STATIC } from './api.js';
import { createDefaultFilters, renderFilters } from './filters.js';
import { renderGoldenCross } from './pages/golden-cross.js';
import { renderLeaderboard } from './pages/leaderboard.js';
import { renderDesigner } from './pages/designer.js';
import { renderAssetLibrary } from './pages/asset-library.js';
import { renderWeeklyUpdate } from './pages/weekly-update.js';
import { renderRollback } from './pages/rollback.js';

const PAGE_TITLES = {
  'golden-cross': '素材黄金交叉复盘',
  leaderboard: '智能排行榜',
  designer: '设计师绩效看板',
  'asset-library': '核心资产晋级库',
  'weekly-update': '周维度更新',
  rollback: '回滚素材',
};

const state = {
  view: 'golden-cross',
  meta: null,
  filters: null,
  tablePage: 1,
  keyword: '',
  sortBy: 'purchases',
  sortDir: 'desc',
  assetTier: 0,
  assetPage: 1,
  assetKeyword: '',
  assetScopeMode: 'weekly',
  weeklyWeek: null,
};

const filtersEl = document.getElementById('filters');
const contentEl = document.getElementById('page-content');
const titleEl = document.getElementById('page-title');
const metaEl = document.getElementById('sidebar-meta');

async function refreshPage() {
  contentEl.innerHTML = '<div class="empty">加载中...</div>';
  try {
    if (state.view === 'golden-cross') await renderGoldenCross(contentEl, state);
    else if (state.view === 'leaderboard') await renderLeaderboard(contentEl, state);
    else if (state.view === 'designer') await renderDesigner(contentEl, state);
    else if (state.view === 'asset-library') await renderAssetLibrary(contentEl, state);
    else if (state.view === 'weekly-update') await renderWeeklyUpdate(contentEl, state);
    else if (state.view === 'rollback') await renderRollback(contentEl);
    else contentEl.innerHTML = '<div class="empty">页面不存在或脚本未更新，请强制刷新（Cmd+Shift+R）</div>';
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = `<div class="empty">加载失败：${err.message}</div>`;
  }
}

function onFiltersChange(next) {
  state.filters = next;
  renderFilters(filtersEl, state, onFiltersChange);
  refreshPage();
}

function setView(view) {
  state.view = view;
  state.tablePage = 1;
  state.assetPage = 1;
  titleEl.textContent = PAGE_TITLES[view] || 'GrowMe';
  filtersEl.style.display = (view === 'weekly-update' || view === 'rollback') ? 'none' : '';
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === view);
  });
  refreshPage();
}

function renderMeta(meta, scannedAt) {
  const catalog = meta.catalog || {};
  const modeLabel = IS_STATIC ? 'GitHub 静态站' : '本地服务';
  const buildAt = meta.generated_at || meta.scanned_at || scannedAt || '-';
  metaEl.innerHTML = `
    ${modeLabel}<br/>
    已加载 ${meta.files_loaded.length} 个文件<br/>
    共 ${meta.records} 条原始记录<br/>
    账户素材 ${catalog.total_materials || '-'} 条 · 周度上新 ${catalog.weekly_materials || '-'} 条<br/>
    周度：${(meta.weekly_labels || []).join('、') || '-'}<br/>
    数据快照：${buildAt}${meta.static ? '<br/><span style="color:#6b7280">≠本地时请 push 后等 1 分钟</span>' : ''}
  `;
}

async function bootstrap() {
  const mode = await initApi();
  state.meta = await api.meta();
  state.filters = createDefaultFilters(state.meta);
  renderMeta(state.meta, state.meta.scanned_at);

  const rescanBtn = document.getElementById('btn-rescan');
  if (IS_STATIC || mode === 'static-fallback') {
    rescanBtn.textContent = '↻ 数据由 GitHub 自动同步';
    rescanBtn.title = '更新 data_inputs 后 push 到 GitHub 即可自动部署';
  }

  renderFilters(filtersEl, state, onFiltersChange);

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.page));
  });

  setView('golden-cross');
}

document.getElementById('btn-rescan').addEventListener('click', async () => {
  if (IS_STATIC) {
    alert('线上是静态快照，不会自动同步本地。\n\n【每周上新更新步骤】\n1. 把新周 CSV/Excel 放入 data_inputs/\n   命名须含「周」，如 0615周WW的数据.csv\n2. 终端执行：\n   ./scripts/update_weekly.sh --push\n\n将同时更新：\n· 周维度更新（新 Tab）\n· 各栏目「上新素材成效」\n· 核心资产晋级库·上新\n\n约 1 分钟后刷新网站。');
    return;
  }
  try {
    const result = await api.rescan();
    state.meta = await api.meta();
    renderMeta(state.meta, result.scanned_at);
    renderFilters(filtersEl, state, onFiltersChange);
    refreshPage();
  } catch (err) {
    alert(`扫描失败：${err.message}`);
  }
});

bootstrap().catch((err) => {
  contentEl.innerHTML = `<div class="empty">初始化失败：${err.message}<br/>请确认后端已启动。</div>`;
});
