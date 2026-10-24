# Tagora

可验证的 AI 执行市场：社区贡献工具，平台实测行为，数据在硬件隔离区内加密处理、用完即销毁。

```
web/        宣传官网（Vite + Three.js + GSAP + Lenis），含阶段 0 横评报告 report.html
app/        产品 Demo（Vite + React + TypeScript），“真实后端”页可连接本机 API
platform/   后端（Python）：沙箱、验证引擎、PDF 横评、路由、定价、402 结算、FHE、API、MCP
docs/PLAN.md  初步计划执行看板与进度日志
```

线上地址：官网 https://adamleopold.github.io/tagora/ · 横评报告 https://adamleopold.github.io/tagora/report.html · Demo https://adamleopold.github.io/tagora/app/

## 本地运行

```bash
npm --prefix web install && npm --prefix web run dev   # http://localhost:5173
npm --prefix app install && npm --prefix app run dev   # http://localhost:5174
```

两个站点互相链接。部署到线上时用环境变量指定对方地址：

- `web`：`VITE_APP_URL`（默认 `http://localhost:5174`）
- `app`：`VITE_WEB_URL`（默认 `http://localhost:5173`）

构建：`npm --prefix web run build`、`npm --prefix app run build`，产物在各自的 `dist/`，可直接放到任何静态托管。

## 后端平台（platform/）

```bash
cd platform
uv venv --python 3.11 .venv && uv pip install --python .venv/bin/python -e ".[bench,dev,fhe]"
.venv/bin/python -m pytest -q                                  # 32 个测试
.venv/bin/python benchmarks/pdf/run.py --split public          # 横评（--split hidden 用本机私有题库）
.venv/bin/python -m tagora.sim                                 # 先验校准、路由与承保利润率模拟
.venv/bin/python benchmarks/fhe/run.py                         # CKKS 密文推理参数网格
.venv/bin/python -m tagora.bootstrap --split hidden --fresh    # 把能力卡装进注册表
.venv/bin/uvicorn tagora.api:app --port 8787                   # API
claude mcp add tagora -- $PWD/.venv/bin/python -m tagora.mcp_server   # 接入 Claude Code
```

| 模块 | 作用 |
| --- | --- |
| `tagora/sandbox` | 每次调用一个子进程；CPython 审计钩子拦截出网、子进程、越权写文件，记录读取 home |
| `tagora/verify` | L1 静态分析 → L2 隐藏题库 → L3 边界 → L4 对抗/出网 → L5 资源 → 能力卡（绑定代码哈希 × 硬件类别） |
| `tagora/router.py` | 按“有效价格 = 标价 ÷ 实测成功率”路由，成功率用校准过的 Beta 先验平滑 |
| `tagora/detect.py` | 在调用方本机识别 PDF 场景，只把场景标签发给路由器 |
| `tagora/pricing.py` | 按结果收费的承保报价 |
| `tagora/enclave.py` | 模拟 TEE：Ed25519 签名的远程证明 + X25519/HKDF/AES-256-GCM 密封 |
| `tagora/settlement.py` | x402 风格的 402 → X-PAYMENT 支付流程（模拟 USDC） |
| `tagora/fhe.py` | 密文档：训练小模型，TenSEAL CKKS 加密推理 |
| `tagora/api.py` / `mcp_server.py` | HTTP API 与 MCP 网关 |

`platform/Dockerfile` 构建 API 镜像（CI 中构建并冒烟测试）。

## 官网（web/）

一页滚动叙事，四个 WebGL 场景随滚动驱动：

| 区块 | 内容 |
| --- | --- |
| Hero | Tagora 核心 + 三层 Worker 轨道，光点代表被路由的调用 |
| 验证体系 | 一个“宣称 SOTA”的工具穿过 L1–L6 六道扫描环，最终变成能力卡 |
| 可证明的隐私 | 十步加密调用：远程证明 → 哈希核验 → 密文直传 → 隔离区碎裂销毁 → 哈希上链 |
| 赛博农民工 | 1,000 个 Worker 随一个任务被逐波唤醒 |

另有问题对比、防作弊机制、可倾斜的能力卡、交互式架构图（悬停查看组件职责）、分账动画、竞品表、路线图和候补名单（仅存本机浏览器）。

## 产品 Demo（app/）

所有密码学与验证都在浏览器里**真实执行**，不是动画：

- **工具市场**：10 个种子工具，覆盖 DNA 序列、蛋白分子量、临床文本脱敏、CSV 统计四类。首次打开时，验证器在沙箱里对每个工具跑完隐藏题库，生成能力卡。部分工具的自述是夸大的（如“准确率 100%”“绝不外传”），市场会显示“描述偏差”。
- **加密调用**：每个隔离区是一个独立 Web Worker，加载代码前就移除了网络 API。远程证明报告用 ECDSA P-256 签名；调用方核验代码哈希后用 ECDH 协商密钥，以 AES-256-GCM 加密输入；执行完 Worker 被终止，凭证与结果哈希写入哈希链账本。
  - 可选 1–3 个不同作者的 Worker 交叉验证。
  - “节点偷换代码”演示：远程证明的度量值与能力卡不符，调用在发送数据前中止。
- **发布工具**：在线写代码，或 fork 现有工具，或加载“恶意版本”。六层验证实时运行：L1 静态扫描、L2 隐藏题库、L3 边界、L4 对抗与出网拦截、L5 延迟与大输入，L6 在上架后随真实调用抽检。
- **悬赏市场**：发布缺口需求（奖金托管），用自己通过验证的工具接单，按能力卡验收。
- **链上账本**：可一键校验整条哈希链；“篡改一个区块”演示篡改如何被发现。
- **我的孪生**：钱包与收益、基于使用情况的需求建议；“出租闲置算力”会让本机真实执行普通档工具的复检任务。

### 演示版与真实系统的差别

| 演示版 | 真实系统 |
| --- | --- |
| 隔离区 = 浏览器 Web Worker，“芯片厂商根密钥”由浏览器生成 | Intel TDX / AMD SEV-SNP / H100 机密计算，签名密钥在硬件中 |
| 隐藏题库打包在前端 | 题库只在验证服务器，定期轮换 |
| 账本存在 localStorage | 公链或联盟链，USDC / x402 结算 |
| 调用次数等历史数据为示例 | 真实统计 |
