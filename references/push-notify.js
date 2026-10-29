#!/usr/bin/env node
/**
 * pushplus 推送助手（天信每日日报）
 * 用途：把日报推送到 ① 天信负责人手机(中国移动 5G 消息 cmcc) ② 245830958@qq.com(邮件 mail)
 *
 * 推送机制（按 pushplus 官方文档）：
 *   - cmcc(5G 消息)：用 template:"html" 发送完整 HTML 看板。pushplus 会把看板托管到其页面，
 *     5G 消息内呈现「纯文本摘要 + 超链接」，负责人点链接即可在手机上查看完整看板。
 *   - mail(邮件)：用 template:"html" 发送完整 HTML 看板全文。
 *
 * pushplus 对单次 content 有 2 万字上限：本助手先压缩空白，若仍超限则按标记
 * （<!-- PUSH-TRIM:history -->…<!-- /PUSH-TRIM:history -->）裁掉最低优先级的
 * 「历史参考」列，确保稳定送达；极端情况下再硬截断并附说明。
 *
 * 用法：node references/push-notify.js "<标题>" "<看板HTML文件路径>"
 * token 读取优先级：环境变量 PUSHPLUS_TOKEN > 同目录 push-secrets.json（本地，gitignore）
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const LIMIT = 19500; // 留余量，pushplus 硬上限 20000 字符

function getToken() {
  if (process.env.PUSHPLUS_TOKEN) return process.env.PUSHPLUS_TOKEN;
  const f = path.join(__dirname, "push-secrets.json");
  if (fs.existsSync(f)) {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8")).token;
    } catch (e) {}
  }
  return null;
}

function minify(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "") // 去注释（含 PUSH-TRIM 标记）
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .replace(/\n/g, "")
    .trim();
}

/* 图片资源改为绝对地址：看板里的 ./assets/xxx 在本地能显示，
   但推到 pushplus 托管页 / 邮件里相对路径会失效，这里统一换成 GitHub 原文件地址。 */
const ASSET_BASE =
  "https://raw.githubusercontent.com/cyhzzz/tianxin-daily-brief/master/assets/";
