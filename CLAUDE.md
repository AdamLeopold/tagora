# Tagora · 给 Claude Code 的项目说明

> 本仓库公开（github.com/AdamLeopold/tagora）。这里不写任何密钥、私钥或私密信息；需要的本地文件只写名字和生成方式。

## 项目目标

Tagora 是“可验证的 AI 执行市场”：社区贡献工具（Worker），平台用隐藏题库实测它们的行为并生成**能力卡**，调用方按“标价 ÷ 实测成功率”路由，数据在隔离区（TEE，或 CKKS 密文）里处理、用完即销毁，按次结算（x402 风格的 402 支付）。核心主张：**不看描述，只看实测。**

## 当前进度（2026-10）

- **阶段 0 已完成**：PDF 解析横评。9 个开源工具 × 30 份隐藏文档，报告在 `web/report.html`（线上 https://adamleopold.github.io/tagora/report.html）。参考实现 `tagora-hybrid` 隐藏集 0.998。
- **阶段 1 MVP 已完成**：沙箱、L1–L6 验证引擎、注册表、哈希链账本、按场景路由（调用方本机识别 PDF 场景）、结果承保报价、模拟 TEE 远程证明 + X25519/AES-GCM 密封、x402 风格支付（模拟 USDC）、FastAPI、MCP 网关。
- **密文档原型**：TenSEAL CKKS，逻辑回归 / 平方激活 MLP，N=8192 与明文 100% 一致。
- **Demo**：首页“对话规划”（对话 → 流程图 → 可替换 Worker → 实时费用，偏好可选或从历史学习）；“真实后端”页可在浏览器里直连本机 API 做加密付费调用。
- 进度日志与里程碑：`docs/PLAN.md`。

**下一步（需要用户决定的已标注）**
1. 对话规划接真实后端：任务拆解改用规划模型（目前是关键词规则），PDF 步骤真实调用 API。
2. 给大模型、检索、图表等类别做横评（目前 Demo 里这些 Worker 是演示数据）。
3. 【用户决定】API 上云（账号、域名、费用）、真实机密计算主机（TDX / SEV-SNP）、真实文档样本、公司主体与合规。
4. 可利用 Windows 机的 RTX 4090：GPU 上的 OCR / 大模型 Worker、GPU 版 CKKS（论文中 NEXUS/Odin 方向）。

## 目录

| 目录 | 作用 |
| --- | --- |
| `app/` | 产品 Demo（Vite + React + TypeScript）。`src/lib/` 里有浏览器端模拟（Web Worker 隔离区、WebCrypto）、规划器 `planner.ts`、能力目录 `catalog.ts`、真实 API 客户端 `tagoraApi.ts`。 |
| `web/` | 宣传官网（Vite + Three.js + GSAP + Lenis）与横评报告页 `report.html`。报告数据 `src/data/pdf-benchmark.json` 由 `platform/scripts/export_report.py` 生成。 |
| `platform/` | Python 后端，包名 `tagora`：`sandbox/`、`verify/`（引擎 + `suites/pdf*.py`）、`router.py`、`pricing.py`、`detect.py`、`enclave.py`、`settlement.py`、`fhe.py`、`api.py`、`mcp_server.py`、`sim.py`、`bootstrap.py`；`benchmarks/pdf/`（工具适配、语料、结果）；`benchmarks/fhe/`；`tests/`。 |
| `docs/` | `PLAN.md` 执行看板与进度日志。 |
| `GPU Stablecoin/` | 用户的商业文档（白皮书、方案书、PPT）及其生成脚本，**不是代码，不进 Git**（见文末分类表）。 |
| `.github/workflows/` | `ci.yml`（pytest、前端构建、Docker 构建冒烟）与 `pages.yml`（main 分支 → GitHub Pages）。 |

## 从零搭环境

版本：Python **3.11**（`platform/.python-version`），Node **22**（`.nvmrc`），包管理用 **uv** 与 npm。

```bash
# 前端
npm --prefix web ci && npm --prefix app ci

# 后端（macOS / Linux / WSL2）
cd platform
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements-lock.txt   # 锁定版本，跨平台
uv pip install --python .venv/bin/python -e ".[bench,dev,fhe]" --no-deps
```

依赖清单：`platform/pyproject.toml`（extras：`bench` 横评工具、`fhe` 密文档、`dev` 测试），`platform/requirements-lock.txt`（`uv pip compile --universal` 生成，改依赖后重新生成），`web/` 与 `app/` 的 `package-lock.json`。

### Windows 注意事项（RTX 4090 台式机）

- **后端必须在 WSL2（Ubuntu）里跑**：沙箱 `platform/tagora/sandbox/runner.py` 用了 `resource`、`preexec_fn`、`os.killpg`，原生 Windows 没有。前端（`web/`、`app/`）可以在 Windows 原生 Node 下跑。
- 仓库放在 WSL 的 Linux 文件系统里（如 `~/tagora`），不要放 `/mnt/c/...`，否则 I/O 很慢、文件权限和换行会出问题。
- `git config core.autocrlf input`，避免 CRLF 改动 `tagora.toml` / 源码导致**代码哈希变化**（能力卡绑定代码哈希，换行变了卡就失效）。
- 生成中文测试文档需要 CJK 字体：`sudo apt install fonts-arphic-uming` 或 `fonts-noto-cjk`（`pdf_corpus.py` 会自动找）。
- RapidOCR 依赖 OpenCV：WSL 里可能需要 `sudo apt install libgl1 libglib2.0-0`。
- GPU 目前代码里没用到；要用 4090 需在 WSL2 装 NVIDIA 的 WSL 驱动与 CUDA。

### 本地状态与密钥文件（都在 `platform/var/`，已被 .gitignore 忽略，绝不提交）

