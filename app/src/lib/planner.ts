import { STEPS, qualityFor, type Availability, type Provider, type StepId } from './catalog';

/* ------------------------------------------------------------------ personas */

export type PersonaId = 'auto' | 'price' | 'speed' | 'balanced' | 'rich';
export interface Weights {
  q: number; // quality
  c: number; // cost
  t: number; // time
  minQ: number; // quality floor
}

export const PERSONAS: Record<Exclude<PersonaId, 'auto'>, { label: string; hint: string; w: Weights }> = {
  price: { label: '价格敏感', hint: '质量够用就行，能省则省', w: { q: 0.2, c: 0.7, t: 0.1, minQ: 0.6 } },
  speed: { label: '追求高效', hint: '时间最贵，优先快和并发', w: { q: 0.3, c: 0.1, t: 0.6, minQ: 0.75 } },
  balanced: { label: '平衡', hint: '质量、价格、速度兼顾', w: { q: 0.4, c: 0.3, t: 0.3, minQ: 0.7 } },
  rich: { label: '财大气粗', hint: '只要最好的结果', w: { q: 0.85, c: 0, t: 0.15, minQ: 0 } },
};

export interface Prefs {
  q: number;
  c: number;
  t: number;
  n: number;
}

/** History-derived weights: every manual swap nudges toward what the user moved to. */
export function historyWeights(p: Prefs | undefined): Weights {
  const base = PERSONAS.balanced.w;
  if (!p || p.n === 0) return base;
  const total = p.q + p.c + p.t || 1;
  const k = Math.min(1, p.n / 6); // trust history more as it grows
  const mix = (b: number, h: number) => b * (1 - k) + h * k;
  return { q: mix(base.q, p.q / total), c: mix(base.c, p.c / total), t: mix(base.t, p.t / total), minQ: base.minQ * (1 - k * (p.c / total)) };
}

export function weightsFor(persona: PersonaId, prefs?: Prefs): Weights {
  return persona === 'auto' ? historyWeights(prefs) : PERSONAS[persona].w;
}

/* ------------------------------------------------------------------ plan */

export interface PlanNode {
  id: string;
  step: StepId;
  label: string;
  deps: string[];
  level: number;
  fanout: number; // parallel instances
  units: number; // units per instance
  scenario?: string;
  providerId: string | null;
}

export interface Plan {
  id: string;
  prompt: string;
  sensitive: boolean;
  docs: number;
  pages: number;
  nodes: PlanNode[];
  assumptions: string[];
}

const num = (text: string, units: string) => {
  const m = text.match(new RegExp(`(\\d+)\\s*(?:${units})`));
  return m ? Number(m[1]) : null;
};

