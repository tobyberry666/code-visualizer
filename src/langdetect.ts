import type { Lang } from "./engine/transpile";

export type StructKind = "array" | "linkedlist" | "tree" | "graph";

/**
 * 根据代码特征自动推断语言（教学常见写法）。
 * 返回 "unknown" 时由调用方退回默认语言。
 * 顺序很重要：强 C 信号 → Java → Python → 弱 C 信号 → JS 兜底。
 */
export function detectLanguage(code: string): Lang | "unknown" {
  const c = code;
  // 1) C/C++ 强信号
  if (
    /(^|\s)#include\b|int\s+main\s*\(|printf\s*\(|scanf\s*\(|malloc\s*\(|calloc\s*\(|\bstd::|cout\s*<<|cin\s*>>|using\s+namespace|->\s*\w|struct\s+\w+\s*\{|\bvector\s*</.test(c)
  ) {
    return "cpp";
  }
  // 2) Java
  if (
    /(public|private|protected)\s+class\b|public\s+static\s+void\s+main|System\.out|import\s+java\.|Scanner\b|String\[\]\s*args|int\s*\[\]|\bString\b\s+\w+\s*=|\bnew\s+[A-Z]\w*\s*\(/.test(c)
  ) {
    return "java";
  }
  // 3) Python
  if (
    /(^|\n)\s*def\s+\w+\s*\(|\bprint\s*\(|\belif\b|\bself\.|(^|\n)\s*import\s+\w|(^|\n)\s*from\s+\w+\s+import|\bfor\s+\w+\s+in\s+range\s*\(|\bfor\s+\w+\s+in\s+\w+\s*:\s*$/.test(c)
  ) {
    return "python";
  }
  // 4) C/C++ 弱信号（没有 #include 的纯数组算法，如 int a[] / for(int i)）
  if (
    /\b(int|char|float|double|void)\s+\w+\s*\[|\bfor\s*\(\s*(int|char|float|double|void)\b|\b(int|char|float|double|void)\s+\w+\s*=/.test(c)
  ) {
    return "cpp";
  }
  // 5) JavaScript
  if (
    /\bfunction\s+\w*\s*\(|=>|let\s+\w|const\s+\w|var\s+\w|console\.\w|document\.|import\s+.+\s+from\s+['"]/.test(c)
  ) {
    return "javascript";
  }
  // 含分号语句则按 JS 兜底
  if (/(;\s*$)/m.test(c)) return "javascript";
  return "unknown";
}

/**
 * 根据代码特征推断数据结构。
 * 返回 "unknown" 时无法判断，允许运行。
 */
export function detectStructure(code: string): StructKind | "unknown" {
  const c = code;
  // 图：邻接表 / 邻接矩阵 / edges / neighbors / adj
  if (/\badj\b|\.neighbors\b|\.edges\b|adjacency|邻接/.test(c)) return "graph";
  // 树：left / right / root / TreeNode / 二叉
  if (/\broot\b|\.left\b|\.right\b|TreeNode|BinaryTree|二叉/.test(c)) return "tree";
  // 链表：next / prev / ListNode / linked / 链表
  if (/\bnext\b|\.next\b|ListNode|LinkedList|linked|链表/.test(c)) return "linkedlist";
  // 数组：默认
  if (/\bfor\s*\(|\bfor\s+\w+\s+in\b|\bwhile\s*\(/.test(c)) return "array";
  return "unknown";
}
