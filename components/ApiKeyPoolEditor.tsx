import React, { useMemo, useState } from 'react';
import { Plus, Trash2, RotateCcw } from 'lucide-react';
import {
  ApiKeyPoolProvider,
  clearPoolExhausted,
  getPoolKeyStatuses,
  listPoolKeys,
  maskApiKey,
  normalizeApiKey,
} from '../services/apiKeyPool';

type Props = {
  provider: ApiKeyPoolProvider;
  /** 受控：外部持有 keys 列表（保存前可编辑） */
  keys: string[];
  onChange: (keys: string[]) => void;
  placeholder?: string;
  hint?: string;
  className?: string;
};

/** 管理后台通用「多 API Key 池」编辑器 */
export const ApiKeyPoolEditor: React.FC<Props> = ({
  provider,
  keys,
  onChange,
  placeholder = '粘贴新的 API Key 后点添加',
  hint,
  className = '',
}) => {
  const [draft, setDraft] = useState('');
  const statuses = useMemo(() => {
    const savedStatuses = getPoolKeyStatuses(provider);
    const byKey = new Map(savedStatuses.map((s) => [s.key, s]));
    const usableFirst = keys.find((k) => !byKey.get(k)?.exhausted) || keys[0] || '';
    return keys.map((key) => {
      const st = byKey.get(key);
      return {
        key,
        label: st?.label || maskApiKey(key),
        exhausted: !!st?.exhausted,
        active: key === usableFirst && !st?.exhausted,
      };
    });
  }, [keys, provider]);

  const handleAdd = () => {
    const k = normalizeApiKey(draft);
    if (!k) return;
    if (keys.includes(k)) {
      alert('该 Key 已在池中');
      return;
    }
    onChange([...keys, k]);
    setDraft('');
  };

  const handleRemove = (key: string) => {
    onChange(keys.filter((k) => k !== key));
  };

  const handleResetExhausted = () => {
    clearPoolExhausted(provider);
    onChange([...keys]);
    alert('已清除本月「耗尽」标记，将重新尝试全部 Key');
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {hint ? <p className="text-[10px] text-slate-500 font-bold leading-relaxed">{hint}</p> : null}
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm text-slate-950"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="bg-white border border-slate-200 text-slate-800 px-4 py-3 rounded-xl font-black inline-flex items-center gap-1"
        >
          <Plus size={16} /> 添加
        </button>
      </div>
      {keys.length > 0 ? (
        <ul className="space-y-2">
          {statuses.map((st) => (
            <li
              key={st.key}
              className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2"
            >
              <div className="text-xs font-bold text-slate-700 truncate">
                {st.label}
                {st.active ? <span className="ml-2 text-emerald-600">优先使用</span> : null}
                {st.exhausted ? <span className="ml-2 text-rose-500">本月已耗尽</span> : null}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(st.key)}
                className="text-rose-500 hover:text-rose-700 p-1"
                title="移除"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-400 font-bold">尚未添加 Key — 可添加多把，超额自动切换</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleResetExhausted}
          className="inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-xs"
        >
          <RotateCcw size={12} /> 重置耗尽标记
        </button>
        <span className="text-[10px] text-slate-400 font-bold self-center">
          池内 {keys.length} 把
          {listPoolKeys(provider).length !== keys.length
            ? `（未保存；已存 ${listPoolKeys(provider).length}）`
            : ''}
        </span>
      </div>
    </div>
  );
};
