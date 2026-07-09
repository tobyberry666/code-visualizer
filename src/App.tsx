import { useEffect, useRef, useState, useMemo } from "react";
import { EditorView, basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import {
  EditorState,
  Compartment,
  StateField,
  StateEffect,
  RangeSetBuilder,
} from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";
import { Visualizer } from "./renderer";
import { detectLanguage, detectStructure } from "./langdetect";
import type { StructKind } from "./langdetect";
import { SAMPLES } from "./samples";
import type { Lang } from "./engine/transpile";
import type { Focus, Step, Trace } from "./engine/types";
import type { RunRequest } from "./engine/worker";

type UiLang = Lang | "auto";
type ThemePref = "light" | "dark" | "system";
type ModeSel = "auto" | "array" | "linkedlist" | "tree" | "graph";

interface RunResult {
  steps: Step[];
  structures: any[];
  detectedKind?: string;
  detectedLang?: string;
  error?: string;
}

/* 当前执行行高亮 + 已执行行累计（与时间轴联动） */
const markLine = StateEffect.define<number>();
const clearExec = StateEffect.define<null>();
const execField = StateField.define<{ exec: Set<number>; cur: number; deco: DecorationSet }>({
  create() {
    return { exec: new Set(), cur: 0, deco: Decoration.none };
  },
  update(st, tr) {
    let exec = st.exec, cur = st.cur, changed = false;
    for (const e of tr.effects) {
      if (e.is(markLine)) {
        cur = e.value;
        if (e.value > 0) { exec = new Set(exec); exec.add(e.value); }
        changed = true;
      } else if (e.is(clearExec)) {
        exec = new Set(); cur = 0; changed = true;
      }
    }
    if (!changed) return st;
    const doc = tr.state.doc;
    // 必须按 from 升序加入 RangeSetBuilder，否则 CodeMirror 抛
    // "Ranges must be added sorted by from position" 并导致整页崩溃。
    const ranges: { from: number; deco: Decoration }[] = [];
    if (cur > 0 && cur <= doc.lines) {
      const cl = doc.line(cur);
      ranges.push({ from: cl.from, deco: Decoration.line({ class: "cv-highlight" }) });
    }
    for (const ln of exec) {
      if (ln === cur || ln < 1 || ln > doc.lines) continue;
      const l = doc.line(ln);
      ranges.push({ from: l.from, deco: Decoration.line({ class: "cv-executed" }) });
    }
    ranges.sort((a, b) => a.from - b.from);
    const builder = new RangeSetBuilder<Decoration>();
    let lastFrom = -1;
    for (const r of ranges) {
      if (r.from === lastFrom) continue; // 同位置去重
      builder.add(r.from, r.from, r.deco);
      lastFrom = r.from;
    }
    return { exec, cur, deco: builder.finish() };
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.deco),
});

const langCompartment = new Compartment();

const LANG_OPTIONS: { value: UiLang; label: string }[] = [
  { value: "auto", label: "自动识别" },
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C / C++" },
];

const MODE_OPTIONS: { value: ModeSel; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "array", label: "数组" },
  { value: "linkedlist", label: "链表" },
  { value: "tree", label: "树" },
  { value: "graph", label: "图" },
];

const KIND_LABEL: Record<string, string> = {
  array: "数组",
  linkedlist: "链表",
  tree: "树",
  graph: "图",
};
const STRUCT_LABEL: Record<string, string> = {
  array: "数组",
  linkedlist: "链表",
  tree: "树",
  graph: "图",
};
const LANG_LABEL: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C / C++",
  unknown: "未知",
};
const EVENT_LABEL: Record<string, string> = {
  line: "执行",
  compare: "比较",
  swap: "交换",
  assign: "赋值",
  call: "调用",
  return: "返回",
  insert: "插入",
  delete: "删除",
  update: "更新",
  error: "错误",
};

function focusText(f: Focus): string {
  if (f.kind === "index") return `${f.name}[${f.index}]`;
  if (f.kind === "node") return `节点 ${f.nodeId}${f.field ? "." + f.field : ""}`;
  if (f.kind === "edge") return `边 ${f.from} → ${f.to}`;
  return "";
}

