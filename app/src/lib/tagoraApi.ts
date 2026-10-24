/**
 * Browser client for a running Tagora API (platform/tagora/api.py).
 *
 * Mirrors platform/tagora/client.py byte for byte where it matters:
 *  - attestation reports are verified with Ed25519 over canonical JSON
 *  - session keys come from X25519 + HKDF-SHA256(info = "tagora-sealed-v1" || nonce)
 *  - payloads are AES-256-GCM, {iv, ciphertext} base64
 *  - x402 payments are Ed25519-signed authorisations sent in X-PAYMENT
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const hex = (b: ArrayBuffer | Uint8Array) =>
  [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Python's json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False). */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

export interface ApiTool {
  key: string;
  name: string;
  author: string;
  tier: string;
  overall: number;
  success_rate: number;
  by_scenario: Record<string, number>;
  price_usd: number;
  effective_price_usd: number;
  egress: boolean;
  code_hash: string;
  known_failures: string[];
}

export interface Step {
  label: string;
  detail: string;
  ok: boolean;
}

export class TagoraApi {
  private wallet: { priv: CryptoKey; account: string } | null = null;

  constructor(public base: string) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(this.base + path, init);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  }

  health() {
    return this.json<{ ok: boolean; tools: number; ledger_height: number; ledger_valid: boolean }>('/v1/health');
  }

  tools(sensitive = false) {
    return this.json<ApiTool[]>(`/v1/tools?category=pdf&sensitive=${sensitive}`);
  }

  route(scenario: string, sensitive: boolean) {
    return this.json<{ picked: string[]; ranked: { key: string; effective_price_usd: number; p_success: number }[]; excluded: { key: string; reason: string }[] }>(
      '/v1/route',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'pdf', scenario, sensitive, k: 1 }) },
    );
  }

  async ensureWallet() {
    if (this.wallet) return this.wallet;
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const account = hex(await crypto.subtle.exportKey('raw', kp.publicKey));
    this.wallet = { priv: kp.privateKey, account };
    await this.json('/v1/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, usd: 1 }) });
    return this.wallet;
  }

  async balance() {
    const w = await this.ensureWallet();
    return (await this.json<{ balance_usd: number }>(`/v1/wallets/${w.account}`)).balance_usd;
  }

  private async pay(req: Record<string, unknown>) {
    const w = await this.ensureWallet();
    const auth = {
      from: w.account,
      to: req.payTo,
      amount: req.maxAmountRequired,
      asset: req.asset,
      network: req.network,
      resource: req.resource,
      nonce: req.nonce,
      validBefore: req.validBefore,
    };
    const sig = await crypto.subtle.sign('Ed25519', w.priv, enc.encode(canonical(auth)));
    return btoa(JSON.stringify({ x402Version: 1, scheme: 'exact', payload: { authorization: auth, signature: hex(sig) } }));
  }

  /** The whole sealed, paid call. Every step is reported so the UI can show it. */
  async runPdf(file: File, key: string, onStep: (s: Step) => void) {
    const card = await this.json<{ code_hash: string }>(`/v1/tools/${encodeURIComponent(key)}/card`);
    const root = (await this.json<{ root_pubkey: string }>('/v1/attest/root')).root_pubkey;
    const att = await this.json<{ session_id: string; report: Record<string, any>; signature: string }>('/v1/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const rootKey = await crypto.subtle.importKey('raw', unhex(root), { name: 'Ed25519' }, false, ['verify']);
    const sigOk = await crypto.subtle.verify('Ed25519', rootKey, unhex(att.signature), enc.encode(canonical(att.report)));
    onStep({ label: '远程证明签名', detail: sigOk ? `有效（根公钥 ${root.slice(0, 10)}…，模拟）` : '无效', ok: sigOk });
    if (!sigOk) throw new Error('attestation signature invalid');
    const match = att.report.measurement === card.code_hash;
    onStep({ label: '代码哈希核验', detail: `${att.report.measurement.slice(0, 12)}… ${match ? '=' : '≠'} 能力卡 ${card.code_hash.slice(0, 12)}…`, ok: match });
    if (!match) throw new Error('measurement does not match capability card; nothing was sent');

    const mine = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
    const peer = await crypto.subtle.importKey('raw', unhex(att.report.enclave_pubkey), { name: 'X25519' }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, mine.privateKey, 256);
    const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const info = new Uint8Array([...enc.encode('tagora-sealed-v1'), ...unhex(att.report.nonce)]);
    const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info }, hk, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, await file.arrayBuffer());
    onStep({ label: '密钥协商与加密', detail: `X25519 + HKDF + AES-256-GCM · ${ct.byteLength.toLocaleString()} 字节密文`, ok: true });

    const body = JSON.stringify({
      key,
      session_id: att.session_id,
      client_pubkey: hex(await crypto.subtle.exportKey('raw', mine.publicKey)),
      sealed: { iv: b64(iv), ciphertext: b64(ct) },
      filename: file.name,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let r = await fetch(`${this.base}/v1/run`, { method: 'POST', headers, body });
    if (r.status === 402) {
      const req = (await r.json()).accepts[0];
      onStep({ label: 'HTTP 402 支付要求', detail: `${Number(req.maxAmountRequired) / 1e6} ${req.asset} · ${req.network}`, ok: true });
      r = await fetch(`${this.base}/v1/run`, { method: 'POST', headers: { ...headers, 'X-PAYMENT': await this.pay(req) }, body });
    }
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const data = await r.json();
    const receipt = JSON.parse(atob(r.headers.get('X-PAYMENT-RESPONSE') || 'e30='));
    onStep({ label: '支付结算', detail: `区块 #${receipt.block ?? data.block} · ${Object.entries(receipt.splits_micros || {}).map(([k, v]) => `${k.split(':')[0]} ${Number(v) / 1e6}`).join(' / ')}`, ok: true });
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.sealed_result.iv) }, aes, unb64(data.sealed_result.ciphertext));
    const result = JSON.parse(dec.decode(plain));
    onStep({ label: '解密结果', detail: `明文只在本机出现 · 隔离区会话已销毁 · 结果哈希 ${data.result_hash.slice(0, 12)}…`, ok: true });
    return { result, block: data.block, receiptHash: data.receipt_hash, resultHash: data.result_hash };
  }
}
