// 可视化运行时（与平台无关）：
//  - 插桩后的用户代码每一步调用 CVS(line, focus, snap) 记录一次状态快照。
//  - runtime 把快照转成归一化 Step，并从快照里自动构建结构化状态（链表/树/图/数组）。
//  - 在 Web Worker（浏览器）与 Node（测试）里都能跑，保证行为一致。

import type {
  CVEdge,
  CVNode,
  Focus,
  Scope,
  Step,
  StepEvent,
  StructKind,
  StructState,
  Value,
} from "./types";

/** 节点工厂：transpiler 把 `new Node(x)` / `malloc` 等翻译为 CVN(...) 调用。 */
export interface CVNodeObj {
  __cvNode: true;
  __cvId: string;
  __cvVal: string;
  val?: unknown;
  value?: unknown;
  data?: unknown;
  next?: unknown;
  left?: unknown;
  right?: unknown;
  adj?: unknown;
  neighbors?: unknown;
  children?: unknown;
  [k: string]: unknown;
}

let _nodeSeq = 0;
export function CVN(value: unknown, fields: Record<string, unknown> = {}): CVNodeObj {
  const id = "n" + _nodeSeq++;
  const obj: CVNodeObj = {
    __cvNode: true,
    __cvId: id,
    __cvVal: fmt(value),
    ...fields,
  };
  return obj;
}
export function resetNodeSeq() {
  _nodeSeq = 0;
}

/** 节点字段访问的焦点（安全：非节点返回 null 被过滤）。 */
export function CVfn(node: unknown, field: string): any {
  if (isNode(node)) return { t: "n", id: (node as CVNodeObj).__cvId, f: field };
  return null;
}
/** 数组下标访问的焦点（安全：下标越界返回 null）。 */
export function CVfi(name: string, arr: unknown, idx: unknown): any {
  if (Array.isArray(arr) && typeof idx === "number" && Number.isFinite(idx) && idx >= 0 && idx < arr.length) {
    const raw = arr[idx];
    const v = typeof raw === "number" ? raw : Number.isNaN(Number(raw)) ? null : Number(raw);
    return { t: "i", n: name, i: idx, v };
  }
  return null;
}
/** 图的边焦点（邻接表 adj[u][v]）。 */
export function CVfe(name: string, i: unknown, j: unknown): any {
  if (typeof i === "number" && typeof j === "number") {
    return { t: "e", from: name + "#" + i, to: name + "#" + j };
  }
  return null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function isNode(v: unknown): v is CVNodeObj {
  return !!v && typeof v === "object" && (v as any).__cvNode === true;
}
function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}
function isNum(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

/** 把任意 JS 值转成归一化 Value（用于变量栏显示）。 */
export function cvSafe(v: unknown): Value {
  if (isNode(v)) return { kind: "ref", id: (v as CVNodeObj).__cvId };
  if (isArr(v)) return { kind: "list", items: v.map(cvSafe) };
  if (v !== null && typeof v === "object") {
    const entries: Array<[string, Value]> = Object.keys(v as object).map((k) => [
      k,
      cvSafe((v as any)[k]),
    ]);
    return { kind: "dict", entries };
  }
  return { kind: "primitive", value: fmt(v) };
}

/** 节点展示值：优先 val/value/data，否则回退 id。 */
function nodeDisplay(n: CVNodeObj): string {
  const cand = n.val ?? n.value ?? n.data;
  if (cand === undefined || cand === null) return n.__cvId;
  return fmt(cand);
}

// ---------- 结构构建 ----------

function detectArrayStructure(name: string, arr: unknown[]): StructState | null {
  // 纯数字数组 -> 柱状图
  if (arr.length > 0 && arr.every(isNum)) {
    return {
      id: name,
      kind: "array",
      nodes: arr.map((x, i) => ({ id: name + "#" + i, value: fmt(x) })),
      edges: [],
    };
  }
  // 二维数字数组 -> 邻接表图
  if (
    arr.length > 0 &&
    arr.every((row) => isArr(row) && (row as unknown[]).every(isNum))
  ) {
    const nodes: CVNode[] = arr.map((_, i) => ({ id: name + "#" + i, value: String(i) }));
    const edges: CVEdge[] = [];
    arr.forEach((row, u) => {
      (row as unknown[]).forEach((w) => {
        const wi = Number(w);
        if (Number.isInteger(wi) && wi >= 0 && wi < arr.length && wi !== u) {
          edges.push({ from: name + "#" + u, to: name + "#" + wi, kind: "adj" });
        }
      });
    });
    return { id: name, kind: "graph", nodes, edges };
  }
  return null;
}

function buildNodeGraph(rootName: string, root: CVNodeObj): StructState {
  // 判定类型：仅当 left/right/adj 实际非 null 时才算树/图（CVN 会把它们默认置 null）
  let kind: StructKind = "linkedlist";
  const nodes: CVNode[] = [];
  const edges: CVEdge[] = [];
  const seen = new Set<string>();
  const queue: CVNodeObj[] = [root];

  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.__cvId)) continue;
    seen.add(n.__cvId);
    nodes.push({ id: n.__cvId, value: nodeDisplay(n) });

    if (n.left != null || n.right != null) kind = "tree";
    if (isArr(n.adj) || isArr(n.neighbors)) kind = "graph";

    if (kind === "tree") {
      if (isNode(n.left)) edges.push({ from: n.__cvId, to: n.left.__cvId, label: "L", kind: "left" });
      if (isNode(n.right)) edges.push({ from: n.__cvId, to: n.right.__cvId, label: "R", kind: "right" });
      if (isNode(n.left) && !seen.has(n.left.__cvId)) queue.push(n.left);
      if (isNode(n.right) && !seen.has(n.right.__cvId)) queue.push(n.right);
    } else if (kind === "graph") {
      const adj = (isArr(n.adj) ? n.adj : n.neighbors) as unknown[];
      adj?.forEach((t) => {
        if (isNode(t) && !seen.has(t.__cvId)) queue.push(t);
        if (isNode(t)) edges.push({ from: n.__cvId, to: t.__cvId, label: "", kind: "adj" });
      });
    } else {
      const nx = n.next;
      if (isNode(nx)) {
        edges.push({ from: n.__cvId, to: nx.__cvId, label: "next", kind: "next" });
        if (!seen.has(nx.__cvId)) queue.push(nx);
      }
    }
  }
  return { id: rootName, kind, nodes, edges, rootId: root.__cvId };
}

