import './report.css';
import data from './data/pdf-benchmark.json';

const $ = (sel) => document.querySelector(sel);
const SCN = data.scenarios;
const SCN_KEYS = Object.keys(SCN);
const tools = data.tools;
const fmt = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
const pct = (v) => `${Math.round(v * 100)}%`;
const usd = (v) => {
  if (v == null) return '—';
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  if (v >= 0.0001) return `$${v.toFixed(5)}`;
  return `$${v.toExponential(1)}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ---------------- tooltip ---------------- */
const tip = $('#tip');
function showTip(e, html) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const pad = 14;
  const { innerWidth: W, innerHeight: H } = window;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + r.width > W - 8) x = e.clientX - r.width - pad;
  if (y + r.height > H - 8) y = e.clientY - r.height - pad;
  tip.style.transform = `translate(${x}px, ${y}px)`;
}
const hideTip = () => tip.classList.remove('on');
function hover(el, html) {
  el.addEventListener('pointermove', (e) => showTip(e, typeof html === 'function' ? html() : html));
  el.addEventListener('pointerleave', hideTip);
}

/* ---------------- sequential ramp (single hue, dark surface) ---------------- */
const RAMP = ['#151c2e', '#173058', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];
function seq(v) {
  const t = Math.max(0, Math.min(1, v)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t));
  const f = t - i;
  const a = RAMP[i].match(/\w\w/g).map((h) => parseInt(h, 16));
  const b = RAMP[i + 1].match(/\w\w/g).map((h) => parseInt(h, 16));
  return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * f)).join(',')})`;
}

/* ---------------- svg helpers ---------------- */
const NS = 'http://www.w3.org/2000/svg';
function svg(w, h, label) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', label);
  return s;
}
function el(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (text != null) n.textContent = text;
  return n;
}

/* ---------------- derived numbers ---------------- */
const hybrid = tools.find((t) => t.name === 'tagora-hybrid');
const others = tools.filter((t) => t !== hybrid);
const scanZero = tools.filter((t) => t.by_scenario.scanned === 0).length;
const R = data.sim.routing;
const saving = 1 - R.effective.usd_per_verified_result / R.best_overall.usd_per_verified_result;
const bestSingle = others[0];

