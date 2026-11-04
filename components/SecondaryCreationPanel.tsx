import React from 'react';
import { Palette, Package, Sparkles, Wand2 } from 'lucide-react';
import {
  DEFAULT_SECONDARY_FIELDS,
  PACKAGING_STYLE_OPTIONS,
  buildSecondaryCreationUserBrief,
  secondaryFieldsHaveEdits,
  type SecondaryCreationFields,
} from '../services/secondaryCreationBrief';

type Props = {
  value: SecondaryCreationFields;
  onChange: (next: SecondaryCreationFields) => void;
  skuName?: string;
  skuCode?: string;
  /** 把结构化字段写入主提示词并可选触发生成准备 */
  onApplyToPrompt: (brief: string) => void;
  compact?: boolean;
};

const field = (
  label: string,
  children: React.ReactNode,
  hint?: string
) => (
  <div className="space-y-1">
    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide">
      {label}
    </label>
    {children}
    {hint ? (
      <p className="text-[9px] text-slate-400 font-medium leading-snug">{hint}</p>
    ) : null}
  </div>
);

export const SecondaryCreationPanel: React.FC<Props> = ({
  value,
  onChange,
  skuName,
  skuCode,
  onApplyToPrompt,
  compact,
}) => {
  const set = <K extends keyof SecondaryCreationFields>(
    key: K,
    v: SecondaryCreationFields[K]
  ) => onChange({ ...value, [key]: v });

  const inputCls =
    'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium bg-white focus:border-violet-400 focus:outline-none';

  return (
    <div
      className={`rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-cyan-50/60 ${
        compact ? 'p-2.5 space-y-2' : 'p-3 space-y-2.5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-black text-emerald-900 inline-flex items-center gap-1.5">
            <Wand2 size={14} className="text-emerald-600" />
            产品二次创作
          </div>
          <p className="text-[10px] text-emerald-800/80 font-medium mt-0.5 leading-snug">
            先锁定产品图，再只改包装 / 颜色 / 外观局部。未填写的部位保持与原图一致。
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_SECONDARY_FIELDS })}
          className="text-[9px] font-bold text-slate-500 hover:text-slate-700 shrink-0"
        >
          清空
        </button>
      </div>

      {(skuName || skuCode) && (
        <div className="text-[10px] font-bold text-slate-600 bg-white/80 border border-slate-100 rounded-lg px-2 py-1">
          当前产品：{skuCode ? `${skuCode} · ` : ''}
          {skuName || '未命名'}
        </div>
      )}

      {field(
        '包装形式',
        <select
          className={inputCls}
          value={value.packagingStyle}
          onChange={(e) =>
            set('packagingStyle', e.target.value as SecondaryCreationFields['packagingStyle'])
          }
        >
          {PACKAGING_STYLE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>,
        '换包装结构时仍保持产品本体与参考一致'
      )}

      {(value.packagingStyle === 'custom' || value.packagingStyle !== 'keep') &&
        field(
          '包装补充说明',
          <input
            className={inputCls}
            value={value.packagingCustom}
            onChange={(e) => set('packagingCustom', e.target.value)}
            placeholder="如：侧开窗、吊卡、双语说明书位…"
          />
        )}

      <div className="grid grid-cols-1 gap-2">
        {field(
          '外包装配色',
          <div className="relative">
            <Palette
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className={`${inputCls} pl-7`}
              value={value.packagingColor}
              onChange={(e) => set('packagingColor', e.target.value)}
              placeholder="如：红金、哑光黑+荧光黄"
            />
          </div>
        )}
        {field(
          '产品本体颜色',
          <input
            className={inputCls}
            value={value.productColor}
            onChange={(e) => set('productColor', e.target.value)}
            placeholder="如：机身改冰蓝、耳朵改粉色"
          />
        )}
      </div>

      {field(
        '外观局部调整',
        <textarea
          className={`${inputCls} min-h-[3rem] resize-y`}
          rows={2}
          value={value.appearanceEdit}
          onChange={(e) => set('appearanceEdit', e.target.value)}
          placeholder="如：屏幕改圆角、胸口加指示灯、去掉肩带接口"
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {field(
          '材质 / 表面',
          <input
            className={inputCls}
            value={value.materialFinish}
            onChange={(e) => set('materialFinish', e.target.value)}
            placeholder="哑光塑胶 / 金属漆…"
          />
        )}
        {field(
          '场景背景（可选）',
          <input
            className={inputCls}
            value={value.sceneBackground}
            onChange={(e) => set('sceneBackground', e.target.value)}
            placeholder="白底 / 儿童房 / 展台"
          />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {field(
          '新增功能',
          <input
            className={inputCls}
            value={value.addFeatures}
            onChange={(e) => set('addFeatures', e.target.value)}
            placeholder="声光、遥控、磁吸…"
          />
        )}
        {field(
          '去掉配件',
          <input
            className={inputCls}
            value={value.removeParts}
            onChange={(e) => set('removeParts', e.target.value)}
            placeholder="电池仓盖字样、多余贴纸…"
          />
        )}
      </div>

      {field(
        '其他说明',
        <textarea
          className={`${inputCls} min-h-[2.5rem] resize-y`}
          rows={2}
          value={value.freeNote}
          onChange={(e) => set('freeNote', e.target.value)}
          placeholder="任意补充；未写的部位一律保持原图"
        />
      )}

      <button
        type="button"
        onClick={() =>
          onApplyToPrompt(
            buildSecondaryCreationUserBrief(value, { skuName, skuCode })
          )
        }
        disabled={!secondaryFieldsHaveEdits(value)}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[11px] font-black px-3 py-2.5"
      >
        <Package size={13} />
        写入改动清单
        <Sparkles size={12} />
      </button>
      <p className="text-[9px] text-slate-500 font-medium leading-snug text-center">
        写入后点下方「确认生成」。系统会强制身份锁，充分发挥参考图一致性。
      </p>
    </div>
  );
};
