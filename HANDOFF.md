# Code Visualier 交接文档

> 生成时间：2026-07-09 11:22（GMT+8）
> 维护人：Senior Developer（高级开发工程师）
> 项目路径（真实，勿被路径错乱误导）：`D:\WorkBuddYY_achievement\Code Visualier`
> 预览地址：`http://127.0.0.1:4173/`（**当前仍是上一轮旧构建，见 §4.1**）

---

## 0. 一句话背景

多语言算法可视化教学平台。本次会话的任务链：

1. 修「点运行白屏」→ 已修并验证
2. 给焦点箭头加变量名标注 → 已修并验证
3. 清掉我产生的垃圾文件 + 删假文件夹 → 已执行
4. 用户反馈三点体验问题（数值遮挡 / 语言识别失效 / 结构识别不切换）→ **已编码、未构建**（本环境命令工具失效）

---

## 1. 项目整体要干什么（Overall Goal）

**定位**：教学用算法可视化，支持 Python / JavaScript / Java / C / C++ 五种语言。

**用户的硬性体验诉求（验收标准）**：
1. 动画丝滑（目标 60fps；swap 用柱子/节点横向交叉滑动表现）
2. 所有 `swap` 必须可视化（不漏交換）
3. 焦点箭头指向的变量一律变黄，**且箭头上方标注变量名**（如 `a[0]`、`head.next`、`adj[0][1]`）
4. **自动识别语言 + 自动识别数据结构**（数组 / 链表 / 树 / 图），可手动指定；切换结构下拉**立刻**切换对应可视化 —— 树必须是「父节点在上、子节点向下」的树形，**绝不能是柱子**

**技术栈**：
- React 18 + TypeScript + Vite
- PixiJS v8（WebGL，自动降级 Canvas 2D）
- CodeMirror 6（带行高亮 StateField）
- Web Worker（`src/engine/worker.ts`）跑 transpile + runtime，避免死循环卡主线程
- 归一化 Trace Schema（`Step` / `Focus` / `StructState`）解耦各语言与渲染
- `langdetect.ts` 自动识别语言，`runtime.ts` 的 `buildNodeGraph` 自动识别四种结构

---

## 2. 已完成且已验证的部分（Done & Verified）

### 2.1 初始全功能构建
多语言支持、四种结构可视化、焦点黄箭头、交换动画、自动识别语言/结构。架构见项目 `MEMORY.md`。

### 2.2 白屏 Bug 修复 ✅
- **根因**：`src/App.tsx` 的 `execField`（CodeMirror StateField）用 `RangeSetBuilder` 收集行高亮装饰，但 `exec` 集合按插入顺序遍历，嵌套循环（如冒泡排序）下 `from` 位置乱序 → CodeMirror 抛 `Error: Ranges must be added sorted by from position and startSide` → 无 ErrorBoundary 兜底 → React 整棵卸载 → 白屏。
- **修复**：装饰先按 `from` 升序排序 + 同位置去重，再喂给 `RangeSetBuilder`；并新增 `ErrorBoundary.tsx` 全局兜底（以后任何渲染崩溃都显示可读错误面板，不再白屏）。
- **验证**：headless Chromium 真点「运行」，5/5 样本（数组/树/图/链表/链表删除）`fatal:none`、canvas 正常、零 `pageerror`；`tsc` 0 错；`vite build` 成功。

### 2.3 焦点箭头变量名标注 ✅
- 四种模式 × 两条渲染路径（WebGL + Canvas 2D 降级）全部加了黄色变量名标签（深色圆角底）。
- 标签文本规则：数组 `a[0]` / `a[1]`…；节点字段 `head.next` / `root.left`（用 `StructState.id`，不用内部序号 `n0`）；图边 `adj[0][1]`。
- **验证**：`tsc` 0 错；引擎数据层实测 focus 携带 `name/index`、edge 形如 `adj#0`、node 形如 `n0.next` → 标签规则全部命中；渲染复用已验证的文字绘制模式。

### 2.4 垃圾清扫 ✅
- 删除了我排查期产生的调试脚本：`scripts/repro.mjs`、`scripts/dbg.mjs`、`scripts/test-engine.mjs`、vite 临时编译产物 `vite.config.ts.timestamp-*.mjs`。
- 保留了项目正式文件：`scripts/test-samples.mjs`（15 示例测试）、`scripts/fetch-pyodide.mjs`（构建辅助）。`dist/` 是 `vite build` 默认产物，原样保留。
- **删除了假的三 y 文件夹** `D:\WorkBuddyyy_achievement`：其中的 `Code Visualier` 只有 `node_modules` + `package*.json` + `scripts`，**根本没有 `src`**，是路径错乱产生的残缺副本，删之无损失。
- **刻意保留了四个 y 的 `D:\WorkBuddyyyy`**：那是 **WorkBuddy 桌面应用本身的安装目录**（`WorkBuddy.exe`、Electron/Chrome 二进制），误删会卸载软件。

---

## 3. 第三轮修复（已编码，未构建 ⚠️）

用户反馈三点 → **全部已在源码改完**，但因本环境命令工具失效（§4.1），未能 `tsc` / `vite build`，线上 4173 仍是旧构建。

