import React, { useEffect, useRef, useState } from 'react';
import {
  BookTemplate,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Sparkles,
  X,
  RefreshCw,
} from 'lucide-react';
import {
  KIND_LABELS,
  appendPackLayoutRefs,
  clearPackLayoutRefs,
  createCustomEnterprisePack,
  deleteEnterprisePack,
  ensureEnterprisePacksSeeded,
  extractStyleCardFromLayoutRefs,
  getActiveEnterprisePackId,
  resetBuiltinEnterprisePacks,
  setActiveEnterprisePackId,
  type EnterpriseDesignPack,
} from '../services/enterpriseDesignPacks';
import { compressImageDataUrl } from '../services/catalogExcelService';

type Props = {
  /** 紧凑模式：海报工作室等窄栏 */
  compact?: boolean;
  onActiveChange?: (pack: EnterpriseDesignPack | null) => void;
};

export const EnterpriseDesignPackPanel: React.FC<Props> = ({ compact, onActiveChange }) => {
  const [packs, setPacks] = useState<EnterpriseDesignPack[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    const list = ensureEnterprisePacksSeeded();
    setPacks(list);
    const id = getActiveEnterprisePackId();
    setActiveId(id);
    onActiveChange?.(list.find((p) => p.id === id) || null);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectPack = (id: string) => {
    setActiveEnterprisePackId(id);
    setActiveId(id);
    onActiveChange?.(packs.find((p) => p.id === id) || null);
  };

  const active = packs.find((p) => p.id === activeId) || null;

  const onUploadLayout = async (files: FileList | null) => {
    if (!files?.length || !active) return;
    setBusy(true);
    setErr(null);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const raw = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('读取失败'));
          reader.readAsDataURL(file);
        });
        if (!raw.startsWith('data:image/')) continue;
        urls.push(await compressImageDataUrl(raw, 1024, 0.72));
      }
      if (!urls.length) {
        setErr('请上传 JPG / PNG / WebP 版式页（PDF 请先导出为图片）');
        return;
      }
      const updated = appendPackLayoutRefs(active.id, urls, 6);
      if (updated) {
        setPacks(ensureEnterprisePacksSeeded());
        onActiveChange?.(updated);
      }
    } catch (e: any) {
      setErr(e?.message || '版式页上传失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onExtract = async () => {
    if (!active?.layoutRefs.length) {
      setErr('请先上传版式页，再提炼风格卡');
      return;
    }
    setExtracting(true);
    setErr(null);
    try {
      await extractStyleCardFromLayoutRefs(active, active.layoutRefs);
      const list = ensureEnterprisePacksSeeded();
      setPacks(list);
      onActiveChange?.(list.find((p) => p.id === active.id) || null);
    } catch (e: any) {
      setErr(e?.message || '风格卡提炼失败');
    } finally {
      setExtracting(false);
    }
  };

  const onCreate = () => {
    const pack = createCustomEnterprisePack({ name: newName || '我的模板包' });
    setNewName('');
    setPacks(ensureEnterprisePacksSeeded());
    setActiveId(pack.id);
    onActiveChange?.(pack);
  };

  const onResetSamples = () => {
    if (!confirm('重置内置样本的风格卡？已上传的版式页会保留。')) return;
    setPacks(resetBuiltinEnterprisePacks());
    refresh();
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-slate-50/80 ${
        compact ? 'p-2.5 space-y-2' : 'p-3 space-y-2.5'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
          <BookTemplate size={14} className="text-violet-600" />
          企业模板技能库
        </div>
        <button
          type="button"
          title="重置内置样本"
          onClick={onResetSamples}
          className="text-slate-400 hover:text-slate-600 p-1"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <p className={`text-slate-500 font-medium leading-snug ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
        L1 版式页 + L2 风格卡。选中后生成会自动套用；可上传企业目录/海报页初始化版式。
      </p>

      <div className={`space-y-1.5 max-h-40 overflow-y-auto ${compact ? '' : 'max-h-52'}`}>
        {packs.map((p) => {
          const selected = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPack(p.id)}
              className={`w-full text-left rounded-lg px-2.5 py-2 border transition-colors ${
                selected
                  ? 'border-violet-300 bg-violet-50'
                  : 'border-slate-100 bg-white hover:border-violet-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black text-slate-800 truncate">{p.name}</span>
                <span className="text-[9px] font-bold text-violet-600 shrink-0">
                  {KIND_LABELS[p.kind]}
                </span>
              </div>
              <div className="text-[9px] text-slate-400 font-semibold mt-0.5">
                L1 {p.layoutRefs.length} 页 · L2 {p.styleCard?.stylePrompt ? '已就绪' : '待提炼'}
                {p.builtin ? ' · 样本' : ''}
              </div>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-2">
          <div className="text-[10px] font-bold text-slate-600 leading-snug">{active.summary}</div>
          {active.layoutRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {active.layoutRefs.map((src, i) => (
                <div
                  key={`${i}-${src.slice(-16)}`}
                  className="relative w-11 h-11 rounded-md overflow-hidden border border-amber-200 bg-slate-50"
                >
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 inset-x-0 text-[7px] font-black text-center text-white bg-amber-700/80">
                    版式{i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => void onUploadLayout(e.target.files)}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 text-white text-[10px] font-black px-2.5 py-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              上传版式页
            </button>
            <button
              type="button"
              disabled={extracting || !active.layoutRefs.length}
              onClick={() => void onExtract()}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 text-white text-[10px] font-black px-2.5 py-1.5 disabled:opacity-50"
            >
              {extracting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              提炼风格卡
            </button>
            {active.layoutRefs.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearPackLayoutRefs(active.id);
                  refresh();
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold px-2 py-1.5"
              >
                <X size={11} /> 清空版式
              </button>
            )}
            {!active.builtin && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm(`删除模板包「${active.name}」？`)) return;
                  setPacks(deleteEnterprisePack(active.id));
                  refresh();
                }}
                className="inline-flex items-center gap-1 rounded-lg text-rose-600 text-[10px] font-bold px-2 py-1.5"
              >
                <Trash2 size={11} /> 删除
              </button>
            )}
          </div>
          {active.styleCard?.stylePrompt && (
            <p className="text-[9px] text-slate-400 font-medium line-clamp-2 leading-snug">
              L2：{active.styleCard.lightingMood || active.styleCard.stylePrompt.slice(0, 80)}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新建包名称"
          className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]"
        />
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1 rounded-lg border border-violet-200 text-violet-700 text-[10px] font-black px-2.5 py-1.5"
        >
          <Plus size={12} /> 新建
        </button>
      </div>

      {err && (
        <div className="text-[10px] font-bold text-rose-600 flex items-start gap-1">
          <span>{err}</span>
        </div>
      )}
    </div>
  );
};
