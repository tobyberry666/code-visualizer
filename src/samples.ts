import type { Lang } from "./engine/transpile";

export type StructHint = "array" | "linkedlist" | "tree" | "graph";

export interface Sample {
  name: string;
  lang: Lang;
  kind: StructHint;
  code: string;
}

export const SAMPLES: Sample[] = [
  // ---------------- 数组（排序） ----------------
  {
    name: "冒泡排序 · Python",
    lang: "python",
    kind: "array",
    code: `a = [5, 2, 8, 1, 9]
for i in range(len(a)):
    for j in range(i + 1, len(a)):
        if a[i] > a[j]:
            a[i], a[j] = a[j], a[i]
`,
  },
  {
    name: "冒泡排序 · JavaScript",
    lang: "javascript",
    kind: "array",
    code: `let a = [5, 2, 8, 1, 9];
for (let i = 0; i < a.length; i++) {
  for (let j = i + 1; j < a.length; j++) {
    if (a[i] > a[j]) {
      let t = a[i]; a[i] = a[j]; a[j] = t;
    }
  }
}
`,
  },
  {
    name: "冒泡排序 · Java",
    lang: "java",
    kind: "array",
    code: `int[] a = {5, 2, 8, 1, 9};
for (int i = 0; i < a.length; i++) {
  for (int j = i + 1; j < a.length; j++) {
    if (a[i] > a[j]) {
      int t = a[i]; a[i] = a[j]; a[j] = t;
    }
  }
}
`,
  },
  {
    name: "冒泡排序 · C",
    lang: "cpp",
    kind: "array",
    code: `int a[] = {5, 2, 8, 1, 9};
int n = 5;
for (int i = 0; i < n; i++) {
  for (int j = i + 1; j < n; j++) {
    if (a[i] > a[j]) {
      int t = a[i]; a[i] = a[j]; a[j] = t;
    }
  }
}
`,
  },
  {
    name: "冒泡排序 · C++",
    lang: "cpp",
    kind: "array",
    code: `#include <iostream>
using namespace std;
int a[] = {5, 2, 8, 1, 9};
int n = 5;
for (int i = 0; i < n; i++) {
  for (int j = i + 1; j < n; j++) {
    if (a[i] > a[j]) {
      int t = a[i]; a[i] = a[j]; a[j] = t;
    }
  }
}
`,
  },

  // ---------------- 链表 ----------------
  {
    name: "链表创建与遍历 · C",
    lang: "cpp",
    kind: "linkedlist",
    code: `struct Node { int val; struct Node* next; };
struct Node* head = (struct Node*)malloc(sizeof(struct Node));
head->val = 1;
head->next = (struct Node*)malloc(sizeof(struct Node));
head->next->val = 2;
head->next->next = (struct Node*)malloc(sizeof(struct Node));
head->next->next->val = 3;
head->next->next->next = NULL;
struct Node* p = head;
while (p != NULL) {
    int x = p->val;
    p = p->next;
}
`,
  },
  {
    name: "链表创建与遍历 · Java",
    lang: "java",
    kind: "linkedlist",
    code: `class Node { int val; Node next; }
Node head = new Node();
head.val = 1;
head.next = new Node();
head.next.val = 2;
head.next.next = new Node();
head.next.next.val = 3;
Node p = head;
while (p != null) {
    int x = p.val;
    p = p.next;
}
`,
  },
  {
    name: "链表插入节点 · C",
    lang: "cpp",
    kind: "linkedlist",
    code: `struct Node { int val; struct Node* next; };
struct Node* head = (struct Node*)malloc(sizeof(struct Node));
head->val = 1;
head->next = (struct Node*)malloc(sizeof(struct Node));
head->next->val = 2;
struct Node* p = (struct Node*)malloc(sizeof(struct Node));
p->val = 9;
p->next = head->next;
head->next = p;
struct Node* q = head;
while (q != NULL) {
    int x = q->val;
    q = q->next;
}
`,
  },

  // ---------------- 树 ----------------
  {
    name: "二叉树构建与遍历 · Python",
    lang: "python",
    kind: "tree",
    code: `root = Node(10)
root.left = Node(5)
root.right = Node(15)
root.left.left = Node(3)
root.left.right = Node(7)
stack = [root]
while len(stack) > 0:
    node = stack.pop()
    v = node.val
    if node.left:
        stack.append(node.left)
    if node.right:
        stack.append(node.right)
`,
  },
  {
    name: "二叉树构建 · C",
    lang: "cpp",
    kind: "tree",
    code: `struct TreeNode { int val; struct TreeNode* left; struct TreeNode* right; };
struct TreeNode* root = (struct TreeNode*)malloc(sizeof(struct TreeNode));
root->val = 10;
root->left = (struct TreeNode*)malloc(sizeof(struct TreeNode));
root->left->val = 5;
root->right = (struct TreeNode*)malloc(sizeof(struct TreeNode));
root->right->val = 15;
root->left->left = (struct TreeNode*)malloc(sizeof(struct TreeNode));
root->left->left->val = 3;
`,
  },

  // ---------------- 图 ----------------
  {
    name: "图的邻接表遍历 · Python",
    lang: "python",
    kind: "graph",
    code: `adj = [[1, 2], [0, 2], [0, 1]]
for i in range(len(adj)):
    for j in range(len(adj[i])):
        u = adj[i][j]
`,
  },
  {
    name: "图的邻接矩阵遍历 · C",
    lang: "cpp",
    kind: "graph",
    code: `int adj[3][3] = { {0, 1, 1}, {1, 0, 1}, {1, 1, 0} };
for (int i = 0; i < 3; i++) {
  for (int j = 0; j < 3; j++) {
    if (adj[i][j] == 1) {
      int e = adj[i][j];
    }
  }
}
`,
  },

  // ---------------- 更多数组（排序变体） ----------------
  {
    name: "选择排序 · Python",
    lang: "python",
    kind: "array",
    code: `a = [5, 2, 8, 1, 9]
for i in range(len(a)):
    m = i
    for j in range(i + 1, len(a)):
        if a[j] < a[m]:
            m = j
    if m != i:
        a[i], a[m] = a[m], a[i]
`,
  },
  {
    name: "插入排序 · JavaScript",
    lang: "javascript",
    kind: "array",
    code: `let a = [5, 2, 8, 1, 9];
for (let i = 1; i < a.length; i++) {
  let key = a[i];
  let j = i - 1;
  while (j >= 0 && a[j] > key) {
    a[j + 1] = a[j];
    j = j - 1;
  }
  a[j + 1] = key;
}
`,
  },

  // ---------------- 链表删除（CRUD 删除动画） ----------------
  {
    name: "链表删除节点 · C",
    lang: "cpp",
    kind: "linkedlist",
    code: `struct Node { int val; struct Node* next; };
struct Node* head = (struct Node*)malloc(sizeof(struct Node));
head->val = 1;
head->next = (struct Node*)malloc(sizeof(struct Node));
head->next->val = 2;
head->next->next = (struct Node*)malloc(sizeof(struct Node));
head->next->next->val = 3;
head->next->next->next = (struct Node*)malloc(sizeof(struct Node));
head->next->next->next->val = 4;
head->next->next->next->next = NULL;
struct Node* p = head;
struct Node* prev = NULL;
while (p != NULL) {
    if (p->val == 3) {
        if (prev != NULL) {
            prev->next = p->next;
        }
        break;
    }
    prev = p;
    p = p->next;
}
struct Node* q = head;
while (q != NULL) {
    int x = q->val;
    q = q->next;
}
`,
  },
];
