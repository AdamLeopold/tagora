import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { sha256Hex } from './crypto';
import { SEED_BOUNTIES, SEED_TOOLS } from './seed';
import type { AppState, Block, BlockType, Bounty, RunRecord, Tool, Wallet } from './types';
import { recheck, runVerification } from './verify';

const STORAGE_KEY = 'tagora-demo-v1';
const VERSION = 1;

export const SPLIT = { author: 0.35, compute: 0.55, platform: 0.1 };

type Action =
  | { type: 'init'; state: AppState }
  | { type: 'addTool'; tool: Tool }
  | { type: 'updateTool'; id: string; patch: Partial<Tool> }
  | { type: 'addBounty'; bounty: Bounty }
  | { type: 'updateBounty'; id: string; patch: Partial<Bounty> }
  | { type: 'addBlock'; block: Block }
  | { type: 'replaceLedger'; ledger: Block[] }
  | { type: 'wallet'; delta: Partial<Wallet> }
  | { type: 'addRun'; run: RunRecord }
  | { type: 'me'; patch: Partial<AppState['me']> };

function reducer(s: AppState | null, a: Action): AppState | null {
  if (a.type === 'init') return a.state;
  if (!s) return s;
  switch (a.type) {
    case 'addTool':
      return { ...s, tools: [a.tool, ...s.tools] };
    case 'updateTool':
      return { ...s, tools: s.tools.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case 'addBounty':
      return { ...s, bounties: [a.bounty, ...s.bounties] };
    case 'updateBounty':
      return { ...s, bounties: s.bounties.map((b) => (b.id === a.id ? { ...b, ...a.patch } : b)) };
    case 'addBlock':
      return { ...s, ledger: [...s.ledger, a.block] };
    case 'replaceLedger':
      return { ...s, ledger: a.ledger };
    case 'wallet': {
      const w = { ...s.wallet };
      (Object.keys(a.delta) as (keyof Wallet)[]).forEach((k) => (w[k] = +(w[k] + (a.delta[k] ?? 0)).toFixed(6)));
      return { ...s, wallet: w };
    }
    case 'addRun':
      return { ...s, runs: [a.run, ...s.runs].slice(0, 200) };
    case 'me':
      return { ...s, me: { ...s.me, ...a.patch } };
  }
}

export async function hashBlock(b: Omit<Block, 'hash'>) {
  return sha256Hex(JSON.stringify({ index: b.index, timestamp: b.timestamp, type: b.type, payload: b.payload, prevHash: b.prevHash }));
}

async function makeBlock(prev: Block | undefined, type: BlockType, payload: Record<string, unknown>): Promise<Block> {
  const base = {
    index: prev ? prev.index + 1 : 0,
    timestamp: new Date().toISOString(),
    type,
    payload,
    prevHash: prev ? prev.hash : '0'.repeat(64),
  };
  return { ...base, hash: await hashBlock(base) };
}

export async function verifyChain(ledger: Block[]): Promise<{ ok: boolean; badIndex?: number; reason?: string }> {
  for (let i = 0; i < ledger.length; i++) {
    const b = ledger[i];
    if ((await hashBlock(b)) !== b.hash) return { ok: false, badIndex: i, reason: '区块内容与其哈希不符' };
    if (i > 0 && b.prevHash !== ledger[i - 1].hash) return { ok: false, badIndex: i, reason: '与上一个区块的链接断开' };
  }
  return { ok: true };
}

async function buildSeed(onProgress: (done: number, total: number, name: string) => void): Promise<AppState> {
  const tools: Tool[] = [];
  let i = 0;
  for (const st of SEED_TOOLS) {
    onProgress(i, SEED_TOOLS.length, st.name);
    const { card } = await runVerification(st.source, st.category);
    // a few real L6 rechecks so the trend line has history
    const trend = [card.overall];
    for (let k = 0; k < 5; k++) {
      const q = await recheck(st.source, st.category);
      trend.push(Math.round((0.8 * q + 0.2 * card.robustness) * 100) / 100);
    }
    tools.push({
      ...st,
      mine: false,
      codeHash: card.codeHash,
      card: { ...card, trend, rechecks: trend.length - 1 },
      earnings: +(st.calls * st.price * SPLIT.author).toFixed(2),
      createdAt: new Date(Date.now() - (30 + i * 9) * 864e5).toISOString(),
    });
    i++;
  }
  onProgress(SEED_TOOLS.length, SEED_TOOLS.length, '写入创世区块');
  const ledger: Block[] = [];
  ledger.push(await makeBlock(undefined, 'genesis', { note: 'Tagora demo chain' }));
  for (const t of tools) {
    ledger.push(
      await makeBlock(ledger.at(-1), 'listing', {
        tool: t.id,
        codeHash: t.codeHash,
        cardHash: await sha256Hex(JSON.stringify(t.card)),
        overall: t.card.overall,
      }),
    );
  }
  const now = new Date().toISOString();
  return {
    version: VERSION,
    tools,
    bounties: SEED_BOUNTIES.map((b) => ({ ...b, createdAt: now })),
    ledger,
    wallet: { balance: 50, spent: 0, earnedAuthor: 0, earnedCompute: 0, earnedBounty: 0 },
    runs: [],
    me: { name: '我的孪生', computeSharing: false },
  };
}

interface Ctx {
  state: AppState;
  addTool: (t: Tool) => Promise<void>;
  updateTool: (id: string, patch: Partial<Tool>) => void;
  addBounty: (b: Bounty) => Promise<void>;
  updateBounty: (id: string, patch: Partial<Bounty>) => void;
  appendBlock: (type: BlockType, payload: Record<string, unknown>) => Promise<Block>;
  replaceLedger: (l: Block[]) => void;
  wallet: (delta: Partial<Wallet>) => void;
  addRun: (r: RunRecord) => void;
  setMe: (patch: Partial<AppState['me']>) => void;
  reset: () => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children, fallback }: { children: ReactNode; fallback: (p: { done: number; total: number; name: string }) => ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null);
  const [progress, setProgress] = useState({ done: 0, total: SEED_TOOLS.length, name: '' });
  const ref = useRef<AppState | null>(null);
  ref.current = state;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AppState;
          if (parsed.version === VERSION && parsed.tools?.length) {
            dispatch({ type: 'init', state: parsed });
            return;
          }
        }
      } catch {
        /* fall through to a fresh seed */
      }
      const seeded = await buildSeed((done, total, name) => setProgress({ done, total, name }));
      dispatch({ type: 'init', state: seeded });
    })();
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked: the demo keeps working in memory */
    }
  }, [state]);

  // Blocks are appended one at a time so every prevHash points at the true tip.
  const appendBlock = useCallback((type: BlockType, payload: Record<string, unknown>) => {
    const next = chain.current.then(async () => {
      const b = await makeBlock(ref.current!.ledger.at(-1), type, payload);
      dispatch({ type: 'addBlock', block: b });
      ref.current = { ...ref.current!, ledger: [...ref.current!.ledger, b] };
      return b;
    });
    chain.current = next.catch(() => undefined);
    return next;
  }, []);

  const api = useMemo<Ctx | null>(() => {
    if (!state) return null;
    return {
      state,
      addTool: async (t) => {
        dispatch({ type: 'addTool', tool: t });
        await appendBlock('listing', {
          tool: t.id,
          codeHash: t.codeHash,
          cardHash: await sha256Hex(JSON.stringify(t.card)),
          overall: t.card.overall,
        });
      },
      updateTool: (id, patch) => dispatch({ type: 'updateTool', id, patch }),
      addBounty: async (b) => {
        dispatch({ type: 'addBounty', bounty: b });
        await appendBlock('bounty-post', { bounty: b.id, reward: b.reward, escrow: true });
      },
      updateBounty: (id, patch) => dispatch({ type: 'updateBounty', id, patch }),
      appendBlock,
      replaceLedger: (l) => dispatch({ type: 'replaceLedger', ledger: l }),
      wallet: (delta) => dispatch({ type: 'wallet', delta }),
      addRun: (r) => dispatch({ type: 'addRun', run: r }),
      setMe: (patch) => dispatch({ type: 'me', patch }),
      reset: () => {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      },
    };
  }, [state, appendBlock]);

  if (!api) return <>{fallback(progress)}</>;
  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore outside provider');
  return c;
}
