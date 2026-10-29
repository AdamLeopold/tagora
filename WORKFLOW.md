# Tagora 多设备工作流

代码在**公开**仓库 `AdamLeopold/tagora`（开发分支 `phase0-mvp`）。不进 Git 的 `GPU Stablecoin/` 文件夹放在 Dropbox 的 `Projects/Tagora/` 里。进度和规则在 `CLAUDE.md`，详细日志在 `docs/PLAN.md`。

> 本仓库公开：这个文件和任何提交里都不写密钥、个人路径或商业内容。下文 `$P` 指 Dropbox 里的 `Projects` 文件夹，完整路径以本机为准，不写在这里。

## 速查

| 项 | 内容 |
|---|---|
| GitHub 仓库（分支） | `AdamLeopold/tagora`，**公开**。日常在 `phase0-mvp` 上开发，验证后快进合并到 `main`。推送到 `main` 会自动部署 GitHub Pages |
| Mac 路径 | `~/Tagora` |
| Windows 路径 | **WSL2 里的 `~/tagora`**：不放在 `C:\Projects`，也不放在 `/mnt/c/...` 下 |
| Dropbox 数据目录 | `$P/Tagora/`，里面只有 `GPU Stablecoin/`（见 `.dropbox-links`） |
| 从 _secrets 拷贝 | `$P/_secrets/Tagora/platform/var/hidden_seed` → `platform/var/hidden_seed`（让两台机器用同一套隐藏题库） |
| 每台机器自己生成（不拷） | `platform/var/vendor_root.key`、`registry.db`、`ledger.db`、`bank.db`，`~/.tagora/wallet.json`，`platform/benchmarks/pdf/corpus/hidden/` |
| 只在 Mac 上 | 没有 Windows 拿不到的代码或数据。Mac 的 `platform/var/`（DB、日志、根密钥）是本机运行状态，不同步 |
| 运行环境 | 后端：WSL2（Ubuntu）+ Python 3.11（`platform/.python-version`）+ uv。前端：Node 22（`.nvmrc`）+ npm，可以原生跑，但仓库在 WSL 里，所以在 WSL 里跑最省事 |

## 第一次在 Windows 上用

1. 前提：Dropbox 里的 `Projects/README-Windows.md` 已做完，包括 WSL2（Ubuntu）。`setup_windows.ps1` **不会**克隆 Tagora。WSL 里还需要 `gh`（已 `gh auth login`）、`uv` 和 Node 22，它们在 WSL 里怎么装，CLAUDE.md 没写。
2. 克隆、建链接、拷密钥（都在 WSL 里执行，bash）：
   ```bash
   gh repo clone AdamLeopold/tagora ~/tagora
   cd ~/tagora
   git switch phase0-mvp
   git config core.autocrlf input            # WSL 的 git 配置和 Windows 的是分开的，这里要再设一次
   P="$(wslpath 'C:\<Dropbox 根目录>\<…>\Projects')"   # Dropbox 根目录见 %LOCALAPPDATA%\Dropbox\info.json
   ln -s "$P/Tagora/GPU Stablecoin" ~/tagora/
   mkdir -p ~/tagora/platform/var
   cp "$P/_secrets/Tagora/platform/var/hidden_seed" ~/tagora/platform/var/
   ```
3. 搭环境（WSL）：
   ```bash
   sudo apt install fonts-noto-cjk libgl1 libglib2.0-0   # 中文测试文档字体；RapidOCR 依赖的 OpenCV 库
   cd ~/tagora/platform
   uv venv --python 3.11 .venv
   uv pip install --python .venv/bin/python -r requirements-lock.txt
   uv pip install --python .venv/bin/python -e ".[bench,dev,fhe]" --no-deps
   cd ~/tagora && npm --prefix web ci && npm --prefix app ci
   ```
4. 验证（WSL）：
   ```bash
   cd ~/tagora/platform && .venv/bin/python -m pytest -q     # 32 个测试，和 CI 一样
   .venv/bin/python -m tagora.bootstrap --split hidden --fresh   # 用已提交的能力卡重建本机注册表
   cd ~/tagora/app && npx tsc --noEmit                         # 前端类型检查
   ```
5. 在 WSL 终端里 `cd ~/tagora` 后启动 Claude Code，这样它能直接跑后端命令（WSL 里怎么装 Claude Code 没有写进文档）。第一句话：
   > 这是 Windows 台式机第一次用这个项目，仓库在 WSL 的 ~/tagora。先 git pull，然后读 CLAUDE.md 和 WORKFLOW.md，告诉我上次做到哪了，再确认 core.autocrlf 是 input、pytest 能过。

## 第一次在新 Mac 上用（重装或换电脑）

