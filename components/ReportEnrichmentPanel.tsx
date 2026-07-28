import React from 'react';
import { AnalysisResult } from '../types';
import { Mail, Users, ShieldCheck, PenTool } from 'lucide-react';

/** 背调报告内展示：决策人邮箱 + 已保存的开发信（随 data 更新） */
export const ReportEnrichmentPanel: React.FC<{ data: AnalysisResult }> = ({ data }) => {
  const dms = data.decisionMakers || [];
  const withEmail = dms.filter((d) => d.emailGuess?.includes('@'));
  const verified = dms.filter((d) => d.isVerified && d.emailGuess);
  const emails = data.generatedEmails;

  if (!dms.length && !emails) return null;

  return (
    <div className="space-y-4 sm:space-y-6">
      {dms.length > 0 && (
        <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-violet-200 shadow-sm">
          <h3 className="text-lg sm:text-xl font-black text-slate-800 mb-4 flex items-center gap-2">
            <Users className="text-violet-600" /> 决策人与邮箱
            <span className="text-[11px] font-bold text-slate-400 ml-auto">
              {withEmail.length}/{dms.length} 有邮箱 · {verified.length} 已验证
            </span>
          </h3>
          {data.decisionMakerEmailSearchAt && (
            <p className="text-[11px] font-bold text-violet-600 mb-3">
              最近邮箱搜索：{new Date(data.decisionMakerEmailSearchAt).toLocaleString('zh-CN')}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase">
                  <th className="py-2 pr-3">姓名</th>
                  <th className="py-2 pr-3">职位</th>
                  <th className="py-2 pr-3">邮箱</th>
                  <th className="py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {dms.slice(0, 15).map((dm, i) => (
                  <tr key={`${dm.name}-${i}`} className="border-b border-slate-50">
                    <td className="py-2.5 pr-3 font-bold text-slate-800">{dm.name}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{dm.title || '—'}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-blue-700 break-all">
                      {dm.emailGuess || '待搜索'}
                    </td>
                    <td className="py-2.5">
                      {dm.isVerified ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                          <ShieldCheck size={12} /> 已验证
                        </span>
                      ) : dm.emailGuess ? (
                        <span className="text-amber-700 font-bold">待确认</span>
                      ) : (
                        <span className="text-slate-400 font-bold">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dms.length > 15 && (
              <p className="text-[11px] text-slate-400 font-bold mt-2">另有 {dms.length - 15} 人，请见「决策人挖掘」页</p>
            )}
          </div>
        </div>
      )}

      {emails && (
        <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-indigo-200 shadow-sm">
          <h3 className="text-lg sm:text-xl font-black text-slate-800 mb-2 flex items-center gap-2">
            <PenTool className="text-indigo-600" /> 已保存开发信
            {data.generatedEmailsAt && (
              <span className="text-[11px] font-bold text-slate-400 ml-auto">
                {new Date(data.generatedEmailsAt).toLocaleString('zh-CN')}
              </span>
            )}
          </h3>
          <p className="text-sm font-bold text-indigo-800 mb-4 bg-indigo-50 p-3 rounded-xl">{emails.analysis}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { label: '邮件 1 · 破冰', body: emails.email1 },
              { label: '邮件 2 · 价值', body: emails.email2 },
              { label: '邮件 3 · 证明', body: emails.email3 },
            ].map((item) => (
              <div key={item.label} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                <div className="text-[10px] font-black text-slate-500 uppercase mb-2 flex items-center gap-1">
                  <Mail size={12} /> {item.label}
                </div>
                <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 font-bold mt-3">下载 PPT 时会自动包含以上开发信内容。</p>
        </div>
      )}
    </div>
  );
};
