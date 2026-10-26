/**
 * 将上游英文/技术错误转成前台可操作的中文提示（不暴露供应商品牌细节）。
 */
export const humanizeCreativeProviderError = (raw: unknown): string => {
  const msg = String((raw as any)?.message || raw || '').trim();
  if (!msg) return '生成失败，请稍后重试';

  if (/don'?t have enough credit|not enough credit|insufficient credit|余额不足|额度不足|credit.*(low|exhaust|deplet)|quota.*(exceed|exhaust)|AllocationQuota|套餐额度/i.test(msg)) {
    return '账户额度不足，无法创建任务。请管理员在对应服务控制台充值或降低品质档（如改用「引擎就绪」）后重试。';
  }
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return '网络请求失败（多为参考图过大或代理超时）。请压缩/少选参考图后重试；若仍失败请检查网络或稍后重试。';
  }
  if (/401|unauthorized|invalid.*key|鉴权|API Key/i.test(msg)) {
    return 'API Key 无效或未启用。请管理员在「系统管理 → 数据接入」检查并重新保存 Key。';
  }
  if (/429|rate.?limit|Too Many Requests|限流/i.test(msg)) {
    return '请求过于频繁，请稍等 1–2 分钟后再试。';
  }
  if (/timeout|超时|504|502/i.test(msg)) {
    return '上游服务超时或暂时不可用，请稍后重试。';
  }
  // 去掉重复前缀
  return msg.replace(/^3D 生成失败：|^视频任务创建失败：/i, '').slice(0, 280);
};
