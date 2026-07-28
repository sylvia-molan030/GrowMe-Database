function copySync(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function showCopyToast(anchor, message = '已复制到剪贴板') {
  document.querySelectorAll('.copy-float-toast').forEach((n) => n.remove());

  const tip = document.createElement('div');
  tip.className = 'copy-float-toast show';
  tip.setAttribute('role', 'status');
  tip.textContent = message;
  document.body.appendChild(tip);

  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.bottom + 6;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  if (top + tipRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - tipRect.height - 6);
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;

  clearTimeout(showCopyToast._timer);
  showCopyToast._timer = setTimeout(() => tip.remove(), 1800);
}

export async function copyMaterialName(text, options = {}) {
  const value = String(text || '').trim();
  if (!value) return false;

  let ok = copySync(value);
  if (!ok && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ok = false;
    }
  }

  if (options.anchor) {
    showCopyToast(
      options.anchor,
      ok ? (options.toastMessage || '已复制到剪贴板') : '复制失败，请手动选择复制',
    );
  }
  return ok;
}

/** 复制交互由 index.html 内联脚本全局委托；此处仅补全样式与 title。 */
export function bindCopyMaterials(container) {
  if (!container) return;
  container.querySelectorAll('[data-copy], .mat-copy, .cell-material-name').forEach((el) => {
    if (!el.classList.contains('mat-copy')) el.classList.add('mat-copy');
    if (!el.title) el.title = '点击复制素材名';
  });
}
