import { CheckCircle2, Clock, Plus, Target, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CatBadge, Panel, scoreColor } from '../components/ui';
import { CATEGORIES, CATEGORY_LIST } from '../lib/categories';
import { useStore } from '../lib/store';
import type { Bounty, CategoryId, Tool } from '../lib/types';

const qualifies = (t: Tool, b: Bounty) =>
  t.category === b.category && t.card.overall >= b.minScore && (b.category !== 'redact' || t.card.security.egress.length === 0);

export default function Bounties() {
  const store = useStore();
  const { state } = store;
  const [showForm, setShowForm] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ title: '', detail: '', category: 'seq' as CategoryId, minScore: 0.9, reward: 10, days: 10 });

  const open = state.bounties.filter((b) => b.status === 'open');
  const pool = open.reduce((a, b) => a + b.reward, 0);
  const note = (id: string, m: string) => setNotes((n) => ({ ...n, [id]: m }));

  async function post() {
    if (!form.title.trim()) return;
    if (state.wallet.balance < form.reward) {
      note('form', '余额不足以托管这笔悬赏。');
      return;
    }
    const b: Bounty = {
      id: `b-${Math.random().toString(36).slice(2, 8)}`,
      title: form.title,
      detail: form.detail || '（无补充说明）',
      category: form.category,
      minScore: form.minScore,
      reward: form.reward,
      poster: state.me.name,
      mine: true,
      deadline: new Date(Date.now() + form.days * 864e5).toISOString().slice(0, 10),
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    store.wallet({ balance: -form.reward });
    await store.addBounty(b);
    setShowForm(false);
    setForm({ ...form, title: '', detail: '' });
  }

  async function claim(b: Bounty, tool: Tool) {
    if (!qualifies(tool, b)) {
      note(b.id, `${tool.name} 的能力卡总分 ${tool.card.overall.toFixed(2)}，未达到 ${b.minScore}${b.category === 'redact' && tool.card.security.egress.length ? '，且存在出网记录' : ''}。`);
      return;
    }
    store.updateBounty(b.id, { status: 'fulfilled', fulfilledBy: tool.id });
    store.wallet({ balance: b.reward, earnedBounty: b.reward });
    await store.appendBlock('bounty-paid', { bounty: b.id, tool: tool.id, codeHash: tool.codeHash, score: tool.card.overall, reward: b.reward });
    note(b.id, `验收通过：${tool.name}（${tool.card.overall.toFixed(2)}）。$${b.reward} 已从托管释放到你的钱包。`);
  }

  async function communityFill(b: Bounty) {
    const cand = state.tools.filter((t) => !t.mine && qualifies(t, b)).sort((x, y) => y.card.overall - x.card.overall)[0];
    if (!cand) {
      note(b.id, `目前市场上没有 ${CATEGORIES[b.category].name} 工具达到 ${b.minScore}。悬赏继续开放。`);
      return;
    }
    store.updateBounty(b.id, { status: 'fulfilled', fulfilledBy: cand.id });
    await store.appendBlock('bounty-paid', { bounty: b.id, tool: cand.id, codeHash: cand.codeHash, score: cand.card.overall, reward: b.reward });
    note(b.id, `${cand.author} 的 ${cand.name}（${cand.card.overall.toFixed(2)}）通过验收，托管资金已支付给对方。`);
  }

  return (
    <div className="bounties">
      <div className="stats">
        <div className="stat">
          <small>开放悬赏</small>
          <b>{open.length}</b>
        </div>
        <div className="stat">
          <small>托管奖金池</small>
          <b>${pool}</b>
        </div>
        <div className="stat">
          <small>你赚到的悬赏</small>
          <b>${state.wallet.earnedBounty}</b>
        </div>
        <button type="button" className="btn primary" onClick={() => setShowForm((s) => !s)}>
          <Plus size={16} /> 发布悬赏
        </button>
      </div>

      {showForm && (
        <Panel title="发布一个缺口需求" className="bounty-form">
          <div className="form-grid">
            <label className="span2">
              标题
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：支持分号分隔的 CSV 统计" />
            </label>
            <label className="span2">
              说明
              <input value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} placeholder="场景、数据特点、验收要求" />
            </label>
            <label>
              类别
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CategoryId })}>
                {CATEGORY_LIST.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              奖金（USD，托管）
              <input type="number" min="1" value={form.reward} onChange={(e) => setForm({ ...form, reward: Math.max(1, Number(e.target.value)) })} />
            </label>
            <label>
              验收线：能力卡总分 ≥ <b>{form.minScore.toFixed(2)}</b>
              <input type="range" min="0.5" max="1" step="0.01" value={form.minScore} onChange={(e) => setForm({ ...form, minScore: Number(e.target.value) })} />
            </label>
            <label>
              期限（天）
              <input type="number" min="1" value={form.days} onChange={(e) => setForm({ ...form, days: Math.max(1, Number(e.target.value)) })} />
            </label>
          </div>
          <div className="row-end">
            {notes.form && <span className="warnline">{notes.form}</span>}
            <button type="button" className="btn primary" onClick={post} disabled={!form.title.trim()}>
              托管 ${form.reward} 并发布
            </button>
          </div>
        </Panel>
      )}

      <div className="bounty-list">
        {state.bounties.map((b) => {
          const mineTools = state.tools.filter((t) => t.mine && t.category === b.category);
          const winner = b.fulfilledBy ? state.tools.find((t) => t.id === b.fulfilledBy) : null;
          return (
            <article key={b.id} className={`bounty ${b.status}`}>
              <div className="b-top">
                <div>
                  <h3>
                    <Target size={16} /> {b.title}
                  </h3>
                  <p className="dim small">
                    {b.poster}
                    {b.mine && <span className="mine">我发布的</span>}
                  </p>
                </div>
                <div className="b-reward">
                  <b>${b.reward}</b>
                  <small>托管中</small>
                </div>
              </div>
              <p className="b-detail">{b.detail}</p>
              <div className="b-meta">
                <CatBadge id={b.category} />
                <span>
                  验收：总分 ≥ <b style={{ color: scoreColor(b.minScore) }}>{b.minScore.toFixed(2)}</b>
                  {b.category === 'redact' && ' · 无出网'}
                </span>
                <span>
                  <Clock size={13} /> 截止 {b.deadline}
                </span>
              </div>
              {b.status === 'fulfilled' ? (
                <p className="b-done">
                  <Trophy size={15} /> 已完成：{winner ? `${winner.name}（${winner.author}，实测 ${winner.card.overall.toFixed(2)}）` : b.fulfilledBy}
                </p>
              ) : b.mine ? (
                <div className="b-actions">
                  <span className="dim small">等待其他孪生接单</span>
                  <button type="button" className="btn ghost" onClick={() => communityFill(b)}>
                    检查市场上是否有人达标
                  </button>
                </div>
              ) : (
                <div className="b-actions">
                  {mineTools.length ? (
                    mineTools.map((t) => (
                      <button type="button" key={t.id} className="btn ghost" onClick={() => claim(b, t)}>
                        <CheckCircle2 size={14} /> 用 {t.name}（{t.card.overall.toFixed(2)}）接单
                      </button>
                    ))
                  ) : (
                    <Link className="btn ghost" to="/publish">
                      写一个工具来接单 →
                    </Link>
                  )}
                </div>
              )}
              {notes[b.id] && <p className="b-note">{notes[b.id]}</p>}
            </article>
          );
        })}
      </div>
      <p className="dim small">演示中以能力卡总分作为验收标准；真实系统中悬赏会附带专门的验收题集。</p>
    </div>
  );
}
