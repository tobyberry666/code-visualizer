// 教学子集 transpiler：把 Python / JavaScript / Java / C / C++ 的「常见算法写法」
// 翻译成带插桩的 JS，运行于 Web Worker（或 Node 测试）。
// 仅覆盖教学常见写法（声明、数组、循环、条件、节点类），并非完整编译器。

export type Lang = "python" | "javascript" | "java" | "c" | "cpp";

const NODE_GLOBALS = new Set([
  "Array", "Object", "Map", "Set", "Date", "RegExp", "Error", "Promise",
  "Math", "JSON", "Number", "String", "Boolean", "Symbol", "Proxy", "Reflect",
  "Int8Array", "Int16Array", "Int32Array", "Uint8Array", "Uint16Array", "Uint32Array",
  "Float32Array", "Float64Array", "CVN",
]);

const TYPE_WORDS = [
  "int", "float", "double", "char", "long", "short", "bool", "boolean", "void",
  "unsigned", "signed", "auto", "byte", "size_t", "uint8_t", "uint16_t", "uint32_t",
  "String", "Integer", "Double", "Long", "Float", "Character", "Boolean", "Byte",
];
const STOP_NAMES = new Set([
  ...TYPE_WORDS, "val", "value", "data", "next", "prev", "left", "right",
  "neighbors", "children", "first", "last", "e",
]);

/** 把 `Name(args)`（构造函数）翻译成 CVN(...) 节点工厂调用。 */
function convertNodeCalls(s: string, nodeClasses: Set<string>): string {
  return s.replace(/(?:new\s+)?([A-Za-z_$][\w$]*)\s*\(\s*([^()]*?)\s*\)/g, (m, name, args) => {
    if (NODE_GLOBALS.has(name)) return m;
    if (/^[A-Z]/.test(name) || nodeClasses.has(name)) {
      const first = (args.split(",")[0] || "").trim() || "undefined";
      return `CVN(${first}, {next:null,left:null,right:null})`;
    }
    return m;
  });
}

/** 去掉字符串/注释，避免误伤。返回与原始行号对齐的数组（注释/空行变为空串）。 */
function stripComments(code: string, lang: Lang): string[] {
  const lines = code.split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (let raw of lines) {
    let s = "";
    let i = 0;
    const n = raw.length;
    while (i < n) {
      const c = raw[i];
      const c2 = raw[i + 1];
      if (inBlock) {
        if (c === "*" && c2 === "/") { inBlock = false; i += 2; continue; }
        if (c === "\n") s += "\n";
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        const q = c;
        s += c;
        i++;
        while (i < n) {
          if (raw[i] === "\\") { s += raw[i] + (raw[i + 1] ?? ""); i += 2; continue; }
          s += raw[i];
          if (raw[i] === q) { i++; break; }
          i++;
        }
        continue;
      }
      if (c === "/" && c2 === "*") { inBlock = true; i += 2; continue; }
      if (c === "/" && c2 === "/") break;
      if (lang === "python" && c === "#") break;
      s += c;
      i++;
    }
    out.push(s);
  }
  return out;
}

/** 把 Python f-string（f"..." / f'...'）转成 JS 模板字符串，避免翻成非法 JS。 */
function convertFString(line: string): string {
  return line.replace(/(f)(["'])([\s\S]*?)\2/g, (_m, _f, _q, body) => {
    let t = body.replace(/\{\{/g, "\x01").replace(/\}\}/g, "\x02");
    t = t.replace(/\{([^{}]*)\}/g, (_x: string, expr: string) => "${" + expr + "}");
    t = t.replace(/\x01/g, "{").replace(/\x02/g, "}");
    return "`" + t + "`";
  });
}

/** 收集变量名（声明/赋值/循环变量/函数参数），用于快照。 */
function collectNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  const declRe = /\b(?:let|var|const|final|auto)\s+([A-Za-z_$][\w$]*)/g;
  const typedDeclRe = new RegExp("\\b(?:" + TYPE_WORDS.join("|") + "|struct\\s+\\w+)\\s*\\*?\\s*([A-Za-z_$][\\w$]*)", "g");
  const assignRe = /(\w+)\s*=(?!=)/g;
  const forRe = /\bfor\s*\((?:let\s+|var\s+|const\s+)?([A-Za-z_$][\w$]*)\s*=|for\s*\((?:let\s+|var\s+|const\s+)?([A-Za-z_$][\w$]*)\s*[:\s]/g;
  const pythonForRe = /\bfor\s+([A-Za-z_$][\w$]*)\s+in\b/g;
  const fnRe = /\b(?:function|def)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
  for (const line of lines) {
    let m;
    while ((m = declRe.exec(line))) names.add(m[1]);
    while ((m = typedDeclRe.exec(line))) names.add(m[1]);
    while ((m = assignRe.exec(line))) names.add(m[1]);
    while ((m = forRe.exec(line))) names.add(m[1] || m[2]);
    while ((m = pythonForRe.exec(line))) names.add(m[1]);
    while ((m = fnRe.exec(line))) {
      m[2].split(",").forEach((p) => {
        const t = p.trim().replace(/^self\s*,?/, "").replace(/:.*$/, "").replace(/=.*$/, "").trim();
        if (t && !/^(?:int|float|double|char|long|short|bool|boolean|void|String|Integer)\b/.test(t)) names.add(t);
      });
    }
  }
  for (const stop of STOP_NAMES) names.delete(stop);
  return names;
}

/** 从一行（翻译后的 JS）里提取焦点表达式列表。 */
function focusExprs(line: string): string[] {
  const out: string[] = [];
  const edgeRe = /([A-Za-z_$][\w$]*)\s*\[\s*([^\];,]+?)\s*\]\s*\[\s*([^\];,]+?)\s*\]/g;
  let m;
  while ((m = edgeRe.exec(line))) out.push(`CVfe(${JSON.stringify(m[1])}, (${m[2]}), (${m[3]}))`);
  const idxRe = /([A-Za-z_$][\w$]*)\s*\[\s*([^\];,]+?)\s*\](?!\s*\[)/g;
  while ((m = idxRe.exec(line))) out.push(`CVfi(${JSON.stringify(m[1])}, ${m[1]}, (${m[2]}))`);
  const nodeRe = /(?<![\w.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$]+)*)\s*\.\s*(val|value|data|next|prev|left|right|adj|neighbors|children|first|last|head|tail)\b/g;
  while ((m = nodeRe.exec(line))) out.push(`CVfn(${m[1]}, ${JSON.stringify(m[2])})`);
  return out;
}

