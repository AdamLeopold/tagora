import { AlertTriangle, ArrowRight, Code2, Search, ShieldOff, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CapabilityCardView } from '../components/CapabilityCard';
import { CatBadge, ClaimGap, Sparkline, TierBadge, fmtMs, money, scoreColor } from '../components/ui';
import { CATEGORY_LIST } from '../lib/categories';
import { useStore } from '../lib/store';
import type { CategoryId, Tool } from '../lib/types';

type Sort = 'score' | 'price' | 'speed' | 'calls';

export default function Market() {
  const { state } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CategoryId | 'all'>('all');
  const [tier, setTier] = useState<'all' | 'trusted' | 'open'>('all');
  const [sort, setSort] = useState<Sort>('score');
  const [noEgress, setNoEgress] = useState(false);
  const [sel, setSel] = useState<Tool | null>(null);

  const tools = useMemo(() => {
    const list = state.tools.filter(
      (t) =>
        (cat === 'all' || t.category === cat) &&
        (tier === 'all' || t.tier === tier) &&
        (!noEgress || t.card.security.egress.length === 0) &&
        (!q || `${t.name} ${t.author} ${t.claim.text}`.toLowerCase().includes(q.toLowerCase())),
    );
    const by: Record<Sort, (a: Tool, b: Tool) => number> = {
      score: (a, b) => b.card.overall - a.card.overall,
      price: (a, b) => a.price - b.price,
      speed: (a, b) => a.card.perf.p50 - b.card.perf.p50,
      calls: (a, b) => b.calls - a.calls,
    };
    return list.sort(by[sort]);
  }, [state.tools, q, cat, tier, sort, noEgress]);

  const gapCount = state.tools.filter((t) => t.claim.accuracy - t.card.overall > 0.15).length;
  const avg = state.tools.reduce((a, t) => a + t.card.overall, 0) / state.tools.length;
  const calls = state.tools.reduce((a, t) => a + t.calls, 0);
  const current = sel ? state.tools.find((t) => t.id === sel.id) ?? sel : null;

  return (
    <div className="market">
      <div className="stats">
        <div className="stat">
          <small>上架 Worker</small>
          <b>{state.tools.length}</b>
        </div>
        <div className="stat">
          <small>平均实测分</small>
          <b style={{ color: scoreColor(avg) }}>{avg.toFixed(2)}</b>
        </div>
        <div className="stat warnstat">
          <small>描述与实测偏差 &gt; 15 分</small>
          <b>
            {gapCount} <span>/ {state.tools.length}</span>
          </b>
        </div>
        <div className="stat">
          <small>累计调用（示例）</small>
          <b>{calls.toLocaleString('en-US')}</b>
        </div>
      </div>

      <div className="filters">
        <label className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索工具、作者、描述" />
        </label>
        <div className="chips">
          <button type="button" className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>
            全部
          </button>
          {CATEGORY_LIST.map((c) => (
            <button type="button" key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <select value={tier} onChange={(e) => setTier(e.target.value as typeof tier)} aria-label="信任档位">
          <option value="all">全部档位</option>
          <option value="trusted">仅可信档 TEE</option>
          <option value="open">仅普通档</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="排序">
          <option value="score">按实测分</option>
          <option value="price">按价格</option>
          <option value="speed">按延迟</option>
          <option value="calls">按调用量</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={noEgress} onChange={(e) => setNoEgress(e.target.checked)} />
          只看无出网
        </label>
      </div>

      <div className="grid">
        {tools.map((t) => (
          <button type="button" key={t.id} className="tile" onClick={() => setSel(t)}>
            <div className="tile-head">
              <div>
                <p className="tile-name">
                  {t.name}
                  {t.mine && <span className="mine">我的</span>}
                </p>
                <p className="tile-author">
                  {t.author} · v{t.version}
                </p>
              </div>
              <Sparkline values={t.card.trend} />
            </div>
            <div className="tile-badges">
              <CatBadge id={t.category} />
              <TierBadge tier={t.tier} />
              {t.card.security.egress.length > 0 && (
                <span className="badge danger">
                  <ShieldOff size={12} /> 出网
                </span>
              )}
            </div>
            <p className="tile-claim">“{t.claim.text}”</p>
            <ClaimGap tool={t} />
            <div className="tile-foot">
              <span>{money(t.price)}/次</span>
              <span>P50 {fmtMs(t.card.perf.p50)}</span>
              <span>{t.calls.toLocaleString('en-US')} 次调用</span>
            </div>
          </button>
        ))}
        {!tools.length && <p className="dim">没有符合条件的工具。</p>}
      </div>

      {current && (
        <div className="drawer-wrap" onClick={() => setSel(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="drawer-x" onClick={() => setSel(null)} aria-label="关闭">
              <X size={18} />
            </button>
            <div className="drawer-head">
              <CatBadge id={current.category} />
              <h2>{current.name}</h2>
              <p className="dim">
                作者 {current.author} · 算力 {current.provider}
              </p>
            </div>
            <div className="claim-box">
              <p className="cb-k">作者自述（README）</p>
              <p>“{current.claim.text}”</p>
              <p className="cb-acc">宣称准确率 {Math.round(current.claim.accuracy * 100)}%</p>
              {current.claim.accuracy - current.card.overall > 0.15 && (
                <p className="cb-warn">
                  <AlertTriangle size={14} /> 实测总分 {current.card.overall.toFixed(2)}，与宣称相差{' '}
                  {Math.round((current.claim.accuracy - current.card.overall) * 100)} 分。路由器不会参考上面这段话。
                </p>
              )}
            </div>
            <CapabilityCardView
              card={current.card}
              category={current.category}
              tier={current.tier}
              hardware={current.hardware}
              price={current.price}
              name={current.name}
              version={current.version}
            />
            <details className="source">
              <summary>
                <Code2 size={14} /> 开源代码（{current.source.split('\n').length} 行）
              </summary>
              <pre>{current.source}</pre>
            </details>
            <button type="button" className="btn primary wide" onClick={() => nav(`/run?cat=${current.category}&tool=${current.id}`)}>
              用它加密调用 <ArrowRight size={16} />
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