export function parseIntent(prompt: string): Plan {
  const t = prompt.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  const assumptions: string[] = [];

  const sensitive = has(/病历|患者|病人|临床|隐私|敏感|外泄|保密|脱敏|身份证|基因组|测序数据|未公开/);
  const wantsSearch = has(/检索|搜索|查找|调研|最新|最近.*(论文|研究|文献)/);
  const pdfInput = has(/pdf|扫描|文件|病历|报告单|化验单/) || (has(/论文|文献/) && !wantsSearch);
  const seq = has(/基因|dna|测序|序列|fasta|gc 含量|gc含量/);
  const protein = has(/蛋白|抗体|分子量|氨基酸/);
  const redact = sensitive && (pdfInput || has(/文本|记录|报告/)) && has(/脱敏|病历|患者|隐私|身份证/);
  const csv = has(/统计|均值|汇总|化验|指标|表格|csv|excel|数据分析/);
  const risk = has(/风险|打分|评分|良恶性|预测|诊断/);
  const translate = has(/翻译|译成|译为/);
  const chart = has(/图表|可视化|画图|作图|柱状|折线|趋势图/);
  const report = has(/报告|导出|排版|pdf ?输出/);
  const summarize = has(/总结|摘要|综述|报告|分析|写|结论/) || (!seq && !protein && !csv && !risk && !translate);

  const docs = num(t, '份|篇|个文件|位患者|名患者|位病人|个病人|条|个样本|位') ?? (has(/这批|一批|所有/) ? 20 : 1);
  if (wantsSearch && !num(t, '篇')) assumptions.push('检索后取相关度最高的 20 篇');
  else if (!num(t, '份|篇|个文件|位患者|名患者|位病人|个病人|条|个样本|位')) assumptions.push(`未写数量，按 ${docs} 份估算`);
  const pages = num(t, '页') ?? 8;
  if (pdfInput && !num(t, '页')) assumptions.push('每份按 8 页估算');
  const scenario = has(/扫描|拍照|照片|手写/) ? 'scanned' : has(/论文|期刊|双栏/) ? 'multicol' : has(/表格|化验|检验/) ? 'table' : has(/中文/) && pdfInput ? 'chinese' : 'plain';
  const candidates = num(t, '个抗体|个候选|个蛋白|条蛋白') ?? 5;

  const nodes: PlanNode[] = [];
  const add = (step: StepId, deps: string[], fanout: number, units: number, extra: Partial<PlanNode> = {}) => {
    const id = `${step}-${nodes.length}`;
    const level = deps.length ? 1 + Math.max(...deps.map((d) => nodes.find((n) => n.id === d)!.level)) : 0;
    nodes.push({ id, step, label: STEPS[step].label, deps, level, fanout, units, providerId: null, ...extra });
    return id;
  };

  let front: string[] = [];
  if (wantsSearch) {
    front = [add('search', [], 3, 1, { label: '文献检索 · 3 个检索式' })];
  }
  const corpus = wantsSearch ? Math.max(docs, 20) : docs;
  if (pdfInput || wantsSearch) {
    const id = add('pdf', front, corpus, 1, { scenario, label: `PDF 解析${scenario === 'scanned' ? '（扫描件）' : scenario === 'multicol' ? '（双栏论文）' : scenario === 'table' ? '（表格）' : ''}` });
    front = [id];
  }
  if (redact) front = [add('redact', front, corpus, 1)];
  const mids: string[] = [];
  if (seq) mids.push(add('seq', front, docs, 1));
  if (protein) mids.push(add('protein', front, candidates, 1, { label: `蛋白分子量 · ${candidates} 个候选` }));
  if (csv) mids.push(add('csv', front, 1, 1));
  if (risk) mids.push(add('risk', front, docs, 1));
  let textIn = mids.length ? mids : front;
  const kTokens = Math.max(2, Math.round((pdfInput || wantsSearch ? corpus * pages * 0.6 : 2) + mids.length * 1.5));
  if (translate) textIn = [add('translate', front, corpus, Math.max(1, Math.round(pages * 0.6)))];
  const finals: string[] = [];
  if (summarize) finals.push(add('summarize', translate ? [...textIn, ...mids] : textIn, 1, kTokens));
  if (chart && (mids.length || csv)) finals.push(add('chart', mids.length ? mids : textIn, Math.max(1, mids.length), 1));
  if (report && finals.length) add('report', finals, 1, 1);

  return {
    id: crypto.randomUUID(),
    prompt,
    sensitive,
    docs: corpus,
    pages,
    nodes,
    assumptions: [...assumptions, ...(sensitive ? ['检测到敏感数据：只用可信档或密文档 Worker'] : [])],
  };
}

/* ------------------------------------------------------------------ eligibility & ranking */

export interface Candidate {
  provider: Provider;
  quality: number;
  cost: number; // expected USD for this node (incl. retries)
  time: number; // seconds for this node
  utility: number;
  blocked: string | null;
  availability: Availability;
}

export function nodeEconomics(node: PlanNode, p: Provider, avail?: Availability) {
  const q = qualityFor(p, node.scenario);
  const pSuccess = Math.max(0.05, Math.min(0.995, q));
  const cost = (node.fanout * node.units * p.unitPrice) / pSuccess;
  const lanes = Math.max(1, Math.min(node.fanout, avail?.free || p.slots));
  const time = Math.ceil(node.fanout / lanes) * node.units * p.latency;
  return { quality: q, pSuccess, cost, time };
}

