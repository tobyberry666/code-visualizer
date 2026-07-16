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
      out.push("/* " + line + " (skipped) */");
      continue;
    }
    if (skipDepth !== -1 && indent >= skipDepth) {
      out.push("/* skipped: " + line + " */");
      continue;
    }

    let s = line;
    // 0) f-string 先转，避免 {expr} 被后续括号统计误伤
    s = convertFString(s);
    // 1) 字典/集合字面量（必须在 range/for 之前处理，避免 { } 被当成块）
    //    字典 {k: v, ...} -> 对象；集合 {a, b, ...} -> new Set([...])
    s = s.replace(/=\s*\{([^}]*:[^}]*)\}/g, "= ({$1})");
    s = s.replace(/=\s*\{([^}]*)\}/g, "= new Set([$1])");
    // 2) 推导式（集合/字典）暂不展开，整行跳过以免产生非法 JS
    if (/\bfor\b.*\bin\b/.test(s) && /[{}]/.test(s)) {
      out.push("/* comprehension skipped: " + line + " */");
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

function normCFamilyLine(line: string, nodeClasses: Set<string>): string {
  let s = line;
  if (s.trim() === "") return s;

  // return / delete / exit → 整行清除（可视化不需要）—— 放在最前面确保清除
  if (/^\s*return\b/.test(s) || /^\s*delete\s+\w/.test(s) || /^\s*exit\s*\(/.test(s)) return "";

  // 预处理指令（#include/#define/#ifdef 等）整行跳过
  s = s.replace(/^\s*#\w+.*$/g, "/* pp skipped */");
  // using namespace std; 整行跳过
  s = s.replace(/^\s*using\b.*$/g, "/* using skipped */");
  // Java import / package 整行跳过
  s = s.replace(/^\s*import\b.*$/g, "/* import skipped */");
  s = s.replace(/^\s*package\b.*$/g, "/* package skipped */");
  // Java class 声明行（含 extends/implements）整行跳过，避免类包裹的 { } 干扰块结构
  s = s.replace(/^\s*(?:public\s+|final\s+|abstract\s+|static\s+)*class\s+[\w<>,.\s]*\{?\s*$/g, "/* class skipped */");

  // 跳过整行结构体/类/联合定义（教学子集不展开成员，避免把成员当语句执行）
  s = s.replace(/^\s*(?:typedef\s+)?(?:struct|class|union)\s+\w*\s*\{[^}]*\}\s*\w*\s*;?\s*$/, "/* struct skipped */");
  // 去掉 C 风格类型强转 (Type*) / (Type) / (struct X*)
  s = s.replace(/\(\s*(?:struct\s+)?[A-Z]\w*(?:\s*\*+)?\s*\)/g, "");

  // 逗号分隔声明拆分：int n, m; → int n; int m;
  // 匹配 TYPE *? var1, *? var2, *? var3;
  s = s.replace(
    new RegExp("^\\s*(?:" + TYPE_WORDS.join("|") + ")\\b\\s*[&*]?\\s*\\w+(?:\\s*,\\s*[&*]?\\w+)+\\s*;\\s*$"),
    (m) => {
      // 提取类型和变量列表
      const parts = m.trim().replace(/;$/, "").split(/(?<=\w)\s*,\s*/);
      const typePart = parts[0].replace(/\s*[&*]?\s*\w+\s*$/, "").trim();
      return parts.map(p => {
        const clean = p.replace(new RegExp("^\\s*(?:" + TYPE_WORDS.join("|") + ")\\s*"), "").trim();
        return typePart + " " + clean + ";";
      }).join("\n");
    }
  );
  // 小写自定义类型逗号声明：node *head, *p, *now; → var head; var p; var now;
  s = s.replace(
    /^\s*([a-z]\w+)\s+(\*?\s*\w+(?:\s*,\s*\*?\s*\w+)+)\s*;\s*$/,
    (_m, _type, vars) => {
      return vars.split(/,\s*/).map((v: string) => "var " + v.replace(/^\*?\s*/, "").trim() + ";").join("\n");
    }
  );
  // 小写自定义类型单变量指针：node *head; → var head;
  s = s.replace(/^\s*([a-z]\w+)\s*\*\s*(\w+)\s*[=;]/, (_m, tp, v) => {
    if (TYPE_WORDS.includes(tp) || /^(?:let|var|const|if|else|for|while|do|switch|case|return|break|continue|function|class|new|delete|typeof|instanceof|void|throw|try|catch|finally)$/.test(tp)) return _m;
    return "var " + v + ";";
  });
  // 小写自定义类型无指针：node head; → var head;
  s = s.replace(/^\s*([a-z]\w+)\s+(\w+)\s*[=;]/, (_m, tp, v) => {
    if (TYPE_WORDS.includes(tp) || /^(?:let|var|const|if|else|for|while|do|switch|case|return|break|continue|function|class|new|delete|typeof|instanceof|void|throw|try|catch|finally)$/.test(tp)) return _m;
    return "var " + v + ";";
  });

  // 函数定义
  s = s.replace(
    new RegExp("\\b(?:" + TYPE_WORDS.join("|") + "|struct\\s+\\w+)s*\\*?\\s*([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)\\s*\\{?"),
    (_m, name, params) => {
      const ps = params.split(",").map((p: string) => p.replace(new RegExp("(?:" + TYPE_WORDS.join("|") + ")"), "").replace(/[&*]+/g, "").replace(/\[\s*\]/g, "").replace(/=.*$/, "").trim()).filter(Boolean).join(", ");
      return `function ${name}(${ps}) {`;
    }
  );

  // 数组字面量声明
  s = s.replace(/\b\w+\s*\[\s*\]\s*(\w+)\s*=\s*\{([^}]*)\}/g, "var $1 = [$2]");
  s = s.replace(/\b\w+\s+(\w+)\s*\[\s*\]\s*=\s*\{([^}]*)\}/g, "var $1 = [$2]");
  // 无类型前缀的数组声明：arr[5] = {1,2,3}; -> arr = [1,2,3];
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
  // 大写类型 + 指针声明：Node* head = -> var head =
  s = s.replace(/\b([A-Z]\w*)\s*\*+\s*([A-Za-z_$][\w$]*)\s*(=|;)/g, "var $2 $3");
  // 指针/引用声明 int* p; -> var p;
  s = s.replace(new RegExp("\\b(?:" + TYPE_WORDS.join("|") + ")\\b\\s*\\*+\\s*(\\w+)\\s*;"), "var $1;");
  // 标量声明带初始化（含引用 &）
  s = s.replace(new RegExp("\\b(?:const|final|static|unsigned|signed)?\\s*(?:" + TYPE_WORDS.join("|") + ")\\b\\s*[&*]?\\s*(\\w+)\\s*="), "var $1 =");
  // 标量声明无初始化（含引用 &）
  s = s.replace(new RegExp("\\b(?:" + TYPE_WORDS.join("|") + ")\\b\\s*[&*]?\\s*(\\w+)\\s*;"), "var $1;");
  // 大写自定义类型作声明：Node head = -> var head =（避免把类型名当语句执行）
  s = s.replace(/\b([A-Z]\w*)\s+([A-Za-z_$][\w$]*)\s*=/g, "var $2 =");

  // & 地址符（scanf/函数参数中的 &var -> var）
  s = s.replace(/&([A-Za-z_$][\w$]*)/g, "$1");

  // 标准库容器类型（vector/map/set/...）声明：剥离 <...> 并给合理初值，避免留下 vector<> 这类非法片段
  s = s.replace(/\b(?:vector|list|deque|forward_list)\s*<[^>]*>\s*(\w+)\s*=\s*\{([^}]*)\}/g, "var $1 = [$2]");
  s = s.replace(/\b(?:vector|list|deque|forward_list)\s*<[^>]*>\s*(\w+)\s*\(([^)]*)\)/g, "var $1 = new Array($2 || 0).fill(0)");
  s = s.replace(/\b(?:vector|list|deque|forward_list)\s*<[^>]*>\s*(\w+)\s*[=;]/g, "var $1 = []");
  s = s.replace(/\b(?:map|multimap|unordered_map)\s*<[^>]*>\s*(\w+)\s*=\s*\{([^}]*)\}/g, "var $1 = {$2}");
  s = s.replace(/\b(?:map|multimap|unordered_map|set|multiset|unordered_set|stack|queue|priority_queue)\s*<[^>]*>\s*(\w+)\s*[=;]/g, "var $1 = {}");
  // 通用容器类型（首字母大写，Java 风格）
  s = s.replace(/\b(?:ArrayList|List|Set|Map|Deque|Queue|Stack|HashMap|Vector|PriorityQueue|LinkedList)\s*<[^>]*>\s*/g, "");
  s = s.replace(/\b[A-Z]\w*\s*<[^>]*>\s*/g, "");
  s = s.replace(/vector\s*<[^>]*>\s*(\w+)\s*\(([^)]*)\)/g, "var $1 = new Array($2 || 0).fill(0)");
  s = s.replace(/vector\s*<[^>]*>\s*(\w+)\s*;/g, "var $1 = []");

  // 指针与结构体
  s = s.replace(/\bstruct\s+/g, "");
  s = s.replace(/\bNULL\b/g, "null");
  s = s.replace(/\bnullptr\b/g, "null");
  s = s.replace(/->/g, ".");
  s = s.replace(/\(\s*\*(\w+)\s*\)/g, "$1");
  s = s.replace(/(^|[^*/\w])\*\s*(\w+)\s*=/g, "$1$2 =");

  // 输出/输入语句
  s = s.replace(/System\.out\.print(ln)?\s*\([^;]*\)\s*;?/g, "");
  s = s.replace(/cout\s*<<[^;]*;?/g, "");
  s = s.replace(/printf\s*\([^;]*\)\s*;?/g, "");
  // scanf → 提取变量名并赋默认值
  s = s.replace(/scanf\s*\([^)]*\)\s*;?/g, (_m) => {
    const args = _m.match(/scanf\s*\(([^)]+)\)/);
    if (!args) return "";
    const parts = args[1].split(",").slice(1).map((a: string) => a.trim().replace(/^&/, ""));
    return parts.map((v: string) => `${v} = 5`).join("; ") + ";";
  });
  s = s.replace(/Console\.WriteLine\s*\([^;]*\)\s*;?/g, "");
  s = s.replace(/\bprintln\s*\([^;]*\)\s*;?/g, "");
  s = s.replace(/\bgets\s*\([^;]*\)\s*;?/g, "");
  s = s.replace(/\bputs\s*\([^;]*\)\s*;?/g, "");

  // delete / free -> 空
  s = s.replace(/\bdelete\s+\w+\s*;?/g, "");
  s = s.replace(/\bfree\s*\([^)]*\)\s*;?/g, "");

  // 内存分配 -> 节点工厂
  s = s.replace(/sizeof\s*\([^)]*\)/g, "0");
  s = s.replace(/malloc\s*\(.*?\)/g, "CVN(undefined, {next:null,left:null,right:null})");
  s = s.replace(/calloc\s*\(.*?\)/g, "CVN(undefined, {next:null,left:null,right:null})");

  // 节点构造
  s = convertNodeCalls(s, nodeClasses);
  // new TypeName（无括号）→ CVN(undefined, ...)
  s = s.replace(/\bnew\s+([A-Z]\w+)\s*[;=]/g, "CVN(undefined, {next:null,left:null,right:null})");
  s = s.replace(/\bnew\s+([a-z]\w+)\s*[;=]/g, (_m, name) => {
    return nodeClasses.has(name) ? `CVN(undefined, {next:null,left:null,right:null})` : _m;
  });
  // 去掉 new 关键字（CVN 已是普通工厂函数）
  s = s.replace(/\bnew\s+/g, "");

  // for 头
  s = s.replace(/for\s*\(\s*(?:int|float|double|char|long|short|bool|boolean|auto|const|let|var)\s+/g, "for (var ");
  s = s.replace(/for\s*\([^)]*?:\s*([^)]+)\)/g, (_m, iter) => {
    const inner = _m.match(/\(([^:]+):/);
    const varPart = inner ? inner[1].replace(new RegExp("(?:" + TYPE_WORDS.join("|") + ")"), "").replace(/\*+/g, "").replace(/^\s*(?:const|let|var)\s*/, "").trim() : "x";
    return `for (var ${varPart} of ${iter.trim()})`;
  });

  // 兜底：去掉残留的 C++ 关键字（public/private/... 已在下面统一处理）
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
      const norm = mainExtracted.map((l) => normCFamilyLine(l, nodeClasses));
      // normCFamilyLine 可能返回多行（逗号声明拆分），需展开为独立行
      const flat: string[] = [];
      for (const l of norm) {
        if (l.includes("\n")) {
          for (const sub of l.split("\n")) flat.push(sub);
        } else {
          flat.push(l);
        }
      }
      const names = collectNames(stripped);
      const js = instrument(flat, names);
      return { js, nodeClasses, error: undefined };
    }
  } catch (e: any) {
    return { js: "", nodeClasses: new Set(), error: String(e?.message || e) };
  }
}
