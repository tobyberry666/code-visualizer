import { Application, Graphics, Text } from "pixi.js";
import type { Focus, Step, StructState, StructKind } from "./engine/types";
import { asNumbers, formatValue, isList } from "./engine/types";

const FOCUS = 0xffe066; // 焦点黄
const NODE = 0x4f8cff; // 节点蓝
const NODE_TREE = 0x36c2a6; // 树青
const NODE_GRAPH = 0xb98cff; // 图紫
const EDGE_DARK = 0x6b7494;
const EDGE_LIGHT = 0x9aa3c0;
const BAR_FOOT = 46; // 柱底留白：避免白色数值标签被底部控制台/状态栏遮挡

interface Bar {
  value: number; x: number; targetX: number; h: number; targetH: number; lift: number;
  t?: Text;
}
interface RN {
  id: string; value: string;
  x: number; y: number; tx: number; ty: number;
  scale: number; tscale: number;
  alpha: number; talpha: number;
  removing: boolean;
  flash?: number;
}
interface REdge { from: string; to: string; label?: string; kind?: string; focus: boolean; }

/**
 * 统一可视化渲染器（PixiJS / WebGL，自动降级 2D）。
 * 支持四种模式：array(柱状)、linkedlist、tree、graph。
 *  - 数组交换：两根柱子横向交叉滑过（高度不变），体现 swap。
 *  - 所有焦点：数组下标 → 黄色箭头；节点/边 → 黄色高亮环/描边。
 *  - 结构 CRUD：节点增删改随代码运行以缓动动画呈现（插入生长、删除淡出、改值闪烁）。
 *  - 支持 light / dark 主题切换。
 */
export class Visualizer {
  private mode: "webgl" | "2d" | null = null;
  private app: Application | null = null;
  private sceneG = new Graphics();
  private labelsG = new Graphics();
  private nodeTexts: Map<string, Text> = new Map();
  private edgeTexts: Map<string, Text> = new Map();
  private focusLabelTexts: Map<string, Text> = new Map();
  private usedFocusKeys = new Set<string>();
  private structName: string | null = null;
  private canvas2d: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private bars: Bar[] = [];
  private focus: Focus[] = [];
  private nodes: Map<string, RN> = new Map();
  private edges: REdge[] = [];
  private maxH = 300;
  private ready = false;
  private destroyed = false;
  private initPromise: Promise<void> | null = null;
  private forcedMode: StructKind | "array" | null = null;

  // 主题
  private theme: "light" | "dark" = "dark";
  private bg = 0x0f1220;
  private textColor = "#dfe6f5";
  private nodeText = "#ffffff";
  private edgeColor = EDGE_DARK;

  get isDestroyed() { return this.destroyed; }
  setMode(m: StructKind | "array" | null) { this.forcedMode = m; }

  setTheme(t: "light" | "dark") {
    this.theme = t;
    if (t === "dark") {
      this.bg = 0x0f1220; this.textColor = "#dfe6f5"; this.nodeText = "#ffffff"; this.edgeColor = EDGE_DARK;
    } else {
      this.bg = 0xf4f6fb; this.textColor = "#1a2238"; this.nodeText = "#0b1020"; this.edgeColor = EDGE_LIGHT;
    }
    if (this.mode === "webgl" && this.app) this.app.renderer.background.color = this.bg;
    this.drawScene();
  }
  private bgHex(): string { return "#" + this.bg.toString(16).padStart(6, "0"); }

