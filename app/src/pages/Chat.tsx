import { ArrowUp, Bot, Crown, Gauge, History, PiggyBank, Play, RotateCcw, Scale, Sparkles, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import PlanFlow from '../components/PlanFlow';
import ReplaceDrawer from '../components/ReplaceDrawer';
import { buildCatalog, sampleAvailability, STEPS } from '../lib/catalog';
import {
  PERSONAS,
  autoSelect,
  estimate,
  fmtTime,
  fmtUsd,
  followUpPersona,
  parseIntent,
  rankCandidates,
  weightsFor,
  type PersonaId,
  type Plan,
  type Prefs,
} from '../lib/planner';
import { useStore } from '../lib/store';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  planId?: string;
}

const EXAMPLES = [
  '把这 120 份扫描版病历 PDF 脱敏后提取化验数据，做统计、画趋势图，写一份中文总结报告',
  '检索最近关于 KRAS 抑制剂的论文，翻译摘要并写成综述',
  '分析 30 条肿瘤测序 FASTA 的 GC 含量，并给 8 个候选抗体算分子量',
  '对 200 位患者的检查指标做恶性风险打分，数据不能外泄',
];

const PERSONA_ICONS = { auto: History, price: PiggyBank, speed: Gauge, balanced: Scale, rich: Crown } as const;

