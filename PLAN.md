# Code Visualier — 实施计划（PLAN）

> 中文友好 · 丝滑动画 · 粘贴代码自动识别语言并可视化的在线平台
> 参考：algorithm-visualizer（运行时/后端复用，MIT）、hello-algo（内容/动画风格参考，CC-BY）

---

## 0. 已锁定的关键决策

| 项 | 决策 |
|---|---|
| 整体路线 | **A+B**：复用现成后端 + tracer 库，并自研**自动插桩器**（粘贴裸代码自动可视化） |
| 前端框架 | React + TypeScript + Vite（单应用，文件精简） |
| 编辑器 | CodeMirror 6（行高亮与时间轴联动） |
| 渲染库 | **PixiJS v8**（WebGL，性能极致） |
| 自动插桩先行语言 | **Python**（settrace，客户端 Pyodide） |
| 执行服务 | **直接 fork** `algorithm-visualizer/server`（Docker 跑 C++/Java，Phase 3） |
| 动画 | `ticker` 缓动插值；时间轴 scrubber（播放/暂停/逐帧/拖拽） |
| 内容 | 中文 UI + 中文算法目录（hello-algo 讲解 port） |

---

## 1. 核心架构

```
[粘贴代码]
   ├─ Python / JS ──► 客户端执行 + 自动插桩(Pyodide / Worker) ──┐
   │                                                           ├─► 归一化 Trace Schema ─► PixiJS 渲染(丝滑)
   └─ C++ / Java ──► fork 的 server(Docker, tracer 范式) ──────┘        （与语言无关，统一）
```

- **Python/JS 自动可视化走客户端**：秒开、免服务器、免沙箱运维。这是标题功能的实现路径。
- **C++/Java**：经 fork 的 server（Docker 沙箱）走 tracer 范式（用现成算法库，或写 tracer 版）。

---

## 2. 归一化 Trace Schema（铰链）

见 `src/trace.ts`。要点：
```ts
type Step = { line: number; event: StepEvent; scope: Scope; highlights?: string[] }
type Trace = { steps: Step[]; structures: Struct[] }
```
自动插桩器（Py/JS）与现成 tracer（C++/Java）都输出此 schema，前端只写一套渲染。

---

## 3. 目录结构（单应用，精简）

```
Code Visualier/
├─ index.html
├─ package.json / vite.config.ts / tsconfig.json
├─ src/
│  ├─ main.tsx          # 入口
│  ├─ App.tsx           # 编辑器 + 时间轴 + 联动
│  ├─ trace.ts          # 归一化 schema（铰链）
│  ├─ detect.ts         # 语言自动识别
│  ├─ runners.ts        # Python(Pyodide) / JS(Worker) 自动插桩执行器
│  ├─ renderer.ts       # PixiJS 渲染器
│  └─ styles.css
├─ server/              # fork 的 algorithm-visualizer/server（C++/Java，Phase 3）
├─ PLAN.md / README.md
```

---

## 4. 分阶段路线图与进度

### Phase 0（地基）— ✅ 已完成
- [x] 单应用骨架 + 归一化 Trace Schema
- [x] Python 自动插桩（sys.settrace）概念验证 + 接入前端执行器
- [x] 语言识别 / 前端脚手架 / 渲染器 / 时间轴联动
- [ ] fork `algorithm-visualizer/server` 到 `server/`（Phase 3 用）

### Phase 1（路线 A 可 demo）— ✅ 已完成（客户端侧）
- [x] 编辑器(CodeMirror) + 行高亮联动
- [x] trace → PixiJS 渲染 + 时间轴（播放/暂停/逐帧/拖拽）
- [x] 中文 UI

### Phase 2（路线 B 差异化）— 🟡 进行中
- [x] Python 自动插桩客户端可视化（已可运行）
- [x] JS 自动插桩（Worker + 轻量插桩，best-effort）
- [ ] 算法专属漂亮动画（排序柱子交换动画、树节点等）

### Phase 3（持续）
- [ ] C++/Java 经 fork server 走 tracer 范式
- [ ] 账号 / 分享链接
- [ ] 测试 + CI（满足 advanced project 标准）

---

## 5. 许可证与合规
- algorithm-visualizer 全家（server/tracers/algorithms）均为 **MIT**，可 fork/改/发，须保留版权声明。
- hello-algo 为 CC-BY，port 其内容须署名。
- 本项目整体 MIT。

## 6. 风险与已知坑
- **自动可视化 ≠ 任意裸代码**：v1 真·自动覆盖 Python/JS；C++/Java 走 tracer 范式。
- JS 自动插桩为 best-effort（行级快照 + eval 抓变量），复杂作用域可能漏抓，属已知限制。
- 客户端 Pyodide 约 10MB，首屏需 loading 优化（已用 CDN 懒加载）。
- fork 的 server 是 2022 年代码，依赖/Java 路径需适配（Phase 3）。
