export type CategoryId = 'seq' | 'protein' | 'redact' | 'csv';
export type Tier = 'trusted' | 'open';

export interface EdgeResult {
  name: string;
  pass: boolean;
  note?: string;
}

/** The output of the verifier — the only thing the router and callers trust. */
export interface CapabilityCard {
  codeHash: string;
  suiteVersion: string;
  verifiedAt: string;
  overall: number;
  confidence: 'high' | 'medium' | 'low';
  byScenario: Record<string, number>;
  robustness: number;
  edges: EdgeResult[];
  security: {
    staticFlags: string[];
    egress: string[];
    adversarialCrashes: number;
  };
  perf: { p50: number; p95: number; largeMs: number | null };
  knownFailures: string[];
  rechecks: number;
  lastRecheck: string;
  trend: number[];
}

export interface Tool {
  id: string;
  name: string;
  author: string;
  mine: boolean;
  category: CategoryId;
  version: string;
  source: string;
  codeHash: string;
  claim: { text: string; accuracy: number };
  price: number;
  tier: Tier;
  hardware: string;
  provider: string;
  card: CapabilityCard;
  calls: number;
  earnings: number;
  createdAt: string;
}

export interface Bounty {
  id: string;
  title: string;
  detail: string;
  category: CategoryId;
  minScore: number;
  reward: number;
  poster: string;
  mine: boolean;
  deadline: string;
  status: 'open' | 'fulfilled';
  fulfilledBy?: string;
  createdAt: string;
}

export type BlockType = 'genesis' | 'listing' | 'call' | 'bounty-post' | 'bounty-paid' | 'compute' | 'recheck';

export interface Block {
  index: number;
  timestamp: string;
  type: BlockType;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface RunRecord {
  id: string;
  at: string;
  category: CategoryId;
  toolIds: string[];
  sensitive: boolean;
  cost: number;
  ok: boolean;
}

export interface Wallet {
  balance: number;
  spent: number;
  earnedAuthor: number;
  earnedCompute: number;
  earnedBounty: number;
}

export interface AppState {
  version: number;
  tools: Tool[];
  bounties: Bounty[];
  ledger: Block[];
  wallet: Wallet;
  runs: RunRecord[];
  me: { name: string; computeSharing: boolean };
}