function absAssets(html) {
  return html.replace(/(src=)(["'])\.?\/?assets\//g, "$1$2" + ASSET_BASE);
}

/**
 * 生成「5G 消息安全版」HTML。
 * 背景：cmcc(5G 消息) 通道下 pushplus 会剥离 HTML 标签、把剩余文本作为短信正文，
 * 并附「查看详情」链接。若 content 里带 <style>，CSS（:root{--bg...} 等）会被当成正文
 * 混入短信。此函数移除 <style>，改用轻量内联样式保证托管页在手机上仍可读，
 * 短信正文即只剩看板真实内容。
 */
/** 从 <style> 的 :root 里取出 CSS 变量表，供解析内联 style 里的 var(--x) */
function cssVars(html) {
  const m = html.match(/:root\s*\{([\s\S]*?)\}/);
  const map = {};
  if (m) m[1].replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (_, k, v) => (map[k] = v.trim()));
  return map;
}
/** 把 var(--x) 替换为实际值（多轮，兼容变量引用变量） */
function resolveVars(str, map) {
  let out = str;
  for (let i = 0; i < 4; i++) {
    out = out.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
      (m, k, fb) => (map[k] !== undefined ? map[k] : (fb || "").trim())
    );
  }
  return out;
}

/**
 * 把 <style> 里的样式内联到各元素（jsdom 负责选择器匹配），然后移除 <style>。
 * 用途：邮件客户端（QQ 邮箱等）常剥离 <style>，且不支持 CSS 变量；
 * 内联后版式才能保住，同时也不会让 CSS 混进 5G 短信正文。
 * jsdom 不可用时返回 null，由调用方降级为「保留 <style>」。
 */
function inlineCss(html) {
  let JSDOM = null;
  for (const p of [
    "jsdom",
    "C:/Users/cyhzz/.workbuddy/binaries/node/workspace/node_modules/jsdom",
  ]) {
    try {
      JSDOM = require(p).JSDOM;
      break;
    } catch (e) {}
  }
  if (!JSDOM) return null;
  const vars = cssVars(html); // CSS 变量表（jsdom 对自定义属性支持有限，这里手工解析）
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const resolve = (v) => resolveVars(v, vars);
  const SKIP_PROPS = ["transition", "animation", "cursor"];
  const ZERO_OK = ["border-radius", "box-shadow", "text-transform", "border"];
  const INHERITED = [
    "color", "font", "font-family", "font-size", "font-weight", "font-style",
    "font-variant-numeric", "letter-spacing", "line-height", "text-align",
    "text-transform", "white-space", "list-style", "visibility", "word-spacing",
  ];
  const added = new Map();
  const track = (el, prop) => {
    if (!added.has(el)) added.set(el, []);
    added.get(el).push(prop);
  };
  // 继承去重：与父级生效值相同的可继承属性不再重复内联，显著压缩体积
  const leanInherited = (doc) => {
    const walk = (el, inherited) => {
      const eff = Object.assign({}, inherited);
      (added.get(el) || []).forEach((p) => {
        if (INHERITED.indexOf(p) < 0) return;
        const v = el.style.getPropertyValue(p);
        if (inherited[p] !== undefined && inherited[p] === v) el.style.removeProperty(p);
      });
      const st = el.style;
      for (let i = 0; i < st.length; i++) {
        const p = st.item(i);
        if (INHERITED.indexOf(p) >= 0) eff[p] = st.getPropertyValue(p);
      }
      Array.prototype.forEach.call(el.children, (c) => walk(c, eff));
    };
    walk(doc.documentElement, {});
  };
  const applyRule = (rule) => {
    const sel = (rule.selectorText || "").trim();
    if (!sel || sel.indexOf(":") >= 0) return; // 伪类/伪元素无法内联，跳过
    let els;
    try {
      els = doc.querySelectorAll(sel);
    } catch (e) {
      return;
    }
    const st = rule.style;
    const names = [];
    for (let i = 0; i < st.length; i++) names.push(st.item(i));
    names.forEach((prop) => {
      if (prop.indexOf("--") === 0) return;
      if (SKIP_PROPS.indexOf(prop) >= 0) return; // 动效类属性不内联
      const val = resolve(st.getPropertyValue(prop));
      if (!val) return;
      // 零值属性不内联（品牌本身 0 圆角，border-radius:0 纯属浪费字符）
      if ((val === "0" || val === "0px" || val === "none") && ZERO_OK.indexOf(prop) >= 0) return;
      const pri = st.getPropertyPriority(prop);
      Array.prototype.forEach.call(els, (el) => {
        // 元素自带的内联样式优先，不覆盖（如 logo 的白色底衬）
        if (elHasProp(el, prop)) return;
        el.style.setProperty(prop, val, pri);
        track(el, prop);
      });
    });
  };
  function elHasProp(el, prop) {
    const s = el.getAttribute("style") || "";
    return new RegExp("(^|;)\\s*" + prop.replace(/[-]/g, "\\-") + "\\s*:").test(s);
  }
  Array.prototype.forEach.call(doc.styleSheets, (ss) => {
    let rules;
    try {
      rules = ss.cssRules;
    } catch (e) {
      return;
    }
    Array.prototype.forEach.call(rules, (r) => {
      if (r.type === 1) applyRule(r); // 普通规则
      else if (r.type === 4 && r.cssRules)
        // @media：后应用，让移动端规则覆盖桌面规则
        Array.prototype.forEach.call(r.cssRules, (x) => {
          if (x.type === 1) applyRule(x);
        });
    });
  });
  Array.prototype.forEach.call(doc.querySelectorAll("style"), (s) => s.remove());
  leanInherited(doc); // 继承去重，压缩体积以适配 pushplus 2 万字上限
  return resolveVars(dom.serialize(), vars); // 残留 var()（元素自带内联里的）一并落地
}

/**
 * 保留 <style>，但把 <style> 内与内联 style 里的 var(--x) 全部落地为实际值。
 * 用途：邮件客户端多不支持 CSS 变量，落地后版式才稳；且不增加体积，守住 2 万字上限。
 * （完整内联版见 inlineCss，体积更大，仅在不超过上限时使用。）
 */
function resolveStyleVars(html) {
  const vars = cssVars(html);
  return html
    .replace(/<style([\s\S]*?)<\/style>/gi, (m, inner) => "<style" + resolveVars(inner, vars) + "</style>")
    .replace(/ style="([^"]*)"/g, (m, v) => ' style="' + resolveVars(v, vars) + '"');
}

/**
 * 抽取短信摘要：看板中 id="sms-summary" 的区块（纯文本）。
 * 5G 消息按 pushplus 文档用 template:"txt"，正文会尽量完整展示，
 * 所以这里必须给「短」内容，短信才不会太长。
 */
function extractSummary(html) {
  const m = html.match(/<div id="sms-summary"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }
  const text = m[1]
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text.length > 600 ? text.slice(0, 600) : text;
}

