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

function readCopyText(el) {
  if (el.dataset.copy) return el.dataset.copy;
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.copy-hint, .copy-float-toast').forEach((n) => n.remove());
  return clone.textContent.trim();
}

function showCopyToast(anchor, message = '已复制到剪贴板') {
  document.querySelectorAll('.copy-float-toast').forEach((n) => n.remove());

  const tip = document.createElement('div');
  tip.className = 'copy-float-toast';
  tip.setAttribute('role', 'status');
  tip.textContent = message;
  tip.style.visibility = 'hidden';
  document.body.appendChild(tip);

  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.bottom + 6;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  if (top + tipRect.height > window.innerHeight - margin) {
    top = rect.top - tipRect.height - 6;
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.style.visibility = 'visible';
  requestAnimationFrame(() => tip.classList.add('show'));

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

export function bindCopyMaterials(container) {
  if (!container) return;
  container.querySelectorAll('[data-copy], .mat-copy, .cell-material-name').forEach((el) => {
    if (el.dataset.copyBound === '1') return;
    el.dataset.copyBound = '1';
    if (!el.classList.contains('mat-copy')) el.classList.add('mat-copy');
    if (!el.title) el.title = '点击复制素材名';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const text = readCopyText(el);
      let ok = copySync(text);
      if (ok) {
        showCopyToast(el, '已复制到剪贴板');
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 800);
        return;
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showCopyToast(el, '已复制到剪贴板');
          el.classList.add('copied');
          setTimeout(() => el.classList.remove('copied'), 800);
        }).catch(() => {
          showCopyToast(el, '复制失败，请手动选择复制');
        });
        return;
      }
      showCopyToast(el, '复制失败，请手动选择复制');
    });
  });
}
