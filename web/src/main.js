import './style.css';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { initHero } from './scenes/hero.js';
import { initVerify } from './scenes/verify.js';
import { initEnclave, STEP_COUNT } from './scenes/enclave.js';
import { initSwarm } from './scenes/swarm.js';

gsap.registerPlugin(ScrollTrigger);

const APP_URL = import.meta.env.VITE_APP_URL || 'http://localhost:5174';
document.querySelectorAll('[data-app-link]').forEach((a) => {
  a.href = APP_URL;
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- smooth scroll ---------- */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.6 });
    else target.scrollIntoView();
  });
});

/* ---------- nav: hide on scroll down, highlight current section ---------- */
const nav = document.getElementById('nav');
let lastY = 0;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  nav.classList.toggle('hide', y > lastY && y > 400);
  lastY = y;
});
const navLinks = [...document.querySelectorAll('.nav-links a')];
navLinks.forEach((link) => {
  const sec = document.querySelector(link.getAttribute('href'));
  if (!sec) return;
  ScrollTrigger.create({
    trigger: sec,
    start: 'top 50%',
    end: 'bottom 50%',
    onToggle: (self) => self.isActive && navLinks.forEach((l) => l.classList.toggle('active', l === link)),
  });
});

/* ---------- cursor glow ---------- */
const glow = document.querySelector('.cursor-glow');
window.addEventListener('pointermove', (e) => {
  glow.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
});

/* ---------- 3D scenes ---------- */
initHero(document.getElementById('hero-canvas'));

function scrub(section, onProgress) {
  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => onProgress(self.progress),
    onRefresh: (self) => onProgress(self.progress),
  });
}

// verification pipeline
const verify = initVerify(document.getElementById('verify-canvas'));
const layerEls = [...document.querySelectorAll('#verify-layers li')];
const verifyBar = document.getElementById('verify-progress');
const verifyFoot = document.getElementById('verify-foot');
scrub('#verify', (p) => {
  verify.setProgress(p);
  verifyBar.style.width = `${p * 100}%`;
});
gsap.ticker.add(() => {
  const L = verify.state.layer;
  layerEls.forEach((li, i) => {
    li.classList.toggle('done', i < L);
    li.classList.toggle('current', i === L);
  });
  verifyFoot.textContent = verify.state.done
    ? '✓ 能力卡已生成 · 绑定代码哈希 × 硬件类别'
    : L < 0
      ? '一个声称 “SOTA · 99%” 的工具进入检测…'
      : `正在执行 L${L + 1} …`;
});

// private execution
const enclave = initEnclave(document.getElementById('enclave-canvas'));
const stepEls = [...document.querySelectorAll('#enclave-steps li')];
const attest = document.getElementById('attest');
const attestLive = document.getElementById('attest-live');
const attestVerdict = document.getElementById('attest-verdict');
const TARGET_HASH = 'sha256:9f3c41d0…a71e';
const HEX = '0123456789abcdef';
scrub('#enclave', (p) => enclave.setProgress(p));
gsap.ticker.add(() => {
  const s = enclave.state.step;
  stepEls.forEach((li, i) => {
    li.classList.toggle('done', i < s);
    li.classList.toggle('current', i === s);
  });
  if (s < 3) {
    attestLive.textContent = 'sha256:…';
    attestVerdict.textContent = '等待远程证明…';
    attest.classList.remove('ok');
  } else if (s === 3) {
    // scramble while the attestation is in flight
    let out = 'sha256:';
    for (let i = 0; i < 8; i++) out += HEX[(Math.random() * 16) | 0];
    attestLive.textContent = `${out}…a71e`;
    attestVerdict.textContent = '收到硬件签名报告，比对中…';
    attest.classList.remove('ok');
  } else {
    attestLive.textContent = TARGET_HASH;
    attestVerdict.textContent = s >= 7 ? '✓ 已核验 · 隔离区已销毁，不留任何数据' : '✓ 哈希一致 · 密钥只发给这个隔离区';
    attest.classList.add('ok');
  }
});
void STEP_COUNT;

// swarm
const swarm = initSwarm(document.getElementById('swarm-canvas'));
const swarmCount = document.getElementById('swarm-count');
scrub('#swarm', (p) => {
  swarm.setProgress(p);
  swarmCount.textContent = swarm.state.countAt(p).toLocaleString('en-US');
});

/* ---------- text animations ---------- */
function splitChars(el) {
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        // keep latin words whole so they never wrap mid-word
        (child.textContent.match(/[A-Za-z0-9_.\-]+|\s+|./gsu) || []).forEach((ch) => {
          const span = document.createElement('span');
          span.className = 'ch';
          span.textContent = ch;
          frag.appendChild(span);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
        // gradient text must stay on the parent span to keep background-clip working
        if (child.classList.contains('grad')) {
          child.classList.remove('grad');
          child.dataset.grad = '1';
        }
        walk(child);
      }
    });
  };
  walk(el);
  el.querySelectorAll('[data-grad] .ch').forEach((c) => c.classList.add('grad'));
  return el.querySelectorAll('.ch');
}

