import { ArrowLeft, Blocks, Bot, LockKeyhole, Menu, MessagesSquare, PackagePlus, RotateCcw, Server, Store, Target, Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { StoreProvider, useStore } from './lib/store';
import Bounties from './pages/Bounties';
import Chat from './pages/Chat';
import Ledger from './pages/Ledger';
import Market from './pages/Market';
import Publish from './pages/Publish';
import Real from './pages/Real';
import Run from './pages/Run';
import Twin from './pages/Twin';

const WEB_URL = import.meta.env.VITE_WEB_URL || 'http://localhost:5173';

const NAV = [
  { to: '/', label: '对话规划', icon: MessagesSquare, title: '对话规划', sub: '说出你要做的事，孪生给出流程图、Worker 与费用，每一步都能换' },
  { to: '/market', label: '工具市场', icon: Store, title: '工具市场', sub: '每个 Worker 都附带平台实测的能力卡，路由只看它' },
  { to: '/run', label: '加密调用', icon: LockKeyhole, title: '加密调用', sub: '远程证明 → 密钥协商 → 隔离区执行 → 销毁 → 上链' },
  { to: '/publish', label: '发布工具', icon: PackagePlus, title: '发布工具', sub: '提交代码，六层实测，拿到能力卡后上架' },
  { to: '/bounties', label: '悬赏市场', icon: Target, title: '悬赏市场', sub: '其他孪生发布的缺口需求，用通过验证的工具接单' },
  { to: '/ledger', label: '链上账本', icon: Blocks, title: '链上账本', sub: '只记支付与哈希，数据从不上链' },
  { to: '/twin', label: '我的孪生', icon: Bot, title: '我的孪生', sub: '既是雇主，也是工人' },
  { to: '/real', label: '真实后端', icon: Server, title: '真实后端', sub: '真实横评的能力卡，以及连接本机 Tagora API 的加密调用' },
];

function Boot({ done, total, name }: { done: number; total: number; name: string }) {
  return (
    <div className="boot">
      <div className="boot-card">
        <div className="boot-orb" />
        <h2>验证器正在为种子工具生成能力卡</h2>
        <p>
          {done}/{total} · {name || '准备隐藏题库'}
        </p>
        <div className="boot-bar">
          <i style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <small>每个工具都在独立的沙箱中跑完六层测试，只在首次打开时进行</small>
      </div>
    </div>
  );
}

function Shell() {
  const { state, reset } = useStore();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const page = NAV.find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to))) ?? NAV[0];
  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="logo">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#3ee7ff" />
                <stop offset=".55" stopColor="#8b5cf6" />
                <stop offset="1" stopColor="#ff4ecd" />
              </linearGradient>
            </defs>
            <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="none" stroke="url(#lg)" strokeWidth="2" />
            <path d="M9 11h14M16 11v13" stroke="url(#lg)" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span>Tagora</span>
          <em>DEMO</em>
        </div>
        <nav>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="wallet">
            <span>
              <Wallet size={14} /> 钱包余额
            </span>
            <b>${state.wallet.balance.toFixed(4)}</b>
            <small>演示用 USDC</small>
          </div>
          <a className="side-link" href={WEB_URL}>
            <ArrowLeft size={14} /> 返回官网
          </a>
          <button
            type="button"
            className="side-link"
            onClick={() => {
              if (confirm('清空本机的演示数据并重新生成种子能力卡？')) reset();
            }}
          >
            <RotateCcw size={14} /> 重置演示数据
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button type="button" className="menu-btn" onClick={() => setOpen((o) => !o)} aria-label="菜单">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div>
            <h1>{page.title}</h1>
            <p>{page.sub}</p>
          </div>
          <span className="live-badge">
            <i /> 加密、验证与哈希都在你的浏览器里真实执行
          </span>
        </header>
        <div className="content">
          <Routes>
            <Route path="/" element={<Chat />} />
            <Route path="/market" element={<Market />} />
            <Route path="/run" element={<Run />} />
            <Route path="/publish" element={<Publish />} />
            <Route path="/bounties" element={<Bounties />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="/twin" element={<Twin />} />
            <Route path="/real" element={<Real />} />
            <Route path="*" element={<Market />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider fallback={(p) => <Boot {...p} />}>
      <Shell />
    </StoreProvider>
  );
}