export default function Chat() {
  const store = useStore();
  const { state } = store;
  const persona: PersonaId = (state.me.persona as PersonaId) ?? 'auto';
  const prefs: Prefs = (state.me.prefs as Prefs) ?? { q: 0, c: 0, t: 0, n: 0 };
  const catalog = useMemo(() => buildCatalog(state.tools), [state.tools]);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const [tick, setTick] = useState(0);
  const avail = useMemo(() => sampleAvailability(catalog, tick), [catalog, tick]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [input, setInput] = useState('');
  const [drawer, setDrawer] = useState<{ planId: string; nodeId: string } | null>(null);
  const [run, setRun] = useState<{ planId: string; progress: Record<string, number>; done: boolean; actual?: number; error?: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const w = weightsFor(persona, prefs);
  const personaLabel = persona === 'auto' ? '根据历史偏好' : PERSONAS[persona].label;
  const online = Object.values(avail).filter((a) => a.state === 'online').length;
  const latestPlanId = [...msgs].reverse().find((m) => m.planId)?.planId;

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs.length]);

  function summary(plan: Plan, label: string) {
    const est = estimate(plan, catalog, avail);
    const par = new Set(plan.nodes.filter((n) => plan.nodes.filter((m) => m.level === n.level).length > 1).map((n) => n.level)).size;
    const fan = plan.nodes.filter((n) => n.fanout > 1).map((n) => `${n.label}×${n.fanout}`);
    return (
      `拆成 ${plan.nodes.length} 步${par ? `，其中 ${par} 层可以同时进行` : ''}${fan.length ? `；${fan.join('、')} 会分发给多个 Worker 并行` : ''}。` +
      `按「${label}」偏好选了方案：预计 ${fmtUsd(est.cost)}，约 ${fmtTime(est.time)}。点任意一步可以换 Worker。`
    );
  }

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput('');
    const p = followUpPersona(t);
    if (p && latestPlanId) {
      store.setMe({ persona: p });
      const before = estimate(plans[latestPlanId], catalog, avail).cost;
      const next = autoSelect(plans[latestPlanId], catalog, weightsFor(p, prefs), avail);
      setPlans((ps) => ({ ...ps, [latestPlanId]: next }));
      const after = estimate(next, catalog, avail).cost;
      setMsgs((m) => [...m, { role: 'user', text: t }, { role: 'assistant', text: `已切换到「${PERSONAS[p as Exclude<PersonaId, 'auto'>].label}」并重新选了 Worker：${fmtUsd(before)} → ${fmtUsd(after)}。` }]);
      return;
    }
    const plan = autoSelect(parseIntent(t), catalog, w, avail);
    setPlans((ps) => ({ ...ps, [plan.id]: plan }));
    setMsgs((m) => [...m, { role: 'user', text: t }, { role: 'assistant', text: summary(plan, personaLabel), planId: plan.id }]);
  }

  function setPersona(p: PersonaId) {
    store.setMe({ persona: p });
    if (latestPlanId && !(run && run.planId === latestPlanId)) {
      setPlans((ps) => ({ ...ps, [latestPlanId]: autoSelect(ps[latestPlanId], catalog, weightsFor(p, prefs), avail) }));
    }
  }

  function pick(planId: string, nodeId: string, providerId: string) {
    const plan = plans[planId];
    const node = plan.nodes.find((n) => n.id === nodeId)!;
    const cands = rankCandidates(node, catalog, plan.sensitive, w, avail);
    const old = cands.find((c) => c.provider.id === node.providerId);
    const neu = cands.find((c) => c.provider.id === providerId);
    if (old && neu && old !== neu) {
      // learn the user's taste from what they move toward
      store.setMe({
        prefs: {
          q: prefs.q + (neu.quality > old.quality + 0.01 ? 1 : 0),
          c: prefs.c + (neu.cost < old.cost * 0.97 ? 1 : 0),
          t: prefs.t + (neu.time < old.time * 0.97 ? 1 : 0),
          n: prefs.n + 1,
        },
      });
    }
    setPlans((ps) => ({ ...ps, [planId]: { ...plan, nodes: plan.nodes.map((n) => (n.id === nodeId ? { ...n, providerId } : n)) } }));
    setDrawer(null);
  }

  async function execute(planId: string) {
    const plan = plans[planId];
    const est = estimate(plan, catalog, avail);
    if (plan.nodes.some((n) => !n.providerId)) return;
    if (state.wallet.balance < est.cost) {
      setRun({ planId, progress: {}, done: true, error: '钱包余额不足' });
      return;
    }
    const levels = [...new Set(plan.nodes.map((n) => n.level))].sort((a, b) => a - b);
    const levelTime = levels.map((lv) => Math.max(...plan.nodes.filter((n) => n.level === lv).map((n) => est.perNode[n.id].time), 0.1));
    const totalMs = Math.min(9000, Math.max(3500, levels.length * 900));
    const share = levelTime.map((t) => Math.max(0.12, t / levelTime.reduce((a, b) => a + b, 0)));
    const norm = share.reduce((a, b) => a + b, 0);
    const progress: Record<string, number> = {};
    setRun({ planId, progress: { ...progress }, done: false });
    for (const [i, lv] of levels.entries()) {
      const dur = (share[i] / norm) * totalMs;
      const nodes = plan.nodes.filter((n) => n.level === lv);
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const f = Math.min(1, (performance.now() - t0) / dur);
          nodes.forEach((n, k) => (progress[n.id] = Math.min(1, f * (1 + k * 0.08))));
          setRun({ planId, progress: { ...progress }, done: false });
          if (f >= 1) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }
    let actual = 0;
    for (const n of plan.nodes) {
      const p = byId.get(n.providerId!)!;
      const c = est.perNode[n.id].cost * (0.85 + Math.random() * 0.2);
      actual += c;
      await store.appendBlock('call', {
        tool: p.name,
        plan: planId.slice(0, 8),
        step: STEPS[n.step].label,
        units: n.fanout * n.units,
        price: +c.toFixed(6),
        split: { author: +(c * 0.35).toFixed(6), compute: +(c * 0.55).toFixed(6), platform: +(c * 0.1).toFixed(6) },
      });
    }
    store.wallet({ balance: -actual, spent: actual });
    setRun({ planId, progress: { ...progress }, done: true, actual });
    setMsgs((m) => [
      ...m,
      {
        role: 'assistant',
        text: `执行完成（模拟）：${plan.nodes.length} 个 Worker 已结算，实付 ${fmtUsd(actual)}，预估 ${fmtUsd(est.cost)}。每一步都在链上账本留了一条记录，只含 Worker、步骤、金额与分账，不含任何数据。`,
      },
    ]);
  }

  const drawerPlan = drawer ? plans[drawer.planId] : null;
  const drawerNode = drawerPlan?.nodes.find((n) => n.id === drawer!.nodeId);

  return (
    <div className={`chat ${msgs.length ? '' : 'empty'}`}>
      <div className="persona-bar">
        {(['auto', 'price', 'speed', 'balanced', 'rich'] as PersonaId[]).map((p) => {
          const Icon = PERSONA_ICONS[p];
          const label = p === 'auto' ? '根据历史' : PERSONAS[p].label;
          const hint = p === 'auto' ? (prefs.n ? `学习自你最近 ${prefs.n} 次替换` : '还没有历史，先按平衡') : PERSONAS[p].hint;
          return (
            <button type="button" key={p} className={persona === p ? 'on' : ''} onClick={() => setPersona(p)} title={hint}>
              <Icon size={14} /> {label}
            </button>
          );
        })}
        <span className="live-count">
          <i /> 在线 Worker {online}/{catalog.length}
        </span>
      </div>
      {persona === 'auto' && prefs.n > 0 && (
        <p className="pref-note">
          根据你最近 {prefs.n} 次替换：偏好权重 质量 {Math.round(w.q * 100)}% · 价格 {Math.round(w.c * 100)}% · 速度 {Math.round(w.t * 100)}%
        </p>
      )}

      {!msgs.length && (
        <div className="welcome">
          <div className="welcome-orb">
            <Bot size={30} />
          </div>
          <h2>想让你的孪生做什么？</h2>
          <p className="dim">说一句话，孪生把它拆成一张流程图：每一步用哪个工具或模型、谁的孪生在提供、能不能并行、要花多少钱。</p>
          <div className="examples">
            {EXAMPLES.map((e) => (
              <button type="button" key={e} onClick={() => send(e)}>
                <Sparkles size={13} /> {e}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="thread">
        {msgs.map((m, i) => {
          const plan = m.planId ? plans[m.planId] : null;
          const est = plan ? estimate(plan, catalog, avail) : null;
          const r = run && plan && run.planId === plan.id ? run : null;
          return (
            <div key={i} className={`msg ${m.role}`}>
              <span className="avatar">{m.role === 'user' ? <User size={15} /> : <Bot size={15} />}</span>
              <div className="bubble">
                <p>{m.text}</p>
                {plan && est && (
                  <div className="plan-card">
                    <div className="plan-stats">
                      <div>
                        <small>预计费用</small>
                        <b>{fmtUsd(est.cost)}</b>
                      </div>
                      <div>
                        <small>预计耗时</small>
                        <b>{fmtTime(est.time)}</b>
                      </div>
                      <div>
                        <small>端到端成功率</small>
                        <b>{Math.round(est.pAll * 1000) / 10}%</b>
                      </div>
                      <div>
                        <small>数据</small>
                        <b className={plan.sensitive ? 'sens' : ''}>{plan.sensitive ? '敏感 · 仅可信/密文' : '普通'}</b>
                      </div>
                    </div>
                    {plan.assumptions.length > 0 && <p className="assume">估算假设：{plan.assumptions.join('；')}</p>}
                    <PlanFlow
                      plan={plan}
                      est={est}
                      byId={byId}
                      avail={avail}
                      progress={r?.progress}
                      active={drawer?.planId === plan.id ? drawer.nodeId : null}
                      onPick={(nodeId) => setDrawer({ planId: plan.id, nodeId })}
                      locked={!!r}
                    />
                    <div className="plan-actions">
                      {r?.error && <span className="warnline bad">{r.error}</span>}
                      {r?.done && !r.error ? (
                        <span className="ok-line">已完成 · 实付 {fmtUsd(r.actual ?? 0)}</span>
                      ) : (
                        <>
                          <button type="button" className="btn ghost" disabled={!!r} onClick={() => setPlans((ps) => ({ ...ps, [plan.id]: autoSelect(plan, catalog, w, avail) }))}>
                            <RotateCcw size={14} /> 按偏好重选
                          </button>
                          <button type="button" className="btn primary" disabled={!!r || plan.nodes.some((n) => !n.providerId)} onClick={() => execute(plan.id)}>
                            <Play size={14} /> 确认并执行 {fmtUsd(est.cost)}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={msgs.length ? '继续描述任务，或说“便宜点”“快一点”“用最好的”' : '描述你要完成的事…'}
          rows={1}
        />
        <button type="submit" className="send" disabled={!input.trim()} aria-label="发送">
          <ArrowUp size={18} />
        </button>
      </form>
      <p className="composer-note">演示版：任务拆解由规则规划器完成，执行为模拟；PDF 解析的质量分来自真实横评，大模型等 Worker 为演示数据。</p>

      {drawerPlan && drawerNode && (
        <ReplaceDrawer
          node={drawerNode}
          candidates={rankCandidates(drawerNode, catalog, drawerPlan.sensitive, w, avail)}
          currentId={drawerNode.providerId}
          personaLabel={personaLabel}
          sensitive={drawerPlan.sensitive}
          onPick={(pid) => pick(drawerPlan.id, drawerNode.id, pid)}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