/* ---------------- page ---------------- */
$('#report').innerHTML = `
<section class="r-hero">
  <p class="eyebrow">PDF 解析 · 隐藏题库 ${data.suite.version} · ${data.generated}</p>
  <h1>只有 <span class="grad">1</span> 个工具在全部场景通过</h1>
  <p class="r-lead">
    9 个工具、${data.suite.cases} 份它们从未见过的文档。${scanZero} 个工具在扫描件上得 0 分；内容流被打乱的双栏文档让多数工具读乱顺序。
    表现最好的单一开源工具是 <b>${bestSingle.name}</b>（总分 ${fmt(bestSingle.overall)}，通过率 ${pct(bestSingle.success_rate)}）；
    针对这些缺口调参后的组合实现 <b>tagora-hybrid</b> 达到 ${fmt(hybrid.overall, 3)}，通过率 ${pct(hybrid.success_rate)}。
  </p>
  <div class="r-tiles">
    <div><b>${tools.length}</b><span>个开源工具</span></div>
    <div><b>${data.suite.cases}</b><span>份隐藏文档 + 7 份边界/对抗样本</span></div>
    <div><b>${scanZero}/${tools.length}</b><span>扫描件得 0 分</span></div>
    <div><b>省 ${Math.round(saving * 100)}%</b><span>有效价格路由 vs 永远选最高分</span></div>
  </div>
</section>

<section class="r-sec">
  <h2>实测得分：工具 × 场景</h2>
  <p class="r-note">每格是该场景下所有隐藏文档的平均得分（0–1）。“通过”指单份文档得分 ≥ ${data.suite.pass_threshold}。悬停查看细节。</p>
  <div class="heat-wrap"><div class="heat" id="heat"></div></div>
  <div class="ramp-key"><span>0</span><i></i><span>1</span><small>得分</small></div>
</section>

<section class="r-sec">
  <h2>README 说的 vs 能力卡测到的</h2>
  <p class="r-note">左边是项目对自己的描述（意译），右边是验证器记录的失败场景。</p>
  <div class="claims" id="claims"></div>
</section>

<section class="r-sec">
  <h2>调参：两处改动把扫描件从 0.52 拉到 0.998</h2>
  <p class="r-lead sm">
    v0.1 在公开集上暴露两个问题：RapidOCR 的检测器把行距紧的相邻两行合成一个框，只识别出一行；以及内容流被打乱时，按流顺序读取会把段落读乱。
    v0.2 改为“投影法纠偏 → 按行切分 → 只调用识别模型”，并按版面分栏排序文本块。调参只用了 10 份公开文档；隐藏集上的结果说明没有过拟合。
  </p>
  <div class="legend" id="tune-legend"></div>
  <div id="tune"></div>
</section>

<section class="r-sec two">
  <div>
    <h2>路由策略：每个验证结果花多少钱</h2>
    <p class="r-note">路由器只看公开集估计的成功率，结果按隐藏集真实发生。每个请求最多尝试 3 个 Worker，失败也要付费。</p>
    <div id="route-cost"></div>
  </div>
  <div>
    <h2>以及最终通过率</h2>
    <p class="r-note">“最便宜优先”省下的标价，被失败重试吃掉，通过率也最低。</p>
    <div id="route-ok"></div>
  </div>
</section>

<section class="r-sec">
  <h2>按结果收费：平台需要多少承保利润</h2>
  <p class="r-note">调用方只为通过验收的结果付费，失败的成本由平台承担。对 ${data.sim.underwriting.requests} 个请求做 2,000 次自助重采样，计算平台亏损的概率。</p>
  <div id="margin"></div>
  <p class="r-note">建议利润率 <b>${pct(data.sim.underwriting.recommended_margin)}</b>（亏损概率低于 5% 的最小值）。样本只有 ${data.sim.underwriting.requests} 个请求，流量增大后这个数字会下降。</p>
</section>

<section class="r-sec">
  <h2>算力成本只占价格的一小部分</h2>
  <p class="r-note">每份文档的 CPU 成本按 ${esc(data.hardware.price_source)} 换算，横轴为对数刻度。标价是演示用的作者定价，用来说明价差的量级。</p>
  <div class="legend" id="cost-legend"></div>
  <div id="cost"></div>
</section>

<section class="r-sec">
  <h2>先验校准</h2>
  <p class="r-note">路由器用 Beta 先验平滑小样本成功率。用公开集估计、在隐藏集上计算对数损失：</p>
  <table class="r-table">
    <thead><tr><th>先验 (a, b)</th><th>对数损失 ↓</th><th>Brier ↓</th></tr></thead>
    <tbody>
      ${[
        ['最优 ' + `(${data.sim.calibration.best.a}, ${data.sim.calibration.best.b})`, data.sim.calibration.best],
        ['Laplace (1, 1)', data.sim.calibration.laplace],
        ['不平滑 (0, 0)', data.sim.calibration.mle_no_prior],
      ]
        .map(([k, r]) => `<tr><td>${k}</td><td>${fmt(r.log_loss, 3)}</td><td>${fmt(r.brier, 3)}</td></tr>`)
        .join('')}
    </tbody>
  </table>
  <p class="r-note">PDF 工具在同一场景下的表现接近确定性，所以弱先验更好。上线使用 (0.1, 0.1)：没有数据的新工具从 0.5 起步，而不是“确定成功”。</p>
</section>

<section class="r-sec method">
  <h2>方法与局限</h2>
  <ul>
    <li><b>语料</b>：全部由程序生成，真值精确已知（段落、顺序、表格单元格）。场景包括单栏英文、双栏（一半文档打乱内容流顺序但保持版面）、带边框与无边框表格、中文、带轻微倾斜的扫描件。</li>
    <li><b>隐藏题库</b>：由验证主机上的私有种子生成，从不公开。公开仓库只含 10 份样例文档，任何人都能复现评分方法，但无法针对考题调参。</li>
    <li><b>评分</b>：文本用归一化编辑距离；双栏另加段落顺序（最长递增子序列）；表格用单元格级 F1 加内容召回。</li>
    <li><b>沙箱</b>：每份文档在独立子进程中运行，Python 审计钩子拦截出网、子进程与越权写文件。9 个工具均未出现出网行为。</li>
    <li><b>局限</b>：语料是合成的，真实文档更脏；CPU 时间在 Apple M3 Max 上测得并按云端价格换算；作者标价为演示值；可信档（TEE）为模拟。</li>
    <li><b>复现</b>：<code>platform/benchmarks/pdf/run.py --split public</code>，代码与能力卡见 <a href="https://github.com/AdamLeopold/tagora">GitHub</a>。</li>
  </ul>
</section>
`;

