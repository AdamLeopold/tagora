import bench from '../data/pdf-benchmark.json';
import type { CategoryId, Tool } from './types';

/**
 * Everything the planner can put in a flow: a step type, and for each step the
 * Workers (tools or models, each run by someone's twin) that can do it.
 *
 * PDF parsing uses the real phase-0 capability cards; seq / protein / redact /
 * csv use the market's cards; the risk-scoring Workers carry the measured CKKS
 * timings. Model, search, chart and report Workers are demo listings until
 * their categories are benchmarked.
 */

export type StepId = 'search' | 'pdf' | 'redact' | 'seq' | 'protein' | 'csv' | 'risk' | 'translate' | 'summarize' | 'chart' | 'report';
export type ProviderTier = 'trusted' | 'open' | 'fhe';

export interface StepMeta {
  label: string;
  unit: string; // what one unit of work is
  kind: 'tool' | 'model';
  blurb: string;
}

export const STEPS: Record<StepId, StepMeta> = {
  search: { label: '文献检索', unit: '次', kind: 'tool', blurb: '多个检索式并行，汇总候选文献' },
  pdf: { label: 'PDF 解析', unit: '份', kind: 'tool', blurb: '把 PDF 转成带表格的 Markdown' },
  redact: { label: '敏感信息脱敏', unit: '份', kind: 'tool', blurb: '去除姓名、手机号、身份证等' },
  seq: { label: 'DNA 序列分析', unit: '条', kind: 'tool', blurb: 'GC 含量与序列统计' },
  protein: { label: '蛋白分子量', unit: '个', kind: 'tool', blurb: '由氨基酸序列计算分子量' },
  csv: { label: '数据统计', unit: '次', kind: 'tool', blurb: '按列计数、均值、极值' },
  risk: { label: '风险打分', unit: '位', kind: 'model', blurb: '对每位患者的指标打分' },
  translate: { label: '翻译', unit: '千 token', kind: 'model', blurb: '大模型逐篇翻译' },
  summarize: { label: '分析与写作', unit: '千 token', kind: 'model', blurb: '大模型汇总、分析、成文' },
  chart: { label: '图表生成', unit: '张', kind: 'tool', blurb: '把统计结果画成图' },
  report: { label: '报告排版', unit: '份', kind: 'tool', blurb: '排版成可分享的 PDF' },
};

export interface Provider {
  id: string;
  name: string;
  step: StepId;
  owner: string; // the twin that runs it
  tier: ProviderTier;
  quality: number | Record<string, number>; // per scenario when known
  unitPrice: number; // USD per unit
  latency: number; // seconds per unit
  slots: number; // parallel capacity
  egress?: boolean;
  source: 'benchmark' | 'market' | 'fhe' | 'demo';
}

export function qualityFor(p: Provider, scenario?: string): number {
  if (typeof p.quality === 'number') return p.quality;
  if (scenario && p.quality[scenario] != null) return p.quality[scenario];
  return p.quality.overall ?? Object.values(p.quality).reduce((a, b) => a + b, 0) / Object.values(p.quality).length;
}

const twin = (author: string) => `${author} 的孪生`;

function pdfProviders(): Provider[] {
  const TEE = new Set(['tagora-hybrid', 'pymupdf', 'pdfplumber', 'pypdf']);
  const out: Provider[] = [];
  for (const t of bench.tools) {
    const base: Provider = {
      id: `pdf:${t.name}`,
      name: t.name,
      step: 'pdf',
      owner: t.name === 'tagora-hybrid' ? 'Tagora 参考实现' : twin(t.author),
      tier: 'open',
      quality: { ...t.by_scenario, overall: t.overall },
      unitPrice: t.price_usd,
      latency: Math.max(0.05, t.p50_s),
      slots: 16,
      egress: t.egress,
      source: 'benchmark',
    };
    out.push(base);
    if (TEE.has(t.name)) out.push({ ...base, id: `${base.id}:tee`, tier: 'trusted', unitPrice: +(t.price_usd * 1.25).toFixed(6), slots: 4, owner: `${base.owner} · 机密节点` });
  }
  return out;
}

const MARKET_STEP: Partial<Record<CategoryId, StepId>> = { seq: 'seq', protein: 'protein', redact: 'redact', csv: 'csv' };

