/** 周次标签 ↔ 日期（自然周周一）映射与选择器 */

function parseWeekLabel(label) {
  const m = String(label || '').match(/(\d{2})(\d{2})/);
  if (!m) return null;
  return { month: Number(m[1]), day: Number(m[2]) };
}

function toIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function weekLabelToMonday(label, weekDateMap = {}) {
  if (weekDateMap?.[label]) return weekDateMap[label];
  const parsed = parseWeekLabel(label);
  if (!parsed) return null;
  return toIsoDate(new Date().getFullYear(), parsed.month, parsed.day);
}

function mondayFromDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function weekLabelFromMonday(mondayStr) {
  const d = new Date(`${mondayStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}${dd}周`;
}

export function dateToWeekLabel(dateStr, weeks, weekDateMap = {}) {
  const monday = mondayFromDate(dateStr);
  if (!monday) return null;

  const direct = weekLabelFromMonday(monday);
  if (weeks.includes(direct)) return direct;

  const target = new Date(`${monday}T12:00:00`).getTime();
  let best = weeks[0];
  let bestDiff = Infinity;
  for (const w of weeks) {
    const iso = weekLabelToMonday(w, weekDateMap);
    if (!iso) continue;
    const diff = Math.abs(new Date(`${iso}T12:00:00`).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = w;
    }
  }
  return best;
}

export function renderWeekPickerHtml(currentWeek, weeks, weekDateMap = {}) {
  const monday = weekLabelToMonday(currentWeek, weekDateMap) || '';
  const minDate = weekLabelToMonday(weeks[0], weekDateMap) || '';
  const maxDate = weekLabelToMonday(weeks[weeks.length - 1], weekDateMap) || '';

  return `
    <div class="week-picker card">
      <div class="week-picker-label">
        <span class="week-picker-title">选择周次</span>
        <span class="muted">选该周内任意日期，自动匹配所在自然周（周一至周日）</span>
      </div>
      <div class="week-picker-row">
        <input type="date" id="weekly-week-date" class="week-date-input"
          value="${monday}" min="${minDate}" max="${maxDate}" />
        <span class="week-picker-current">当前周：<strong id="weekly-week-label">${currentWeek}</strong></span>
        <span class="muted">共 ${weeks.length} 个周次可选</span>
      </div>
    </div>
  `;
}

export function bindWeekPicker(container, { weeks, weekDateMap, currentWeek, onChange }) {
  const input = container.querySelector('#weekly-week-date');
  const labelEl = container.querySelector('#weekly-week-label');
  if (!input) return;

  input.addEventListener('change', async () => {
    const next = dateToWeekLabel(input.value, weeks, weekDateMap);
    if (!next || next === currentWeek) return;
    if (labelEl) labelEl.textContent = next;
    await onChange(next);
  });
}
