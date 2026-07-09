import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

// 全局兜底：渲染器在 requestAnimationFrame / Web Worker 回调里的异常也能显示，避免静默白屏。
window.addEventListener("error", (e) => {
  console.error("[Code Visualier] 全局错误：", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[Code Visualier] 未处理的 Promise 拒绝：", e.reason);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
