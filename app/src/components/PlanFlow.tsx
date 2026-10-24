import { AlertTriangle, ArrowLeftRight, Lock, ShieldCheck, Users } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { qualityFor, type Availability, type Provider, type ProviderTier } from '../lib/catalog';
import { fmtTime, fmtUsd, type Estimate, type Plan } from '../lib/planner';
import { scoreColor } from './ui';

export function TierTag({ tier }: { tier: ProviderTier }) {
  if (tier === 'trusted')
    return (
      <span className="badge trusted">
        <ShieldCheck size={11} /> 可信档
      </span>
    );
  if (tier === 'fhe')
    return (
      <span className="badge fhe">
        <Lock size={11} /> 密文档
      </span>
    );
  return (
    <span className="badge open">
      <Users size={11} /> 普通档
    </span>
  );
}

interface Props {
  plan: Plan;
  est: Estimate;
  byId: Map<string, Provider>;
  avail: Record<string, Availability>;
  progress?: Record<string, number>;
  active?: string | null;
  onPick: (nodeId: string) => void;
  locked?: boolean;
}

export default function PlanFlow({ plan, est, byId, avail, progress, active, onPick, locked }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [paths, setPaths] = useState<{ d: string; key: string; live: boolean }[]>([]);
  const levels = [...new Set(plan.nodes.map((n) => n.level))].sort((a, b) => a - b);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const draw = () => {
      const box = el.getBoundingClientRect();
      const out: { d: string; key: string; live: boolean }[] = [];
      for (const n of plan.nodes) {
        const to = refs.current.get(n.id)?.getBoundingClientRect();
        if (!to) continue;
        for (const dep of n.deps) {
          const from = refs.current.get(dep)?.getBoundingClientRect();
          if (!from) continue;
          const x1 = from.left + from.width / 2 - box.left;
          const y1 = from.bottom - box.top;
          const x2 = to.left + to.width / 2 - box.left;
          const y2 = to.top - box.top;
          const my = (y1 + y2) / 2;
          const live = !!progress && (progress[dep] ?? 0) >= 1 && (progress[n.id] ?? 0) < 1;
          out.push({ d: `M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2 - 6}`, key: `${dep}>${n.id}`, live });
        }
      }
      setPaths(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [plan, progress]);

  return (
    <div className="pf" ref={wrap}>
      <svg className="pf-lines" aria-hidden="true">
        <defs>
          <marker id="pf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="currentColor" />
          </marker>
        </defs>
        {paths.map((p) => (
          <path key={p.key} d={p.d} className={p.live ? 'live' : ''} markerEnd="url(#pf-arrow)" />
        ))}
      </svg>
      {levels.map((lv) => {
        const row = plan.nodes.filter((n) => n.level === lv);
        return (
          <div className="pf-level" key={lv}>
            {row.length > 1 && <span className="pf-par">并行</span>}
            {row.map((n) => {
              const p = n.providerId ? byId.get(n.providerId) : undefined;
              const a = p ? avail[p.id] : undefined;
              const e = est.perNode[n.id];
              const pr = progress?.[n.id] ?? 0;
              const down = a && a.state !== 'online';
              return (
                <button
                  type="button"
                  key={n.id}
                  ref={(el) => {
                    if (el) refs.current.set(n.id, el);
                    else refs.current.delete(n.id);
                  }}
                  className={`pf-node ${n.fanout > 1 ? 'stack' : ''} ${active === n.id ? 'on' : ''} ${down ? 'warn' : ''} ${pr >= 1 ? 'done' : pr > 0 ? 'run' : ''}`}
                  onClick={() => !locked && onPick(n.id)}
                  disabled={locked}
                >
                  <span className="pf-head">
                    <b>{n.label}</b>
                    {n.fanout > 1 && <em>×{n.fanout} 并行</em>}
                  </span>
                  {p ? (
                    <>
                      <span className="pf-prov">
                        <strong>{p.name}</strong>
                        <small>{p.owner}</small>
                      </span>
                      <span className="pf-tags">
                        <TierTag tier={p.tier} />
                        {p.source === 'benchmark' && <span className="badge real">真实能力卡</span>}
                      </span>
                      <span className="pf-metrics">
                        <span style={{ color: scoreColor(qualityFor(p, n.scenario)) }}>质量 {qualityFor(p, n.scenario).toFixed(2)}</span>
                        <span>{fmtUsd(e.cost)}</span>
                        <span>{fmtTime(e.time)}</span>
                      </span>
                      {down && (
                        <span className="pf-alert">
                          <AlertTriangle size={12} /> 所选 Worker {a!.state === 'offline' ? '已离线' : '满载'}，点击换一个
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="pf-alert">
                      <AlertTriangle size={12} /> 没有可用的 Worker
                    </span>
                  )}
                  {!locked && (
                    <span className="pf-swap">
                      <ArrowLeftRight size={12} /> 替换
                    </span>
                  )}
                  {pr > 0 && (
                    <span className="pf-progress">
                      <i style={{ width: `${Math.min(100, pr * 100)}%` }} />
                      {n.fanout > 1 && pr < 1 && <small>{Math.floor(pr * n.fanout)}/{n.fanout}</small>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