function marketProviders(tools: Tool[]): Provider[] {
  return tools
    .filter((t) => MARKET_STEP[t.category])
    .map((t) => ({
      id: `mkt:${t.id}`,
      name: t.name,
      step: MARKET_STEP[t.category]!,
      owner: t.mine ? '我的孪生' : twin(t.author),
      tier: t.tier,
      quality: t.card.overall,
      unitPrice: t.price,
      latency: Math.max(0.05, t.card.perf.p50 / 1000),
      slots: t.tier === 'trusted' ? 4 : 12,
      egress: t.card.security.egress.length > 0,
      source: 'market' as const,
    }));
}

const DEMO: Provider[] = [
  // risk scoring: CKKS timings from benchmarks/fhe (25 ms / 96 ms per patient)
  { id: 'risk:logreg-fhe', name: 'risk-logreg（密文推理）', step: 'risk', owner: 'Tagora 密文档', tier: 'fhe', quality: 0.959, unitPrice: 0.002, latency: 0.025, slots: 8, source: 'fhe' },
  { id: 'risk:mlp-fhe', name: 'risk-mlp-square（密文推理）', step: 'risk', owner: 'Tagora 密文档', tier: 'fhe', quality: 0.959, unitPrice: 0.006, latency: 0.096, slots: 8, source: 'fhe' },
  { id: 'risk:gbm', name: 'risk-gbm（明文）', step: 'risk', owner: '临床数据科学组的孪生', tier: 'open', quality: 0.97, unitPrice: 0.0004, latency: 0.002, slots: 32, source: 'demo' },
  { id: 'risk:gbm-tee', name: 'risk-gbm（可信档）', step: 'risk', owner: '临床数据科学组的孪生 · 机密节点', tier: 'trusted', quality: 0.97, unitPrice: 0.0006, latency: 0.003, slots: 8, source: 'demo' },

  // open-weight models on community compute (demo listings)
  { id: 'llm:llama-8b', name: 'Llama-3.1-8B-Instruct', step: 'summarize', owner: '阿杰的孪生 · RTX 4090', tier: 'open', quality: 0.62, unitPrice: 0.00008, latency: 0.35, slots: 6, source: 'demo' },
  { id: 'llm:llama-8b-tee', name: 'Llama-3.1-8B-Instruct', step: 'summarize', owner: '合规算力联盟 · 机密 GPU', tier: 'trusted', quality: 0.62, unitPrice: 0.00012, latency: 0.4, slots: 4, source: 'demo' },
  { id: 'llm:qwen-72b', name: 'Qwen2.5-72B-Instruct', step: 'summarize', owner: 'Mia 的孪生 · 4×A100', tier: 'open', quality: 0.82, unitPrice: 0.0006, latency: 1.1, slots: 4, source: 'demo' },
  { id: 'llm:llama-70b-tee', name: 'Llama-3.3-70B-Instruct', step: 'summarize', owner: '合规算力联盟 · 机密 H100', tier: 'trusted', quality: 0.8, unitPrice: 0.0009, latency: 1.2, slots: 3, source: 'demo' },
  { id: 'llm:deepseek-v3', name: 'DeepSeek-V3', step: 'summarize', owner: 'Kai 的孪生 · H100 集群', tier: 'open', quality: 0.88, unitPrice: 0.0011, latency: 0.9, slots: 8, source: 'demo' },
  { id: 'llm:qwen3-235b-tee', name: 'Qwen3-235B-A22B', step: 'summarize', owner: '云端机密节点 · H200', tier: 'trusted', quality: 0.9, unitPrice: 0.0016, latency: 1.0, slots: 2, source: 'demo' },
  { id: 'llm:glm-9b', name: 'GLM-4-9B', step: 'summarize', owner: '小周的孪生 · M3 Max', tier: 'open', quality: 0.58, unitPrice: 0.00006, latency: 0.8, slots: 1, source: 'demo' },

  { id: 'tr:llama-8b', name: 'Llama-3.1-8B-Instruct', step: 'translate', owner: '阿杰的孪生 · RTX 4090', tier: 'open', quality: 0.7, unitPrice: 0.00008, latency: 0.3, slots: 6, source: 'demo' },
  { id: 'tr:qwen-72b', name: 'Qwen2.5-72B-Instruct', step: 'translate', owner: 'Mia 的孪生 · 4×A100', tier: 'open', quality: 0.88, unitPrice: 0.0006, latency: 1.0, slots: 4, source: 'demo' },
  { id: 'tr:nllb', name: 'NLLB-200-3.3B', step: 'translate', owner: '翻译社的孪生 · L40S', tier: 'open', quality: 0.76, unitPrice: 0.00004, latency: 0.15, slots: 12, source: 'demo' },
  { id: 'tr:llama-70b-tee', name: 'Llama-3.3-70B-Instruct', step: 'translate', owner: '合规算力联盟 · 机密 H100', tier: 'trusted', quality: 0.85, unitPrice: 0.0009, latency: 1.1, slots: 3, source: 'demo' },

  { id: 'search:pubmed', name: 'pubmed-search', step: 'search', owner: '医学图书馆的孪生', tier: 'open', quality: 0.86, unitPrice: 0.0003, latency: 1.4, slots: 8, source: 'demo' },
  { id: 'search:openalex', name: 'openalex-search', step: 'search', owner: '开放学术联盟的孪生', tier: 'open', quality: 0.8, unitPrice: 0.0001, latency: 0.9, slots: 16, source: 'demo' },
  { id: 'search:s2', name: 'semantic-scholar-search', step: 'search', owner: '阿岚的孪生', tier: 'open', quality: 0.83, unitPrice: 0.0002, latency: 1.1, slots: 8, source: 'demo' },
  { id: 'search:scrape', name: 'web-scrape-search', step: 'search', owner: 'growth-hacker 的孪生', tier: 'open', quality: 0.55, unitPrice: 0.00005, latency: 2.5, slots: 4, egress: true, source: 'demo' },

  { id: 'chart:vega', name: 'vega-lite-builder', step: 'chart', owner: '可视化工坊的孪生', tier: 'open', quality: 0.84, unitPrice: 0.0005, latency: 0.6, slots: 8, source: 'demo' },
  { id: 'chart:mpl', name: 'matplotlib-runner', step: 'chart', owner: '小林的孪生', tier: 'open', quality: 0.78, unitPrice: 0.0002, latency: 1.5, slots: 4, source: 'demo' },
  { id: 'chart:mpl-tee', name: 'matplotlib-runner', step: 'chart', owner: '小林的孪生 · 机密节点', tier: 'trusted', quality: 0.78, unitPrice: 0.0003, latency: 1.7, slots: 2, source: 'demo' },
  { id: 'chart:vega-tee', name: 'vega-lite-builder', step: 'chart', owner: '可视化工坊的孪生 · 机密节点', tier: 'trusted', quality: 0.84, unitPrice: 0.0007, latency: 0.7, slots: 3, source: 'demo' },
  { id: 'chart:plotly-tee', name: 'plotly-static', step: 'chart', owner: '合规算力联盟 · 机密节点', tier: 'trusted', quality: 0.8, unitPrice: 0.0005, latency: 1.1, slots: 4, source: 'demo' },

  { id: 'report:typst', name: 'typst-render', step: 'report', owner: '排版社的孪生', tier: 'open', quality: 0.9, unitPrice: 0.001, latency: 1.2, slots: 4, source: 'demo' },
  { id: 'report:pandoc', name: 'pandoc-pdf', step: 'report', owner: '文档工具组的孪生', tier: 'open', quality: 0.8, unitPrice: 0.0004, latency: 2.0, slots: 4, source: 'demo' },
  { id: 'report:typst-tee', name: 'typst-render', step: 'report', owner: '排版社的孪生 · 机密节点', tier: 'trusted', quality: 0.9, unitPrice: 0.0013, latency: 1.4, slots: 2, source: 'demo' },
  { id: 'report:pandoc-tee', name: 'pandoc-pdf', step: 'report', owner: '文档工具组的孪生 · 机密节点', tier: 'trusted', quality: 0.8, unitPrice: 0.0005, latency: 2.2, slots: 3, source: 'demo' },
];

export function buildCatalog(tools: Tool[]): Provider[] {
  return [...pdfProviders(), ...marketProviders(tools), ...DEMO];
}

/* ------------------------------------------------------------ availability */

export type Availability = { state: 'online' | 'busy' | 'offline'; free: number };

/** Simulated live status; deterministic per provider with a slow random walk. */
export function sampleAvailability(catalog: Provider[], tick: number): Record<string, Availability> {
  const out: Record<string, Availability> = {};
  for (const p of catalog) {
    let h = 0;
    for (const ch of p.id + ':' + Math.floor(tick / 3)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const r = (h % 1000) / 1000;
    const state = r < 0.07 ? 'offline' : r < 0.14 ? 'busy' : 'online';
    out[p.id] = { state, free: state === 'online' ? Math.max(1, Math.round(p.slots * (0.4 + 0.6 * ((h >> 10) % 100) / 100))) : 0 };
  }
  return out;
}
