let toastTimer = null;

function clampToastPosition(toast, anchorRect) {
  const margin = 8;
  const gap = 6;
  let left = anchorRect.left + anchorRect.width / 2;
  let top = anchorRect.bottom + gap;

  toast.style.left = `${left}px`;
  toast.style.top = `${top}px`;
  toast.style.bottom = 'auto';

  const toastRect = toast.getBoundingClientRect();
  if (toastRect.right > window.innerWidth - margin) {
    left -= toastRect.right - (window.innerWidth - margin);
  }
  if (toastRect.left < margin) {
    left += margin - toastRect.left;
  }
  if (toastRect.bottom > window.innerHeight - margin) {
    top = anchorRect.top - toastRect.height - gap;
  }
  toast.style.left = `${left}px`;
  toast.style.top = `${top}px`;
}

function showCopyToast(message = '已复制到剪贴板', anchor = null) {
  let toast = document.getElementById('copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copy-toast';
    toast.className = 'copy-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.remove('show');

  if (anchor?.getBoundingClientRect) {
    clampToastPosition(toast, anchor.getBoundingClientRect());
  } else {
    toast.style.left = '50%';
    toast.style.top = 'auto';
    toast.style.bottom = '28px';
  }

  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

export async function copyMaterialName(text, options = {}) {
  const value = String(text || '').trim();
  if (!value) return false;
  let ok = false;
  try {
    await navigator.clipboard.writeText(value);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand('copy');
    ta.remove();
  }
  if (ok && options.toast !== false) {
    showCopyToast(options.toastMessage || '已复制到剪贴板', options.anchor);
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
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = el.dataset.copy || el.textContent.trim();
      const ok = await copyMaterialName(text, { anchor: el });
      if (ok) {
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 800);
      }
    });
  });
}
