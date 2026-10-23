# Code Visualizer

中文友好 · 丝滑动画 · 粘贴代码自动识别语言并可视化的在线平台。

- **Python / JS**：粘贴裸代码即可在浏览器内自动可视化（客户端执行 + 自动插桩，无需后端）。
- **C++ / Java**：经 fork 的 `algorithm-visualizer/server`（Docker 沙箱）走 tracer 范式（见 `server/README.md`）。
- 所有语言统一输出**归一化 Trace Schema**，前端用 PixiJS(WebGL) 丝滑渲染。

## 技术栈
React + TypeScript + Vite · CodeMirror 6（编辑器/行高亮）· PixiJS v8（WebGL 渲染）·
Pyodide（浏览器内 Python）· Web Worker（浏览器内 JS 插桩）。

## 运行
```bash
npm install
npm run dev      # 打开 http://localhost:5173
npm run build    # 生产构建
```

## 已落地能力
- [x] 语言自动识别（Python / JS）
- [x] Python 客户端自动插桩（sys.settrace）→ 逐行变量快照
- [x] JS 客户端轻量插桩（Worker + 行级快照）
- [x] PixiJS 柱状图渲染 + 步骤间缓动插值（丝滑）
- [x] 时间轴：播放 / 暂停 / 逐帧 / 拖拽 + 编辑器当前行高亮联动
- [x] 中文 UI

## 目录
- `src/trace.ts`：归一化 Trace Schema（铰链）
- `src/runners.ts`：Python(Pyodide) / JS(Worker) 自动插桩执行器
- `src/renderer.ts`：PixiJS 渲染器
- `src/App.tsx`：编辑器 + 时间轴 + 联动
- `server/`：fork 的 algorithm-visualizer/server（C++/Java 执行，Phase 3）

详见 [PLAN.md](PLAN.md)。
