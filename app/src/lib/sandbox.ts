/**
 * Isolated execution for tools.
 *
 * Every tool runs inside its own Web Worker built from the bootstrap below.
 * The bootstrap removes network APIs before any tool code loads (recording
 * every attempt as an egress event), and for "sealed" calls plays the role
 * of a TEE: it attests to the hash of the code it loaded, agrees a key with
 * the caller over ECDH, and only ever sees plaintext inside the worker.
 * Terminating the worker is the "destroy the enclave" step.
 */

const BOOT = String.raw`
'use strict';
const egress = [];
const blocked = (name) => function (...args) {
  egress.push(name + (args[0] ? ' → ' + String(args[0]).slice(0, 80) : ''));
  throw new Error('网络访问被隔离区拦截：' + name);
};
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'BroadcastChannel']) {
  try { Object.defineProperty(self, k, { value: blocked(k), writable: false, configurable: false }); } catch (e) {}
}
try { Object.defineProperty(self.navigator, 'sendBeacon', { value: blocked('sendBeacon') }); } catch (e) {}

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
let tool = null;
let source = '';
let ecdh = null;

const clean = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

async function invoke(input) {
  egress.length = 0;
  const t0 = performance.now();
  let output, error;
  try { output = clean(await tool(input)); }
  catch (e) { error = String((e && e.message) || e); }
  return { output, error, ms: performance.now() - t0, egress: egress.slice() };
}

self.onmessage = async ({ data: m }) => {
  const reply = (msg, transfer) => self.postMessage({ rid: m.rid, ...msg }, transfer || []);
  try {
    if (m.type === 'load') {
      source = m.source;
      tool = new Function(source + '\n;return typeof run === "function" ? run : null;')();
      if (!tool) throw new Error('源码中没有找到 run(input) 函数');
      reply({ ok: true });
    } else if (m.type === 'exec') {
      reply(await invoke(m.input));
    } else if (m.type === 'attest') {
      ecdh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
      const pub = hex(await crypto.subtle.exportKey('raw', ecdh.publicKey));
      const measurement = hex(await crypto.subtle.digest('SHA-256', enc.encode(source)));
      const report = JSON.stringify({ measurement, enclavePubKey: pub, nonce: m.nonce, hardware: m.hardware });
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, m.vendorKey, enc.encode(report));
      reply({ report, signature: hex(sig) });
    } else if (m.type === 'sealed-exec') {
      const peer = await crypto.subtle.importKey('raw', unhex(m.clientPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, ecdh.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const input = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: m.iv }, key, m.ciphertext));
      const res = await invoke(input);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ output: res.output, error: res.error })));
      reply({ iv, ciphertext: ct, ms: res.ms, egress: res.egress }, [ct]);
    }
  } catch (e) {
    reply({ fatal: String((e && e.message) || e) });
  }
};
`;

let bootUrl: string | null = null;
const getBootUrl = () => (bootUrl ??= URL.createObjectURL(new Blob([BOOT], { type: 'text/javascript' })));

export interface ExecResult {
  output?: unknown;
  error?: string;
  ms: number;
  egress: string[];
  timedOut?: boolean;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: number };

export class Sandbox {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private rid = 0;
  alive = true;

  constructor() {
    this.worker = new Worker(getBootUrl());
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.rid);
      if (!p) return;
      this.pending.delete(data.rid);
      clearTimeout(p.timer);
      if (data.fatal) p.reject(new Error(data.fatal));
      else p.resolve(data);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.pending.forEach((p) => p.reject(new Error(e.message || '隔离区崩溃')));
      this.pending.clear();
    };
  }

  request<T = any>(msg: Record<string, unknown>, timeoutMs = 4000, transfer: Transferable[] = []): Promise<T> {
    if (!this.alive) return Promise.reject(new Error('隔离区已销毁'));
    const rid = ++this.rid;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(rid);
        // a runaway tool (e.g. an infinite loop) can only be stopped by killing the worker
        this.destroy();
        reject(new Error(`超时（>${timeoutMs}ms），隔离区已强制销毁`));
      }, timeoutMs);
      this.pending.set(rid, { resolve, reject, timer });
      this.worker.postMessage({ rid, ...msg }, transfer);
    });
  }

  load(source: string) {
    return this.request<{ ok: true }>({ type: 'load', source });
  }

  async exec(input: string, timeoutMs = 2000): Promise<ExecResult> {
    try {
      return await this.request<ExecResult>({ type: 'exec', input }, timeoutMs);
    } catch (e) {
      return { error: (e as Error).message, ms: timeoutMs, egress: [], timedOut: true };
    }
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.worker.terminate();
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error('隔离区已销毁'));
    });
    this.pending.clear();
  }
}

/** Run one tool on many inputs in a fresh sandbox, replacing it if a call times out. */
export async function runMany(source: string, inputs: string[], timeoutMs = 2000): Promise<ExecResult[]> {
  let box = new Sandbox();
  const fresh = async () => {
    box = new Sandbox();
    await box.load(source);
  };
  try {
    await box.load(source);
  } catch (e) {
    box.destroy();
    return inputs.map(() => ({ error: `加载失败：${(e as Error).message}`, ms: 0, egress: [] }));
  }
  const out: ExecResult[] = [];
  for (const input of inputs) {
    if (!box.alive) await fresh();
    out.push(await box.exec(input, timeoutMs));
  }
  box.destroy();
  return out;
}
