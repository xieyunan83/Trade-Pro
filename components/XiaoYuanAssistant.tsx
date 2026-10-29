import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import {
  askXiaoYuan,
  XIAOYUAN_AVATAR,
  XIAOYUAN_NAME,
  XIAOYUAN_QUICK_PROMPTS,
  type XiaoYuanMsg,
} from '../services/xiaoyuanAssistant';
import { newCreativeId } from '../services/creativeStudioStore';

type Props = {
  /** 登录后才显示；未登录不挂载 */
  visible?: boolean;
};

type Pos = { x: number; y: number };

const POS_KEY = 'trade_scout_xiaoyuan_fab_pos_v1';
const FAB_W = 52;
const FAB_H = 68;

const WELCOME: XiaoYuanMsg = {
  id: 'welcome',
  role: 'assistant',
  text: `你好，我是${XIAOYUAN_NAME}。想找功能入口、不会操作某一步，直接问我就好——例如任务流下一步、平面设计、客户搜索、建站怎么用。`,
  at: Date.now(),
};

const defaultPos = (): Pos => {
  if (typeof window === 'undefined') return { x: 8, y: 360 };
  const y = Math.max(window.innerHeight * 0.58, window.innerHeight - 200);
  return { x: 8, y };
};

const clampPos = (p: Pos): Pos => {
  if (typeof window === 'undefined') return p;
  const maxX = Math.max(8, window.innerWidth - FAB_W - 8);
  const maxY = Math.max(8, window.innerHeight - FAB_H - 8);
  return {
    x: Math.min(maxX, Math.max(8, p.x)),
    y: Math.min(maxY, Math.max(8, p.y)),
  };
};

const loadPos = (): Pos => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return clampPos(defaultPos());
    const p = JSON.parse(raw) as Pos;
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return clampPos(p);
  } catch {
    /* ignore */
  }
  return clampPos(defaultPos());
};

/** 可拖动浮动助手：默认在左侧下半区，不挡「开始」球 */
export const XiaoYuanAssistant: React.FC<Props> = ({ visible = true }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<XiaoYuanMsg[]>([WELCOME]);
  const [pos, setPos] = useState<Pos>(() => loadPos());
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    ox: number;
    oy: number;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open, messages, busy]);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d?.active) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
      setPos(clampPos({ x: e.clientX - d.ox, y: e.clientY - d.oy }));
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d?.active) return;
      d.active = false;
      setPos((p) => {
        const next = clampPos(p);
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  if (!visible) return null;

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput('');
    const userMsg: XiaoYuanMsg = {
      id: newCreativeId('xy'),
      role: 'user',
      text,
      at: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);
    try {
      const reply = await askXiaoYuan(text, [...messages, userMsg]);
      setMessages((prev) => [
        ...prev,
        {
          id: newCreativeId('xy'),
          role: 'assistant',
          text: reply,
          at: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const panelW = Math.min(
    typeof window !== 'undefined' ? window.innerWidth - 24 : 352,
    352
  );
  const panelH = Math.min(
    typeof window !== 'undefined' ? window.innerHeight * 0.68 : 480,
    512
  );
  let panelLeft = pos.x + FAB_W + 10;
  let panelTop = pos.y - 24;
  if (typeof window !== 'undefined') {
    if (panelLeft + panelW > window.innerWidth - 8) {
      panelLeft = Math.max(8, pos.x - panelW - 10);
    }
    if (panelTop + panelH > window.innerHeight - 8) {
      panelTop = Math.max(8, window.innerHeight - panelH - 8);
    }
    if (panelTop < 8) panelTop = 8;
  }

  return (
    <>
      <button
        type="button"
        className="tp-xiaoyuan-fab fixed z-[70] group flex flex-col items-center gap-0.5 cursor-grab active:cursor-grabbing touch-none select-none"
        style={{ left: pos.x, top: pos.y }}
        aria-label={`打开${XIAOYUAN_NAME}助手（可拖动）`}
        title={`${XIAOYUAN_NAME} · 按住拖动，点击对话`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
          dragRef.current = {
            active: true,
            moved: false,
            ox: e.clientX - rect.left,
            oy: e.clientY - rect.top,
            startX: e.clientX,
            startY: e.clientY,
          };
          try {
            (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }}
        onClick={() => {
          if (dragRef.current?.moved) {
            dragRef.current.moved = false;
            return;
          }
          setOpen((v) => !v);
        }}
      >
        <span className="relative w-11 h-11 rounded-full overflow-hidden bg-slate-900 ring-2 ring-cyan-300/70 shadow-lg shadow-cyan-900/25 group-hover:scale-105 transition-transform">
          <img
            src={XIAOYUAN_AVATAR}
            alt={XIAOYUAN_NAME}
            className="w-full h-full object-cover object-top pointer-events-none"
            draggable={false}
          />
          <span className="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
        </span>
        <span className="text-[9px] font-black text-cyan-100/90 bg-slate-950/80 px-1.5 py-0.5 rounded-md border border-cyan-400/25 leading-none">
          {XIAOYUAN_NAME}
        </span>
      </button>

      {open && (
        <div
          className="fixed z-[71] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
          style={{ left: panelLeft, top: panelTop, width: panelW, height: panelH }}
          role="dialog"
          aria-label={`${XIAOYUAN_NAME}对话`}
        >
          <header className="shrink-0 flex items-center gap-3 px-3.5 py-3 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
            <img
              src={XIAOYUAN_AVATAR}
              alt=""
              className="w-10 h-10 rounded-full object-cover object-top ring-2 ring-teal-400/50"
              draggable={false}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black flex items-center gap-1.5">
                {XIAOYUAN_NAME}
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-200 border border-teal-400/30">
                  平台助手
                </span>
              </div>
              <p className="text-[10px] text-slate-300 truncate">可拖动头像 · 功能指路</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.role === 'assistant' && (
                  <img
                    src={XIAOYUAN_AVATAR}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover object-top shrink-0 mt-0.5"
                    draggable={false}
                  />
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-slate-900 text-white rounded-br-md'
                      : 'bg-white text-slate-700 border border-slate-200 rounded-bl-md shadow-sm'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-400 pl-9">
                <Loader2 size={12} className="animate-spin" /> 小媛正在想…
              </div>
            )}
            <div ref={endRef} />
          </div>

          {messages.length <= 2 && (
            <div className="shrink-0 px-3 pb-2 flex flex-wrap gap-1.5 bg-slate-50 border-t border-slate-100 pt-2">
              {XIAOYUAN_QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(q)}
                  className="text-[10px] font-bold px-2 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="shrink-0 p-2.5 border-t border-slate-100 bg-white flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="问小媛：入口在哪、怎么操作…"
              className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            />
            <button
              type="button"
              disabled={busy || !input.trim()}
              onClick={() => void send()}
              className="shrink-0 h-10 w-10 rounded-xl bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center disabled:opacity-40"
              aria-label="发送"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default XiaoYuanAssistant;
