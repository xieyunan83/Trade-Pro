import React, { memo, useRef, useState } from 'react';
import { Loader2, Sparkles, Compass, Briefcase, Target } from 'lucide-react';
import { DesignConstraintCardPanel } from './DesignConstraintCardPanel';

export type MatchFormValues = {
  productName: string;
  category: string;
  priceBand: string;
  skuCode: string;
  notes: string;
};

type Props = {
  initial: MatchFormValues;
  busy: boolean;
  progress: string;
  error: string | null;
  crmCount: number;
  historyCount: number;
  onGoCrm?: () => void;
  onSubmit: (values: MatchFormValues) => void;
};

/**
 * 独立输入岛：击键只更新本组件 state，绝不向上冒泡，
 * 避免父页 CatalogCoverage / 结果区随字重渲导致「一框等几分钟」。
 */
const MatchInputFormInner: React.FC<Props> = ({
  initial,
  busy,
  progress,
  error,
  crmCount,
  historyCount,
  onGoCrm,
  onSubmit,
}) => {
  const [name, setName] = useState(initial.productName);
  const [category, setCategory] = useState(initial.category);
  const [priceBand, setPriceBand] = useState(initial.priceBand);
  const [skuCode, setSkuCode] = useState(initial.skuCode);
  const [notes, setNotes] = useState(initial.notes);
  const [localError, setLocalError] = useState<string | null>(null);
  /** 适市约束仅手动加载，禁止跟输入联动 */
  const [constraintKey, setConstraintKey] = useState('');
  const [constraintPrice, setConstraintPrice] = useState('');
  const [constraintSku, setConstraintSku] = useState('');
  const seeded = useRef(false);

  // 父级仅首次传入建议值；之后以本岛为准
  if (!seeded.current && (initial.productName || initial.category || initial.skuCode)) {
    seeded.current = true;
  }

  const handleSubmit = () => {
    const productName = name.trim();
    if (!productName) {
      setLocalError('请填写新品名称');
      return;
    }
    setLocalError(null);
    onSubmit({
      productName,
      category: category.trim(),
      priceBand: priceBand.trim(),
      skuCode: skuCode.trim(),
      notes: notes.trim(),
    });
  };

  const loadConstraint = () => {
    const key = category.trim() || name.trim();
    if (!key) {
      setLocalError('请先填写品类或新品名称，再查看适市约束');
      return;
    }
    setLocalError(null);
    setConstraintKey(key.slice(0, 80));
    setConstraintPrice(priceBand.trim());
    setConstraintSku(skuCode.trim());
  };

  const err = localError || error;

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 text-slate-900 font-black text-xl">
            <Target className="text-emerald-600" size={22} />
            市调 · 匹配 · 开发信
          </div>
          <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl leading-relaxed">
            两位专家协同出国家与定位；客户匹配只引用背调入库的「在售/采购」真数据与标签，不空编。请先完成客户背调（或
            CRM 产品深挖）再匹配。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-black">
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 text-cyan-800 px-2.5 py-1 border border-cyan-100">
            <Compass size={12} /> 市调专家
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-800 px-2.5 py-1 border border-violet-100">
            <Briefcase size={12} /> 产品经理
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <label className="block sm:col-span-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            新品名称 *
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：1:64 合金回力消防车"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            货号 SKU
          </span>
          <input
            value={skuCode}
            onChange={(e) => setSkuCode(e.target.value)}
            placeholder="可选"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">品类</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="合金/回力车玩具"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            价格带
          </span>
          <input
            value={priceBand}
            onChange={(e) => setPriceBand(e.target.value)}
            placeholder="例如 FOB $1.2–2.5"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            卖点 / 设计备注
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="开窗礼盒、可充电、适合会展…"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={handleSubmit}
          className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-bold text-sm"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? progress || '专家工作中…' : '双专家分析并匹配'}
        </button>
        {busy && progress ? (
          <span className="text-[11px] font-bold text-emerald-700 max-w-xs leading-snug">
            {progress}
          </span>
        ) : null}
        <button
          type="button"
          onClick={loadConstraint}
          className="text-xs font-bold text-violet-700 hover:underline"
        >
          查看适市约束
        </button>
        {onGoCrm && (
          <button
            type="button"
            onClick={onGoCrm}
            className="text-xs font-bold text-emerald-700 hover:underline"
          >
            去客户库补充线索
          </button>
        )}
        <span className="text-[11px] text-slate-400 font-medium">
          CRM {crmCount} 家 · 背调历史 {historyCount} 条
        </span>
      </div>

      {constraintKey ? (
        <div className="mt-4">
          <DesignConstraintCardPanel
            categoryOrName={constraintKey}
            priceBandText={constraintPrice}
            skuCode={constraintSku}
          />
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-400 font-medium">
          适市约束不会随输入自动刷新；填好后点「查看适市约束」即可，避免大库拖慢打字。
        </p>
      )}

      <p className="mt-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 font-medium leading-relaxed">
        匹配依据：库内在售/采购品类、SKU、标签，以及包装/配色/价带重叠；完成后会给出定价参考与置信度。结果很少时，先「从历史同步」或「补全
        CRM 空白」。
      </p>
      {err && (
        <p className="mt-3 text-sm font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
          {err}
        </p>
      )}
    </div>
  );
};

export const MatchInputForm = memo(MatchInputFormInner);