/* ---------------- heatmap ---------------- */
(function heatmap() {
  const cols = [
    ...SCN_KEYS.map((k) => ({ key: k, label: SCN[k], get: (t) => t.by_scenario[k], kind: 'score' })),
    { key: 'robust', label: '边界鲁棒', get: (t) => t.robustness, kind: 'score' },
    { key: 'overall', label: '总分', get: (t) => t.overall, kind: 'score', strong: true },
    { key: 'pass', label: '通过率', get: (t) => t.success_rate, kind: 'pct', strong: true },
  ];
  const host = $('#heat');
  host.style.setProperty('--cols', cols.length);
  host.innerHTML = `<div class="hh corner">工具</div>${cols.map((c) => `<div class="hh${c.strong ? ' strong' : ''}">${c.label}</div>`).join('')}`;
  tools.forEach((t) => {
    const name = document.createElement('div');
    name.className = `hn${t === hybrid ? ' mine' : ''}`;
    name.innerHTML = `<b>${esc(t.name)}</b><small>${esc(t.author)} · ${esc(t.license)}</small>`;
    host.appendChild(name);
    cols.forEach((c) => {
      const v = c.get(t);
      const cell = document.createElement('div');
      cell.className = `hc${c.strong ? ' strong' : ''}`;
      cell.style.background = seq(v);
      cell.style.color = v > 0.62 ? '#05070d' : '#e8ecf5';
      cell.textContent = c.kind === 'pct' ? pct(v) : fmt(v);
      hover(cell, () => {
        let extra = '';
        if (c.key === 'robust') extra = t.edges.map((e) => `${e.pass ? '✓' : '✕'} ${esc(e.name)}`).join('<br/>');
        else if (c.key === 'overall') extra = `0.8 × 场景均分 + 0.2 × 鲁棒性<br/>CPU ${fmt(t.cpu_mean_s, 2)} s/份 · 每份算力 ${usd(t.compute_usd_per_case)}`;
        else if (c.key === 'pass') extra = `${Math.round(v * t.cases)} / ${t.cases} 份文档得分 ≥ ${data.suite.pass_threshold}`;
        else extra = `${SCN[c.key]}场景平均得分`;
        return `<b>${esc(t.name)}</b> · ${c.label}<div class="tv">${c.kind === 'pct' ? pct(v) : fmt(v, 3)}</div><div class="td">${extra}</div>`;
      });
      host.appendChild(cell);
    });
  });
})();

/* ---------------- claims ---------------- */
$('#claims').innerHTML = tools
  .map(
    (t) => `<div class="claim-row">
      <div class="cl-name"><a href="${esc(t.upstream)}" target="_blank" rel="noopener">${esc(t.name)}</a><small>${fmt(t.overall)} · 通过 ${pct(t.success_rate)}</small></div>
      <p class="cl-said">“${esc(t.claim)}”</p>
      <p class="cl-meas">${t.known_failures.length ? t.known_failures.map((f) => `<span>${esc(f)}</span>`).join('') : '<em>未记录失败场景</em>'}${
        t.license_warnings.length ? `<span class="lic">AGPL：托管须提供源码</span>` : ''
      }</p>
    </div>`,
  )
  .join('');