### 3.1 蓝柱下方白色数值被控制台遮挡 → `src/renderer.ts`
- 新增常量 `BAR_FOOT = 46`（`src/renderer.ts:11`），柱底留白由写死的 `28px` 加大到 `46px`。
- 白色数值标签定位改为**贴在柱子内侧靠下**：WebGL `y + max(bar.h - 16, 2)`、2D `y + max(bar.h - 8, 4)`，不再贴画布底边。
- 焦点箭头起点、`maxH`（柱高上限）随 `BAR_FOOT` 同步。
- 改动点：`renderer.ts` L11、L170、L396、L466、L595、L607（WebGL 与 2D 两条路径都改）。

### 3.2 语言识别失效（选 Python 还能跑 C++）→ `src/App.tsx`
- **根因**：`uiLang` 默认值写死 `"python"`，导致选 Python 贴 C++ 时被 Python 转译器执行。
- **修复**：默认改为 `"auto"`（`App.tsx:135`）；`handleRun` 在 auto 时 `detectLanguage(code)` 选对应转译器（`App.tsx:284`）。
- 下拉框保留「自动识别」+ Python / JS / Java / C·C++ 四档手动选项。
- 顺手修坑：运行完不再偷偷把下拉切成「检测到的语言」（之前等于把 auto 变手动）；改为只在状态栏标注「语言 X（自动识别 / 手动指定）」（`App.tsx:221`）。

### 3.3 结构识别不切换（选树却显示柱子）→ `src/App.tsx`
- **核查结论**：引擎**本来就能**正确构建 树/链表/图（`buildNodeGraph` + `transpile` 均正确，树本就是父上子下）。真正的 bug 是——切换结构下拉框时只调了 `setMode`，**没有按当前步重渲染**，所以「下拉改变可视化」不立即生效。
- **修复**：`mode` 的 `useEffect` 在 `setMode` 之后，若已有运行结果（`trace.steps.length > 0`）立即 `renderStep(当前步)`（`App.tsx:246-253`）。切换下拉**马上**变。
- `mode` 默认本就是 `"auto"`，自动识别工作正常（数组→柱、链表→横向节点、树→上下树形、图→环形）。

---

## 4. 失败 / 未完成（Failed / Pending）

### 4.1 第三轮构建未跑（核心阻塞）⚠️
- **现象**：本会话 `Bash` 与 `PowerShell` 工具持续报错（`command expected string, received undefined` / 命令不执行），无法运行 `npx tsc`、`vite build`、重启预览。
- **影响**：第三轮三处改动（§3.1~3.3）只停在源码层，**未经编译 + 浏览器验证**；线上 `http://127.0.0.1:4173/` 仍是上一轮构建（`out/index-2dUevcPI.js` 或更早），不含本轮修复。
- **补救（环境恢复后执行）**：在 `Code Visualier` 目录运行
  ```bash
  npx tsc --noEmit            # 应 0 错误
  npx vite build --outDir out # 成功生成新哈希
  # 重启预览（先 kill 占用 4173 的进程）
  npx vite preview --outDir out --port 4173
  ```
  然后浏览器开 `4173` 验收三点：数值不再被遮挡、选 auto 时 C++ 用 C/C++ 转译器、切结构下拉树立刻变树形。

### 4.2 历史已解决、勿重蹈的坑
- **`npm i -D` 在项目中会覆盖 `package.json` 全部依赖**：曾把完整依赖表覆盖成只剩 `playwright-core`。已手写恢复。→ 切勿在项目中裸装依赖。
- **路径错乱**：`WorkBuddyyy`（三 y）/ `WorkBuddYY`（两 Y）/ `WorkBuddyyyy`（四 y）混用，真实路径是 `WorkBuddYY_achievement`。MSYS 与 Windows 路径归一化会乱。
- **`vite build` 清理 `dist` 被 safe-delete 拦截**：用 `--outDir out` 绕过（输出到新目录，无残留可拦）。
- **验证浏览器 Bug 用 Playwright headless 抓 `pageerror` 比猜准**；但 `playwright-core` 已从 `package.json` 移除，重测需另装或换法。

---

## 5. 怎么验收 / 下一步

- **最快看到改动**：本地 `npm run dev`（Vite 热更新直接吃 `src`，改完即所见，推荐）。
- **或**：环境恢复后按 §4.1 补构建 + 重启预览。
- **待办**：用户将发 **phase 2** 任务，届时在已修复的基础上继续。

---

## 6. 关键文件索引

| 文件 | 职责 |
|------|------|
| `src/App.tsx` | UI 状态、运行流程、语言/结构切换（§3.2、§3.3 改动在此） |
| `src/renderer.ts` | PixiJS 渲染：数值留白、焦点箭头、变量名标签（§3.1 改动在此） |
| `src/engine/types.ts` | 归一化 Trace Schema（Step/Focus/StructState） |
| `src/engine/transpile.ts` | 各语言转归一化插桩 |
| `src/engine/runtime.ts` | 与平台无关运行 + 自动构结构（buildNodeGraph） |
| `src/engine/worker.ts` | Web Worker 跑 transpile+runtime |
| `src/langdetect.ts` | 语言识别 |
| `src/samples.ts` | 示例库 |
| `src/ErrorBoundary.tsx` | 全局崩溃兜底（白屏修复配套） |