| 文件 | 是什么 | 怎么得到 |
| --- | --- | --- |
| `platform/var/hidden_seed` | 隐藏题库的私有种子 | 第一次跑 `benchmarks/pdf/run.py --split hidden` 自动生成。**新机器会生成新种子 → 新的隐藏题库**；要复现同一套隐藏集，需由用户通过私密渠道拷贝原文件 |
| `platform/var/vendor_root.key` | 模拟的“芯片厂商根密钥”（Ed25519 私钥），给远程证明签名 | 第一次启动 API 自动生成；每台机器各自一份即可，客户端会通过 `/v1/attest/root` 取公钥 |
| `platform/var/registry.db`、`ledger.db`、`bank.db` | 注册表、账本、模拟钱包余额 | 运行时生成；用 `python -m tagora.bootstrap --split hidden --fresh` 从已提交的能力卡重建注册表 |
| `~/.tagora/wallet.json` | MCP 网关的本地模拟钱包私钥 | 第一次运行 `tagora.mcp_server` 自动生成 |
| `platform/benchmarks/pdf/corpus/hidden/` | 由私有种子生成的隐藏考卷 | 随 `hidden_seed` 生成；**不得提交** |

环境变量（均可选）：`TAGORA_VAR`（var 目录）、`TAGORA_API`（客户端 API 地址，默认 `http://127.0.0.1:8787`）、`TAGORA_WALLET`（MCP 钱包文件）、`TAGORA_FAUCET`（`1` 开启测试水龙头）、`TAGORA_NO_AUTOAPP`（测试用）、`VITE_APP_URL` / `VITE_WEB_URL`（两个前端互链地址，Pages 构建时由工作流设置）。目前**没有任何真实的 API 密钥**。

## 运行与测试

```bash
cd platform
.venv/bin/python -m pytest -q                                # 32 个测试，CI 同款
.venv/bin/python benchmarks/pdf/run.py --split public        # 公开集横评（约 4 分钟）
.venv/bin/python benchmarks/pdf/run.py --split hidden        # 隐藏集横评（需要 hidden_seed）
.venv/bin/python -m tagora.sim                               # 先验校准 / 路由 / 承保模拟
.venv/bin/python benchmarks/fhe/run.py                       # CKKS 参数网格
.venv/bin/python scripts/export_report.py                    # 结果 → web/app 的 JSON
.venv/bin/python -m tagora.bootstrap --split hidden --fresh  # 能力卡 → 注册表
.venv/bin/uvicorn tagora.api:app --port 8787                 # API
claude mcp add tagora -- $PWD/.venv/bin/python -m tagora.mcp_server

npm --prefix web run dev     # http://localhost:5173
npm --prefix app run dev     # http://localhost:5174（“真实后端”页可连本机 API）
cd app && npx tsc --noEmit   # 前端类型检查
```

## 约定

- **分支**：在 `phase0-mvp` 上开发，验证通过后快进合并到 `main`；推到 `main` 会自动部署 GitHub Pages。提交信息末尾加 Co-Authored-By 行。
- **隐藏题库永不公开**：只提交成绩（`benchmarks/pdf/results/`），不提交 `corpus/hidden/` 与 `var/`。
- **能力卡绑定代码哈希**：改了某个工具的任何文件（含换行符），都要重新验证再上架；工具改动时同时改 `tagora.toml` 的 `version`。
- **工具接口**：PDF 工具 `run({"pdf": path}) -> {"markdown": str}`，放在 `benchmarks/pdf/tools/<name>/`（`tagora.toml` + `tool.py`），沙箱里不能联网、不能起子进程。
- **诚实标注**：模拟的部分（TEE 根密钥、USDC、演示价格、Demo 里的大模型 Worker）在 UI 和文档里都要写明是模拟。
- **调参只用公开集**，结论用隐藏集验证。
- 前端改动后在浏览器里看一眼再提交（有 3D 场景和图表，构建通过不等于显示正确）。

## 文件分类

| 顶层路径 | 分类 | 说明 |
| --- | --- | --- |
| `app/` | 代码（进 Git） | 其中 `app/node_modules/`、`app/dist/` 属可再生成、可丢弃 |
| `web/` | 代码（进 Git） | 其中 `web/node_modules/`、`web/dist/` 属可再生成、可丢弃 |
| `platform/` | 代码（进 Git） | `benchmarks/pdf/corpus/public|special/` 与 `results/` 也进 Git（公开样例与公开成绩）；`platform/.venv/` 可再生成、可丢弃；`platform/var/` 与 `benchmarks/pdf/corpus/hidden/` 属敏感、只留本地 |
| `docs/` | 代码（进 Git） | |
| `.github/` | 代码（进 Git） | CI 与部署工作流 |
| `.claude/` | 代码（进 Git） | 只有 `launch.json`（本地开发服务器配置），不含个人设置 |
| `README.md`、`CLAUDE.md`、`.gitignore`、`.nvmrc` | 代码（进 Git） | |
| `GPU Stablecoin/` | 大数据或输出（不进 Git） | 约 286 MB 的商业文档与生成脚本；其中 `.proposal_build/`、`.revision_build/`、`.update_20261015/` 属可再生成的中间产物 |
| `.DS_Store`（各级） | 可再生成、可丢弃 | macOS 自动生成 |

## 多设备工作流

这个项目在 Mac 和 Windows（RTX 4090）两台机器上用：代码靠 GitHub，大数据靠 Dropbox 链接。第一次在某台机器上使用、日常怎么同步、离线时怎么办，都写在 [WORKFLOW.md](WORKFLOW.md) 里。收工前把进度更新进本文件，然后提交并推送；另一台机器上的 Claude 只能从文件里知道进度。