/* ---------------- tuning dumbbell ---------------- */
(function tuning() {
  const S = [
    { key: 'v01_public', label: 'v0.1 · 公开集', color: 'var(--s2)' },
    { key: 'v02_public', label: 'v0.2 · 公开集', color: 'var(--s1)' },
    { key: 'v02_hidden', label: 'v0.2 · 隐藏集', color: 'var(--s3)', ring: true },
  ];
  $('#tune-legend').innerHTML = S.map((s) => `<span><i style="background:${s.color}${s.ring ? ';border-radius:50%' : ''}"></i>${s.label}</span>`).join('');
  const W = 760;
  const rowH = 46;
  const L = 120;
  const Rr = 40;
  const H = SCN_KEYS.length * rowH + 50;
  const s = svg(W, H, 'tagora-hybrid 调参前后各场景得分');
  const x = (v) => L + v * (W - L - Rr);
  for (let i = 0; i <= 4; i++) {
    const v = i / 4;
    s.append(el('line', { x1: x(v), x2: x(v), y1: 10, y2: H - 34, class: 'grid' }));
    s.append(el('text', { x: x(v), y: H - 14, class: 'tick', 'text-anchor': 'middle' }, v.toFixed(2)));
  }
  SCN_KEYS.forEach((k, i) => {
    const y = 30 + i * rowH;
    const vals = S.map((ser) => data.tuning[ser.key][k]);
    s.append(el('text', { x: L - 14, y: y + 4, class: 'lab', 'text-anchor': 'end' }, SCN[k]));
    s.append(el('line', { x1: x(Math.min(...vals)), x2: x(Math.max(...vals)), y1: y, y2: y, class: 'stem' }));
    S.forEach((ser, j) => {
      const v = vals[j];
      const dot = ser.ring
        ? el('circle', { cx: x(v), cy: y, r: 7, fill: 'none', stroke: ser.color, 'stroke-width': 2.5 })
        : el('circle', { cx: x(v), cy: y, r: 6, fill: ser.color, stroke: 'var(--surface)', 'stroke-width': 2 });
      s.append(dot);
      const hit = el('circle', { cx: x(v), cy: y, r: 14, fill: 'transparent' });
      hover(hit, `<b>${SCN[k]}</b> · ${ser.label}<div class="tv">${fmt(v, 3)}</div>`);
      s.append(hit);
    });
    if (vals[1] - vals[0] > 0.1) s.append(el('text', { x: x(vals[1]) + 14, y: y - 10, class: 'delta' }, `+${fmt(vals[1] - vals[0])}`));
  });
  $('#tune').append(s);
})();

/* ---------------- routing bars ---------------- */
const STRAT = { effective: '有效价格路由', best_overall: '永远选最高分', cheapest: '最便宜优先', random: '随机' };
function bars(host, key, fmtv, label, max) {
  const items = Object.entries(STRAT).map(([k, name]) => ({ k, name, v: R[k][key] }));
  const W = 440;
  const rowH = 40;
  const L = 150;
  const H = items.length * rowH + 16;
  const s = svg(W, H, label);
  const top = max ?? Math.max(...items.map((i) => i.v)) * 1.18;
  const x = (v) => (v / top) * (W - L - 70);
  items.forEach((it, i) => {
    const y = 8 + i * rowH;
    s.append(el('text', { x: L - 12, y: y + 16, class: 'lab', 'text-anchor': 'end' }, it.name));
    const w = Math.max(4, x(it.v));
    s.append(el('path', { d: `M${L} ${y + 4}h${w - 4}a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-${w - 4}z`, fill: it.k === 'effective' ? 'var(--s1)' : 'var(--muted-bar)' }));
    s.append(el('text', { x: L + w + 8, y: y + 16, class: 'val' }, fmtv(it.v)));
    const hit = el('rect', { x: 0, y, width: W, height: rowH - 4, fill: 'transparent' });
    hover(hit, `<b>${it.name}</b><div class="tv">${fmtv(it.v)}</div><div class="td">通过率 ${pct(R[it.k].success_rate)} · 平均尝试 ${R[it.k].attempts_per_request} 次 · 总花费 ${usd(R[it.k].spend_usd)}</div>`);
    s.append(hit);
  });
  $(host).append(s);
}
bars('#route-cost', 'usd_per_verified_result', (v) => usd(v), '各路由策略每个验证结果的成本');
bars('#route-ok', 'success_rate', (v) => pct(v), '各路由策略的通过率', 1.25);