export default function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vizRef = useRef<Visualizer | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [uiLang, setUiLang] = useState<UiLang>(SAMPLES[0].lang);
  const [mode, setMode] = useState<ModeSel>("auto");
  const [theme, setTheme] = useState<ThemePref>("system");
  const [sampleKey, setSampleKey] = useState(SAMPLES[0].name);
  const [tab, setTab] = useState<"examples" | "workspace">("examples");

  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(550);
  const [status, setStatus] = useState("粘贴代码或选择示例，点「运行」开始可视化");
  const [statusError, setStatusError] = useState(false);
  const [detected, setDetected] = useState<{ kind?: string; lang?: string }>({});

  const steps = trace?.steps.length ?? 0;
  const curStep: Step | undefined = trace?.steps[Math.min(step, Math.max(0, steps - 1))];

  // 最新 uiLang 的引用（供 worker 回调内读取，避免闭包陈旧）
  const uiLangRef = useRef<UiLang>("auto");
  uiLangRef.current = uiLang;
  // 运行回调引用（供快捷键调用，避免每次渲染重订阅键盘事件）
  const runRef = useRef<() => void>(() => {});

  // 主题：解析 system -> light/dark
  const effectiveTheme: "light" | "dark" =
    theme === "system"
      ? typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  // 初始化编辑器
  useEffect(() => {
    if (!editorRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: SAMPLES[0].code,
        extensions: [
          basicSetup,
          langCompartment.of(python()),
          execField,
          EditorView.lineWrapping,
        ],
      }),
      parent: editorRef.current,
    });
    viewRef.current = view;
    return () => view.destroy();
  }, []);

  // 初始化可视化 + Worker
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const v = new Visualizer();
    let alive = true;
    v.init(container).then(() => {
      if (alive && !v.isDestroyed) {
        vizRef.current = v;
        v.setTheme(effectiveTheme);
      }
    });
    const worker = new Worker(new URL("./engine/worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<RunResult>) => {
      const r = e.data;
      setRunning(false);
      if (r.error) {
        setStatus("运行出错：" + r.error);
        setStatusError(true);
        setPlaying(false);
        return;
      }
      const t: Trace = {
        steps: r.steps,
        structures: r.structures,
        detectedKind: r.detectedKind as any,
        detectedLang: r.detectedLang,
      };
      setTrace(t);
      setStep(0);
      setPlaying(true);
      setDetected({ kind: r.detectedKind, lang: r.detectedLang });
      const kindLabel = KIND_LABEL[r.detectedKind ?? ""] ?? "数组";
      const langLabel = LANG_LABEL[r.detectedLang ?? "unknown"] ?? "未知";
      const langMode = uiLangRef.current === "auto" ? "自动识别" : "手动指定";
      setStatus(`共 ${r.steps.length} 步 · 识别为 ${kindLabel} · 语言 ${langLabel}（${langMode}）`);
      setStatusError(false);
    };
    workerRef.current = worker;
    return () => {
      alive = false;
      v.destroy();
      worker.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题应用到 DOM 与可视化
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    vizRef.current?.setTheme(effectiveTheme);
  }, [effectiveTheme]);

  // 语言切换 -> 编辑器高亮
  useEffect(() => {
    if (!viewRef.current) return;
    const ext = uiLang === "python" ? python() : javascript();
    viewRef.current.dispatch({ effects: langCompartment.reconfigure(ext) });
  }, [uiLang]);

  // 结构模式 -> 可视化（切换即按当前步重新渲染，让下拉选择立刻生效）
  useEffect(() => {
    vizRef.current?.setMode(mode === "auto" ? null : (mode as any));
    if (trace && trace.steps.length > 0) {
      const s = trace.steps[Math.min(step, trace.steps.length - 1)];
      if (s) vizRef.current?.renderStep(s);
    }
  }, [mode]);

  function loadSample(key: string) {
    const s = SAMPLES.find((x) => x.name === key);
    if (!s || !viewRef.current) return;
    viewRef.current.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: s.code },
    });
    viewRef.current.dispatch({ effects: clearExec.of(null) });
    setUiLang(s.lang);
    setSampleKey(key);
    setTrace(null);
    setStep(0);
    setPlaying(false);
    setDetected({});
    setStatus("已载入示例，点「运行」开始可视化");
    setStatusError(false);
  }

  function handleReset() {
    setTrace(null);
    setStep(0);
    setPlaying(false);
    setDetected({});
    if (viewRef.current) viewRef.current.dispatch({ effects: clearExec.of(null) });
    setStatus("已重置 · 粘贴代码或选择示例后点「运行」");
    setStatusError(false);
  }

  async function handleRun() {
    if (!viewRef.current || !workerRef.current) return;
    const code = viewRef.current.state.doc.toString();
    const detected = detectLanguage(code);
    let effective: Lang;
    if (uiLang === "auto") {
      // unknown 时优先尝试 Python（无分号语言，JS 转译器无法处理）
      effective = (detected as Lang) || "python";
    } else {
      if (detected !== "unknown" && detected !== uiLang) {
        const gotLabel = LANG_LABEL[detected] ?? detected;
        const wantLabel = LANG_LABEL[uiLang] ?? uiLang;
        setStatus(`代码与所选语言不一致：代码为 ${gotLabel}，所选为 ${wantLabel}，无法运行`);
        setStatusError(true);
        return;
      }
      effective = uiLang;
    }
    // 结构校验
    if (mode !== "auto") {
      const detectedStruct = detectStructure(code);
      if (detectedStruct !== "unknown" && detectedStruct !== mode) {
        setStatus(`代码与所选结构不一致：代码为 ${STRUCT_LABEL[detectedStruct]}，所选为 ${STRUCT_LABEL[mode]}，无法运行`);
        setStatusError(true);
        return;
      }
    }
    setRunning(true);
    setStatus("正在运行…");
    setStatusError(false);
    vizRef.current?.clear();
    const req: RunRequest = { code, lang: effective };
    workerRef.current.postMessage(req);
  }
  runRef.current = handleRun;

  // 播放循环
  useEffect(() => {
    if (!playing || !trace) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s >= trace.steps.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [playing, trace, speed]);

  // 渲染当前步
  useEffect(() => {
    if (!trace) return;
    const s = trace.steps[Math.min(step, trace.steps.length - 1)];
    if (!s) return;
    vizRef.current?.renderStep(s);
    if (viewRef.current && s.line > 0) {
      viewRef.current.dispatch({ effects: markLine.of(s.line) });
    }
  }, [step, trace]);

  // 键盘快捷键：空格 播放/暂停 · ←/→ 步进 · R 运行
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.closest?.(".cm-editor")) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (trace) setPlaying((p) => !p);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (trace) { setPlaying(false); setStep((s) => Math.min(steps - 1, s + 1)); }
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (trace) { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }
      } else if (e.key === "r" || e.key === "R") {
        runRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trace, steps]);

  // 派生：实时指标 / 焦点变量
  const metrics = useMemo(() => {
    const m = { compare: 0, swap: 0, insert: 0, delete: 0, update: 0 };
    trace?.steps.forEach((s) => {
      if (s.event in m) (m as any)[s.event]++;
    });
    return m;
  }, [trace]);

  const focusKeys = useMemo(() => {
    const set = new Set<string>();
    curStep?.focus?.forEach((f) => {
      if (f.kind === "index") set.add(f.name);
    });
    return set;
  }, [curStep]);

  const grouped = useMemo(() => {
    const g: Record<string, typeof SAMPLES> = {};
    SAMPLES.forEach((s) => { (g[s.lang] = g[s.lang] || []).push(s); });
    return g;
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span>
          <div>
            <h1>Code Visualier</h1>
            <span className="sub">多语言 · 丝滑动画 · 粘贴即可视化</span>
          </div>
        </div>
        <div className="tabs">
          <button className={"tab" + (tab === "examples" ? " active" : "")} onClick={() => { setTab("examples"); vizRef.current?.clear(); }}>示例</button>
          <button className={"tab" + (tab === "workspace" ? " active" : "")} onClick={() => { setTab("workspace"); setUiLang("auto"); setMode("auto"); handleReset(); vizRef.current?.clear(); }}>工作台</button>
        </div>
        <div className="actions">
          {tab === "examples" && (
            <select className="ctl" value={sampleKey} onChange={(e) => loadSample(e.target.value)} title="示例库（按语言分组）">
              {Object.entries(grouped).map(([lang, items]) => (
                <optgroup key={lang} label={LANG_LABEL[lang] ?? lang}>
                  {items.map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <select
            className="ctl"
            value={uiLang}
            onChange={(e) => setUiLang(e.target.value as UiLang)}
            title="运行语言（自动识别或手动指定）"
          >
            {LANG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            className="ctl"
            value={mode}
            onChange={(e) => setMode(e.target.value as ModeSel)}
            title="可视化结构模式"
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button className="theme-btn" onClick={() => {
            setTheme((t) => (t === "dark" ? "light" : t === "light" ? "system" : "dark"));
          }} title="切换主题（深 / 浅 / 跟随系统）">
            {theme === "dark" ? "🌙 深色" : theme === "light" ? "☀ 浅色" : "🖥 跟随系统"}
          </button>
          <button className="primary" onClick={handleRun} disabled={running}>
            {running ? "运行中…" : "▶ 运行"}
          </button>
          <button onClick={() => setPlaying((p) => !p)} disabled={!trace}>
            {playing ? "⏸ 暂停" : "▶ 播放"}
          </button>
          <button onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} disabled={!trace}>
            上一步
          </button>
          <button
            onClick={() => { setPlaying(false); setStep((s) => Math.min(steps - 1, s + 1)); }}
            disabled={!trace}
          >
            下一步
          </button>
          <button onClick={handleReset} disabled={!trace} title="清空可视化结果">
            ↺ 重置
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="editor-pane">
          <div className="pane-title">
            {tab === "examples" ? "示例代码" : "工作台 — 粘贴你的代码，自动识别语言与数据结构"}
          </div>
          <div className="editor" ref={editorRef}></div>
        </section>

        <section className="viz-pane">
          <div className="pane-title">
            可视化
            {detected.kind && (
              <span className="badge">识别为：{KIND_LABEL[detected.kind] ?? detected.kind}</span>
            )}
            {detected.lang && (
              <span className="badge lang">{LANG_LABEL[detected.lang] ?? detected.lang}</span>
            )}
          </div>
          <div className="canvas" ref={containerRef} />
          <div className="inspect">
            <div className="inspect-title">焦点 / 当前状态</div>
            <div className="metrics">
              <span className="metric"><b>{metrics.swap}</b>交换</span>
              <span className="metric"><b>{metrics.compare}</b>比较</span>
              <span className="metric"><b>{metrics.insert}</b>插入</span>
              <span className="metric"><b>{metrics.delete}</b>删除</span>
              <span className="metric"><b>{metrics.update}</b>更新</span>
            </div>
            <div className="focus-row">
              {curStep?.focus && curStep.focus.length > 0 ? (
                curStep.focus.map((f, i) => (
                  <span key={i} className="focus-chip">{focusText(f)}</span>
                ))
              ) : (
                <span className="muted">（本步无焦点）</span>
              )}
            </div>
            <div className="event-line">
              {curStep ? (
                <>
                  <span className={"event-tag " + (EVENT_LABEL[curStep.event] || "line")}>{EVENT_LABEL[curStep.event] ?? curStep.event}</span>
                  {curStep.note && <span className="event-note">{curStep.note}</span>}
                </>
              ) : (
                <span className="muted">运行后展示当前步骤</span>
              )}
            </div>
            <div className="scope">
              {curStep ? (
                Object.entries(curStep.scope).map(([k, v]) => (
                  <div key={k} className="scope-item">
                    <span className={"scope-k" + (focusKeys.has(k) ? " focus-key" : "")}>{k}</span>
                    <span className="scope-v">{formatScope(v)}</span>
                  </div>
                ))
              ) : (
                <span className="muted">运行后展示变量快照</span>
              )}
            </div>
          </div>
          <div className="timeline">
            <button className="mini" onClick={() => { setPlaying(false); setStep(0); }} disabled={!trace}>⏮</button>
            <input
              type="range"
              min={0}
              max={Math.max(0, steps - 1)}
              value={Math.min(step, Math.max(0, steps - 1))}
              onChange={(e) => {
                setPlaying(false);
                setStep(Number(e.target.value));
              }}
            />
            <span className="step-label">
              {steps > 0 ? `${Math.min(step + 1, steps)} / ${steps}` : "0 / 0"}
            </span>
            <span className="speed">
              速度
              <input
                type="range"
                min={120}
                max={1200}
                step={30}
                value={1820 - speed}
                onChange={(e) => setSpeed(1820 - Number(e.target.value))}
                title="播放速度"
              />
            </span>
          </div>
          <div className={"status" + (statusError ? " status-error" : "")}>{status}</div>
          <div className="hint">
            快捷键：<kbd>空格</kbd> 播放/暂停 · <kbd>←</kbd>/<kbd>→</kbd> 单步 · <kbd>R</kbd> 运行 · 蓝底=执行过，亮蓝=当前行
          </div>
        </section>
      </main>
    </div>
  );
}

function formatScope(v: any): string {
  if (!v) return String(v);
  if (v.kind === "primitive") return v.value;
  if (v.kind === "list") {
    const items = v.items.slice(0, 16).map((it: any) => formatScope(it));
    return "[" + items.join(", ") + (v.items.length > 16 ? ", …" : "") + "]";
  }
  if (v.kind === "ref") return "●" + v.id;
  if (v.kind === "dict") return "{…}";
  return String(v);
}