function smsSafe(html) {
  const vars = cssVars(html); // 先取变量表，再移除 <style>
  let out = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = resolveVars(out, vars); // 内联 style 里的 var(--x) 一并落地，避免托管页取不到值
  const tagStyle = (tag, css) =>
    out = out.replace(
      new RegExp("<" + tag + "(?![^>]*\\sstyle=)([^>]*)>", "gi"),
      "<" + tag + ' style="' + css + '"$1>'
    );
  tagStyle("table", "border-collapse:collapse;width:100%;font-size:13px;margin:12px 0");
  tagStyle("th", "border:1px solid #d0d0d0;padding:6px 8px;background:#f4f4f4;text-align:left;font-weight:600");
  tagStyle("td", "border:1px solid #e0e0e0;padding:6px 8px;vertical-align:top");
  tagStyle("h1", "font-size:20px;margin:16px 0 8px;color:#00338D");
  tagStyle("h2", "font-size:16px;margin:14px 0 6px;color:#00338D");
  tagStyle("h3", "font-size:14px;margin:12px 0 6px;color:#161616");
  tagStyle("p", "margin:8px 0;line-height:1.6");
  tagStyle("li", "margin:4px 0;line-height:1.6");
  tagStyle("section", "margin:16px 0");
  tagStyle("header", "margin:0 0 16px");
  tagStyle("footer", "margin:24px 0 0;padding-top:12px;border-top:1px solid #e0e0e0");
  out = out.replace(/<body([^>]*)>/i, (m, attrs) =>
    /style=/i.test(attrs)
      ? m
      : '<body' + attrs + ' style="font-family:-apple-system,\'PingFang SC\',\'Microsoft YaHei\',Arial,sans-serif;padding:12px;color:#161616;background:#ffffff;line-height:1.6">'
  );
  return out;
}

function prepare(raw) {
  let html = minify(raw);
  if (html.length <= LIMIT) return { html, trimmed: false };
  // 超限：裁掉「历史参考」列（最低优先级）
  const before = html;
  html = html
    .replace(/<!--\s*PUSH-TRIM:history\s*-->[\s\S]*?<!--\s*\/PUSH-TRIM:history\s*-->/g, "")
    .trim();
  html = minify(html);
  if (html.length <= LIMIT) return { html, trimmed: true };
  // 仍超限：在最后一个 </section> 前硬截断并附说明
  const cut = html.lastIndexOf("</section>", LIMIT - 200);
  const safe = cut > 0 ? cut : LIMIT;
  html =
    html.slice(0, safe) +
    '<section><p style="color:#8a8a8a">（内容过长已精简，完整看板见对话/邮件）</p></section></body></html>';
  return { html, trimmed: true };
}

function send(token, channel, title, content, template) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ token, title, content, channel, template });
    const req = https.request(
      "https://www.pushplus.plus/send/" + token,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve("[" + channel + "] " + res.statusCode + " " + b));
      }
    );
    req.on("error", (e) => resolve("[" + channel + "] ERR " + e.message));
    req.write(body);
    req.end();
  });
}

function resolveHtml(arg) {
  if (!arg) return null;
  try {
    if (fs.existsSync(arg) && fs.statSync(arg).isFile()) {
      return fs.readFileSync(arg, "utf8");
    }
  } catch (e) {}
  return arg;
}

(async () => {
  const token = getToken();
  if (!token) {
    console.log("SKIP: 未找到 PUSHPLUS_TOKEN（环境变量）或 push-secrets.json，跳过推送。");
    process.exit(0);
  }
  const [titleArg, htmlArg] = process.argv.slice(2);
  if (!titleArg) {
    console.log("SKIP: 缺少标题参数，跳过推送。");
    process.exit(0);
  }
  const raw = resolveHtml(htmlArg);
  if (!raw) {
    console.log("SKIP: 缺少看板 HTML 内容/路径，跳过推送。");
    process.exit(0);
  }
  const { html, trimmed } = prepare(raw);
  console.log("看板字符数:", html.length, trimmed ? "（已按优先级精简至 2 万字内）" : "（原始，未超上限）");
  const full = absAssets(html); // 图片转绝对地址，托管页/邮件才能显示
  const summary = extractSummary(full); // 5G 短信：只发短摘要（template:txt）
  const inlined = inlineCss(full); // 邮件/托管页：CSS 转内联，版式才不会丢
  console.log("短信摘要字符数:", summary.length, "（目标 ≤ 300）");
  console.log("--- 短信正文 ---\n" + summary + "\n----------------");
  const cmcc = await send(token, "cmcc", titleArg, summary, "txt");
  console.log(cmcc);
  const lean = resolveStyleVars(full); // 邮件版：保留 <style>，但 CSS 变量全部落地
  const mailBody = inlined && inlined.length <= LIMIT ? inlined : lean;
  console.log(
    "邮件版式:",
    mailBody === inlined ? "CSS 已内联" : "保留 <style>（变量已落地，邮件端兼容性更好）",
    "｜字符数:", mailBody.length, "｜var 残留:", mailBody.indexOf("var(--") >= 0 ? "有" : "无"
  );
  const mail = await send(token, "mail", titleArg, mailBody, "html");
  console.log(mail);
})();