/* ---------------- margin line ---------------- */
(function margin() {
  const pts = data.sim.underwriting.margins;
  const W = 760;
  const H = 260;
  const L = 56;
  const Rr = 24;
  const T = 16;
  const B = 40;
  const xMax = Math.max(...pts.map((p) => p.margin));
  const yMax = 0.6;
  const x = (v) => L + (v / xMax) * (W - L - Rr);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const s = svg(W, H, '承保利润率与平台亏损概率');
  [0, 0.2, 0.4, 0.6].forEach((v) => {
    s.append(el('line', { x1: L, x2: W - Rr, y1: y(v), y2: y(v), class: 'grid' }));
    s.append(el('text', { x: L - 10, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, pct(v)));
  });
  pts.forEach((p) => s.append(el('text', { x: x(p.margin), y: H - 16, class: 'tick', 'text-anchor': 'middle' }, pct(p.margin))));
  s.append(el('line', { x1: L, x2: W - Rr, y1: y(0.05), y2: y(0.05), class: 'ref' }));
  s.append(el('text', { x: W - Rr, y: y(0.05) - 8, class: 'ref-lab', 'text-anchor': 'end' }, '5% 亏损概率线'));
  s.append(el('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.margin)} ${y(p.p_loss)}`).join(''), class: 'line', stroke: 'var(--s1)' }));
  const rec = data.sim.underwriting.recommended_margin;
  pts.forEach((p) => {
    s.append(el('circle', { cx: x(p.margin), cy: y(p.p_loss), r: p.margin === rec ? 7 : 4.5, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
    const hit = el('rect', { x: x(p.margin) - 22, y: T, width: 44, height: H - T - B, fill: 'transparent' });
    hover(hit, `<b>利润率 ${pct(p.margin)}</b><div class="tv">亏损概率 ${pct(p.p_loss)}</div><div class="td">样本利润 ${usd(p.profit_usd)} / 收入 ${usd(p.revenue_usd)}</div>`);
    s.append(hit);
  });
  s.append(el('text', { x: x(rec) + 12, y: y(pts.find((p) => p.margin === rec).p_loss) - 10, class: 'delta' }, `建议 ${pct(rec)}`));
  $('#margin').append(s);
})();

/* ---------------- compute vs price (log scale) ---------------- */
(function cost() {
  $('#cost-legend').innerHTML = `<span><i style="background:var(--s2)"></i>每份文档的算力成本</span><span><i style="background:var(--s1)"></i>作者标价（演示）</span>`;
  const rows = [...tools].sort((a, b) => a.compute_usd_per_case - b.compute_usd_per_case);
  const W = 760;
  const rowH = 36;
  const L = 130;
  const Rr = 70;
  const H = rows.length * rowH + 44;
  const lo = -6.5;
  const hi = -2;
  const x = (v) => L + ((Math.log10(v) - lo) / (hi - lo)) * (W - L - Rr);
  const s = svg(W, H, '每份文档算力成本与标价对比（对数刻度）');
  for (let e = -6; e <= -2; e++) {
    s.append(el('line', { x1: x(10 ** e), x2: x(10 ** e), y1: 6, y2: H - 34, class: 'grid' }));
    s.append(el('text', { x: x(10 ** e), y: H - 14, class: 'tick', 'text-anchor': 'middle' }, `$1e${e}`));
  }
  rows.forEach((t, i) => {
    const y = 20 + i * rowH;
    const a = x(t.compute_usd_per_case);
    const b = x(t.price_usd);
    s.append(el('text', { x: L - 12, y: y + 4, class: 'lab', 'text-anchor': 'end' }, t.name));
    s.append(el('line', { x1: a, x2: b, y1: y, y2: y, class: 'stem' }));
    s.append(el('circle', { cx: a, cy: y, r: 6, fill: 'var(--s2)', stroke: 'var(--surface)', 'stroke-width': 2 }));
    s.append(el('circle', { cx: b, cy: y, r: 6, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
    s.append(el('text', { x: W - Rr + 14, y: y + 4, class: 'val' }, `×${Math.round(t.price_usd / t.compute_usd_per_case)}`));
    const hit = el('rect', { x: 0, y: y - rowH / 2, width: W, height: rowH, fill: 'transparent' });
    hover(hit, `<b>${esc(t.name)}</b><div class="td">算力 ${usd(t.compute_usd_per_case)} / 份（CPU ${fmt(t.cpu_mean_s, 2)} s）<br/>标价 ${usd(t.price_usd)} / 份<br/>每个验证结果的算力 ${usd(t.compute_usd_per_verified)}</div>`);
    s.append(hit);
  });
  $('#cost').append(s);
})();
