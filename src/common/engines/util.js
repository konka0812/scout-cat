import { spawn } from "node:child_process";

/** 运行外部 CLI，带超时和 JSON 提取 */
export function runCommand(cmd, args, { timeoutMs = 300000, cwd, parseJson = false } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { shell: true, cwd: cwd || process.cwd(), windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, items: [], error: e.message, raw: "" });
    }
    let out = "";
    let err = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, items: [], error: "timeout", raw: out });
    }, timeoutMs);

    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => finish({ ok: false, items: [], error: e.message, raw: "" }));
    child.on("close", (code) => {
      if (code !== 0) return finish({ ok: false, items: [], error: err || `exit ${code}`, raw: out });
      if (parseJson) {
        const items = extractJsonItems(out);
        return finish({ ok: true, items, error: "", raw: out });
      }
      finish({ ok: true, items: [], error: "", raw: out });
    });
  });
}

/** 从混合文本中抽取 JSON 对象（容忍前后噪声） */
export function extractJsonItems(text) {
  if (!text) return [];
  const candidates = [];
  // 1) 整体 parse
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j?.items)) return j.items;
  } catch {}
  // 2) 花括号配对扫描
  const seen = new Set();
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let k = i; k < text.length; k++) {
      const ch = text[k];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const slice = text.slice(i, k + 1);
          try {
            const j = JSON.parse(slice);
            if (Array.isArray(j?.items)) {
              for (const it of j.items) {
                const key = it?.url || it?.title || JSON.stringify(it);
                if (!seen.has(key)) { seen.add(key); candidates.push(it); }
              }
            }
          } catch {}
          break;
        }
      }
    }
  }
  return candidates;
}
