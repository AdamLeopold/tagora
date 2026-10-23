import { Bot, Cpu, Lightbulb, Power, Sparkles, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CatBadge, Panel, money, scoreColor } from '../components/ui';
import { CATEGORIES, CATEGORY_LIST } from '../lib/categories';
import { SPLIT, useStore } from '../lib/store';
import { recheck } from '../lib/verify';

interface Job {
  at: string;
  tool: string;
  earned: number;
  score: number;
}

export default function Twin() {
  const store = useStore();
  const { state } = store;
  const [jobs, setJobs] = useState<Job[]>([]);
  const pending = jobs.reduce((a, j) => a + j.earned, 0);
  const sharing = state.me.computeSharing;
  const toolsRef = useRef(state.tools);
  toolsRef.current = state.tools;

  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  // While sharing is on, this device really does work: it runs L6 rechecks
  // for open-tier tools inside a sandbox, and earns the compute share.
  useEffect(() => {
    if (!sharing) return;
    let stop = false;
    const tick = async () => {
      const open = toolsRef.current.filter((t) => t.tier === 'open');
      if (!open.length || stop) return;
      const t = open[Math.floor(Math.random() * open.length)];
      const score = await recheck(t.source, t.category);
      if (stop) return;
      setJobs((js) => [{ at: new Date().toLocaleTimeString(), tool: t.name, earned: +(t.price * SPLIT.compute).toFixed(6), score }, ...js].slice(0, 40));
    };
    const id = window.setInterval(tick, 2200);
    tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [sharing]);

  async function settle() {
    if (!jobs.length) return;
    const amount = +pending.toFixed(6);
    await store.appendBlock('compute', { jobs: jobs.length, amount, device: `${cores}c` });
    store.wallet({ balance: amount, earnedCompute: amount });
    setJobs([]);
  }

  const mine = state.tools.filter((t) => t.mine);

  const ideas = useMemo(() => {
    const out: { icon: 'idea' | 'up' | 'spark'; text: string; to: string; cta: string }[] = [];
    if (!state.runs.length)
      out.push({ icon: 'spark', text: '你还没有调用过任何工具。试试把一份门诊病历加密脱敏——数据只在隔离区里解密。', to: '/run?cat=redact', cta: '去试试' });
    CATEGORY_LIST.forEach((c) => {
      const best = Math.max(0, ...state.tools.filter((t) => t.category === c.id).map((t) => t.card.overall));
      const trusted = state.tools.filter((t) => t.category === c.id && t.tier === 'trusted' && !t.card.security.egress.length).length;
      if (trusted < 2)
        out.push({
          icon: 'up',
          text: `「${c.name}」只有 ${trusted} 个可接敏感数据的 Worker，敏感任务没有交叉验证的选择。写一个可信档实现会很抢手。`,
          to: '/publish',
          cta: '发布工具',
        });
      else if (best < 0.95)
        out.push({ icon: 'up', text: `「${c.name}」市场最高分只有 ${best.toFixed(2)}。`, to: '/publish', cta: '发布工具' });
    });
    const freq: Record<string, number> = {};
    state.runs.forEach((r) => (freq[r.category] = (freq[r.category] ?? 0) + 1));
    Object.entries(freq)
      .filter(([, n]) => n >= 2)
      .forEach(([c, n]) =>
        out.push({ icon: 'idea', text: `你已经调用了 ${n} 次「${CATEGORIES[c as keyof typeof CATEGORIES].name}」。可以把它设成每天自动执行的流程。`, to: `/run?cat=${c}`, cta: '再跑一次' }),
      );
    state.bounties
      .filter((b) => b.status === 'open' && !b.mine && mine.some((t) => t.category === b.category))
      .forEach((b) => out.push({ icon: 'spark', text: `你的工具可能满足悬赏「${b.title}」（$${b.reward}）。`, to: '/bounties', cta: '去接单' }));
    return out.slice(0, 6);
  }, [state.runs, state.tools, state.bounties, mine]);

  const w = state.wallet;
  return (
    <div className="twin">
      <div className="twin-top">
        <Panel className="twin-id">
          <div className="twin-orb">
            <Bot size={34} />
          </div>
          <input className="twin-name" value={state.me.name} onChange={(e) => store.setMe({ name: e.target.value })} aria-label="孪生名称" />
          <p className="dim small">替你发现需求、雇佣 Worker，也替你接单赚钱</p>
          <div className="wallet-grid">
            <div>
              <small>余额</small>
              <b>{money(w.balance)}</b>
            </div>
            <div>
              <small>累计支出</small>
              <b>{money(w.spent)}</b>
            </div>
            <div>
              <small>作者分成</small>
              <b>{money(w.earnedAuthor)}</b>
            </div>
            <div>
              <small>算力收入</small>
              <b>{money(w.earnedCompute)}</b>
            </div>
            <div>
              <small>悬赏收入</small>
              <b>{money(w.earnedBounty, 2)}</b>
            </div>
            <div>
              <small>调用次数</small>
              <b>{state.runs.length}</b>
            </div>
          </div>
        </Panel>

        <Panel title="孪生发现的需求" className="ideas">
          {ideas.map((i) => (
            <div className="idea" key={i.text}>
              {i.icon === 'idea' ? <Lightbulb size={16} /> : i.icon === 'up' ? <Upload size={16} /> : <Sparkles size={16} />}
              <p>{i.text}</p>
              <Link className="btn ghost sm" to={i.to}>
                {i.cta}
              </Link>
            </div>
          ))}
        </Panel>
      </div>

      <div className="twin-bottom">
        <Panel
          title="出租闲置算力"
          extra={
            <button type="button" className={`btn ${sharing ? 'ghost' : 'primary'}`} onClick={() => store.setMe({ computeSharing: !sharing })}>
              <Power size={15} /> {sharing ? '停止出租' : '开始出租'}
            </button>
          }
        >
          <div className="device">
            <Cpu size={18} />
            <div>
              <b>
                这台设备：{cores} 核{mem ? ` · ${mem} GB 内存` : ''}
              </b>
              <small>浏览器无法提供硬件机密计算 → 归入普通档，只接非敏感任务</small>
            </div>
          </div>
          <p className="dim small">
            开启后，这台设备会真实地为普通档工具执行 L6 复检任务（在沙箱里跑隐藏题），每个任务赚取该工具价格的 {Math.round(SPLIT.compute * 100)}%。
          </p>
          <div className="jobs">
            {jobs.length ? (
              jobs.map((j, i) => (
                <div className="job" key={i}>
                  <span className="mono dim">{j.at}</span>
                  <span>{j.tool} 复检</span>
                  <span style={{ color: scoreColor(j.score) }}>{j.score.toFixed(2)}</span>
                  <b>+{money(j.earned, 5)}</b>
                </div>
              ))
            ) : (
              <p className="dim small">{sharing ? '等待任务…' : '尚未开启。'}</p>
            )}
          </div>
          <div className="row-end">
            <span>
              待结算 <b>{money(pending, 5)}</b>
            </span>
            <button type="button" className="btn primary" onClick={settle} disabled={!jobs.length}>
              结算上链
            </button>
          </div>
        </Panel>

        <Panel title="我发布的工具">
          {mine.length ? (
            <table className="mytools">
              <thead>
                <tr>
                  <th>工具</th>
                  <th>类别</th>
                  <th>实测</th>
                  <th>调用</th>
                  <th>分成</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>
                      <CatBadge id={t.category} />
                    </td>
                    <td style={{ color: scoreColor(t.card.overall) }}>{t.card.overall.toFixed(2)}</td>
                    <td>{t.calls}</td>
                    <td>{money(t.earnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dim">
              还没有。<Link to="/publish">发布第一个工具</Link>，每被调用一次就有 {Math.round(SPLIT.author * 100)}% 的分成。
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
