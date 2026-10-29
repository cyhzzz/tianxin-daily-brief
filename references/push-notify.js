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
const { execSync } = require("child_process");

/* ── 完整看板的公网托管（GitHub Pages） ───────────────────────────────
   背景：pushplus 的 cmcc(5G 消息) 通道，短信正文与「查看详情」链接页用的是同一份 content。
   发完整看板 → 短信必然又长又混代码；发短摘要 → 链接页也只能是摘要。二者无法在 pushplus 内解耦。
   解法：把完整看板发布到 GitHub Pages 拿到公网地址，短信只带摘要，
   链接页用「跳转桥页」自动跳到完整看板 —— 短信短、点开是完整版。 */
const PAGES_BASE = "https://cyhzzz.github.io/tianxin-daily-brief";
const REPO_ROOT = path.resolve(__dirname, "..");

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

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
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

/**
 * 等 GitHub Pages 构建完成。刚 push 完就发短信，链接会短暂 404（构建约需 30–60 秒），
 * 所以推送前轮询到可访问为止；超时也照发，只是链接可能要稍等。
 */
function headOk(url) {
  return new Promise((resolve) => {
    const req = https.request(
      url,
      { method: "GET", headers: { "User-Agent": "tianxin-daily-brief" } },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForPages(url, maxMs) {
  const t0 = Date.now();
  let waited = 0;
  while (Date.now() - t0 < maxMs) {
    if (await headOk(url)) return { ok: true, waited };
    waited = Math.round((Date.now() - t0) / 1000);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, waited };
}

/**
 * 把完整看板发布到 GitHub Pages（仓库 daily/ 目录），返回公网地址。
 * 同时写入 daily/latest.html 作为「最新一期」稳定地址。
 * 若不在 git 仓库 / 推送失败，返回 { url: null }，由调用方降级。
 */
function publishFullPage(html, date) {
  const dir = path.join(REPO_ROOT, "daily");
  try {
    fs.mkdirSync(dir, { recursive: true });
    // 页面位于 daily/ 下，资源路径 ./assets/ → ../assets/
    const page = html.replace(/(src=)(["'])\.?\/?assets\//g, "$1$2../assets/");
    fs.writeFileSync(path.join(dir, date + ".html"), page);
    fs.writeFileSync(path.join(dir, "latest.html"), page);
    const git = (cmd) => execSync(cmd, { cwd: REPO_ROOT, stdio: "pipe" }).toString();
    if (!fs.existsSync(path.join(REPO_ROOT, ".git"))) {
      return { url: null, why: "不在 git 仓库，未发布" };
    }
    git("git add daily");
    const st = execSync("git status --porcelain -- daily", { cwd: REPO_ROOT, stdio: "pipe" })
      .toString()
      .trim();
    if (st) {
      git('git commit -m "日报看板 ' + date + '"');
      git("git push origin master");
    }
    return { url: PAGES_BASE + "/daily/" + date + ".html", why: "" };
  } catch (e) {
    return { url: null, why: "发布失败: " + String(e.message || e).split("\n")[0] };
  }
}

/**
 * 生成「跳转桥页」：短信里点开 pushplus 链接后落地这一页，自动跳到完整看板。
 * 桥页正文就是短信摘要，因此 pushplus 抽出的短信正文 = 短摘要，不会长。
 * 若托管环境屏蔽 meta/script 跳转，页面上仍有醒目按钮可一键直达。
 */
function bridgeHtml(summary, url, title) {
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = summary.split("\n").filter((s) => s.trim());
  const body = lines
    .map(
      (l) =>
        '<p style="margin:6px 0;font-size:15px;line-height:1.6;color:#161616">' +
        esc(l) +
        "</p>"
    )
    .join("");
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="0;url=' + url + '">' +
    "<title>" + esc(title) + "</title></head>" +
    '<body style="margin:0;padding:16px;font-family:-apple-system,\'PingFang SC\',\'Microsoft YaHei\',Arial,sans-serif;background:#ffffff">' +
    '<div style="max-width:640px;margin:0 auto">' +
    '<p style="margin:0 0 10px;font-size:12px;letter-spacing:.08em;color:#8a8a8a">天台天信会计师事务所 · 每日情报</p>' +
    body +
    '<p style="margin:18px 0 6px"><a href="' + url + '" style="display:block;padding:13px 12px;background:#00338D;color:#ffffff;text-decoration:none;font-size:16px;text-align:center;font-weight:600">查看完整看板</a></p>' +
    '<p style="margin:0;font-size:12px;color:#8a8a8a">未自动跳转请点上方按钮</p>' +
    "</div>" +
    // 不用 <script>：pushplus 抽短信正文时会把脚本文本一起抽进去（曾导致短信混入代码）
    "</body></html>"
  );
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
  const summary = extractSummary(full); // 5G 短信：只发短摘要
  const inlined = inlineCss(full); // 邮件：CSS 转内联，版式才不会丢

  // ① 先把完整看板发布到公网（GitHub Pages），拿到可点开的完整版地址
  const date = (String(titleArg).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || todayStr();
  const pub = publishFullPage(raw, date);
  console.log(
    "完整看板公网地址:",
    pub.url || "（未发布：" + pub.why + "，将降级为短信只发摘要）"
  );
  if (pub.url) {
    const w = await waitForPages(pub.url, 120000); // 等 Pages 构建，避免短信里的链接 404
    console.log(
      w.ok ? "Pages 已就绪（等待 " + w.waited + " 秒）" : "Pages 尚未就绪（已等 " + w.waited + " 秒，链接可能要稍等）"
    );
  }

  // ② 5G 消息：短摘要 + 跳转桥页。点短信里的链接 → 桥页 → 自动跳到完整看板
  let cmccTpl = "txt";
  let cmccBody = summary;
  if (pub.url) {
    cmccBody = bridgeHtml(summary, pub.url, titleArg);
    cmccTpl = "html"; // 非 txt 模板：pushplus 抽纯文本摘要作短信正文，链接页显示桥页（跳转完整版）
  }
  const smsText = cmccBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  console.log(
    "短信正文字符数:",
    smsText.length,
    "｜代码残留:",
    /:root|var\(--|--bg|\{/.test(smsText) ? "有（异常）" : "无"
  );
  console.log("--- 短信正文 ---\n" + smsText + "\n----------------");
  const cmcc = await send(token, "cmcc", titleArg, cmccBody, cmccTpl);
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