  init(container: HTMLElement): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        const app = new Application();
        await app.init({
          resizeTo: container,
          background: this.bg,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        });
        if (this.destroyed) { app.destroy(true, { children: true }); return; }
        this.app = app;
        container.appendChild(app.canvas);
        this.app.stage.addChild(this.sceneG);
        this.app.stage.addChild(this.labelsG);
        this.app.ticker.add(() => this.tick());
        this.mode = "webgl";
        this.ready = true;
      } catch (e) {
        console.warn("[Visualizer] WebGL 初始化失败，降级 Canvas2D：", e);
        if (this.destroyed) return;
        this.setup2D(container);
        this.mode = "2d";
        this.ready = true;
      }
    })();
    return this.initPromise;
  }

  private setup2D(container: HTMLElement) {
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    this.canvas2d = canvas;
    this.ctx2d = canvas.getContext("2d");
    this.resize2D();
    window.addEventListener("resize", this.resize2D);
  }
  private resize2D = () => {
    if (!this.canvas2d || !this.ctx2d) return;
    const rect = this.canvas2d.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas2d.width = Math.max(1, rect.width * dpr);
    this.canvas2d.height = Math.max(1, rect.height * dpr);
    this.canvas2d.style.width = rect.width + "px";
    this.canvas2d.style.height = rect.height + "px";
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawScene();
  };

  private fontSize(): number {
    const W = this.mode === "webgl" ? this.app!.screen.width : this.canvas2d?.clientWidth || 600;
    return Math.max(11, Math.min(18, Math.round(W / 70)));
  }
  private W() { return this.mode === "webgl" ? this.app!.screen.width : this.canvas2d?.clientWidth || 600; }
  private H() { return this.mode === "webgl" ? this.app!.screen.height : this.canvas2d?.clientHeight || 300; }

  renderStep(step: Step) {
    if (!this.ready) return;
    this.focus = step.focus ?? [];
    const structureMode = this.decideStructure(step);
    if (structureMode) {
      this.clearBars();
      this.applyStructure(structureMode);
    } else {
      this.applyBars(step);
    }
  }

  private decideStructure(step: Step): StructState | null {
    const structs = step.structures ?? [];
    if (this.forcedMode === "array") return null;
    const nonArrays = structs.filter((s) => s.kind !== "array");
    if (nonArrays.length === 0) return null;
    // 优先与强制模式匹配，否则取第一个非数组结构
    if (this.forcedMode) {
      const m = nonArrays.find((s) => s.kind === this.forcedMode);
      if (m) return m;
    }
    return nonArrays[0];
  }

  // ---------------- 数组（柱状） ----------------

  private clearBars() {
    this.bars.forEach((b) => { try { b.t?.destroy(); } catch { /* */ } });
    this.bars = [];
  }

  private clearStructure() {
    this.nodes.clear();
    this.edges = [];
    for (const t of this.nodeTexts.values()) t.destroy();
    this.nodeTexts.clear();
    for (const t of this.edgeTexts.values()) t.destroy();
    this.edgeTexts.clear();
  }

  /** 清除所有可视化内容（柱子 + 结构 + 焦点标签） */
  clear() {
    this.clearBars();
    this.clearStructure();
    this.focus = [];
    for (const t of this.focusLabelTexts.values()) t.destroy();
    this.focusLabelTexts.clear();
    this.drawScene();
  }

  private applyBars(step: Step) {
    this.clearStructure();
    const listEntry = Object.entries(step.scope).find(([, v]) => isList(v as any));
    if (listEntry) {
      const nums = asNumbers(listEntry[1] as any);
      if (nums && nums.length > 0) {
        const viewH = this.mode === "webgl" ? this.app!.screen.height : this.canvas2d!.clientHeight || 300;
        this.maxH = Math.max(60, viewH - BAR_FOOT - 56);
        this.applyValues(nums);
        this.drawScene();
        return;
      }
    }
    this.bars = [];
    this.focus = [];
    this.drawScene();
  }

  private valueToHeight(n: number): number {
    return Math.max(6, Math.min(this.maxH, n * 8 + 6));
  }

  private applyValues(vals: number[]) {
    if (this.bars.length === 0 || this.bars.length !== vals.length) {
      this.bars.forEach((b) => { try { b.t?.destroy(); } catch { /* */ } });
      this.bars = vals.map((v, i) => {
        const h = this.valueToHeight(v);
        return { value: v, x: i, targetX: i, h, targetH: h, lift: 0, t: undefined };
      });
      return;
    }
    const prevVals = this.bars.map((b) => b.value);
    const changed: number[] = [];
    for (let i = 0; i < vals.length; i++) if (prevVals[i] !== vals[i]) changed.push(i);
    if (
      changed.length === 2 &&
      prevVals[changed[0]] === vals[changed[1]] &&
      prevVals[changed[1]] === vals[changed[0]]
    ) {
      const a = changed[0], b = changed[1];
      const tmp = this.bars[a];
      this.bars[a] = this.bars[b];
      this.bars[b] = tmp;
      this.bars[a].targetX = a;
      this.bars[b].targetX = b;
      this.bars[a].lift = 18;
      this.bars[b].lift = -18;
    } else {
      for (const i of changed) {
        this.bars[i].value = vals[i];
        this.bars[i].targetX = i;
        this.bars[i].targetH = this.valueToHeight(vals[i]);
      }
    }
  }

  // ---------------- 结构（链表/树/图） ----------------

  private applyStructure(st: StructState) {
    this.structName = st.id;
    const layout = this.layoutStructure(st);
    const targetIds = new Set(layout.nodes.map((n) => n.id));
    // 更新/新增节点
    for (const n of layout.nodes) {
      let rn = this.nodes.get(n.id);
      if (!rn) {
        rn = { id: n.id, value: n.value, x: n.x, y: n.y, tx: n.x, ty: n.y, scale: 0, tscale: 1, alpha: 0, talpha: 1, removing: false };
        this.nodes.set(n.id, rn);
      } else {
        rn.tx = n.x; rn.ty = n.y; rn.tscale = 1; rn.talpha = 1; rn.removing = false;
        if (rn.value !== n.value) { rn.value = n.value; rn.flash = 1; }
      }
    }
    // 删除：存在于旧但不在新目标中的节点 → 淡出
    for (const [id, rn] of this.nodes) {
      if (!targetIds.has(id) && !rn.removing) { rn.removing = true; rn.tscale = 0; rn.talpha = 0; }
    }
    // 边
    const focusEdge = new Set(
      this.focus.filter((f) => f.kind === "edge").map((f: any) => f.from + "->" + f.to)
    );
    this.edges = st.edges.map((e) => ({
      from: e.from, to: e.to, label: e.label, kind: e.kind,
      focus: focusEdge.has(e.from + "->" + e.to),
    }));
    this.drawScene();
  }

  private layoutStructure(st: StructState): { nodes: { id: string; value: string; x: number; y: number }[]; } {
    const W = this.W(), H = this.H();
    const padX = 60, padY = 50;
    const n = st.nodes.length;
    if (st.kind === "linkedlist") {
      const nextMap = new Map<string, string>();
      st.edges.forEach((e) => { if (e.kind === "next") nextMap.set(e.from, e.to); });
      const order: string[] = [];
      const seen = new Set<string>();
      let cur = st.rootId;
      while (cur && !seen.has(cur) && nextMap.has(cur)) {
        seen.add(cur); order.push(cur); cur = nextMap.get(cur)!;
      }
      if (cur && !seen.has(cur)) order.push(cur);
      // 若 rootId 不在（如节点图），按 edges 链不成则按节点顺序
      if (order.length === 0) order.push(...st.nodes.map((x) => x.id));
      const spacing = Math.min(120, (W - padX * 2) / Math.max(1, order.length));
      const bw = Math.min(64, spacing - 18);
      return { nodes: order.map((id, i) => {
        const v = st.nodes.find((x) => x.id === id)?.value ?? "";
        return { id, value: v, x: padX + i * spacing + bw / 2, y: H / 2 };
      }) };
    }
    if (st.kind === "tree") {
      const children = new Map<string, { left?: string; right?: string }>();
      st.edges.forEach((e) => {
        if (e.kind === "left") children.set(e.from, { ...(children.get(e.from) || {}), left: e.to });
        if (e.kind === "right") children.set(e.from, { ...(children.get(e.from) || {}), right: e.to });
      });
      const pos = new Map<string, { idx: number; depth: number }>();
      let counter = 0;
      const inorder = (id?: string, depth = 0) => {
        if (!id) return;
        const c = children.get(id);
        inorder(c?.left, depth + 1);
        pos.set(id, { idx: counter++, depth });
        inorder(c?.right, depth + 1);
      };
      inorder(st.rootId);
      if (pos.size === 0) st.nodes.forEach((x, i) => pos.set(x.id, { idx: i, depth: 0 }));
      const maxDepth = Math.max(...[...pos.values()].map((p) => p.depth), 1);
      const levelH = Math.min(90, (H - padY * 2) / (maxDepth + 1));
      const spacing = Math.min(110, (W - padX * 2) / Math.max(1, counter));
      return { nodes: st.nodes.map((x) => {
        const p = pos.get(x.id)!;
        return { id: x.id, value: x.value, x: padX + p.idx * spacing + spacing / 2, y: padY + p.depth * levelH };
      }) };
    }
    // graph：环形布局
    const R = Math.min(W, H) / 2 - 70;
    const cx = W / 2, cy = H / 2;
    return { nodes: st.nodes.map((x, i) => {
      const ang = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
      return { id: x.id, value: x.value, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
    }) };
  }

  // ---------------- 动画 ----------------

  private tick() {
    let moving = false;
    // 柱子
    for (const bar of this.bars) {
      const nx = bar.x + (bar.targetX - bar.x) * 0.18;
      if (Math.abs(nx - bar.x) > 0.002) moving = true; bar.x = nx;
      const nh = bar.h + (bar.targetH - bar.h) * 0.18;
      if (Math.abs(nh - bar.h) > 0.3) moving = true; bar.h = nh;
      if (Math.abs(bar.lift) > 0.5) { bar.lift *= 0.85; moving = true; } else bar.lift = 0;
    }
    // 节点
    for (const rn of this.nodes.values()) {
      const nx = rn.x + (rn.tx - rn.x) * 0.2;
      const ny = rn.y + (rn.ty - rn.y) * 0.2;
      const ns = rn.scale + (rn.tscale - rn.scale) * 0.2;
      const na = rn.alpha + (rn.talpha - rn.alpha) * 0.2;
      if (Math.abs(nx - rn.x) > 0.3 || Math.abs(ny - rn.y) > 0.3 || Math.abs(ns - rn.scale) > 0.01 || Math.abs(na - rn.alpha) > 0.01) moving = true;
      rn.x = nx; rn.y = ny; rn.scale = ns; rn.alpha = na;
      if (rn.flash) rn.flash = Math.max(0, rn.flash - 0.05);
    }
    // 删除完成 → 移除
    for (const [id, rn] of [...this.nodes]) {
      if (rn.removing && rn.alpha < 0.02) { this.nodes.delete(id); const t = this.nodeTexts.get(id); if (t) { t.destroy(); this.nodeTexts.delete(id); } }
    }
    if (moving) this.drawScene();
  }

  // ---------------- 绘制 ----------------

  private nodeColor(st: StructKind | "array"): number {
    if (st === "tree") return NODE_TREE;
    if (st === "graph") return NODE_GRAPH;
    return NODE;
  }

  private drawScene() {
    if (this.mode === "webgl") this.drawSceneWebGL();
    else this.drawScene2D();
  }

  private drawSceneWebGL() {
    if (!this.app) return;
    const g = this.sceneG;
    g.clear();
    this.labelsG.clear();
    this.usedFocusKeys.clear();
    const fs = this.fontSize();
    const hasStructure = this.nodes.size > 0;

    if (hasStructure) {
      const color = this.currentStructKindColor();
      // 边
      const used = new Set<string>();
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b) continue;
        const key = e.from + "->" + e.to;
        used.add(key);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: e.focus ? 3 : 1.5, color: e.focus ? FOCUS : this.edgeColor, alpha: Math.min(a.alpha, b.alpha) });
        if (e.label) {
          let t = this.edgeTexts.get(key);
          if (!t) { t = new Text({ text: e.label, style: { fill: this.textColor, fontSize: 11 } }); this.app!.stage.addChild(t); this.edgeTexts.set(key, t); }
          t.text = e.label; t.x = (a.x + b.x) / 2 - 6; t.y = (a.y + b.y) / 2 - 8; t.alpha = Math.min(a.alpha, b.alpha);
        }
      }
      for (const [k, t] of this.edgeTexts) if (!used.has(k)) { t.destroy(); this.edgeTexts.delete(k); }

      // 节点
      for (const rn of this.nodes.values()) {
        const w = 60 * rn.scale, h = 42 * rn.scale;
        const x = rn.x - w / 2, y = rn.y - h / 2;
        const focused = this.focus.some((f) => f.kind === "node" && f.nodeId === rn.id);
        g.roundRect(x, y, w, h, 8).fill({ color, alpha: rn.alpha });
        if (focused) g.roundRect(x - 3, y - 3, w + 6, h + 6, 10).stroke({ width: 3, color: FOCUS, alpha: rn.alpha });
        let t = this.nodeTexts.get(rn.id);
        if (!t) { t = new Text({ text: rn.value, style: { fill: this.nodeText, fontSize: fs, fontWeight: "bold" } }); this.app!.stage.addChild(t); this.nodeTexts.set(rn.id, t); }
        t.text = rn.value; t.alpha = rn.alpha; t.x = rn.x - t.width / 2; t.y = rn.y - t.height / 2;
        if (rn.flash) g.roundRect(x - 3, y - 3, w + 6, h + 6, 10).stroke({ width: 2, color: 0xffffff, alpha: rn.flash });
      }
      this.drawStructFocusWebGL(g);
    } else {
      // 柱子
      const { gap, bw, n } = this.barLayout();
      for (let i = 0; i < n; i++) {
        const bar = this.bars[i];
        const x = gap + bar.x * (bw + gap);
        const y = this.H() - bar.h - BAR_FOOT - bar.lift;
        const isSwap = Math.abs(bar.lift) > 0.5;
        g.rect(x, y, bw, bar.h).fill(isSwap ? 0xffa94d : NODE);
        if (!bar.t && this.app) {
          bar.t = new Text({ text: String(bar.value), style: { fill: "#ffffff", fontSize: Math.max(10, fs - 1), fontWeight: "bold" } });
          this.app.stage.addChild(bar.t);
        }
        if (bar.t) {
          bar.t.text = String(bar.value);
          bar.t.x = x + bw / 2 - bar.t.width / 2;
          bar.t.y = y + Math.max(bar.h - 16, 2);
          bar.t.alpha = 1;
        }
      }
      // 焦点箭头（黄）
      this.drawBarsFocusWebGL(g, gap, bw);
    }
    // 清理本帧未使用的焦点标签
    for (const [k, t] of this.focusLabelTexts) {
      if (!this.usedFocusKeys.has(k)) { t.destroy(); this.focusLabelTexts.delete(k); }
    }
  }

  private drawStructFocusWebGL(g: Graphics) {
    for (const f of this.focus) {
      if (f.kind === "node") {
        const rn = this.nodes.get(f.nodeId);
        if (!rn) continue;
        const w = 60 * rn.scale, h = 42 * rn.scale;
        const x = rn.x - w / 2, y = rn.y - h / 2;
        const cx = rn.x;
        const topY = y - 26, tipY = y - 6;
        g.moveTo(cx, topY).lineTo(cx, tipY).stroke({ width: 2, color: FOCUS, alpha: rn.alpha });
        g.moveTo(cx - 5, tipY - 7).lineTo(cx, tipY).lineTo(cx + 5, tipY - 7).stroke({ width: 2, color: FOCUS, alpha: rn.alpha });
        this.drawFocusLabelWebGL(f, cx, topY - 4, rn.alpha);
      } else if (f.kind === "edge") {
        const a = this.nodes.get(f.from), b = this.nodes.get(f.to);
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const ah = 9;
        g.moveTo(mx - ah * Math.cos(ang - 0.4), my - ah * Math.sin(ang - 0.4))
          .lineTo(mx, my)
          .lineTo(mx - ah * Math.cos(ang + 0.4), my - ah * Math.sin(ang + 0.4))
          .stroke({ width: 2, color: FOCUS, alpha: Math.min(a.alpha, b.alpha) });
        this.drawFocusLabelWebGL(f, mx, my - 12, Math.min(a.alpha, b.alpha));
      }
    }
  }

  private currentStructKindColor(): number {
    if (this.edges.some((e) => e.kind === "left" || e.kind === "right")) return NODE_TREE;
    if (this.edges.some((e) => e.kind === "adj")) return NODE_GRAPH;
    return NODE;
  }

  private barLayout() {
    const n = this.bars.length;
    const W = this.W();
    const gap = Math.max(6, Math.min(20, W / n / 6));
    const bw = n > 0 ? (W - gap * (n + 1)) / n : 0;
    return { W, H: this.H(), gap, bw, n };
  }

  private drawBarsFocusWebGL(g: Graphics, gap: number, bw: number) {
    for (const f of this.focus) {
      if (f.kind !== "index") continue;
      if (f.index < 0 || f.index >= this.bars.length) continue;
      const bar = this.bars[f.index];
      const cx = gap + bar.x * (bw + gap) + bw / 2;
      const yTop = this.H() - bar.h - BAR_FOOT - bar.lift;
      const top = yTop - 14 - 14, bot = yTop - 4;
      g.moveTo(cx, top).lineTo(cx, bot).stroke({ width: 2, color: FOCUS });
      g.moveTo(cx - 5, bot - 6).lineTo(cx, bot).lineTo(cx + 5, bot - 6).stroke({ width: 2, color: FOCUS });
      this.drawFocusLabelWebGL(f, cx, top - 6, 1);
    }
  }

  // ---------------- 焦点箭头标签（变量名标注） ----------------
  private focusKey(f: Focus): string {
    if (f.kind === "index") return `i:${f.name}:${f.index}`;
    if (f.kind === "node") return `n:${f.nodeId}:${f.field ?? ""}`;
    return `e:${f.from}->${f.to}`;
  }
  private focusLabel(f: Focus): string {
    if (f.kind === "index") return `${f.name}[${f.index}]`;
    if (f.kind === "node") {
      const base = this.structName ?? f.nodeId;
      return f.field ? `${base}.${f.field}` : base;
    }
    // 边焦点：from/to 形如 "adj#i" / "adj#j"
    const a = f.from.split("#"), b = f.to.split("#");
    if (a.length === 2 && b.length === 2 && a[0] === b[0]) return `${a[0]}[${a[1]}][${b[1]}]`;
    return `${f.from}→${f.to}`;
  }
  private drawFocusLabelWebGL(f: Focus, cx: number, labelY: number, alpha: number) {
    const key = this.focusKey(f);
    const label = this.focusLabel(f);
    const fs = this.fontSize();
    let t = this.focusLabelTexts.get(key);
    if (!t) {
      t = new Text({ text: label, style: { fill: FOCUS, fontSize: fs, fontWeight: "bold", fontFamily: "monospace" } });
      this.app!.stage.addChild(t);
      this.focusLabelTexts.set(key, t);
    }
    t.text = label;
    t.alpha = alpha;
    t.x = Math.round(cx - t.width / 2);
    t.y = Math.round(labelY - t.height);
    const padX = 5, padY = 3;
    this.labelsG.roundRect(t.x - padX, t.y - padY, t.width + padX * 2, t.height + padY * 2, 6)
      .fill({ color: 0x0f1220, alpha: 0.62 });
    this.usedFocusKeys.add(key);
  }
  private rr2d(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  private drawFocusLabel2D(ctx: CanvasRenderingContext2D, f: Focus, cx: number, labelY: number, alpha: number) {
    const label = this.focusLabel(f);
    const fs = this.fontSize();
    ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const tw = ctx.measureText(label).width;
    const padX = 5, padY = 3, th = fs + 4;
    ctx.globalAlpha = alpha * 0.62;
    ctx.fillStyle = "#0f1220";
    this.rr2d(ctx, cx - tw / 2 - padX, labelY - th - padY, tw + padX * 2, th + padY * 2, 6);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffe066";
    ctx.fillText(label, cx, labelY);
    ctx.globalAlpha = 1;
  }

  private drawScene2D() {
    if (!this.ctx2d || !this.canvas2d) return;
    const ctx = this.ctx2d;
    const W = this.W(), H = this.H();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this.bgHex(); ctx.fillRect(0, 0, W, H);
    const fs = this.fontSize();
    const hasStructure = this.nodes.size > 0;
    if (hasStructure) {
      const color = this.currentStructKindColor();
      const hex = "#" + color.toString(16).padStart(6, "0");
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b) continue;
        ctx.strokeStyle = e.focus ? "#ffe066" : this.theme === "dark" ? "#6b7494" : "#9aa3c0";
        ctx.lineWidth = e.focus ? 3 : 1.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (e.label) { ctx.fillStyle = this.textColor; ctx.font = "11px sans-serif"; ctx.fillText(e.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 4); }
      }
      for (const rn of this.nodes.values()) {
        const w = 60 * rn.scale, h = 42 * rn.scale;
        const x = rn.x - w / 2, y = rn.y - h / 2;
        const focused = this.focus.some((f) => f.kind === "node" && f.nodeId === rn.id);
        ctx.globalAlpha = rn.alpha;
        ctx.fillStyle = hex; ctx.fillRect(x, y, w, h);
        if (focused) { ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 3; ctx.strokeRect(x - 3, y - 3, w + 6, h + 6); }
        ctx.fillStyle = this.nodeText; ctx.font = `bold ${fs}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(rn.value, rn.x, rn.y);
        ctx.globalAlpha = 1;
      }
      // 焦点箭头（节点 / 边）
      for (const f of this.focus) {
        if (f.kind === "node") {
          const rn = this.nodes.get(f.nodeId); if (!rn) continue;
          const w = 60 * rn.scale, h = 42 * rn.scale; const x = rn.x - w / 2, y = rn.y - h / 2; const cx = rn.x;
          const topY = y - 26, tipY = y - 6;
          ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(cx, topY); ctx.lineTo(cx, tipY); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - 5, tipY - 7); ctx.lineTo(cx, tipY); ctx.lineTo(cx + 5, tipY - 7); ctx.stroke();
          this.drawFocusLabel2D(ctx, f, cx, topY - 4, rn.alpha);
        } else if (f.kind === "edge") {
          const a = this.nodes.get(f.from), b = this.nodes.get(f.to); if (!a || !b) continue;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; const ang = Math.atan2(b.y - a.y, b.x - a.x); const ah = 9;
          ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(mx - ah * Math.cos(ang - 0.4), my - ah * Math.sin(ang - 0.4));
          ctx.lineTo(mx, my);
          ctx.lineTo(mx - ah * Math.cos(ang + 0.4), my - ah * Math.sin(ang + 0.4));
          ctx.stroke();
          this.drawFocusLabel2D(ctx, f, mx, my - 12, Math.min(a.alpha, b.alpha));
        }
      }
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    } else {
      const { gap, bw, n } = this.barLayout();
      for (let i = 0; i < n; i++) {
        const bar = this.bars[i];
        const x = gap + bar.x * (bw + gap);
        const y = H - bar.h - BAR_FOOT - bar.lift;
        ctx.fillStyle = Math.abs(bar.lift) > 0.5 ? "#ffa94d" : "#4f8cff";
        ctx.fillRect(x, y, bw, bar.h);
        ctx.fillStyle = "#ffffff"; ctx.font = `bold ${Math.max(10, fs - 1)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.fillText(String(bar.value), x + bw / 2, y + Math.max(bar.h - 8, 4));
        ctx.textAlign = "left";
      }
      ctx.strokeStyle = "#ffe066"; ctx.fillStyle = "#ffe066"; ctx.lineWidth = 2;
      for (const f of this.focus) {
        if (f.kind !== "index" || f.index < 0 || f.index >= n) continue;
        const bar = this.bars[f.index];
        const cx = gap + bar.x * (bw + gap) + bw / 2;
        const yTop = H - bar.h - BAR_FOOT - bar.lift;
        ctx.beginPath(); ctx.moveTo(cx, yTop - 28); ctx.lineTo(cx, yTop - 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 5, yTop - 10); ctx.lineTo(cx, yTop - 4); ctx.lineTo(cx + 5, yTop - 10); ctx.stroke();
        this.drawFocusLabel2D(ctx, f, cx, yTop - 34, 1);
      }
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.app) { try { this.app.destroy(true, { children: true }); } catch { /* */ } this.app = null; }
    for (const t of this.nodeTexts.values()) t.destroy();
    this.nodeTexts.clear();
    for (const t of this.edgeTexts.values()) t.destroy();
    this.edgeTexts.clear();
    for (const t of this.focusLabelTexts.values()) t.destroy();
    this.focusLabelTexts.clear();
    for (const b of this.bars) { try { b.t?.destroy(); } catch { /* */ } }
    this.bars = [];
    if (this.canvas2d) { window.removeEventListener("resize", this.resize2D); this.canvas2d.remove(); this.canvas2d = null; this.ctx2d = null; }
    this.ready = false; this.mode = null;
  }
}
