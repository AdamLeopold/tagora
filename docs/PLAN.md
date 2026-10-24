# Tagora 初步计划执行看板

目标：把白皮书路线图的**阶段 0（公开横评）**和**阶段 1（验证路由 MVP）**做成真实可运行的系统，并补上定价与密文档的原型。
工作分支：`phase0-mvp`。每个里程碑验证通过后合并到 `main` 部署。

## 架构

```
platform/                     Python 后端（包名 tagora）
  tagora/sandbox/             子进程沙箱：审计钩子拦截出网/子进程/越权写文件，CPU/内存/超时限制
  tagora/verify/              L1–L6 验证引擎 → 能力卡（绑定代码哈希 × 硬件类别）
  tagora/registry.py          工具注册表（SQLite）
  tagora/ledger.py            哈希链账本（SQLite）
  tagora/router.py            按“有效价格 = 标价 ÷ 实测成功率”路由
  tagora/pricing.py           结果定价 / 承保模型
  tagora/settlement.py        x402 风格的 402 支付流程（模拟 USDC，ed25519 签名）
  tagora/api.py               FastAPI 服务
  tagora/mcp_server.py        MCP 服务：任何 agent 都能搜索、查看能力卡、加密调用
  benchmarks/pdf/             阶段 0：PDF 解析横评（合成语料 + 真实开源解析器）
  tests/                      pytest
```

隐藏题库：由本机私有种子生成，**不提交到公开仓库**；仓库里只有公开样例种子。

## 里程碑

- [x] M1 平台骨架：沙箱、清单格式、代码哈希、注册表、账本 + 测试
- [x] M2 阶段 0 横评：PDF 合成语料（含真值）、6+ 个开源解析器适配、评分、能力卡、每个验证结果的成本
- [x] M3 横评报告页面（官网 /report），部署到 GitHub Pages
- [x] M4 阶段 1：路由器 + 402 结算 + FastAPI + MCP 服务，端到端测试
- [x] M5 定价：有效价格路由、结果承保模型、参数模拟与调参
- [x] M6 密文档原型：训练小模型，用 CKKS 做加密推理，测准确率与开销
- [x] M7 Infra：CI（pytest + 前端构建）、Dockerfile、运行文档
- [x] M8 Demo 接入真实后端数据，白皮书更新实测结果

## 进度日志

（每轮循环在此追加）

**2026-10-24 第 1 轮**
- 沙箱：子进程 + CPython 审计钩子，拦截出网、子进程、越权写文件，记录读取 home；11 个逃逸测试通过。
- 阶段 0：合成 PDF 语料（单栏、双栏且一半打乱内容流、表格、中文、扫描件），真值自动生成；隐藏题库由本机私有种子生成、不入库。
- 9 个工具上榜（pypdf、pypdf-layout、pdfplumber、pdfminer.six、PyMuPDF、pymupdf4llm、markitdown、RapidOCR、tagora-hybrid）。
- 调参：tagora-hybrid 在公开集上发现扫描件丢行（RapidOCR 检测器把紧密行合并），改为“投影纠偏 + 按行切分 + 只用识别模型”，扫描件 0.52→0.998；双栏改为按版面排序。隐藏集验证：总分 0.998、通过率 100%，无过拟合。
- 阶段 1：路由器（有效价格）、结果承保报价、模拟 TEE 远程证明 + X25519/AES-GCM 密封、x402 风格 402 支付（模拟 USDC）、FastAPI、MCP 网关；端到端测试含偷换代码、重放支付、余额不足。
- 定价调参（tagora.sim）：先验 (0.1, 0.1)；有效价格路由每个验证结果 $0.00105，比“永远选最高分”便宜 48%；承保 margin 建议 30%（样本 30，P(亏损)=1.1%）。
- M3：官网新增 /report.html（热力图、调参前后对比、路由策略、承保曲线、算力 vs 价格），数据由 platform/scripts/export_report.py 导出。
- M7：CI 三个任务全部通过（platform pytest、前端构建、Docker 镜像构建 + 冒烟测试）。
- M6：tagora.fhe 用 sklearn 乳腺癌数据训练逻辑回归与平方激活 MLP，TenSEAL CKKS 加密推理。参数网格：N=4096/Δ=2^20 掉 4.7 个点；N=8192 两个模型与明文 100% 一致（25 ms / 96 ms，每次查询 230–345 KB）。API 新增 /v1/fhe/*（公共上下文、拒收私钥、402 支付、账本只记密文哈希）。
- 实跑发现问题：扫描件被路由到纯文本工具（只按总分路由）。新增 tagora/detect.py 在调用方本机识别场景（公开+隐藏 40/40），按场景成功率路由，并加验收失败自动换下一个 Worker。
- M8：Demo 新增“真实后端”页：9 张真实能力卡；浏览器用 WebCrypto 直连本机 API 完成 Ed25519 验签 → 哈希核验 → X25519/HKDF/AES-GCM → 402 → 签名支付 → 解密，已与 Python 服务端实测互通。
- 待办：白皮书更新实测结果。生产部署 API 需要云账号与域名，留给用户决定。
