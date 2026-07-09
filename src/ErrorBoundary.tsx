import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * 全局错误边界：任何渲染期异常都不再「白屏」，而是展示可读的错误信息，
 * 方便定位（尤其可视化渲染器偶发的 PixiJS 运行时问题）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Code Visualier] 渲染异常：", error, info.componentStack);
  }

  private reload = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div className="fatal">
          <div className="fatal-card">
            <h2>页面渲染出错</h2>
            <p className="fatal-msg">{e.message || String(e)}</p>
            <pre className="fatal-stack">{e.stack ? e.stack.split("\n").slice(0, 12).join("\n") : ""}</pre>
            <div className="fatal-actions">
              <button className="primary" onClick={this.reload}>重试</button>
              <button onClick={() => location.reload()}>刷新页面</button>
            </div>
            <p className="fatal-tip">把上面的错误信息发给我，我可以直接定位修复。</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