/** 在已翻译的 JS 行里注入插桩：语句结束 `;` 后插入 CVS；块头（if/while/for）内插入 CVS。 */
function instrument(jsLines: string[], names: Set<string>): string {
  const snapEntries = Array.from(names)
    .map((nm) => `${JSON.stringify(nm)}: (typeof ${nm} !== 'undefined' ? ${nm} : undefined)`)
    .join(", ");
  const result: string[] = [];
  let stepId = 0;
  for (let li = 0; li < jsLines.length; li++) {
    const line = jsLines[li];
    let out = "";
    let inStr: string | null = null;
    let paren = 0;
    let stmtStart = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const c2 = line[i + 1];
      if (inStr) {
        if (c === "\\") { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "(" || c === "[") paren++;
      else if (c === ")" || c === "]") paren--;
      if (c === ";" && paren <= 0) {
        const stmt = line.slice(stmtStart, i).trim();
        if (stmt.length > 0 && !/^[\s{}]*$/.test(stmt)) {
          const f = focusExprs(stmt).join(", ");
          out += line.slice(stmtStart, i + 1);
          stepId++;
          out += `\nCVS(${stepId}, [${f}], {${snapEntries}});`;
        } else {
          out += line.slice(stmtStart, i + 1);
        }
        stmtStart = i + 1;
      }
    }
    out += line.slice(stmtStart);
    // 块头（if/while/for/elif）条件内也插桩，使比较/遍历时的焦点箭头可见
    const header = out.match(/^\s*(?:if|while|elif)\b[^]*\{\s*$/) || out.match(/^\s*for\b[^]*\{\s*$/);
    if (header) {
      const f = focusExprs(out).join(", ");
      out = out.replace(/\{\s*$/, `{ CVS(${++stepId}, [${f}], {${snapEntries}}); `);
    }
    result.push(out);
  }
  let js = result.join("\n");
  // 用 var 代替 let/const，避免快照里 typeof 触发暂时性死区（TDZ）报错
  js = js.replace(/\b(const|let)\b/g, "var");
  return js;
}

// ---------------- Python → JS-ish ----------------

function pythonToJSish(srcLines: string[]): { lines: string[]; nodeClasses: Set<string> } {
  const nodeClasses = new Set<string>();
  const out: string[] = [];
  const indentStack: number[] = [0];
  let skipDepth = -1;

  for (let raw of srcLines) {
    if (raw.trim() === "") { out.push(""); continue; }
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    while (indentStack.length > 1 && indent < indentStack[indentStack.length - 1]) {
      indentStack.pop();
      if (skipDepth >= indentStack.length) skipDepth = -1;
      out.push("}");
    }

    if (/^\s*(class|def)\s+/.test(raw)) {
      const cls = line.match(/^class\s+(\w+)/);
      if (cls) nodeClasses.add(cls[1]);
      skipDepth = indentStack.length > 0 ? indentStack[indentStack.length - 1] : 0;
      out.push("/* def/class skipped */");
      continue;
    }
    if (skipDepth !== -1 && indent >= skipDepth) {
      out.push("/* skipped */");
      continue;
    }

    let s = line;
    // 0) f-string 先转，避免 {expr} 被后续括号统计误伤
    s = convertFString(s);
    // 1) 浅层字面量 / 推导式保护：嵌套花括号或含 for 的推导式整行跳过并声明左侧变量，
    //    避免产生非法 JS。正常单层字典/集合仍正常转换。
    const assignLhs = s.match(/^([A-Za-z_$][\w$]*)\s*=/);
    if (assignLhs) {
      if (/=\s*\[[^\]]*\bfor\b/.test(s)) {
        out.push("var " + assignLhs[1] + "; /* listcomp skipped */");
        continue;
      }
      if (/=\s*\{[^}]*\{/.test(s)) {
        out.push("var " + assignLhs[1] + "; /* nested brace skipped */");
        continue;
      }
    }
    // 2) 字典/集合字面量（必须在 range/for 之前处理，避免 { } 被当成块）
    //    字典 {k: v, ...} -> 对象；集合 {a, b, ...} -> new Set([...])
    s = s.replace(/=\s*\{([^}]*:[^}]*)\}/g, "= ({$1})");
    s = s.replace(/=\s*\{([^}]*)\}/g, "= new Set([$1])");
    // 3) 推导式（集合/字典）暂不展开，整行跳过以免产生非法 JS
    if (/\bfor\b.*\bin\b/.test(s) && /[{}]/.test(s)) {
      out.push("/* comprehension skipped */");
      continue;
    }
    // 内置翻译
    s = s.replace(/len\(([^)]+)\)/g, "($1).length");
    s = s.replace(/\.append\(/g, ".push(");
    s = s.replace(/([\w)\]]+)\s*\/\/\s*([\w)\]]+)/g, "Math.floor($1 / $2)");
    s = convertNodeCalls(s, nodeClasses);

    const swap = s.match(/^([\w.\[\]]+)\s*,\s*([\w.\[\]]+)\s*=\s*([\w.\[\]]+)\s*,\s*([\w.\[\]]+)$/);
    if (swap && swap[1].includes("[") && swap[2].includes("[") && swap[3].includes("[") && swap[4].includes("[")) {
      const t = "__cvt" + Math.random().toString(36).slice(2, 7);
      out.push(`var ${t} = ${swap[1]}; ${swap[1]} = ${swap[3]}; ${swap[2]} = ${t};`);
      continue;
    }
    // for X in range(...): 同行 body（如 for i in range(n): a[i] = 0）
    let fm = s.match(/^for\s+(\w+)\s+in\s+range\((.*)\)\s*:\s*(.+)$/);
    if (fm) {
      const v = fm[1];
      const args = fm[2].split(",").map((x) => x.trim());
      let start = "0", end = "0", step = "1";
      if (args.length === 1) end = args[0];
      else if (args.length === 2) { start = args[0]; end = args[1]; }
      else if (args.length >= 3) { start = args[0]; end = args[1]; step = args[2]; }
      const body = fm[3].replace(/;?\s*$/, ";");
      out.push(`for (var ${v} = ${start}; ${v} < ${end}; ${v} += ${step}) { ${body} }`);
      continue;
    }
    fm = s.match(/^for\s+(\w+)\s+in\s+range\((.*)\)\s*:$/);
    if (fm) {
      const v = fm[1];
      const args = fm[2].split(",").map((x) => x.trim());
      let start = "0", end = "0", step = "1";
      if (args.length === 1) end = args[0];
      else if (args.length === 2) { start = args[0]; end = args[1]; }
      else if (args.length >= 3) { start = args[0]; end = args[1]; step = args[2]; }
      out.push(`for (var ${v} = ${start}; ${v} < ${end}; ${v} += ${step}) {`);
      indentStack.push(indent + 1);
      continue;
    }
    // for X in Y: 兼容数组(遍历元素)与字典/对象(遍历键)
    fm = s.match(/^for\s+(\w+)\s+in\s+(\w+)\s*:$/);
    if (fm) {
      const iter = `(typeof ${fm[2]} === 'object' && !Array.isArray(${fm[2]}) ? Object.keys(${fm[2]}) : ${fm[2]})`;
      out.push(`for (var ${fm[1]} of ${iter}) {`);
      indentStack.push(indent + 1);
      continue;
    }
    const wm = s.match(/^while\s+(.*?)\s*:$/);
    if (wm) { out.push(`while (${wm[1]}) {`); indentStack.push(indent + 1); continue; }
    const im = s.match(/^if\s+(.*?)\s*:$/);
    if (im) { out.push(`if (${im[1]}) {`); indentStack.push(indent + 1); continue; }
    const em = s.match(/^elif\s+(.*?)\s*:$/);
    if (em) { out.push(`} else if (${em[1]}) {`); indentStack.push(indent + 1); continue; }
    const elm = s.match(/^else\s*:$/);
    if (elm) { out.push(`} else {`); indentStack.push(indent + 1); continue; }

    s = s.replace(/^print\s*\((.*)\)$/, "");
    s = s.replace(/\bself\./g, "");
    s = s.replace(/:\s*$/, ";");
    if (s !== "" && !s.endsWith(";") && !s.endsWith("{") && !s.endsWith("}")) s += ";";
    out.push(s);
  }
  while (indentStack.length > 1) { indentStack.pop(); out.push("}"); }
  return { lines: balanceBraces(out), nodeClasses };
}

