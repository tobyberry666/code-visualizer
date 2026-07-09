# server/ — fork 自 algorithm-visualizer/server

本目录用于放置 **fork 的 `algorithm-visualizer/server`**（MIT 许可证，须保留版权声明）。
它用 Docker 容器编译/运行 C++/Java/Python/JS 代码，并把可视化指令流回传给前端。
本项目仅在跑 **C++ / Java** 等需要编译的语言时使用它；Python/JS 的自动可视化走客户端（见 `packages/auto-instrument`）。

## fork 步骤（Phase 0 待执行）
```bash
# 在 server/ 目录内克隆上游
git clone --depth 1 https://github.com/algorithm-visualizer/server.git .
```

## 已知适配点
- 上游最后提交约 2022 年，依赖可能需小修以适配当前 Node/Docker。
- Java 编译历史上走 AWS Lambda，本项目需替换为 Docker 编译路径。
- 须保留上游 MIT 版权声明（LICENSE / 文件头）。

## 与本项目前端的对接
前端消费归一化 Trace Schema（`packages/trace-schema`）。若上游 tracer 指令格式与 schema 不一致，
需在 `apps/web` 内写一层适配器（把上游指令映射为 schema）。