```bash
P="<Dropbox 里 Projects 文件夹的路径>"               # 在 ~/Library/CloudStorage/ 下面，先等 Dropbox 同步完
gh repo clone AdamLeopold/tagora ~/Tagora
cd ~/Tagora && git switch phase0-mvp
"$P/_tools/link_dropbox.sh" ~/Tagora Tagora          # 建 GPU Stablecoin 链接
mkdir -p platform/var && cp "$P/_secrets/Tagora/platform/var/hidden_seed" platform/var/
npm --prefix web ci && npm --prefix app ci
cd platform
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements-lock.txt
uv pip install --python .venv/bin/python -e ".[bench,dev,fhe]" --no-deps
.venv/bin/python -m pytest -q
```

## 这台 Mac（已经配好）

什么都不用装：`platform/.venv`（Python 3.11.4）、Node 22、uv、`platform/var/`（种子、根密钥、DB）和 `GPU Stablecoin` 链接都在。环境丢了时：

- `platform/.venv` 坏了：把旧的挪到废纸篓，然后重跑上面 `uv venv` 和两条 `uv pip install`。
- `node_modules` 坏了：`npm --prefix web ci && npm --prefix app ci`。
- 注册表 DB 坏了：`cd platform && .venv/bin/python -m tagora.bootstrap --split hidden --fresh`。
- 链接丢了：`"$P/_tools/link_dropbox.sh" ~/Tagora Tagora`。

## 日常：开工和收工（两台机器一样）

- 开工：`cd ~/Tagora`（Windows：WSL 里 `cd ~/tagora`）→ 确认在 `phase0-mvp` 上 → `git pull`。
- 收工：`git status`（确认没有 `platform/var/`、`corpus/hidden/`、密钥或 `GPU Stablecoin` 的内容）→ `git add -A` → `git commit -m "<说明>"`（按 CLAUDE.md 约定，末尾加 Co-Authored-By 行）→ `git push`。
- 对 Claude 说的两句话：
  - 开工："先 git pull，然后读 CLAUDE.md，告诉我上次做到哪了"
  - 收工："更新 CLAUDE.md 里的进度，然后提交并推送"
- 收工只推 `phase0-mvp`。合并到 `main` 等于公开发布网站，只有用户明确要求时才做。

## Mac 离线时

- 能做（Claude Code 不能用，只能自己动手）：后端测试、公开集和隐藏集横评、`tagora.sim`、FHE 网格、本机 API 和 MCP 网关、前端 dev server（`node_modules` 已装的前提下）、本地 `git commit`。
- 不能做：`npm ci` 和 `uv pip install` 这类要下载的操作、`git pull/push`、Pages 部署、`GPU Stablecoin/` 的 Dropbox 同步。
- 联网后：先 `git pull --rebase`，再 `git push`。

## 本项目特别注意

- **公开仓库**：不提交任何密钥、私钥、`platform/var/`、`benchmarks/pdf/corpus/hidden/`、`GPU Stablecoin/` 的内容，也不提交私人资料。隐藏题库永不公开，只提交成绩（`benchmarks/pdf/results/`）。
- **换行符会让能力卡失效**：能力卡绑定代码哈希，CRLF 一改，哈希就变。WSL 和 Windows 两边的 git 都要设 `core.autocrlf input`。改了某个工具的任何文件，都要重新验证，并同时改 `tagora.toml` 的 `version`。
- **后端只在 WSL2 里跑**：沙箱用了 `resource`、`preexec_fn`、`os.killpg`，原生 Windows 上没有。
- **调参只用公开集**，结论用隐藏集验证。模拟的部分（TEE 根密钥、USDC、演示价格、Demo 里的大模型 Worker）要在 UI 和文档里标明是模拟。
- 前端改完先在浏览器里看一眼再提交（3D 场景和图表，构建通过不等于显示正确）。
- `GPU Stablecoin/` 两台机器共用：同一个文件不要两边同时改。
- 4090 目前代码里没用上。要用的话，需要在 WSL2 里装 NVIDIA 的 WSL 驱动和 CUDA（CLAUDE.md "Windows 注意事项"）。

## 出问题怎么办

- **`GPU Stablecoin` 链接丢了**：Mac 跑 `link_dropbox.sh`（见上）；WSL 里重做第 2 步的 `ln -s`（`setup_windows.ps1 -LinkOnly` 不管 Tagora）。
- **Dropbox 冲突副本**（文件名带"冲突副本 / conflicted copy"）：对比两份，留下正确的一份，另一份挪到废纸篓。
- **拉下来后能力卡失效，或 `git status` 里一堆没改过的文件**：先查 `git config core.autocrlf`，应为 `input`；再让 Claude 检查是哪些文件的换行变了。
- **`git pull --rebase` 冲突或依赖装不上**：冲突解决后 `git add <文件>`，再 `git rebase --continue`。改了依赖要用 `uv pip compile --universal` 重新生成 `requirements-lock.txt` 并提交。OpenCV 报错就装 `libgl1 libglib2.0-0`。