function blockedReason(node: PlanNode, p: Provider, sensitive: boolean, a: Availability, q: number): string | null {
  if (a.state === 'offline') return '离线';
  if (a.state === 'busy') return '满载，暂不接单';
  if (sensitive && p.tier === 'open') return '普通档不接敏感数据';
  if (sensitive && p.egress) return '能力卡记录了出网行为';
  if (p.egress && node.step === 'search') return null;
  if (q < 0.3) return `实测不适合此场景（${q.toFixed(2)}）`;
  return null;
}

export function rankCandidates(node: PlanNode, catalog: Provider[], sensitive: boolean, w: Weights, avail: Record<string, Availability>): Candidate[] {
  const raw = catalog
    .filter((p) => p.step === node.step)
    .map((p) => {
      const a = avail[p.id] ?? { state: 'online', free: p.slots };
      const e = nodeEconomics(node, p, a);
      return { provider: p, quality: e.quality, cost: e.cost, time: e.time, availability: a, blocked: blockedReason(node, p, sensitive, a, e.quality), utility: 0 };
    });
  const ok = raw.filter((c) => !c.blocked);
  const span = (xs: number[]) => {
    const lo = Math.log(Math.min(...xs) + 1e-9);
    const hi = Math.log(Math.max(...xs) + 1e-9);
    return (x: number) => (hi - lo < 1e-9 ? 0 : (Math.log(x + 1e-9) - lo) / (hi - lo));
  };
  const nc = span(ok.map((c) => c.cost).concat(1e-9));
  const nt = span(ok.map((c) => c.time).concat(1e-9));
  for (const c of raw) {
    const floorPenalty = c.quality < w.minQ ? 0.5 : 0;
    c.utility = w.q * c.quality - w.c * nc(c.cost) - w.t * nt(c.time) - floorPenalty;
  }
  return raw.sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || b.utility - a.utility);
}

export function autoSelect(plan: Plan, catalog: Provider[], w: Weights, avail: Record<string, Availability>): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((n) => {
      const best = rankCandidates(n, catalog, plan.sensitive, w, avail).find((c) => !c.blocked);
      return { ...n, providerId: best?.provider.id ?? null };
    }),
  };
}

/* ------------------------------------------------------------------ totals */

export interface Estimate {
  cost: number;
  time: number;
  pAll: number;
  perNode: Record<string, { cost: number; time: number; quality: number }>;
}

export function estimate(plan: Plan, catalog: Provider[], avail: Record<string, Availability>): Estimate {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const perNode: Estimate['perNode'] = {};
  let cost = 0;
  let pAll = 1;
  const levelTime: Record<number, number> = {};
  for (const n of plan.nodes) {
    const p = n.providerId ? byId.get(n.providerId) : undefined;
    if (!p) {
      perNode[n.id] = { cost: 0, time: 0, quality: 0 };
      pAll = 0;
      continue;
    }
    const e = nodeEconomics(n, p, avail[p.id]);
    perNode[n.id] = { cost: e.cost, time: e.time, quality: e.quality };
    cost += e.cost;
    // each node retries up to twice before the flow gives up
    pAll *= 1 - (1 - e.pSuccess) ** 3;
    levelTime[n.level] = Math.max(levelTime[n.level] ?? 0, e.time);
  }
  return { cost, time: Object.values(levelTime).reduce((a, b) => a + b, 0), pAll, perNode };
}

export function fmtTime(s: number) {
  if (s < 1) return `${Math.max(0.1, s).toFixed(1)} 秒`;
  if (s < 90) return `${Math.round(s)} 秒`;
  if (s < 5400) return `${Math.round(s / 60)} 分钟`;
  return `${(s / 3600).toFixed(1)} 小时`;
}

export function fmtUsd(v: number) {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/** Follow-up phrases that re-tune the last plan instead of making a new one. */
export function followUpPersona(text: string): PersonaId | null {
  if (/便宜|省钱|省点|划算|预算/.test(text)) return 'price';
  if (/快|赶时间|加急|并发/.test(text)) return 'speed';
  if (/最好|不差钱|顶配|质量优先|最贵/.test(text)) return 'rich';
  if (/平衡|均衡|折中/.test(text)) return 'balanced';
  return null;
}
