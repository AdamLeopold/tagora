import { CircleSlash, X } from 'lucide-react';
import type { Candidate } from '../lib/planner';
import { fmtTime, fmtUsd, type PlanNode } from '../lib/planner';
import { TierTag } from './PlanFlow';
import { scoreColor } from './ui';

interface Props {
  node: PlanNode;
  candidates: Candidate[];
  currentId: string | null;
  personaLabel: string;
  sensitive: boolean;
  onPick: (providerId: string) => void;
  onClose: () => void;
}

export default function ReplaceDrawer({ node, candidates, currentId, personaLabel, sensitive, onPick, onClose }: Props) {
  const current = candidates.find((c) => c.provider.id === currentId);
  const online = candidates.filter((c) => c.availability.state === 'online').length;
  const usable = candidates.filter((c) => !c.blocked);
  let rank = 0;
  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer rd" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="drawer-x" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
        <p className="rd-k">替换这一步</p>
        <h2>{node.label}</h2>
        <p className="dim small">
          按「{personaLabel}」偏好排序 · 在线 {online}/{candidates.length} · 可用 {usable.length}
          {node.fanout > 1 && ` · 本步 ${node.fanout} 路并行`}
          {sensitive && ' · 敏感数据只能用可信档或密文档'}
        </p>
        <ol className="rd-list">
          {candidates.map((c) => {
            const isCur = c.provider.id === currentId;
            const dCost = current ? c.cost - current.cost : 0;
            const dTime = current ? c.time - current.time : 0;
            if (!c.blocked) rank += 1;
            return (
              <li key={c.provider.id}>
                <button
                  type="button"
                  className={`rd-item ${isCur ? 'cur' : ''} ${c.blocked ? 'off' : ''}`}
                  disabled={!!c.blocked}
                  onClick={() => onPick(c.provider.id)}
                >
                  <span className="rd-rank">{c.blocked ? <CircleSlash size={14} /> : rank}</span>
                  <span className="rd-main">
                    <span className="rd-name">
                      <b>{c.provider.name}</b>
                      <TierTag tier={c.provider.tier} />
                      {c.provider.source === 'benchmark' && <span className="badge real">真实能力卡</span>}
                      {isCur && <span className="badge cur">当前</span>}
                    </span>
                    <span className="rd-owner">
                      <i className={`dot ${c.availability.state}`} />
                      {c.provider.owner}
                      {c.availability.state === 'online' ? ` · 空闲 ${c.availability.free}/${c.provider.slots} 路` : ''}
                    </span>
                    {c.blocked ? (
                      <span className="rd-why">{c.blocked}</span>
                    ) : (
                      <span className="rd-metrics">
                        <span style={{ color: scoreColor(c.quality) }}>质量 {c.quality.toFixed(2)}</span>
                        <span>
                          {fmtUsd(c.cost)}
                          {current && !isCur && <em className={dCost <= 0 ? 'down' : 'up'}>{dCost <= 0 ? '−' : '+'}{fmtUsd(Math.abs(dCost))}</em>}
                        </span>
                        <span>
                          {fmtTime(c.time)}
                          {current && !isCur && Math.abs(dTime) > 0.05 && <em className={dTime <= 0 ? 'down' : 'up'}>{dTime <= 0 ? '更快' : '更慢'}</em>}
                        </span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="dim small">费用已含按实测成功率折算的失败重试；“质量”来自该 Worker 在这个场景的能力卡。</p>
      </aside>
    </div>
  );
}
