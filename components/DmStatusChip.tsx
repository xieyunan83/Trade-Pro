import React from 'react';
import { Users } from 'lucide-react';
import { DmDigStatus, dmDigStatusLabel } from '../utils/crmHistory';

/** 列表用：未挖 / 已挖有联系人 / 已挖无联系人 */
export const DmStatusChip: React.FC<{
  status: DmDigStatus;
  contactCount?: number;
  className?: string;
  showIcon?: boolean;
}> = ({ status, contactCount = 0, className = '', showIcon = true }) => {
  const label = dmDigStatusLabel(status, contactCount);
  const tone =
    status === 'found'
      ? 'bg-amber-500 text-white'
      : status === 'empty'
        ? 'bg-rose-50 text-rose-600 border border-rose-200'
        : 'bg-slate-100 text-slate-400 border border-slate-200';
  const title =
    status === 'found'
      ? `决策人挖掘已完成，找到 ${contactCount} 位联系人`
      : status === 'empty'
        ? '决策人挖掘已完成，但未找到可用联系人'
        : '尚未进行决策人挖掘';

  return (
    <span
      className={`text-[9px] font-black px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${tone} ${className}`}
      title={title}
    >
      {showIcon ? <Users size={9} /> : null}
      {label}
    </span>
  );
};
