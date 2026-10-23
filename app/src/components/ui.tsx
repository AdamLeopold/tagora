import { AlertTriangle, Check, Copy, Lock, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CATEGORIES } from '../lib/categories';
import { shortHash } from '../lib/crypto';
import type { CategoryId, Tier, Tool } from '../lib/types';

export function scoreColor(v: number) {
  if (v >= 0.85) return 'var(--good)';
  if (v >= 0.6) return 'var(--warn)';
  return 'var(--bad)';
}

export function ScoreBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="scorebar" title={hint}>
      <span className="sb-label">{label}</span>
      <span className="sb-track">
        <i style={{ width: `${Math.max(2, value * 100)}%`, background: scoreColor(value) }} />
      </span>
      <b style={{ color: scoreColor(value) }}>{value.toFixed(2)}</b>
    </div>
  );
}

export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values, 0.4);
  const max = Math.max(...values, 1);
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const last = values.at(-1)!;
  return (
    <svg width={width} height={height} className="spark" aria-label={`趋势：最近 ${values.map((v) => v.toFixed(2)).join('、')}`}>
      <path d={d} fill="none" stroke={scoreColor(last)} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.6" fill={scoreColor(last)} />
    </svg>
  );
}

export function Hash({ value, n = 8, prefix = '' }: { value: string; n?: number; prefix?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="hash"
      title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {prefix}
      {shortHash(value, n)}
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function TierBadge({ tier }: { tier: Tier }) {
  return tier === 'trusted' ? (
    <span className="badge trusted">
      <Lock size={12} /> 可信档 TEE
    </span>
  ) : (
    <span className="badge open">
      <Users size={12} /> 普通档
    </span>
  );
}

export function CatBadge({ id }: { id: CategoryId }) {
  return <span className={`badge cat cat-${id}`}>{CATEGORIES[id].name}</span>;
}

export function ClaimGap({ tool }: { tool: Tool }) {
  const gap = tool.claim.accuracy - tool.card.overall;
  return (
    <div className="claimgap">
      <div>
        <small>作者宣称</small>
        <b className="claimed">{Math.round(tool.claim.accuracy * 100)}%</b>
      </div>
      <div>
        <small>Tagora 实测</small>
        <b style={{ color: scoreColor(tool.card.overall) }}>{tool.card.overall.toFixed(2)}</b>
      </div>
      {gap > 0.15 && (
        <span className="gapflag">
          <AlertTriangle size={13} /> 描述偏差 {Math.round(gap * 100)} 分
        </span>
      )}
    </div>
  );
}

export function Panel({ title, extra, children, className = '' }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || extra) && (
        <header className="panel-head">
          {title && <h3>{title}</h3>}
          {extra}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export const money = (v: number, d = 4) => `$${v.toFixed(d)}`;
// worker clocks are coarsened by the browser, so tiny timings read as 0
export const fmtMs = (v: number) => (v < 0.1 ? '<0.1 ms' : v < 10 ? `${v.toFixed(2)} ms` : `${v.toFixed(0)} ms`);
export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
};
