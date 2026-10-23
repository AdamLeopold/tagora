import { AlertTriangle, CheckCircle2, CircleDashed, EyeOff, Loader2, Lock, Play, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CatBadge, Hash, Panel, TierBadge, money, scoreColor } from '../components/ui';
import { CATEGORIES, CATEGORY_LIST } from '../lib/categories';
import { STEPS, sealedCall, type CallResult, type StepKey, type StepState } from '../lib/execute';
import { SPLIT, useStore } from '../lib/store';
import type { CategoryId, Tool } from '../lib/types';
import { recheck } from '../lib/verify';

type Strategy = 'quality' | 'price' | 'speed';

interface Lane {
  tool: Tool;
  steps: Partial<Record<StepKey, StepState>>;
  result?: CallResult;
}

function route(tools: Tool[], cat: CategoryId, sensitive: boolean, strategy: Strategy, k: number, pinned?: string) {
  const inCat = tools.filter((t) => t.category === cat);
  const excluded: { tool: Tool; reason: string }[] = [];
  const ok = inCat.filter((t) => {
    if (sensitive && t.tier !== 'trusted') {
      excluded.push({ tool: t, reason: '普通档不接敏感数据' });
      return false;
    }
    if (sensitive && t.card.security.egress.length) {
      excluded.push({ tool: t, reason: '能力卡记录了出网行为' });
      return false;
    }
    return true;
  });
  const sorters: Record<Strategy, (a: Tool, b: Tool) => number> = {
    quality: (a, b) => b.card.overall - a.card.overall || a.price - b.price,
    price: (a, b) => a.price - b.price || b.card.overall - a.card.overall,
    speed: (a, b) => a.card.perf.p50 - b.card.perf.p50,
  };
  ok.sort(sorters[strategy]);
  if (pinned) {
    const p = ok.find((t) => t.id === pinned);
    if (p) return { picked: [p], excluded, candidates: ok };
  }
  return { picked: ok.slice(0, k), excluded, candidates: ok };
}

const StepIcon = ({ s }: { s?: StepState }) => {
  if (!s || s.status === 'pending') return <CircleDashed size={16} className="st-pending" />;
  if (s.status === 'running') return <Loader2 size={16} className="st-running spin" />;
  if (s.status === 'fail') return <XCircle size={16} className="st-fail" />;
  if (s.status === 'warn') return <AlertTriangle size={16} className="st-warn" />;
  return <CheckCircle2 size={16} className="st-done" />;
};

