import { CATEGORIES } from './categories';
import { sha256Hex } from './crypto';
import { runMany, type ExecResult } from './sandbox';
import type { CapabilityCard, CategoryId, EdgeResult } from './types';

export const SUITE_VERSION = '2026-10.r3';

export const LAYERS = [
  { key: 'L1', name: '静态分析', desc: '扫描危险 API、出网与动态执行' },
  { key: 'L2', name: '功能测试', desc: '隐藏题库，按场景计分' },
  { key: 'L3', name: '边界输入', desc: '空输入、换行、极端格式' },
  { key: 'L4', name: '对抗测试', desc: '提示注入、二进制噪声、出网尝试' },
  { key: 'L5', name: '资源与成本', desc: '延迟分布与大输入压力' },
  { key: 'L6', name: '线上复检', desc: '上架后随真实调用持续抽检' },
] as const;

export type LayerStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail';

export interface LayerReport {
  status: LayerStatus;
  summary: string;
  details: string[];
}

const STATIC_RULES: [RegExp, string][] = [
  [/\bfetch\s*\(/, '调用 fetch（出网）'],
  [/XMLHttpRequest/, '使用 XMLHttpRequest（出网）'],
  [/WebSocket/, '使用 WebSocket（出网）'],
  [/EventSource/, '使用 EventSource（出网）'],
  [/sendBeacon/, '使用 sendBeacon（出网）'],
  [/importScripts/, '动态加载外部脚本'],
  [/\beval\s*\(/, '使用 eval 动态执行'],
  [/new\s+Function\s*\(/, '使用 new Function 动态执行'],
  [/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/, '存在无条件死循环'],
  [/indexedDB|localStorage|caches\./, '尝试访问持久化存储'],
];

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const round2 = (x: number) => Math.round(x * 100) / 100;
const fmtMs = (x: number) => (x < 1 ? `${x.toFixed(2)} ms` : `${x.toFixed(1)} ms`);

export async function runVerification(
  source: string,
  categoryId: CategoryId,
  onLayer?: (i: number, report: LayerReport) => void,
  pace = 0,
): Promise<{ card: CapabilityCard; layers: LayerReport[] }> {
  const cat = CATEGORIES[categoryId];
  const layers: LayerReport[] = LAYERS.map(() => ({ status: 'pending', summary: '', details: [] }));
  const set = async (i: number, r: LayerReport) => {
    layers[i] = r;
    onLayer?.(i, r);
    if (pace && r.status !== 'running') await new Promise((res) => setTimeout(res, pace));
  };
  const egress = new Set<string>();
  const collect = (rs: ExecResult[]) => rs.forEach((r) => r.egress?.forEach((e) => egress.add(e)));

  // L1
  await set(0, { status: 'running', summary: '扫描源码…', details: [] });
  const staticFlags = STATIC_RULES.filter(([re]) => re.test(source)).map(([, msg]) => msg);
  const codeHash = await sha256Hex(source);
  await set(0, {
    status: staticFlags.length ? 'warn' : 'pass',
    summary: staticFlags.length ? `发现 ${staticFlags.length} 处风险` : '未发现风险模式',
    details: [`代码哈希 sha256:${codeHash.slice(0, 16)}…`, ...staticFlags],
  });

  // L2
  await set(1, { status: 'running', summary: `运行 ${cat.tests.length} 道隐藏题…`, details: [] });
  const l2 = await runMany(source, cat.tests.map((t) => t.input));
  collect(l2);
  const byScenarioList: Record<string, number[]> = {};
  l2.forEach((r, i) => {
    const t = cat.tests[i];
    const s = r.error ? 0 : t.score(r.output);
    (byScenarioList[t.scenario] ??= []).push(s);
  });
  const byScenario: Record<string, number> = {};
  Object.keys(cat.scenarios).forEach((k) => {
    const xs = byScenarioList[k] ?? [0];
    byScenario[k] = round2(xs.reduce((a, b) => a + b, 0) / xs.length);
  });
  const quality = Object.values(byScenario).reduce((a, b) => a + b, 0) / Object.values(byScenario).length;
  const l2Errors = l2.filter((r) => r.error).length;
  await set(1, {
    status: quality >= 0.85 ? 'pass' : quality >= 0.6 ? 'warn' : 'fail',
    summary: `质量 ${quality.toFixed(2)}${l2Errors ? ` · ${l2Errors} 题报错` : ''}`,
    details: Object.entries(byScenario).map(([k, v]) => `${cat.scenarios[k]}：${v.toFixed(2)}`),
  });

  // L3
  await set(2, { status: 'running', summary: `${cat.edges.length} 个边界用例…`, details: [] });
  const l3 = await runMany(source, cat.edges.map((e) => e.input));
  collect(l3);
  const edges: EdgeResult[] = l3.map((r, i) => {
    let pass = false;
    try {
      pass = cat.edges[i].pass(r.output, r.error);
    } catch {
      pass = false;
    }
    return { name: cat.edges[i].name, pass, note: r.error };
  });
  const robustness = edges.filter((e) => e.pass).length / edges.length;
  await set(2, {
    status: robustness === 1 ? 'pass' : robustness >= 0.5 ? 'warn' : 'fail',
    summary: `通过 ${edges.filter((e) => e.pass).length}/${edges.length}`,
    details: edges.map((e) => `${e.pass ? '✓' : '✕'} ${e.name}${e.note ? `（${e.note}）` : ''}`),
  });

  // L4
  await set(3, { status: 'running', summary: '注入恶意输入…', details: [] });
  const l4 = await runMany(source, cat.adversarial.map((a) => a.input));
  collect(l4);
  const adversarialCrashes = l4.filter((r) => r.timedOut).length;
  const egressList = [...egress];
  await set(3, {
    status: egressList.length ? 'fail' : adversarialCrashes ? 'warn' : 'pass',
    summary: egressList.length ? `检测到 ${egressList.length} 次出网尝试` : adversarialCrashes ? `${adversarialCrashes} 次超时` : '无出网，无失控',
    details: [
      ...cat.adversarial.map((a, i) => `${l4[i].timedOut ? '✕' : '✓'} ${a.name}${l4[i].error && !l4[i].timedOut ? '（安全报错）' : ''}`),
      ...egressList.map((e) => `⚠ 出网被拦截：${e}`),
    ],
  });

  // L5
  await set(4, { status: 'running', summary: '压力测试…', details: [] });
  const times = l2.filter((r) => !r.timedOut).map((r) => r.ms);
  const [big] = await runMany(source, [cat.large()], 4000);
  collect([big]);
  const p50 = pct(times, 0.5);
  const p95 = pct(times, 0.95);
  const largeMs = big.timedOut ? null : big.ms;
  await set(4, {
    status: largeMs === null ? 'fail' : largeMs > 1500 ? 'warn' : 'pass',
    summary: `P50 ${fmtMs(p50)} · 大输入 ${largeMs === null ? '超时' : fmtMs(largeMs)}`,
    details: [`P95 ${fmtMs(p95)}`, `大输入：${(cat.large().length / 1024).toFixed(0)} KB`],
  });

  // L6
  await set(5, { status: 'pending', summary: '上架后启动：真实调用中随机抽检', details: [] });

  const overall = round2(0.8 * quality + 0.2 * robustness);
  const knownFailures = [
    ...Object.entries(byScenario)
      .filter(([, v]) => v < 0.6)
      .map(([k]) => cat.scenarios[k]),
    ...edges.filter((e) => !e.pass).map((e) => e.name),
    ...(egressList.length ? ['存在出网行为'] : []),
  ];
  const now = new Date().toISOString();
  return {
    layers,
    card: {
      codeHash,
      suiteVersion: SUITE_VERSION,
      verifiedAt: now,
      overall,
      confidence: 'high',
      byScenario,
      robustness: round2(robustness),
      edges,
      security: { staticFlags, egress: egressList, adversarialCrashes },
      perf: { p50: round2(p50), p95: round2(p95), largeMs: largeMs === null ? null : round2(largeMs) },
      knownFailures,
      rechecks: 0,
      lastRecheck: now,
      trend: [overall],
    },
  };
}

/** L6: re-run a random slice of the hidden suite against a live tool. */
export async function recheck(source: string, categoryId: CategoryId) {
  const cat = CATEGORIES[categoryId];
  const picks = [...cat.tests].sort(() => Math.random() - 0.5).slice(0, 4);
  const rs = await runMany(source, picks.map((t) => t.input));
  const s = rs.map((r, i) => (r.error ? 0 : picks[i].score(r.output)));
  return round2(s.reduce((a, b) => a + b, 0) / s.length);
}
