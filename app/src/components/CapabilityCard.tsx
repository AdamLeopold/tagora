import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { CATEGORIES } from '../lib/categories';
import type { CapabilityCard as Card, CategoryId, Tier } from '../lib/types';
import { Hash, ScoreBar, Sparkline, TierBadge, fmtMs, scoreColor } from './ui';

export function CapabilityCardView({
  card,
  category,
  tier,
  hardware,
  price,
  name,
  version,
}: {
  card: Card;
  category: CategoryId;
  tier: Tier;
  hardware: string;
  price: number;
  name: string;
  version: string;
}) {
  const cat = CATEGORIES[category];
  const egress = card.security.egress.length > 0;
  return (
    <div className="capcard">
      <div className="cc-head">
        <div>
          <p className="cc-k">CAPABILITY CARD · {card.suiteVersion}</p>
          <p className="cc-name">
            {name} <span>v{version}</span>
          </p>
          <Hash value={card.codeHash} prefix="sha256:" />
        </div>
        <div className="cc-overall" style={{ color: scoreColor(card.overall) }}>
          <b>{card.overall.toFixed(2)}</b>
          <small>总分 · 置信度{card.confidence === 'high' ? '高' : card.confidence === 'medium' ? '中' : '低'}</small>
        </div>
      </div>

      <div className="cc-section">
        <p className="cc-label">质量（L2 隐藏题库 · 按场景）</p>
        {Object.entries(card.byScenario).map(([k, v]) => (
          <ScoreBar key={k} label={cat.scenarios[k]} value={v} />
        ))}
      </div>

      <div className="cc-grid">
        <div>
          <small>鲁棒性 L3</small>
          <b style={{ color: scoreColor(card.robustness) }}>{Math.round(card.robustness * 100)}%</b>
        </div>
        <div>
          <small>P50 延迟</small>
          <b>{fmtMs(card.perf.p50)}</b>
        </div>
        <div>
          <small>大输入</small>
          <b>{card.perf.largeMs === null ? '超时' : fmtMs(card.perf.largeMs)}</b>
        </div>
        <div>
          <small>单次价格</small>
          <b>${price.toFixed(4)}</b>
        </div>
        <div>
          <small>出网</small>
          <b style={{ color: egress ? 'var(--bad)' : 'var(--good)' }}>{egress ? `${card.security.egress.length} 次` : '无'}</b>
        </div>
        <div>
          <small>复检 L6</small>
          <b>{card.rechecks} 次</b>
        </div>
      </div>

      <div className="cc-row">
        <TierBadge tier={tier} />
        <span className="mono dim">{hardware}</span>
        <span className="cc-trend">
          <small>分数趋势</small>
          <Sparkline values={card.trend} />
        </span>
      </div>

      {card.security.staticFlags.length > 0 || egress ? (
        <div className="cc-alert bad">
          <ShieldAlert size={16} />
          <div>
            {card.security.staticFlags.map((f) => (
              <p key={f}>静态分析：{f}</p>
            ))}
            {card.security.egress.map((e) => (
              <p key={e}>运行时出网被拦截：{e}</p>
            ))}
          </div>
        </div>
      ) : (
        <div className="cc-alert good">
          <ShieldCheck size={16} />
          <p>无出网、无动态执行、对抗输入下未失控</p>
        </div>
      )}

      {card.knownFailures.length > 0 && (
        <p className="cc-fail">已知失败：{card.knownFailures.join(' · ')}</p>
      )}
      <details className="cc-edges">
        <summary>边界用例明细（{card.edges.filter((e) => e.pass).length}/{card.edges.length}）</summary>
        <ul>
          {card.edges.map((e) => (
            <li key={e.name} className={e.pass ? 'ok' : 'no'}>
              {e.pass ? '✓' : '✕'} {e.name}
              {e.note && <small>（{e.note}）</small>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
