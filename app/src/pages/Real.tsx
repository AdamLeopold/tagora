import { CheckCircle2, ExternalLink, FileUp, Loader2, Plug, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Panel, scoreColor } from '../components/ui';
import data from '../data/pdf-benchmark.json';
import { TagoraApi, type ApiTool, type Step } from '../lib/tagoraApi';

const SCN = data.scenarios as Record<string, string>;
const REPORT_URL = (import.meta.env.VITE_WEB_URL || 'http://localhost:5173/') + 'report.html';
const usd = (v: number | null) => (v == null ? '—' : v >= 0.0001 ? `$${v.toFixed(5)}` : `$${v.toExponential(1)}`);

function load(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export default function Real() {
  const [open, setOpen] = useState<string | null>(null);
  const [base, setBase] = useState(load('tagora-api', 'http://127.0.0.1:8787'));
  const [api, setApi] = useState<TagoraApi | null>(null);
  const [health, setHealth] = useState<string>('');
  const [tools, setTools] = useState<ApiTool[]>([]);
  const [sensitive, setSensitive] = useState(true);
  const [scenario, setScenario] = useState('plain');
  const [file, setFile] = useState<File | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [out, setOut] = useState<{ markdown: string; tool: string; block: number; balance: number } | null>(null);

  async function connect() {
    setErr('');
    try {
      localStorage.setItem('tagora-api', base);
    } catch {
      /* per-viewer convenience only */
    }
    const a = new TagoraApi(base.replace(/\/$/, ''));
    try {
      const h = await a.health();
      setHealth(`已连接 · ${h.tools} 个上架 Worker · 账本高度 ${h.ledger_height} · ${h.ledger_valid ? '链完整' : '链损坏'}`);
      setApi(a);
      setTools(await a.tools(sensitive));
    } catch (e) {
      setApi(null);
      setHealth('');
      setErr(`连接失败：${(e as Error).message}。先在本机启动 API（见下方命令）。`);
    }
  }

  async function run() {
    if (!api || !file) return;
    setBusy(true);
    setErr('');
    setSteps([]);
    setOut(null);
    try {
      const decision = await api.route(scenario, sensitive);
      const key = decision.picked[0];
      if (!key) throw new Error(`没有可用的 Worker：${decision.excluded.map((x) => `${x.key} ${x.reason}`).join('；')}`);
      setSteps([{ label: '按能力卡路由', detail: `${SCN[scenario]} 场景 → ${key}（有效价格 $${decision.ranked[0].effective_price_usd}）`, ok: true }]);
      const r = await api.runPdf(file, key, (s) => setSteps((ss) => [...ss, s]));
      setOut({ markdown: r.result.output?.markdown ?? r.result.error ?? '', tool: key, block: r.block, balance: await api.balance() });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="real">
      <Panel
        title="真实横评的能力卡"
        extra={
          <a className="link" href={REPORT_URL} target="_blank" rel="noopener">
            完整报告 <ExternalLink size={12} />
          </a>
        }
      >
        <p className="dim small">
          下面 {data.tools.length} 张卡不是演示数据：开源 PDF 解析工具在沙箱中跑完 {data.suite.cases} 份隐藏文档（题库 {data.suite.version}）得出。点击一行查看边界用例与成本。
        </p>
        <div className="rt">
          <div className="rt-row rt-head">
            <span>工具</span>
            {Object.values(SCN).map((s) => (
              <span key={s}>{s}</span>
            ))}
            <span>总分</span>
            <span>通过率</span>
            <span>算力/份</span>
          </div>
          {data.tools.map((t) => (
            <div key={t.name}>
              <button type="button" className={`rt-row ${open === t.name ? 'on' : ''}`} onClick={() => setOpen(open === t.name ? null : t.name)}>
                <span className="rt-name">
                  <b>{t.name}</b>
                  <small>
                    {t.author} · {t.license}
                  </small>
                </span>
                {Object.keys(SCN).map((k) => {
                  const v = (t.by_scenario as Record<string, number>)[k];
                  return (
                    <span key={k} className="rt-cell" style={{ color: scoreColor(v) }}>
                      {v.toFixed(2)}
                    </span>
                  );
                })}
                <span className="rt-cell strong" style={{ color: scoreColor(t.overall) }}>
                  {t.overall.toFixed(2)}
                </span>
                <span className="rt-cell">{Math.round(t.success_rate * 100)}%</span>
                <span className="rt-cell mono dim">{usd(t.compute_usd_per_case)}</span>
              </button>
              {open === t.name && (
                <div className="rt-detail">
                  <p>“{t.claim}”</p>
                  <ul>
                    {t.edges.map((e) => (
                      <li key={e.name} className={e.pass ? 'ok' : 'no'}>
                        {e.pass ? '✓' : '✕'} {e.name}
                      </li>
                    ))}
                  </ul>
                  <p className="mono dim small">
                    CPU {t.cpu_mean_s.toFixed(3)} s/份 · P50 {t.p50_s.toFixed(3)} s · 每个验证结果算力 {usd(t.compute_usd_per_verified)} · 出网 {t.egress ? '有' : '无'}
                    <br />
                    sha256:{t.code_hash}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={<><Plug size={16} /> 连接本机的 Tagora API</>}>
        <p className="dim small">
          在浏览器里完成整条链路：验证远程证明签名（Ed25519）→ 核对代码哈希 → X25519 协商密钥 → AES-256-GCM 加密 PDF → HTTP 402 → 用浏览器生成的钱包签名支付 → 解密结果。
        </p>
        <div className="api-row">
          <input value={base} onChange={(e) => setBase(e.target.value)} aria-label="API 地址" />
          <button type="button" className="btn primary" onClick={connect}>
            连接
          </button>
        </div>
        {health && (
          <p className="ok-line">
            <CheckCircle2 size={14} /> {health}
          </p>
        )}
        {!api && (
          <pre className="cmd">{`cd platform
uv venv --python 3.11 .venv && uv pip install --python .venv/bin/python -e ".[bench,fhe]"
.venv/bin/python -m tagora.bootstrap --split hidden --fresh
.venv/bin/uvicorn tagora.api:app --port 8787`}</pre>
        )}
        {api && (
          <>
            <div className="api-tools">
              {tools.map((t) => (
                <span key={t.key} className="api-tool">
                  <b>{t.key}</b> <i style={{ color: scoreColor(t.overall) }}>{t.overall.toFixed(2)}</i> ${t.effective_price_usd.toFixed(5)}
                </span>
              ))}
            </div>
            <div className="api-form">
              <label className="file">
                <FileUp size={16} />
                {file ? file.name : '选择一个 PDF'}
                <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              {(
                [
                  ['scanned', 'scanned.pdf', '示例：扫描件'],
                  ['multicol', 'multicol-scrambled.pdf', '示例：打乱的双栏'],
                ] as const
              ).map(([scn, fname, label]) => (
                <button
                  type="button"
                  key={fname}
                  className="sample"
                  onClick={async () => {
                    const blob = await (await fetch(`${import.meta.env.BASE_URL}samples/${fname}`)).blob();
                    setFile(new File([blob], fname, { type: 'application/pdf' }));
                    setScenario(scn);
                  }}
                >
                  {label}
                </button>
              ))}
              <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="文档类型">
                {Object.entries(SCN).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={sensitive}
                  onChange={async (e) => {
                    setSensitive(e.target.checked);
                    setTools(await api.tools(e.target.checked));
                  }}
                />
                敏感数据（仅可信档）
              </label>
              <button type="button" className="btn primary" onClick={run} disabled={!file || busy}>
                {busy ? <Loader2 size={16} className="spin" /> : null}
                加密解析
              </button>
            </div>
            <p className="dim small">Python SDK 会在本机自动识别文档类型；浏览器版请手动选择。</p>
          </>
        )}
        {steps.length > 0 && (
          <ol className="api-steps">
            {steps.map((s, i) => (
              <li key={i} className={s.ok ? 'ok' : 'no'}>
                {s.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                <div>
                  <b>{s.label}</b>
                  <small>{s.detail}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
        {err && (
          <p className="warnline bad">
            <ShieldAlert size={15} /> {err}
          </p>
        )}
        {out && (
          <div className="api-out">
            <p className="dim small">
              {out.tool} · 区块 #{out.block} · 钱包余额 ${out.balance.toFixed(6)}
            </p>
            <pre>{out.markdown.slice(0, 4000) || '（空结果）'}</pre>
          </div>
        )}
      </Panel>
    </div>
  );
}