function detectAndBuild(snap: ScopeLike): StructState[] {
  const out: StructState[] = [];
  const kindPriority: StructKind[] = ["tree", "graph", "linkedlist", "array"];
  let best: StructState | null = null;

  for (const [name, raw] of Object.entries(snap)) {
    if (name.startsWith("__")) continue;
    if (isNode(raw)) {
      const st = buildNodeGraph(name, raw);
      out.push(st);
      if (!best || kindPriority.indexOf(st.kind) < kindPriority.indexOf(best.kind)) best = st;
    } else if (isArr(raw)) {
      const st = detectArrayStructure(name, raw);
      if (st) {
        out.push(st);
        if (!best || kindPriority.indexOf(st.kind) < kindPriority.indexOf(best.kind)) best = st;
      }
    }
  }
  // 去重：遍历指针（如链表里的 p）与 root 共享节点时，会构建出「子集」结构。
  // 丢弃节点集合是其它结构子集的结构，只保留最完整的那一个，避免画面重复/抖动。
  const filtered: StructState[] = [];
  for (let i = 0; i < out.length; i++) {
    const si = out[i];
    const siIds = new Set(si.nodes.map((n) => n.id));
    let isSubset = false;
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue;
      const sj = out[j];
      if (sj.nodes.length > si.nodes.length) {
        const sjIds = new Set(sj.nodes.map((n) => n.id));
        if (si.nodes.every((n) => sjIds.has(n.id))) { isSubset = true; break; }
      }
    }
    if (!isSubset) filtered.push(si);
  }
  return filtered;
}

type ScopeLike = Record<string, unknown>;

// ---------- 运行时 ----------

export class CVRuntime {
  steps: Step[] = [];
  lang = "";
  error: string | null = null;
  private prev?: { scope: ScopeLike; structures: StructState[] };

