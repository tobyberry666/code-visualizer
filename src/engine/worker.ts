// 浏览器端运行器：在 Web Worker 里跑 transpile + runtime。
// 这样用户代码（含潜在死循环）不会卡住主线程的 UI 与动画。
import {
  CVRuntime,
  CVN,
  CVfn,
  CVfi,
  CVfe,
  resetNodeSeq,
} from "./runtime";
import { transpile, type Lang } from "./transpile";

export interface RunRequest {
  code: string;
  lang: Lang;
}

interface TraceResult {
  steps: any[];
  structures: any[];
  detectedKind?: string;
  detectedLang?: string;
  error?: string;
}

// 用 any 规避 DOM 与 Worker 全局作用域下 postMessage 签名冲突
const ctx = self as any;

ctx.onmessage = (e: MessageEvent<RunRequest>) => {
  const { code, lang } = e.data;
  try {
    const { js, error } = transpile(code, lang);
    if (error) {
      ctx.postMessage({ error });
      return;
    }
    const rt = new CVRuntime();
    rt.lang = lang;
    resetNodeSeq();
    // 把插桩后的 JS 包进一个函数，注入运行时 API。
    // 用户代码已全部用 var 声明，故无 TDZ 问题；所有语句都在同一函数作用域内。
    // 注入 print 作为安全空函数，避免 Python 的 print(...) 在行内/同行 for 体里未定义而崩溃。
    // 注入常用数学辅助，避免 max/min/abs/pow 等被当成未定义而崩溃。
    const preamble = "var print=function(){},max=Math.max,min=Math.min,abs=Math.abs,pow=Math.pow,sqrt=Math.sqrt,floor=Math.floor,ceil=Math.ceil,round=Math.round,PI=Math.PI,E=Math.E;";
    const fn = new Function("CVS", "CVN", "CVfn", "CVfi", "CVfe", preamble + js);
    fn(rt.CVS, CVN, CVfn, CVfi, CVfe);
    const finished = rt.finish() as TraceResult;
    // 推断整体结构类型：取出现频次最高的非数组结构，否则 array。
    const kindCount: Record<string, number> = {};
    for (const s of finished.steps) {
      for (const st of s.structures ?? []) {
        if (st.kind === "array") continue;
        kindCount[st.kind] = (kindCount[st.kind] || 0) + 1;
      }
    }
    let detectedKind: string | undefined;
    let best = 0;
    for (const [k, c] of Object.entries(kindCount)) {
      if (c > best) { best = c; detectedKind = k; }
    }
    const result: TraceResult = {
      steps: finished.steps,
      structures: finished.structures,
      detectedKind,
      detectedLang: lang,
      error: finished.error ?? undefined,
    };
    ctx.postMessage(result);
  } catch (err: any) {
    ctx.postMessage({ error: String(err?.message || err) });
  }
};
