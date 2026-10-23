import { Ban, CheckCircle2, Hammer, Link2, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Hash, Panel, ago } from '../components/ui';
import { verifyChain, useStore } from '../lib/store';
import type { Block, BlockType } from '../lib/types';

const TYPE: Record<BlockType, { label: string; cls: string }> = {
  genesis: { label: '创世', cls: 't-genesis' },
  listing: { label: '工具上架', cls: 't-listing' },
  call: { label: '调用支付', cls: 't-call' },
  'bounty-post': { label: '悬赏托管', cls: 't-bounty' },
  'bounty-paid': { label: '悬赏支付', cls: 't-bounty' },
  compute: { label: '算力结算', cls: 't-compute' },
  recheck: { label: 'L6 复检', cls: 't-recheck' },
};

function describe(b: Block) {
  const p = b.payload as any;
  switch (b.type) {
    case 'genesis':
      return '链的起点';
    case 'listing':
      return `${p.tool} 上架 · 总分 ${p.overall}`;
    case 'call':
      return `${p.tool} · $${Number(p.price).toFixed(4)} → 作者 ${p.split?.author} / 算力 ${p.split?.compute} / 平台 ${p.split?.platform}`;
    case 'bounty-post':
      return `${p.bounty} 托管 $${p.reward}`;
    case 'bounty-paid':
      return `${p.bounty} 由 ${p.tool} 完成（${p.score}）· 支付 $${p.reward}`;
    case 'compute':
      return `${p.jobs} 个算力任务 · $${Number(p.amount).toFixed(4)}`;
    case 'recheck':
      return `${p.tool} 复检得分 ${p.score}`;
  }
}

export default function Ledger() {
  const store = useStore();
  const ledger = store.state.ledger;
  const [check, setCheck] = useState<{ ok: boolean; badIndex?: number; reason?: string } | null>(null);
  const [original, setOriginal] = useState<Block[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function runCheck(l = ledger) {
    setBusy(true);
    setCheck(await verifyChain(l));
    setBusy(false);
  }

  function tamper() {
    const idx = [...ledger].reverse().find((b) => b.type === 'call' || b.type === 'listing')?.index ?? 1;
    setOriginal(ledger);
    const forged = ledger.map((b) =>
      b.index === idx ? { ...b, payload: { ...b.payload, price: 99, overall: 1, note: '被篡改：金额/分数被改写' } } : b,
    );
    store.replaceLedger(forged);
    setCheck(null);
  }

  function restore() {
    if (original) store.replaceLedger(original);
    setOriginal(null);
    setCheck(null);
  }

  const rows = [...ledger].reverse();
  const counts = ledger.reduce<Record<string, number>>((a, b) => ((a[b.type] = (a[b.type] ?? 0) + 1), a), {});

  return (
    <div className="ledger">
      <div className="stats">
        <div className="stat">
          <small>区块数</small>
          <b>{ledger.length}</b>
        </div>
        <div className="stat">
          <small>调用支付</small>
          <b>{counts.call ?? 0}</b>
        </div>
        <div className="stat">
          <small>链尖哈希</small>
          <b className="mono small">
            <Hash value={ledger.at(-1)!.hash} />
          </b>
        </div>
        <div className="ledger-actions">
          <button type="button" className="btn primary" onClick={() => runCheck()} disabled={busy}>
            <ShieldCheck size={16} /> 校验整条链
          </button>
          {original ? (
            <button type="button" className="btn ghost" onClick={restore}>
              <RotateCcw size={16} /> 恢复原始账本
            </button>
          ) : (
            <button type="button" className="btn ghost danger" onClick={tamper}>
              <Hammer size={16} /> 演示：篡改一个区块
            </button>
          )}
        </div>
      </div>

      {check && (
        <div className={`chaincheck ${check.ok ? 'ok' : 'bad'}`}>
          {check.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          {check.ok
            ? `全部 ${ledger.length} 个区块的哈希与链接都有效。`
            : `区块 #${check.badIndex} 校验失败：${check.reason}。任何人都能发现篡改。`}
        </div>
      )}

      <div className="ledger-grid">
        <div className="blocks">
          {rows.map((b) => (
            <article key={b.index} className={`block ${check && !check.ok && check.badIndex === b.index ? 'broken' : ''}`}>
              <div className="blk-idx">#{b.index}</div>
              <div className="blk-body">
                <p>
                  <span className={`tbadge ${TYPE[b.type].cls}`}>{TYPE[b.type].label}</span>
                  <span className="dim small">{ago(b.timestamp)}</span>
                </p>
                <p className="blk-desc">{describe(b)}</p>
                <div className="blk-hashes">
                  {'receiptHash' in b.payload && (
                    <span>
                      凭证 <Hash value={String(b.payload.receiptHash)} />
                    </span>
                  )}
                  {'resultHash' in b.payload && (
                    <span>
                      结果 <Hash value={String(b.payload.resultHash)} />
                    </span>
                  )}
                  {'codeHash' in b.payload && (
                    <span>
                      代码 <Hash value={String(b.payload.codeHash)} />
                    </span>
                  )}
                </div>
                <div className="blk-link">
                  <Link2 size={12} /> prev <Hash value={b.prevHash} n={6} /> · hash <Hash value={b.hash} n={6} />
                </div>
              </div>
            </article>
          ))}
        </div>
        <Panel title="这条链上永远没有" className="never">
          <ul>
            <li>
              <Ban size={14} /> 调用方的输入数据（即使是加密的）
            </li>
            <li>
              <Ban size={14} /> 输出结果本身
            </li>
            <li>
              <Ban size={14} /> 会话密钥
            </li>
            <li>
              <Ban size={14} /> 验证题库
            </li>
          </ul>
          <p className="dim small">
            结果哈希让调用方日后可以就某次结果发起争议仲裁：拿出密文，任何人都能核对它与链上记录是否一致，但看不到内容。
          </p>
          <p className="dim small">演示链保存在本机浏览器，真实系统会使用公链或联盟链。</p>
        </Panel>
      </div>
    </div>
  );
}