export default function Run() {
  const store = useStore();
  const { state } = store;
  const [params, setParams] = useSearchParams();
  const initialCat = (params.get('cat') as CategoryId) || 'redact';
  const [cat, setCat] = useState<CategoryId>(CATEGORIES[initialCat] ? initialCat : 'redact');
  const [input, setInput] = useState(CATEGORIES[cat].samples[0].input);
  const [sensitive, setSensitive] = useState(CATEGORIES[cat].samples[0].sensitive);
  const [strategy, setStrategy] = useState<Strategy>('quality');
  const [k, setK] = useState(1);
  const [tamper, setTamper] = useState(false);
  const [pinned, setPinned] = useState<string | undefined>(params.get('tool') ?? undefined);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (pinned && !state.tools.some((t) => t.id === pinned && t.category === cat)) setPinned(undefined);
  }, [cat, pinned, state.tools]);

  const plan = useMemo(() => route(state.tools, cat, sensitive, strategy, k, pinned), [state.tools, cat, sensitive, strategy, k, pinned]);
  const total = plan.picked.reduce((a, t) => a + t.price, 0);
  const catDef = CATEGORIES[cat];

  const pickCategory = (c: CategoryId) => {
    setCat(c);
    setInput(CATEGORIES[c].samples[0].input);
    setSensitive(CATEGORIES[c].samples[0].sensitive);
    setLanes([]);
    setPinned(undefined);
    setParams({});
  };

  async function go() {
    if (!plan.picked.length) return;
    if (state.wallet.balance < total) {
      setMsg('余额不足，去「我的孪生」页面结算收益或重置演示数据。');
      return;
    }
    setMsg('');
    setRunning(true);
    const init: Lane[] = plan.picked.map((tool) => ({ tool, steps: {} }));
    setLanes(init);
    const results = await Promise.all(
      plan.picked.map((tool, i) =>
        sealedCall({
          tool,
          input,
          tamper: tamper && i === 0,
          split: SPLIT,
          appendBlock: store.appendBlock,
          onStep: (key, s) =>
            setLanes((ls) => ls.map((l, j) => (j === i ? { ...l, steps: { ...l.steps, [key]: s } } : l))),
        }).then((result) => {
          setLanes((ls) => ls.map((l, j) => (j === i ? { ...l, result } : l)));
          return result;
        }),
      ),
    );

    let cost = 0;
    for (const [i, r] of results.entries()) {
      const tool = plan.picked[i];
      if (r.aborted || !r.block) continue;
      cost += tool.price;
      const authorCut = tool.price * SPLIT.author;
      store.updateTool(tool.id, { calls: tool.calls + 1, earnings: +(tool.earnings + authorCut).toFixed(6) });
      if (tool.mine) store.wallet({ balance: authorCut, earnedAuthor: authorCut });
      // L6: a share of live calls are silently rechecked against the hidden suite
      if (Math.random() < 0.35) {
        recheck(tool.source, tool.category).then(async (q) => {
          const v = Math.round((0.8 * q + 0.2 * tool.card.robustness) * 100) / 100;
          const trend = [...tool.card.trend, v].slice(-12);
          const overall = Math.round((0.7 * tool.card.overall + 0.3 * v) * 100) / 100;
          store.updateTool(tool.id, {
            card: { ...tool.card, trend, overall, rechecks: tool.card.rechecks + 1, lastRecheck: new Date().toISOString() },
          });
          await store.appendBlock('recheck', { tool: tool.id, codeHash: tool.codeHash, score: v });
        });
      }
    }
    if (cost) store.wallet({ balance: -cost, spent: cost });
    store.addRun({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      category: cat,
      toolIds: plan.picked.map((t) => t.id),
      sensitive,
      cost,
      ok: results.some((r) => r.ok),
    });
    setRunning(false);
  }

  const done = lanes.filter((l) => l.result?.ok);
  const keys = done.map((l) => catDef.agreeKey(l.result!.output));
  const agree = keys.length > 1 && keys.every((x) => x === keys[0]);

  return (
    <div className="run">
      <div className="run-left">
        <Panel title="1 · 任务">
          <div className="chips">
            {CATEGORY_LIST.map((c) => (
              <button type="button" key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => pickCategory(c.id)} disabled={running}>
                {c.name}
              </button>
            ))}
          </div>
          <p className="dim small">{catDef.desc}</p>
          <div className="samples">
            {catDef.samples.map((s) => (
              <button
                type="button"
                key={s.label}
                className="sample"
                onClick={() => {
                  setInput(s.input);
                  setSensitive(s.sensitive);
                }}
              >
                {s.sensitive ? <Lock size={12} /> : null}
                {s.label}
              </button>
            ))}
          </div>
          <textarea className="code" value={input} onChange={(e) => setInput(e.target.value)} rows={8} spellCheck={false} />
          <label className="switch">
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
            <span />
            <div>
              <b>敏感数据</b>
              <small>开启后只路由到可信档、且能力卡无出网记录的 Worker</small>
            </div>
          </label>
        </Panel>

        <Panel title="2 · 路由策略">
          <div className="seg">
            {(
              [
                ['quality', '质量优先'],
                ['price', '价格优先'],
                ['speed', '速度优先'],
              ] as const
            ).map(([v, l]) => (
              <button type="button" key={v} className={strategy === v ? 'on' : ''} onClick={() => setStrategy(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="kpick">
            <span>同时雇佣</span>
            {[1, 2, 3].map((n) => (
              <button type="button" key={n} className={k === n ? 'on' : ''} onClick={() => setK(n)} disabled={!!pinned}>
                {n}
              </button>
            ))}
            <span>个不同作者的 Worker 交叉验证</span>
          </div>
          <label className="switch danger">
            <input type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} />
            <span />
            <div>
              <b>演示：节点偷换代码</b>
              <small>第一个 Worker 的节点在上架后替换了代码，看看远程证明会发生什么</small>
            </div>
          </label>
        </Panel>
      </div>

      <div className="run-right">
        <Panel
          title="3 · 路由结果"
          extra={
            pinned ? (
              <button type="button" className="link" onClick={() => setPinned(undefined)}>
                已指定工具 · 改为自动路由
              </button>
            ) : null
          }
        >
          {plan.picked.length ? (
            <div className="picked">
              {plan.picked.map((t, i) => (
                <div className="pick" key={t.id}>
                  <span className="pick-n">{i + 1}</span>
                  <div>
                    <b>{t.name}</b>
                    <small>{t.author}</small>
                  </div>
                  <TierBadge tier={t.tier} />
                  <span className="pick-score" style={{ color: scoreColor(t.card.overall) }}>
                    {t.card.overall.toFixed(2)}
                  </span>
                  <span className="mono">{money(t.price)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="warnline">
              <ShieldAlert size={16} /> 没有满足条件的 Worker。关闭“敏感数据”或去「发布工具」上架一个可信档实现。
            </p>
          )}
          {plan.excluded.length > 0 && (
            <ul className="excluded">
              {plan.excluded.map(({ tool, reason }) => (
                <li key={tool.id}>
                  <EyeOff size={13} /> {tool.name}：{reason}
                </li>
              ))}
            </ul>
          )}
          <div className="run-cta">
            <span>
              预计费用 <b>{money(total)}</b> · 余额 {money(state.wallet.balance)}
            </span>
            <button type="button" className="btn primary" onClick={go} disabled={running || !plan.picked.length || !input}>
              {running ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
              {running ? '执行中…' : '加密执行'}
            </button>
          </div>
          {msg && <p className="warnline">{msg}</p>}
        </Panel>

        {lanes.length > 0 && (
          <div className={`lanes n${lanes.length}`}>
            {lanes.map((lane, i) => (
              <Panel
                key={lane.tool.id + i}
                className="lane"
                title={
                  <>
                    {lane.tool.name} <CatBadge id={lane.tool.category} />
                  </>
                }
              >
                <ol className="timeline">
                  {STEPS.map((s) => {
                    const st = lane.steps[s.key];
                    return (
                      <li key={s.key} className={st?.status ?? 'pending'}>
                        <StepIcon s={st} />
                        <div>
                          <b>{s.label}</b>
                          {st?.detail && <small>{st.detail}</small>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {lane.result && <ResultView lane={lane} />}
              </Panel>
            ))}
          </div>
        )}

        {done.length > 1 && (
          <div className={`agree ${agree ? 'ok' : 'no'}`}>
            {agree ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            {agree
              ? `${done.length} 个不同作者的 Worker 结果一致，可信度更高。`
              : `${done.length} 个 Worker 结果不一致：这正是交叉验证要发现的问题，请参考各自的能力卡得分。`}
          </div>
        )}

        {lanes.some((l) => l.result?.block) && (
          <Panel title="Tagora 平台视角：它看到了什么">
            <div className="povs">
              <div>
                <p className="pov-k">平台看到</p>
                <ul>
                  <li>任务类别：{catDef.name}</li>
                  <li>选中的 Worker 与能力卡</li>
                  <li>密文长度、凭证哈希、结果哈希</li>
                  <li>支付金额与分账</li>
                </ul>
              </div>
              <div>
                <p className="pov-k bad">平台看不到</p>
                <ul>
                  <li>你的输入明文</li>
                  <li>结果明文</li>
                  <li>会话密钥（只存在于你的浏览器与已销毁的隔离区）</li>
                </ul>
              </div>
            </div>
            <Link to="/ledger" className="link">
              去链上账本查看这些区块 →
            </Link>
          </Panel>
        )}
      </div>
    </div>
  );
}

function ResultView({ lane }: { lane: Lane }) {
  const r = lane.result!;
  const cat = CATEGORIES[lane.tool.category];
  if (r.aborted)
    return (
      <div className="result aborted">
        <ShieldAlert size={18} />
        <div>
          <b>调用已中止，数据没有发送</b>
          <p>{r.error}</p>
        </div>
      </div>
    );
  if (!r.block) return <div className="result aborted">执行失败：{r.error}</div>;
  const out = r.output as any;
  return (
    <div className="result">
      {r.error && <p className="warnline">工具报错：{r.error}</p>}
      {out !== undefined && (
        <>
          <dl className="kv">
            {cat.summary(out).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {lane.tool.category === 'redact' && typeof out?.text === 'string' && <pre className="redacted">{out.text}</pre>}
          <details>
            <summary>原始输出 JSON</summary>
            <pre>{JSON.stringify(out, null, 2)}</pre>
          </details>
        </>
      )}
      <div className="receipt">
        <span>
          凭证 <Hash value={r.receiptHash!} />
        </span>
        <span>
          结果 <Hash value={r.resultHash!} />
        </span>
        <span>区块 #{r.block.index}</span>
      </div>
    </div>
  );
}
