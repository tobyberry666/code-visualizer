// 归一化 Trace Schema（整个可视化引擎的铰链）
// 自动插桩器（各语言 transpiler → 插桩 JS）统一输出此 schema，前端只写一套渲染。

export type StepEvent =
  | "line"
  | "compare"
  | "swap"
  | "assign"
  | "call"
  | "return"
  | "insert"
  | "delete"
  | "update"
  | "error";

export type Value =
  | { kind: "primitive"; value: string }
  | { kind: "list"; items: Value[] }
  | { kind: "dict"; entries: Array<[string, Value]> }
  | { kind: "ref"; id: string };

export interface Scope {
  [name: string]: Value;
}

export type StructKind = "array" | "linkedlist" | "tree" | "graph";

/** 一个被可视化聚焦的元素。三种形态：数组下标 / 节点字段 / 边。 */
export type Focus =
  | { kind: "index"; name: string; index: number; value?: number | null }
  | { kind: "node"; nodeId: string; field?: string }
  | { kind: "edge"; from: string; to: string };

/** 结构化状态的归一化形态（链表 / 树 / 图 / 数组）。 */
export interface CVNode {
  id: string;
  value: string;
  /** 是否已删除（CRUD 动画用，淡出后移除） */
  removed?: boolean;
}
export interface CVEdge {
  from: string;
  to: string;
  label?: string;
  kind?: "next" | "left" | "right" | "adj";
}
export interface StructState {
  id: string; // 结构变量名，如 "head"、"adj"、"a"
  kind: StructKind;
  nodes: CVNode[];
  edges: CVEdge[];
  rootId?: string;
}

export interface Step {
  line: number;
  event: StepEvent;
  scope: Scope;
  highlights?: string[];
  focus?: Focus[];
  /** 本步的结构化状态（链表/树/图/数组），由 runtime 从快照构建 */
  structures?: StructState[];
  /** 供 UI 展示的备注，如 "swap a[2] <-> a[5]" */
  note?: string;
}

export interface Trace {
  steps: Step[];
  structures: StructState[];
  /** 引擎判定出的整体结构类型（auto-detect 结果） */
  detectedKind?: StructKind;
  /** 引擎推断出的语言（auto-detect 结果） */
  detectedLang?: string;
  error?: string;
}

export function isList(v: Value | undefined): v is { kind: "list"; items: Value[] } {
  return !!v && v.kind === "list";
}

export function formatValue(v: Value, depth = 0): string {
  switch (v.kind) {
    case "primitive":
      return v.value;
    case "list": {
      const items = v.items.slice(0, 12).map((it) => formatValue(it, depth + 1));
      const more = v.items.length > 12 ? ", …" : "";
      return "[" + items.join(", ") + more + "]";
    }
    case "dict": {
      const ents = v.entries.slice(0, 8).map(([k, val]) => `${k}: ${formatValue(val, depth + 1)}`);
      const more = v.entries.length > 8 ? ", …" : "";
      return "{" + ents.join(", ") + more + "}";
    }
    case "ref":
      return v.id;
  }
}

/** 把 list 价值转为数字数组（用于画柱状图）；非纯数字则返回 null */
export function asNumbers(v: Value): number[] | null {
  if (v.kind !== "list") return null;
  const out: number[] = [];
  for (const item of v.items) {
    if (item.kind === "primitive") {
      const n = Number(item.value);
      if (Number.isNaN(n)) return null;
      out.push(n);
    } else {
      return null;
    }
  }
  return out;
}