function balanceBraces(lines: string[]): string[] {
  let open = 0;
  for (const l of lines) {
    let inStr: string | null = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inStr) {
        if (c === "\\") { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "{") open++;
      else if (c === "}") open--;
    }
  }
  const res = lines.slice();
  for (let i = 0; i < Math.max(0, open); i++) res.push("}");
  return res;
}

// ---------------- C-family 归一化 ----------------

/** 把嵌套的容器模板参数剥离：vector<vector<int>> -> vector，map<string,int> -> map。
 *  只匹配已知容器名，避免误伤比较表达式里的 < / >。 */
const CONTAINERS = "vector|list|map|set|deque|stack|queue|priority_queue|pair|array|multimap|multiset|unordered_map|unordered_set|unordered_multimap|unordered_multiset|forward_list|tuple";
function stripContainerTemplates(s: string): string {
  let out = s;
  // 反复剥离最内层模板参数 <...>，处理嵌套如 vector<pair<int,int>>
  // 仅当 < 前是标识符或 >（嵌套闭合）才剥离，避免误伤 << 流输出 / -> 箭头
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/(?<=[\w>])<[^<>]*>/g, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

function normCFamilyLine(line: string, lang: Lang, nodeClasses: Set<string>): string {
  let s = line;
  if (s.trim() === "") return s;

  // JavaScript 已是合法 JS，直接返回，避免 C/Java 类型词（如 double/char）误伤标识符/对象键
  if (lang === "javascript") return s;

  // 1) 容器嵌套模板先剥离：vector<vector<int>> -> vector（只匹配已知容器名，避免误伤比较表达式）
  s = stripContainerTemplates(s);
  // 2) 剥掉 C++ 命名空间前缀 / endl
  s = s.replace(/std::/g, "");
  s = s.replace(/\bendl\b/g, "");

  // 3) 预处理/using/import/package/class 包裹整行跳过（避免游离大括号）
  if (/^\s*#\w+.*$/g.test(s)) return "/* pp skipped */";
  if (/^\s*using\b.*$/g.test(s)) return "/* using skipped */";
  if (/^\s*import\b.*$/g.test(s)) return "/* import skipped */";
  if (/^\s*package\b.*$/g.test(s)) return "/* package skipped */";
  if (/^\s*(?:public\s+|final\s+|abstract\s+|static\s+)*class\s+[\w<>,.\s]*\{?\s*$/g.test(s)) return "/* class skipped */";
  if (/^\s*(?:typedef\s+)?(?:struct|class|union)\s+\w*\s*\{[^}]*\}\s*\w*\s*;?\s*$/.test(s)) return "/* struct skipped */";

  // 4) exit -> 空语句（不要清空整行，以免控制结构大括号失衡）
  if (/^\s*exit\s*\(/.test(s)) return ";";

  // 5) I/O 与 delete/free：替换为空语句 ";"（保留大括号平衡），而不是清空整行。
  //    关键：原 for(...) cout<<...; 这类「循环体即一条 I/O」会变成 for(...) ; 仍然合法。
  s = s.replace(/std::cout\s*<<[^;]*;?/g, ";");
  s = s.replace(/System\.out\.print(ln)?\s*\([^;]*\)\s*;?/g, ";");
  s = s.replace(/cout\s*<<[^;]*;?/g, ";");
  s = s.replace(/printf\s*\([^;]*\)\s*;?/g, ";");
  s = s.replace(/Console\.WriteLine\s*\([^;]*\)\s*;?/g, ";");
  s = s.replace(/\bprintln\s*\([^;]*\)\s*;?/g, ";");
  s = s.replace(/\bgets\s*\([^;]*\)\s*;?/g, ";");
  s = s.replace(/\bputs\s*\([^;]*\)\s*;?/g, ";");
  s = s.replace(/\bdelete\s+\w+\s*;?/g, ";");
  s = s.replace(/\bfree\s*\([^)]*\)\s*;?/g, ";");
  // cin >> x; -> x = 5;（可视化给默认输入）
  s = s.replace(/cin\s*>>\s*([^;]*);?/g, (_m, vars) =>
    vars.split(">>").map((v: string) => v.trim().replace(/^&?/, "") + " = 5").join("; ") + ";");
  // scanf -> 给变量赋默认值
  s = s.replace(/scanf\s*\([^)]*\)\s*;?/g, (_m) => {
    const args = _m.match(/scanf\s*\(([^)]+)\)/);
    if (!args) return ";";
    const parts = args[1].split(",").slice(1).map((a: string) => a.trim().replace(/^&/, ""));
    return parts.map((v: string) => `${v} = 5`).join("; ") + ";";
  });

  // 6) Java 数组返回类型 / 形参里的 []：int[] foo / int[] x -> 去掉 int[]（后续标量规则处理）
  s = s.replace(/\b(?:int|long|double|float|char|byte|short|boolean|String|void)\s*\[\s*\]/g, "");
  // 6b) Java 数组构造 new int[]{…} -> […]，以及剥离 int[] 后残留的 new {…} -> […]
  s = s.replace(new RegExp("\\bnew\\s*(?:" + TYPE_WORDS.join("|") + ")\\s*\\[\\s*\\]\\s*\\{([^}]*)\\}"), "[$1]");
  s = s.replace(/\bnew\s*\{([^}]*)\}/g, "[$1]");

  // 7) swap(a, b) -> 临时变量交换（否则未定义报错）
  s = s.replace(/swap\s*\(([^)]*)\)/g, (_m, args) => {
    const [a, b] = args.split(",").map((x: string) => x.trim());
    if (!a || !b) return ";";
    const t = "__cvt" + Math.random().toString(36).slice(2, 7);
    return `var ${t} = ${a}; ${a} = ${b}; ${b} = ${t};`;
  });

  // 8) sort(x.begin(), x.end(), cmp) -> x.sort(cmp)；sort(x.begin(), x.end()) -> x.sort()
  s = s.replace(/(\w+)\.begin\(\)/g, "$1");
  s = s.replace(/(\w+)\.end\(\)/g, "$1");
  s = s.replace(/(?<!\.)\bsort\s*\(\s*([^,]+?)\s*,\s*[^,]+?(?:,\s*([^)]*))?\)/g, (_m, arr, cmp) =>
    cmp ? `${arr.trim()}.sort(${cmp.trim()})` : `${arr.trim()}.sort()`);
  // C++ lambda [] (...) { ... } -> function(...) { ... }（使整体可解析）
  s = s.replace(/\[\]\s*\(([^)]*)\)\s*\{/g, "function($1) {");

  // 9) C 风格类型强转 (Type*) / (Type)
  s = s.replace(/\(\s*(?:struct\s+)?[A-Z]\w*(?:\s*\*+)?\s*\)/g, "");
  s = s.replace(/\(\s*(?:int|float|double|char|long|short|bool|boolean|void|size_t|uint\w+_t)\s*\)/g, "");

  // 10) 逗号分隔声明拆分：int n, m; -> int n; int m;
  s = s.replace(
    new RegExp("^\\s*(?:" + TYPE_WORDS.join("|") + ")\\b\\s*[&*]?\\s*\\w+(?:\\s*,\\s*[&*]?\\w+)+\\s*;\\s*$"),
    (m) => {
      const parts = m.trim().replace(/;$/, "").split(/(?<=\w)\s*,\s*/);
      const typePart = parts[0].replace(/\s*[&*]?\s*\w+\s*$/, "").trim();
      return parts.map(p => {
        const clean = p.replace(new RegExp("^\\s*(?:" + TYPE_WORDS.join("|") + ")\\s*"), "").trim();
        return typePart + " " + clean + ";";
      }).join("\n");
    }
  );
  // 小写自定义类型逗号声明：node *head, *p; -> var head; var p;（容器名跳过，交给规则13）
  s = s.replace(
    /^\s*([a-z]\w+)\s+(\*?\s*\w+(?:\s*,\s*\*?\s*\w+)+)\s*;\s*$/,
    (_m, _type, vars) => {
      if (new RegExp("^(?:" + CONTAINERS + ")$").test(_type)) return _m;
      return vars.split(/,\s*/).map((v: string) => "var " + v.replace(/^\*?\s*/, "").trim() + ";").join("\n");
    }
  );
  // 小写自定义类型单变量指针：node *head; -> var head;（容器名跳过，交给规则13）
  s = s.replace(/^\s*([a-z]\w+)\s*\*\s*(\w+)\s*[=;]/, (_m, tp, v) => {
    if (TYPE_WORDS.includes(tp) || /^(?:let|var|const|if|else|for|while|do|switch|case|return|break|continue|function|class|new|delete|typeof|instanceof|void|throw|try|catch|finally)$/.test(tp) || new RegExp("^(?:" + CONTAINERS + ")$").test(tp)) return _m;
    return "var " + v + ";";
  });
  // 小写自定义类型无指针：node head; -> var head;（容器名跳过，交给规则13）
  s = s.replace(/^\s*([a-z]\w+)\s+(\w+)\s*[=;]/, (_m, tp, v) => {
    if (TYPE_WORDS.includes(tp) || /^(?:let|var|const|if|else|for|while|do|switch|case|return|break|continue|function|class|new|delete|typeof|instanceof|void|throw|try|catch|finally)$/.test(tp) || new RegExp("^(?:" + CONTAINERS + ")$").test(tp)) return _m;
    return "var " + v + ";";
  });

  // 11) 函数定义（允许修饰符 public/static、Java 数组返回类型、引用形参 &；返回类型可缺省，但需有修饰符或类型）
  s = s.replace(
    new RegExp("\\b(?:(?:(?:public|private|protected|static|final|const|virtual|inline|explicit|override|constexpr)\\s+)+\\s*(?:(?:" + TYPE_WORDS.join("|") + "|struct\\s+\\w+)\\s*)?|(?:(?:" + TYPE_WORDS.join("|") + "|struct\\s+\\w+)\\s*))\\*?\\s*\\[?\\]?\\s*([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)\\s*\\{?"),
    (_m, name, params) => {
      const ps = params.split(",").map((p: string) => p
        .replace(new RegExp("(?:" + TYPE_WORDS.join("|") + ")"), "")
        .replace(new RegExp("(?:" + CONTAINERS + ")\\b"), "")
        .replace(/\b[A-Z]\w*\b/g, "")
        .replace(/\[\s*\]/g, "")
        .replace(/[&*]+/g, "")
        .replace(/=.*$/, "")
        .trim()).filter(Boolean).join(", ");
      return `function ${name}(${ps}) {`;
    }
  );

  // 11b) 清洗已生成 function(...) 的形参类型（如 lambda function( a, int b) -> function(a, b)）
  s = s.replace(/function\s*\(([^)]*)\)/g, (_m, params) => {
    const ps = params.split(",").map((p: string) => p
      .replace(new RegExp("(?:" + TYPE_WORDS.join("|") + ")"), "")
      .replace(/\b[A-Z]\w*\b/g, "")
      .replace(/\[\s*\]/g, "")
      .replace(/[&*]+/g, "")
      .replace(/=.*$/, "")
      .trim()).filter(Boolean).join(", ");
    return `function(${ps})`;
  });

  // 12) 数组字面量声明
  s = s.replace(/\b\w+\s*\[\s*\]\s*(\w+)\s*=\s*\{([^}]*)\}/g, "var $1 = [$2]");
  s = s.replace(/\b\w+\s+(\w+)\s*\[\s*\]\s*=\s*\{([^}]*)\}/g, "var $1 = [$2]");
  s = s.replace(/\b([A-Za-z_]\w*)\s*\[\s*\w*\s*\]\s*=\s*\{([^}]*)\}/g, "$1 = [$2]");
  s = s.replace(/new\s+\w+\s*\[\s*\]\s*\{([^}]*)\}/g, "[$1]");
  // 二维数组字面量：int adj[3][3] = { {0,1,1}, ... } -> var adj = [[0,1,1], ...]
  s = s.replace(
    /\b\w+\s+(\w+)\s*\[\s*\w*\s*\]\s*\[\s*\w*\s*\]\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*;?/g,
    (m, name, body) => {
      const rows = body.replace(/\{[^{}]*\}/g, (rm: string) => "[" + rm.slice(1, -1) + "]");
      return `var ${name} = [${rows}];`;
    }
  );
  // new TYPE[n] -> new Array(n).fill(0)
  s = s.replace(/\bnew\s+\w+\s*\[\s*([^\]]*)\s*\]\s*\(?([^;]*?)\)?\s*(?:;|$)/g, "new Array($1).fill(0)");

  // 13) 容器声明（模板已剥离，余下 vector v / map m / set s 等）
  s = s.replace(/\b(set|multiset|unordered_set)\s+([A-Za-z_$][\w$]*)\s*=\s*\{([^}]*)\}/g, "var $2 = new Set([$3])");
  s = s.replace(/\b(map|multimap|unordered_map|unordered_multimap)\s+([A-Za-z_$][\w$]*)\s*[=;]/g, "var $2 = new Map()");
  s = s.replace(new RegExp("\\b(?:" + CONTAINERS + ")\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\{([^}]*)\\}"), "var $1 = [$2]");
  s = s.replace(new RegExp("\\b(?:" + CONTAINERS + ")\\s+([A-Za-z_$][\\w$]*)\\s*[=;]"), "var $1 = [];");
  // 13b) 容器构造调用：vector<vector<int>> adj(n); -> var adj = Array.from({length:n},()=>[])
  s = s.replace(new RegExp("\\b(?:" + CONTAINERS + ")\\s+([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)"), "var $1 = Array.from({length: ($2)}, () => [])");
  // 容器成员方法：push_back -> push
  s = s.replace(/\.push_back\(/g, ".push(");
  // 13d) 裸初始化：int[] a = {…} 经规则6剥离 int[] 后剩 a = {…} -> var a = […]
  s = s.replace(/^\s*([A-Za-z_$][\w$]*)\s*=\s*\{([^}:]*)\}\s*;?\s*$/g, "var $1 = [$2];");
  // 13e) C++ 花括号初始化（pair/tuple）：push_back({1,2}) -> push([1,2])；x = {1,2} -> x = [1,2]（不含冒号，避免误伤对象字面量）
  s = s.replace(/\.(?:push_back|push|emplace_back)\s*\(\s*\{([^{}:]*)\}\s*\)/g, ".push([$1])");
  s = s.replace(/=\s*\{([^{}:]*)\}/g, "= [$1]");
  // 13c) Java 集合：new HashMap<>() -> new Map()；HashSet/.../ArrayList/... -> []（统一用数组 + push）
  // 模板参数可能已被 stripContainerTemplates 剥离为 new X()，故 <[^>]*> 设为可选
  s = s.replace(/new\s+(?:HashMap|TreeMap|LinkedHashMap|ConcurrentHashMap)(?:\s*<[^>]*>)?\s*\(\s*\)/g, "new Map()");
  s = s.replace(/new\s+(?:HashSet|TreeSet|LinkedHashSet|ArrayList|LinkedList|Vector|Stack|ArrayDeque)(?:\s*<[^>]*>)?\s*\(\s*\)/g, "[]");
  // Java 泛型擦除：HashMap<Integer,Integer> map -> HashMap map（仅大写类型名后跟 <...>）
  s = s.replace(/\b([A-Z]\w*)\s*<[^<>]*>\s*/g, "$1 ");
  // Java 集合方法：containsKey -> has；put -> set；add -> push（统一转到 JS 数组）
  s = s.replace(/\.containsKey\s*\(/g, ".has(");
  s = s.replace(/\.put\s*\(/g, ".set(");
  s = s.replace(/\.add\s*\(/g, ".push(");
  // 注意：不再 blanket 剥离容器名，否则会把名为 map/set 的变量也吃掉（如 java_twosum）

  // 14) 大写类型 + 指针声明：Node* head = -> var head =
  s = s.replace(/\b([A-Z]\w*)\s*\*+\s*([A-Za-z_$][\w$]*)\s*(=|;)/g, "var $2 $3");
  // 指针/引用声明 int* p; -> var p;
  s = s.replace(new RegExp("\\b(?:" + TYPE_WORDS.join("|") + ")\\b\\s*\\*+\\s*(\\w+)\\s*;"), "var $1;");
  // 标量声明带初始化（含引用 &）
  s = s.replace(new RegExp("\\b(?:const|final|static|unsigned|signed)?\\s*(?:" + TYPE_WORDS.join("|") + ")\\b\\s*[&*]?\\s*(\\w+)\\s*="), "var $1 =");
  // 标量声明无初始化（含引用 &）
  s = s.replace(new RegExp("\\b(?:" + TYPE_WORDS.join("|") + ")\\b\\s*[&*]?\\s*(\\w+)\\s*;"), "var $1;");
  // 大写自定义类型作声明：Node head = -> var head =
  s = s.replace(/\b([A-Z]\w*)\s+([A-Za-z_$][\w$]*)\s*=/g, "var $2 =");

  // 15) & 地址符
  s = s.replace(/&([A-Za-z_$][\w$]*)/g, "$1");

  // 16) 指针与结构体
  s = s.replace(/\bstruct\s+/g, "");
  s = s.replace(/\bNULL\b/g, "null");
  s = s.replace(/\bnullptr\b/g, "null");
  s = s.replace(/->/g, ".");
  s = s.replace(/\(\s*\*(\w+)\s*\)/g, "$1");
  s = s.replace(/(^|[^*/\w])\*\s*(\w+)\s*=/g, "$1$2 =");

  // 17) 内存分配 -> 节点工厂
  s = s.replace(/sizeof\s*\([^)]*\)/g, "0");
  s = s.replace(/malloc\s*\(.*?\)/g, "CVN(undefined, {next:null,left:null,right:null})");
  s = s.replace(/calloc\s*\(.*?\)/g, "CVN(undefined, {next:null,left:null,right:null})");

  // 18) 节点构造
  s = convertNodeCalls(s, nodeClasses);
  s = s.replace(/\bnew\s+([A-Z]\w+)\s*[;=]/g, "CVN(undefined, {next:null,left:null,right:null})");
  s = s.replace(/\bnew\s+([a-z]\w+)\s*[;=]/g, (_m, name) => {
    return nodeClasses.has(name) ? `CVN(undefined, {next:null,left:null,right:null})` : _m;
  });
  // 仅剥离 C++ 风格 new（如 new Node(...)），保留 JS 内置构造（new Set/Map/Array/...）
  s = s.replace(/\bnew\s+(?!Set|Map|Array|Date|Promise|RegExp|Error|Object|WeakMap|WeakSet)(?=[A-Za-z_$])/g, "");

  // 19) for 头
  s = s.replace(/for\s*\(\s*(?:int|float|double|char|long|short|bool|boolean|auto|const|let|var)\s+/g, "for (var ");
  s = s.replace(/for\s*\([^)]*?:\s*([^)]+)\)/g, (_m, iter) => {
    const inner = _m.match(/\(([^:]+):/);
    let varPart = inner ? inner[1].replace(new RegExp("(?:" + TYPE_WORDS.join("|") + ")"), "").replace(/\*+/g, "").replace(/&/g, "").replace(/^\s*(?:const|let|var)\s*/, "").trim() : "x";
    if (!varPart) varPart = "x";
    return `for (var ${varPart} of ${iter.trim()})`;
  });

  // 20) 兜底关键字
  s = s.replace(/\b(public|private|protected|static|final|virtual|inline|unsigned|signed|register|volatile|constexpr|override|explicit|friend|typedef|using)\b/g, " ");
  // 兜底：残留的 TYPE var / TYPE *var / TYPE &var 声明 → var
  s = s.replace(new RegExp("\\b(?:" + TYPE_WORDS.join("|") + ")\\b\\s*[&*]?\\s*(\\w+)\\s*([=;])"), "var $1 $2");
  // 兜底：仅剩 TYPE 关键字（无变量名）→ 删掉
  s = s.replace(new RegExp("\\b(?:" + TYPE_WORDS.join("|") + ")\\b"), "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** 把多行 struct/class/union 定义折叠成单行，供逐行正则匹配。 */
function collapseMultilineDefs(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    // 匹配 struct/union 开头（可能带 typedef）；class 不折叠，保持多行由逐行跳过处理（Java）
    if (/^\s*(?:typedef\s+)?(?:struct|union)\b/.test(l)) {
      // 收集从 { 到匹配的 } 的所有行
      let braceDepth = 0;
      let combined = "";
      let started = false;
      while (i < lines.length) {
        const cur = lines[i];
        for (const ch of cur) {
          if (ch === "{") { braceDepth++; started = true; }
          else if (ch === "}") braceDepth--;
        }
        combined += " " + cur.trim();
        i++;
        if (started && braceDepth <= 0) break;
      }
      out.push(combined.replace(/\s+/g, " ").trim());
    } else {
      out.push(l);
      i++;
    }
  }
  return out;
}

/** 如果代码有 int main()/void main()/public static void main()，提取函数体作为顶层代码。 */
function extractMainBody(lines: string[]): string[] {
  // 找 main 函数起始行（C: int/void main; Java: public static void main / static void main）
  let mainStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\b(?:public\s+static\s+|static\s+)?(?:int|void)\s+main\s*\(/.test(lines[i])) {
      mainStart = i;
      break;
    }
  }
  if (mainStart === -1) return lines;

  // 从 mainStart 行开始，找匹配的 { 与 }
  let braceDepth = 0;
  let started = false;
  for (let i = mainStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { braceDepth++; if (!started) started = true; }
      else if (ch === "}") braceDepth--;
    }
    if (started && braceDepth <= 0) {
      const afterOpen = lines[mainStart].slice(lines[mainStart].indexOf("{") + 1);
      const body: string[] = [];
      if (afterOpen.trim()) body.push(afterOpen);
      for (let j = mainStart + 1; j < i; j++) body.push(lines[j]);
      const beforeClose = lines[i].slice(0, lines[i].lastIndexOf("}"));
      if (beforeClose.trim()) body.push(beforeClose);
      // 仅保留 main 之前的「全局」行（去掉类/import/package/using/# 包裹），
      // 丢弃 main 之后的内容（如 Java 类的闭合 }），避免游离大括号破坏块结构
      const skipWrap = /^\s*(class\s|public\s+class|import\s|package\s|using\s|#)/;
      const before = lines.slice(0, mainStart).filter((l) => !skipWrap.test(l));
      return [...before, ...body];
    }
  }
  return lines;
}

export function transpile(code: string, lang: Lang): { js: string; nodeClasses: Set<string>; error?: string } {
  try {
    const stripped = stripComments(code, lang);
    if (lang === "python") {
      const { lines, nodeClasses } = pythonToJSish(stripped.map((l) => l.replace(/\n/g, "")));
      const names = collectNames(stripped);
      const js = instrument(lines, names);
      return { js, nodeClasses, error: undefined };
    } else {
      const nodeClasses = new Set<string>();
      for (const l of stripped) {
        const c = l.match(/^\s*(?:class|struct)\s+(\w+)/);
        if (c) nodeClasses.add(c[1]);
      }
      const collapsed = collapseMultilineDefs(stripped);
      const mainExtracted = extractMainBody(collapsed);
      const norm = mainExtracted.map((l) => normCFamilyLine(l, lang, nodeClasses));
      // normCFamilyLine 可能返回多行（逗号声明拆分），需展开为独立行
      const flat: string[] = [];
      for (const l of norm) {
        if (l.includes("\n")) {
          for (const sub of l.split("\n")) flat.push(sub);
        } else {
          flat.push(l);
        }
      }
      // 大括号兜底：归一化可能仍残留开括号失衡（例如被剥离的循环体），
      // 这里按字符串统计补齐缺失的闭合 }，避免 new Function 报 Unexpected token。
      const balanced = balanceBraces(flat);
      const names = collectNames(stripped);
      const js = instrument(balanced, names);
      return { js, nodeClasses, error: undefined };
    }
  } catch (e: any) {
    return { js: "", nodeClasses: new Set(), error: String(e?.message || e) };
  }
}
