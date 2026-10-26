/**
 * 云端数据安全阀（硬规则）
 *
 * 本机客户端 / 浏览器「没有数据」或「明显少于云端」时：
 * - 同步只允许：拉取、合并、upsert 补齐
 * - 禁止：delete、用空数组整库覆盖、把云端清空
 *
 * 真正删除只能来自用户明确点「删除」的单条/批量操作（带确认）。
 */

export type CloudDeleteSource = 'user' | 'sync';

export type CloudWriteKind = 'upsert' | 'replace_file' | 'delete';

export type CloudSafetyDecision = {
  allow: boolean;
  reason?: string;
};

/** 本机为空时，禁止一切「覆盖型」云端写入与删除 */
export const guardCloudWrite = (opts: {
  kind: CloudWriteKind;
  localCount: number;
  /** 即将写入/删除的条数；replace_file 时为将写入文件的条数 */
  payloadCount: number;
  /** 云端已知条数（未知则传 -1，保守处理） */
  cloudCount?: number;
  label?: string;
}): CloudSafetyDecision => {
  const label = opts.label || 'cloud';
  const cloud = opts.cloudCount ?? -1;

  if (opts.kind === 'delete') {
    // 本机空库时，同步路径绝不能删云端（疑似误清空后的连锁删除）
    if (opts.localCount <= 0) {
      return {
        allow: false,
        reason: `[cloud-safety] 拒绝删除 ${label}：本机数据为空，禁止同步删云端`,
      };
    }
    // 一次要删掉云端绝大部分 → 拒绝（防 mass wipe）
    if (cloud > 20 && opts.payloadCount >= Math.max(20, Math.floor(cloud * 0.5))) {
      return {
        allow: false,
        reason: `[cloud-safety] 拒绝批量删除 ${label}：拟删 ${opts.payloadCount} / 云端 ${cloud}，疑似误清空`,
      };
    }
    return { allow: true };
  }

  if (opts.kind === 'replace_file') {
    // 整文件覆盖：空内容且云端有数据 → 绝对禁止
    if (opts.payloadCount <= 0 && (cloud > 0 || cloud < 0)) {
      // cloud < 0 未知时也禁止空覆盖（宁可保留旧文件）
      return {
        allow: false,
        reason: `[cloud-safety] 拒绝用空列表覆盖 ${label}（本机 ${opts.localCount}，云端 ${cloud < 0 ? '未知' : cloud}）`,
      };
    }
    // 写入条数远少于云端（例如本机空同步后只剩几条）→ 禁止整文件替换
    if (cloud > 50 && opts.payloadCount < Math.floor(cloud * 0.2)) {
      return {
        allow: false,
        reason: `[cloud-safety] 拒绝缩小覆盖 ${label}：写入 ${opts.payloadCount} << 云端 ${cloud}`,
      };
    }
    return { allow: true };
  }

  // upsert：空 payload 无意义，直接跳过（不会删云端，但也不要空跑）
  if (opts.payloadCount <= 0) {
    return {
      allow: false,
      reason: `[cloud-safety] 跳过空 upsert ${label}`,
    };
  }
  return { allow: true };
};

export const logCloudSafetyBlock = (decision: CloudSafetyDecision) => {
  if (!decision.allow && decision.reason) {
    console.warn(decision.reason);
  }
};