if (!reduceMotion) {
  // hero intro
  gsap.from('[data-hero]', { y: 40, opacity: 0, filter: 'blur(10px)', duration: 1.3, ease: 'power3.out', stagger: 0.12, delay: 0.2 });

  document.querySelectorAll('[data-split]').forEach((el) => {
    const chars = splitChars(el);
    gsap.from(chars, {
      opacity: 0,
      y: 30,
      rotateX: -70,
      filter: 'blur(8px)',
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.025,
      scrollTrigger: { trigger: el, start: 'top 85%' },
    });
  });

  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    gsap.from(el, {
      y: 50,
      opacity: 0,
      duration: 1.1,
      ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%' },
    });
  });
}

// things that animate once when they come into view (bars, money flow)
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in-view');
      e.target.querySelectorAll('[data-count]').forEach((n) => {
        const to = Number(n.dataset.count);
        gsap.to({ v: 0 }, { v: to, duration: 2, ease: 'power2.out', onUpdate() { n.textContent = Math.round(this.targets()[0].v); } });
      });
      io.unobserve(e.target);
    });
  },
  { threshold: 0.3 },
);
document.querySelectorAll('.problem-card, .cap-card, .flowmoney').forEach((el) => io.observe(el));

/* ---------- capability card tilt ---------- */
const card = document.getElementById('cap-card');
card.addEventListener('pointermove', (e) => {
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  card.style.setProperty('--ry', `${(x - 0.5) * 24}deg`);
  card.style.setProperty('--rx', `${(0.5 - y) * 18}deg`);
  card.style.setProperty('--mx', `${x * 100}%`);
  card.style.setProperty('--my', `${y * 100}%`);
});
card.addEventListener('pointerleave', () => {
  card.style.setProperty('--ry', '-14deg');
  card.style.setProperty('--rx', '8deg');
});

/* ---------- architecture info panel ---------- */
const ARCH = {
  caller: ['调用方 agent', '任何 agent 都能通过 MCP 接入：Tagora 孪生、Claude Code、Codex……说出“解析这份 PDF”，剩下的交给路由器。'],
  router: ['路由器 Router', '按任务类型与数据敏感度，只依据能力卡挑选 Worker；可把一个大任务拆给多个 Worker 并行执行。敏感任务永远不会发往普通档。'],
  registry: ['注册表', '登记每个工具的版本与代码哈希。任何代码变更都会生成新版本，并自动送去重新验证。'],
  verifier: ['验证器', '六层实测生成能力卡；上架后持续抽样复检真实调用，分数随表现变化。题库隐藏且定期轮换。'],
  trusted: ['可信档 Worker', '运行在 Intel TDX / AMD SEV-SNP（可配合 H100 机密计算）的隔离区中。每次执行前出示远程证明，机器主人也读不到内存。'],
  open: ['普通档 Worker', '社区成员的闲置机器。不做隐私承诺，只接公开或非敏感数据；结果正确性靠冗余执行、抽查与质押罚没。'],
  author: ['工具作者', '提交开源代码，通过验证后上架。每被调用一次就获得分成；未入驻的开源作者，分成先进入托管池等待认领。'],
  provider: ['算力提供者', '把云端机密虚拟机或个人闲置机器接入执行层，按硬件类别生成各自的能力卡，赚取算力报酬。'],
  settle: ['结算层', 'USDC 通过 x402 类协议按次结算。链上只记录支付、执行凭证哈希与结果哈希；数据本身永不上链。'],
};
const archTitle = document.getElementById('arch-title');
const archDesc = document.getElementById('arch-desc');
const archNodes = document.querySelectorAll('.node');
archNodes.forEach((n) => {
  const show = () => {
    const [t, d] = ARCH[n.dataset.node];
    archTitle.textContent = t;
    archDesc.textContent = d;
    archNodes.forEach((m) => m.classList.toggle('active', m === n));
  };
  n.addEventListener('pointerenter', show);
  n.addEventListener('click', show);
});

/* ---------- chain blocks ---------- */
const track = document.getElementById('chain-track');
const rhex = (n) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join('');
const blocksHtml = Array.from(
  { length: 8 },
  (_, i) => `<div class="block"><b>#${10240 + i}</b>pay&nbsp;&nbsp;$0.0${(i % 7) + 2}<br/>rcpt 0x${rhex(6)}<br/>rslt 0x${rhex(6)}</div>`,
).join('');
track.innerHTML = blocksHtml + blocksHtml;

/* ---------- roadmap progress line ---------- */
gsap.to('#rm-fill', {
  width: '100%',
  ease: 'none',
  scrollTrigger: { trigger: '#roadmap-track', start: 'top 75%', end: 'bottom 55%', scrub: true },
});

/* ---------- waitlist (local only) ---------- */
document.getElementById('waitlist').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const email = form.querySelector('input').value.trim();
  const role = form.querySelector('select').value;
  try {
    const list = JSON.parse(localStorage.getItem('tagora-waitlist') || '[]');
    list.push({ email, role, at: new Date().toISOString() });
    localStorage.setItem('tagora-waitlist', JSON.stringify(list));
  } catch {
    /* storage unavailable: still show the confirmation */
  }
  document.getElementById('wl-msg').textContent = `已记录：${role}。正式上线时会通知你（演示版仅保存在本机浏览器）。`;
  form.reset();
});

window.addEventListener('load', () => ScrollTrigger.refresh());
