/**
 * 客户端防护：防随意复制/右键扒内容、水印、检测调试器（不阻断业务「复制」按钮）。
 * 双桌面壳（Electron）下额外关闭常见快捷键；浏览器端水印 + 敏感区禁选。
 */

const WATERMARK_ID = 'tp-client-shield-wm';

const isDesktopShell = (): boolean => {
  try {
    const ua = navigator.userAgent || '';
    return /TradeShell|TradeCollabClient|BabyWorldClient|Electron/i.test(ua);
  } catch {
    return false;
  }
};

const ensureWatermark = (label: string) => {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(WATERMARK_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = WATERMARK_ID;
    el.setAttribute('aria-hidden', 'true');
    el.className = 'tp-client-watermark';
    document.body.appendChild(el);
  }
  const unit = `${label} · 内部授权使用 · 禁止未授权转发`;
  // 铺满视口的重复水印文案（CSS ::before 读取 data-label）
  const tiled = Array.from({ length: 48 }, () => unit).join('　　');
  el.dataset.label = tiled;
};

const onContextMenu = (e: MouseEvent) => {
  const t = e.target as HTMLElement | null;
  if (!t) return;
  // 输入框 / 显式允许复制的区域放行
  if (t.closest('input, textarea, [contenteditable="true"], .tp-allow-copy, .ql-editor')) return;
  if (t.closest('.tp-shield-content, .tp-landing, [data-tp-shield="1"]')) {
    e.preventDefault();
  }
};

const onKeyDown = (e: KeyboardEvent) => {
  if (!isDesktopShell()) return;
  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  // 阻断常见扒站快捷键；复制快捷键在输入框内仍可用
  const t = e.target as HTMLElement | null;
  const inField = !!t?.closest('input, textarea, [contenteditable="true"], .tp-allow-copy, .ql-editor');
  if (key === 'f12') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (ctrl && (key === 'u' || key === 's' || (e.shiftKey && key === 'i') || (e.shiftKey && key === 'j') || (e.shiftKey && key === 'c'))) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (ctrl && key === 'c' && !inField && t?.closest('.tp-shield-content, [data-tp-shield="1"]')) {
    e.preventDefault();
  }
};

const onDragStart = (e: DragEvent) => {
  const t = e.target as HTMLElement | null;
  if (t?.closest('.tp-shield-content img, [data-tp-shield="1"] img')) {
    e.preventDefault();
  }
};

/** 轻量调试器探测（仅提示，不锁死业务） */
const probeDevtools = (onSuspect?: () => void) => {
  if (!isDesktopShell()) return () => undefined;
  let fired = false;
  const threshold = 160;
  const id = window.setInterval(() => {
    const open =
      window.outerWidth - window.innerWidth > threshold ||
      window.outerHeight - window.innerHeight > threshold;
    if (open && !fired) {
      fired = true;
      onSuspect?.();
    }
    if (!open) fired = false;
  }, 2500);
  return () => clearInterval(id);
};

export type ClientShieldHandle = { dispose: () => void };

/**
 * 登录成功后安装。admin 账号仍加水印，但桌面壳不禁 DevTools 快捷键以外的业务复制。
 */
export const installClientShield = (
  username: string,
  opts?: { isAdmin?: boolean }
): ClientShieldHandle => {
  ensureWatermark(username || 'user');
  document.documentElement.classList.add('tp-shield-on');
  if (isDesktopShell()) {
    document.documentElement.classList.add('tp-shield-desktop');
  }

  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('dragstart', onDragStart, true);

  const stopProbe = opts?.isAdmin
    ? () => undefined
    : probeDevtools(() => {
        console.info('[shield] 检测到调试窗口；生产环境已禁用诊断菜单。');
      });

  return {
    dispose: () => {
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('dragstart', onDragStart, true);
      stopProbe();
      document.documentElement.classList.remove('tp-shield-on', 'tp-shield-desktop');
      document.getElementById(WATERMARK_ID)?.remove();
    },
  };
};