  /** 用户代码每步调用：CVS(line, focusSpecs, snap) */
  CVS = (line: number, focusSpecs: any[] = [], snap: ScopeLike = {}): void => {
    if (this.steps.length >= 6000) {
      this.error = "步数过多（疑似死循环），已停止。请检查循环条件。";
      throw new Error(this.error);
    }
    const scope: Scope = {};
    for (const [k, v] of Object.entries(snap)) {
      if (k.startsWith("__")) continue;
      try {
        scope[k] = cvSafe(v);
      } catch {
        /* ignore */
      }
    }
    const focus: Focus[] = (focusSpecs || [])
      .map((f): Focus | null => {
        if (!f) return null;
        if (f.t === "i") return { kind: "index", name: f.n, index: f.i, value: f.v };
        if (f.t === "n") return { kind: "node", nodeId: f.id, field: f.f };
        if (f.t === "e") return { kind: "edge", from: f.from, to: f.to };
        return null;
      })
      .filter(Boolean) as Focus[];

    const structures = detectAndBuild(snap);

    let event: StepEvent = "line";
    let note: string | undefined;
    if (focus.some((f) => f.kind === "index")) {
      event = "compare"; // 具体是否为 swap 由 maybeCollapseSwap 判定
    } else if (structures.length) {
      const crud = this.detectCrud(structures);
      if (crud) { event = crud.event; note = crud.note; }
    }

    const step: Step = { line, event, scope, focus, structures, note };
    // 折叠临时变量交换：若上一步是「单元素改动」且本步与上上步构成两元素互换，则丢弃中间步。
    this.maybeCollapseSwap(step);
    this.prev = { scope: snap, structures };
  };

  private listChanged(a: Scope, b: Scope): { name: string; changed: number[] } | null {
    const lists = Object.keys(a).filter(
      (k) => a[k].kind === "list" && (a[k] as any).items.every((i: any) => i.kind === "primitive")
    );
    for (const k of lists) {
      const la = a[k] as any, lb = b[k] as any;
      if (!lb || lb.kind !== "list" || la.items.length !== lb.items.length) continue;
      const changed: number[] = [];
      for (let i = 0; i < la.items.length; i++)
        if (la.items[i].value !== lb.items[i].value) changed.push(i);
      if (changed.length > 0) return { name: k, changed };
    }
    return null;
  }

  private isSwap(a: Scope, b: Scope): { name: string; i: number; j: number } | null {
    const r = this.listChanged(a, b);
    if (!r || r.changed.length !== 2) return null;
    const [i, j] = r.changed;
    const la = (a[r.name] as any).items, lb = (b[r.name] as any).items;
    if (la[i].value === lb[j].value && la[j].value === lb[i].value)
      return { name: r.name, i, j };
    return null;
  }

  private maybeCollapseSwap(step: Step) {
    if (this.steps.length >= 2) {
      const last = this.steps[this.steps.length - 1];
      const prev = this.steps[this.steps.length - 2];
      const mid = this.listChanged(last.scope, prev.scope);
      const swap = this.isSwap(step.scope, prev.scope);
      if (mid && mid.changed.length === 1 && swap && swap.name === mid.name) {
        // 中间步是临时赋值，丢弃它，本步记为 swap
        this.steps.pop();
        const prevFocus = this.steps[this.steps.length - 1]?.focus;
        step.event = "swap";
        step.note = `swap ${swap.name}[${swap.i}] ↔ ${swap.name}[${swap.j}]`;
        step.focus = this.mergeFocus(prevFocus, step.focus);
        this.steps.push(step);
        return;
      }
    }
    this.steps.push(step);
  }

  private mergeFocus(a?: Focus[], b?: Focus[]): Focus[] {
    const seen = new Set<string>();
    const out: Focus[] = [];
    const add = (f: Focus) => {
      const key =
        f.kind === "index" ? `i:${f.name}:${f.index}` :
        f.kind === "node" ? `n:${f.nodeId}:${f.field}` :
        `e:${f.from}:${f.to}`;
      if (!seen.has(key)) { seen.add(key); out.push(f); }
    };
    (a ?? []).forEach(add);
    (b ?? []).forEach(add);
    return out;
  }

  private detectCrud(structures: StructState[]): { event: StepEvent; note: string } | undefined {
    if (!this.prev) return undefined;
    const prevById = new Map<string, StructState>();
    this.prev.structures.forEach((s) => prevById.set(s.id, s));
    for (const s of structures) {
      const p = prevById.get(s.id);
      if (!p) continue;
      if (s.nodes.length > p.nodes.length) return { event: "insert", note: `insert into ${s.id}` };
      if (s.nodes.length < p.nodes.length) return { event: "delete", note: `delete from ${s.id}` };
      // 值变化
      const pm = new Map(p.nodes.map((n) => [n.id, n.value]));
      for (const n of s.nodes) if (pm.get(n.id) !== n.value) return { event: "update", note: `update ${s.id}` };
    }
    return undefined;
  }

  finish() {
    return { steps: this.steps, structures: this.steps[0]?.structures ?? [], error: this.error };
  }
}
