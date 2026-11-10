/**
 * 本地自测：大库合并时若用户“忙碌”，必须让出主线程，不能一口气跑完卡死。
 * node scripts/stress-main-thread-yield.mjs
 */
import { performance } from 'node:perf_hooks';

let busyUntil = 0;
const shouldDeferHeavyWork = () => Date.now() < busyUntil;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yieldToUi = () => new Promise((r) => setImmediate(r));

const pauseIfUserBusy = async () => {
  let spins = 0;
  while (shouldDeferHeavyWork()) {
    await sleep(50);
    spins += 1;
    if (spins > 200) break;
  }
  await yieldToUi();
};

const makeClients = (n, prefix) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_${i}`,
    name: `Co ${prefix} ${i}`,
    productType: i % 7 === 0 ? '公开信息未找到' : `Toy-${i % 11}`,
    tags: [`t${i % 5}`],
    searchedKeywords: [`k${i % 9}`],
    activityEvents: [{ id: `e${i}`, at: Date.now() - i }],
    contacts: i % 3 === 0 ? [{ name: 'A' }] : [],
    lastBackgroundCheckAt: Date.now() - i * 1000,
  }));

const mergeOne = (prev, c) => {
  if (!prev) return c;
  const prefer = (c.lastBackgroundCheckAt || 0) >= (prev.lastBackgroundCheckAt || 0);
  const a = prefer ? c : prev;
  const b = prefer ? prev : c;
  return {
    ...b,
    ...a,
    tags: Array.from(new Set([...(b.tags || []), ...(a.tags || [])])),
    searchedKeywords: Array.from(
      new Set([...(b.searchedKeywords || []), ...(a.searchedKeywords || [])])
    ),
  };
};

const mergeChunked = async (local, cloud) => {
  const all = [...cloud, ...local];
  const map = new Map();
  const slice = 250;
  let maxSliceMs = 0;
  for (let i = 0; i < all.length; i += slice) {
    await pauseIfUserBusy();
    const t0 = performance.now();
    const end = Math.min(i + slice, all.length);
    for (let j = i; j < end; j++) {
      const c = all[j];
      map.set(c.id, mergeOne(map.get(c.id), c));
    }
    maxSliceMs = Math.max(maxSliceMs, performance.now() - t0);
    await yieldToUi();
  }
  return { count: map.size, maxSliceMs };
};

const local = makeClients(1800, 'L');
const cloud = makeClients(1800, 'C').concat(makeClients(400, 'L')); // overlap

busyUntil = Date.now() + 400;
const tBusy = performance.now();
const paused = await mergeChunked(local, cloud);
const busyElapsed = performance.now() - tBusy;

busyUntil = 0;
const tFree = performance.now();
const free = await mergeChunked(local, cloud);
const freeElapsed = performance.now() - tFree;

const ok =
  paused.count === free.count &&
  paused.maxSliceMs < 80 &&
  free.maxSliceMs < 80 &&
  busyElapsed > 350;

console.log(
  JSON.stringify(
    {
      ok,
      pausedCount: paused.count,
      freeCount: free.count,
      busyElapsedMs: Math.round(busyElapsed),
      freeElapsedMs: Math.round(freeElapsed),
      maxSliceBusyMs: Math.round(paused.maxSliceMs),
      maxSliceFreeMs: Math.round(free.maxSliceMs),
    },
    null,
    2
  )
);

if (!ok) process.exit(1);
