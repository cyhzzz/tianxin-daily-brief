#!/usr/bin/env node
/**
 * pushplus 推送助手（天信每日日报）
 * 用途：把日报推到三个终端
 *   ① 天信负责人手机（中国移动 5G 消息 cmcc）
 *   ② 微信「pushplus推送加」服务号（wechat）
 *   ③ 245830958@qq.com（邮件 mail）
 *
 * 推送机制（详细规范见 references/推送规范.md）：
 *   - cmcc(5G 消息)：template:"txt"，发**要点压缩版纯文本**（编号 + 要点，默认 ≤420 字）。
 *     通道经「新消息ClawBot」应用号下发，正文过长会投递异常（实测 1732 字时手机端
 *     收不到正常正文），故按 商机 > 天台县 > 提示 > 热点 的优先级装预算、逐档降级。
 *   - wechat(服务号)：template:"html"，发**移动端 HTML 看板**（全内联样式、单列重排），
 *     微信里点开即看，不必进邮箱。详见 buildWechatBoard。
 *   - mail(邮件)：template:"html"，发完整 HTML 看板（CSS 变量已落地）。
 *
 * 不发布到任何公网：GitHub Pages 路线已废弃（云端无 git 写凭据、构建延迟致链接 404），
 * 三个通道都不依赖自建外链。
 *
 * pushplus 对单次 content 有 2 万字上限：本助手先压缩空白，若仍超限则按 </section>
 * 硬截断并附说明（看板模板已移除「历史参考」列，正常不会触发）。
 *
 * 用法：node references/push-notify.js "<标题>" "<看板HTML文件路径>"
 * token 读取优先级：环境变量 PUSHPLUS_TOKEN > 同目录 push-secrets.json（本地，gitignore）
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

/* ── 完整看板的公网托管（GitHub Pages） ───────────────────────────────
   尽力而为：发布成功后，在短信全文末尾附一行完整看板地址。
   发布失败（非 git 环境 / 无 push 凭据）不影响短信 —— 短信本身即全文文案。 */

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

/* 图片资源改为绝对地址。
   看板为「单文件自包含」，logo 以 data URI 内联（生成时由 inline-logo.js 写入），
   好处是本地/预览面板打开都能显示；但 data URI 约 23 万字符，直接发会爆 pushplus
   2 万字上限，故推送前统一换回 GitHub 原文件地址（同一份官网原版文件，未做修改）。 */
const ASSET_BASE =
  "https://raw.githubusercontent.com/cyhzzz/tianxin-daily-brief/master/assets/";
function absAssets(html) {
  // ① data URI → 公网原图
  html = html.replace(/src=(["'])data:image\/[a-z+]*;base64,[A-Za-z0-9+/=\s]*\1/gi, function (
    _m,
    q
  ) {
    return "src=" + q + ASSET_BASE + "tianxin-logo.svg" + q;
  });
  // ② 相对路径 → 公网原图
  return html.replace(/(src=)(["'])\.{0,2}\/?assets\//g, "$1$2" + ASSET_BASE);
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
 * 按 class 名提取 div 区块（含匹配闭合标签），纯正则实现，不依赖 jsdom。
 * 看板是固定模板，div 嵌套规整，用深度计数即可准确切块。
 */
function matchBlocks(html, cls) {
  const out = [];
  const re = /<(\/?)div\b([^>]*)>/gi;
  const stack = [];
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    if (!closing) {
      const attrs = m[2] || "";
      const cm = attrs.match(/class\s*=\s*"([^"]*)"/i);
      const hit = cm && cm[1].split(/\s+/).indexOf(cls) >= 0;
      stack.push({ start: m.index + m[0].length, hit: !!hit });
    } else {
      const top = stack.pop();
      if (top && top.hit) out.push(html.slice(top.start, m.index));
    }
  }
  return out;
}

/** HTML 片段 → 纯文本（去标签、解实体、压空白） */
function textOf(frag) {
  if (!frag) return "";
  return frag
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|dt|dd|h\d|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

/** 取 <dl class="meta"> 里的 dt/dd 键值对 */
function metaPairs(cardHtml) {
  const dl = cardHtml.match(/<dl class="meta"[^>]*>([\s\S]*?)<\/dl>/i);
  if (!dl) return [];
  const pairs = [];
  const re = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let m;
  while ((m = re.exec(dl[1]))) {
    pairs.push([textOf(m[1]).replace(/[:：]\s*$/, ""), textOf(m[2])]);
  }
  return pairs;
}

/** 取区块里的 tag 文本（如 国企采购 / 急 · 11-05 开标 / 评分 高 / 可独立投） */
function tagTexts(frag) {
  const spans = frag.match(/<span class="tag[^"]*"[^>]*>([\s\S]*?)<\/span>/gi) || [];
  return spans.map((s) => textOf(s)).filter(Boolean);
}

/**
 * 构建 5G 消息正文（纯文本 · 编号 + 要点罗列 · 严格控长）。
 *
 * 通道实测：cmcc 走「新消息ClawBot」应用号下发，正文过长会投递异常
 * （1732 字 / 4047 字节 时手机端收不到正常正文）。故按优先级把要点装入
 * 固定预算（默认 420 字）：商机 > 天台县 > 提示 > 热点，超预算的档位自动降级，
 * 完整内容一律走邮件——短信只负责「三秒扫完知道今天有没有要动的事」。
 *
 * @param {string} html  看板 HTML
 * @param {string} dateStr 日期 YYYY-MM-DD
 * @param {number} [maxChars] 字数预算，默认 420
 */
function buildSmsText(html, dateStr, maxChars) {
  const BUDGET = maxChars || 420;
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const clip = (s, n) => {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const statOf = (label) => {
    for (const b of matchBlocks(html, "stat")) {
      if (b.indexOf(label) >= 0) {
        const n = b.match(/<div class="n">([^<]*)<\/div>/);
        if (n) return n[1].trim();
      }
    }
    return "";
  };

  // ── 抽取三板块结构 ──
  const oppSec = html.match(/<section id="opportunities"[^>]*>([\s\S]*?)<\/section>/i);
  const cards = (oppSec ? matchBlocks(oppSec[1], "card") : []).filter((c) =>
    /<h4 class="c-title"/i.test(c)
  );
  const hotSec = html.match(/<section id="hotspots"[^>]*>([\s\S]*?)<\/section>/i);
  const news = hotSec ? matchBlocks(hotSec[1], "news") : [];
  const tipSec = html.match(/<section id="tips"[^>]*>([\s\S]*?)<\/section>/i);
  const tips = tipSec ? tipSec[1].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [] : [];

  const opps = cards.map((c) => {
    const title = textOf((c.match(/<h4 class="c-title"[^>]*>([\s\S]*?)<\/h4>/i) || [])[1] || "");
    const meta = {};
    metaPairs(c).forEach(([k, v]) => (meta[k] = v));
    const when = meta["开标"] || meta["截止"] || "";
    const tags = tagTexts(c);
    const mt = tags.find((t) => /可独立投|需联合|暂不匹配/.test(t)) || "";
    const match = /可独立投/.test(mt)
      ? "可投"
      : /需联合/.test(mt)
      ? "需联合"
      : /暂不匹配/.test(mt)
      ? "不匹配"
      : "";
    const follow = textOf((c.match(/<div class="follow"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "").replace(
      /^跟进[：:]\s*/,
      ""
    );
    return { title, when, match, follow };
  });
  const hotItems = news.map((n) =>
    textOf((n.match(/<h3 class="n-title"[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || n)
  );
  const tipItems = tips.map((t) =>
    textOf((t.match(/<span class="t-body"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || t)
  );
  const nTT = Number(statOf("天台县") || 0);

  // ── 按档位渲染（参数越宽松，内容越全）──
  const render = (p) => {
    const L = [];
    L.push("天信每日日报 · " + dateStr);
    L.push("商机 " + opps.length + "｜天台县 " + nTT + "｜热点 " + hotItems.length);

    L.push("");
    L.push("【商机】");
    if (!opps.length) L.push("近 7 天无活单");
    opps.slice(0, p.oppN).forEach((o, i) => {
      const tail = [o.when, o.match].filter(Boolean).join("｜");
      L.push(i + 1 + ". " + clip(o.title, p.titleN) + (tail ? "｜" + tail : ""));
      if (p.followN > 0 && o.follow) L.push("   " + clip(o.follow, p.followN));
    });
    if (opps.length > p.oppN) L.push("（余 " + (opps.length - p.oppN) + " 条见邮件）");

    L.push("");
    L.push("【天台县】");
    L.push(nTT ? "本县 " + nTT + " 条，见商机区" : "近 7 天无本县活单");

    if (p.tipN > 0) {
      L.push("");
      L.push("【提示】");
      tipItems.slice(0, p.tipN).forEach((t, i) => L.push(i + 1 + ". " + clip(t, p.tipLen)));
    }
    if (p.hotN > 0 && hotItems.length) {
      L.push("");
      L.push("【热点】");
      hotItems.slice(0, p.hotN).forEach((t, i) => L.push(i + 1 + ". " + clip(t, p.hotLen)));
    }

    L.push("");
    L.push("完整版见邮件");
    return L.join("\n").trim();
  };

  // 由全到简逐档降级，取第一个装得进预算的档
  const plans = [
    { oppN: 3, titleN: 40, followN: 60, tipN: 4, tipLen: 56, hotN: 5, hotLen: 34 },
    { oppN: 3, titleN: 36, followN: 0, tipN: 4, tipLen: 50, hotN: 4, hotLen: 30 },
    { oppN: 2, titleN: 32, followN: 0, tipN: 3, tipLen: 44, hotN: 3, hotLen: 26 },
    { oppN: 2, titleN: 28, followN: 0, tipN: 2, tipLen: 38, hotN: 2, hotLen: 22 },
    { oppN: 1, titleN: 26, followN: 0, tipN: 2, tipLen: 32, hotN: 0, hotLen: 0 },
    { oppN: 1, titleN: 22, followN: 0, tipN: 0, tipLen: 0, hotN: 0, hotLen: 0 },
  ];
  for (const p of plans) {
    const t = render(p);
    if (t.length <= BUDGET) return t;
  }
  // 极端兜底：最后一档仍超预算则硬截
  const last = render(plans[plans.length - 1]);
  return last.slice(0, BUDGET - 1) + "…";
}

/* ══════════════════════════════════════════════════════════════════════════
   服务号（微信）HTML 看板  buildWechatBoard()
   ──────────────────────────────────────────────────────────────────────────
   通道 wechat + template:"html"：pushplus 把 content 原样注入详情页
   https://www.pushplus.plus/shortMessage/{id} 的 #messageContent 容器。
   这个注入点有三条硬约束，决定了**不能直接复用桌面看板**：

     ① 注入点在 <body> 内的 div —— 若内容带 <style>，其中 body / * / :root
        规则会外溢，改写 pushplus 页面自身的标题栏、页脚与字号。故本函数
        **全量内联样式、零 <style>**（顺带也免疫"客户端剥 style"）。
     ② 容器 style 带 white-space: pre-line —— 内容里每个换行都会渲染成空行。
        故最终输出前压掉所有换行。
     ③ 视口宽 ~375px —— 桌面看板靠 @media 才降列，内联后 @media 失效、会挤成
        四列。故按单列重排；速览与字段表用 <table> 保证对齐。

   内容与看板**同源抽取**（不另行组织信息、不新增判断），仅在超 2 万字上限时
   按「跟进 → 相关性 → 热点条数」逐档收缩，并在末尾注明余量去向。
   ══════════════════════════════════════════════════════════════════════════ */
const WX_LIMIT = 19000;
const LOGO_URL = ASSET_BASE + "tianxin-logo.svg";
const LOGO_FALLBACK =
  "https://cdn.jsdelivr.net/gh/cyhzzz/tianxin-daily-brief@master/assets/tianxin-logo.svg";

/** HTML 实体转义（textOf 已解码，回写前要重新编码） */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 片段 → 安全文本，保留 <a>（套内联样式）与 <b>/<strong>（"相关性""跟进"等小标题） */
function richText(frag) {
  const keep = [];
  const body = String(frag || "")
    .replace(
      /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      function (_m, href, label) {
        keep.push(
          '<a href="' +
            esc(href) +
            '" style="color:#0F62FE;text-decoration:none;border-bottom:1px solid #0F62FE">' +
            esc(textOf(label)) +
            "</a>"
        );
        return "\u0001" + (keep.length - 1) + "\u0001";
      }
    )
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (_m, _t, inner) {
      keep.push('<b style="color:#00338D;font-weight:600">' + esc(textOf(inner)) + "</b>");
      return "\u0001" + (keep.length - 1) + "\u0001";
    });
  return esc(textOf(body)).replace(/\u0001(\d+)\u0001/g, function (_m, i) {
    return keep[Number(i)];
  });
}

/** 标签 → 内联 span（沿用看板配色语义：紧急红 / 分类navy / 其余灰） */
function wxTag(txt, kind) {
  const c = kind === "urgent" ? "#da1e28" : kind === "navy" ? "#00338D" : "#6f6f6f";
  const b = kind === "urgent" ? "#F0B6B9" : kind === "navy" ? "#A9BDD8" : "#D8D8D8";
  return (
    '<span style="display:inline-block;font-size:11px;line-height:1.7;padding:0 6px;margin:0 4px 4px 0;border:1px solid ' +
    b +
    ";color:" +
    c +
    ';white-space:nowrap">' +
    esc(txt) +
    "</span>"
  );
}

/** 取片段里的 <span class="tag*">，带语义分类 */
function tagObjs(frag) {
  const out = [];
  const re = /<span class="([^"]*tag[^"]*)"[^>]*>([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = re.exec(frag))) {
    const cls = m[1];
    const t = textOf(m[2]);
    if (!t) continue;
    const kind = /tag-urgent/.test(cls) ? "urgent" : /tag-(blue|navy)/.test(cls) ? "navy" : "gray";
    out.push(wxTag(t, kind));
  }
  return out.join("");
}

/**
 * @param {string} html 看板 HTML（**必须先 absAssets**，否则 data URI 撑爆上限）
 * @param {string} dateStr YYYY-MM-DD
 * @param {{followLen?:number, relLen?:number, hotN?:number}} [plan] 收缩档位
 *        followLen/relLen：0=整段省略；>=9999 视为不截断。hotN：0=整个热点区省略
 */
function buildWechatBoard(html, dateStr, plan) {
  const P = Object.assign({ followLen: 9999, relLen: 9999, hotN: 99 }, plan || {});
  html = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  const clip = (s, n) => {
    s = String(s || "");
    return n > 0 && n < 9999 && s.length > n ? s.slice(0, n - 1) + "…" : s;
  };

  // ── 抽取（结构与 buildSmsText 共用同一套选择器）──
  const stats = matchBlocks(html, "stat")
    .slice(0, 3)
    .map((b) => ({
      n: ((b.match(/<div class="n">([^<]*)<\/div>/) || [])[1] || "").trim(),
      l: textOf((b.match(/<div class="l">([\s\S]*?)<\/div>/) || [])[1] || ""),
    }));
  const dateLine =
    textOf((html.match(/<p class="date"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "") || dateStr;

  const ttBand = matchBlocks(html, "tiantai-band")[0] || "";
  const ttText = richText((ttBand.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "");

  const oppSec = (html.match(/<section id="opportunities"[^>]*>([\s\S]*?)<\/section>/i) || [])[1] || "";
  let cols = matchBlocks(oppSec, "col")
    .map((c) => ({
      head: textOf((c.match(/<div class="col-head"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || ""),
      cards: matchBlocks(c, "card").filter((x) => /<h4 class="c-title"/i.test(x)),
    }))
    .filter((c) => c.cards.length);
  if (!cols.length) {
    const cs = matchBlocks(oppSec, "card").filter((x) => /<h4 class="c-title"/i.test(x));
    if (cs.length) cols = [{ head: "", cards: cs }];
  }

  const hotSec = (html.match(/<section id="hotspots"[^>]*>([\s\S]*?)<\/section>/i) || [])[1] || "";
  const hotNote = clip(
    textOf((hotSec.match(/<p class="section-note"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ""),
    230
  );
  const news = matchBlocks(hotSec, "news").map((n) => ({
    title: textOf((n.match(/<h3 class="n-title"[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || ""),
    tags: tagObjs(n),
    rel: richText((n.match(/<p class="n-rel"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ""),
  }));

  const tipSec = (html.match(/<section id="tips"[^>]*>([\s\S]*?)<\/section>/i) || [])[1] || "";
  const tips = (tipSec.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || []).map((li) =>
    richText((li.match(/<span class="t-body"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || li)
  );

  // ── 渲染 ──
  const T = [];
  T.push('<div style="margin:0;padding:0;background:#ffffff;max-width:680px">');

  // 页眉：红章压在 navy 上会发闷 → 白色底衬（内联，推送端剥 style 也照样生效）
  T.push('<div style="background:#00338D;padding:16px">');
  T.push('<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse"><tr>');
  T.push('<td width="60" valign="middle" style="width:60px;padding:0">');
  T.push(
    '<img src="' + LOGO_URL + '" alt="天台天信会计师事务所" width="56" height="56" style="display:block;width:56px;height:56px;background:#ffffff;padding:5px;box-sizing:border-box;border:0" onerror="this.onerror=null;this.src=\'' +
      LOGO_FALLBACK +
      '\'" />'
  );
  T.push("</td>");
  T.push('<td valign="middle" style="padding:0 0 0 12px">');
  T.push('<div style="font-size:9px;letter-spacing:1.5px;color:#8FB0DC;line-height:1.4">TIANXIN CPA · DAILY INTELLIGENCE</div>');
  T.push('<div style="font-size:17px;font-weight:600;color:#ffffff;line-height:1.5;margin-top:2px">天台天信会计师事务所</div>');
  T.push('<div style="font-size:11px;color:#C9D6EA;line-height:1.5;margin-top:1px">每日行业与商机情报看板 · 县城所赋能与外联获客</div>');
  T.push("</td></tr></table></div>");

  T.push('<div style="background:#F7F7F7;padding:9px 16px;border-bottom:1px solid #D8D8D8;font-size:12px;color:#525252">' + esc(dateLine) + "</div>");

  // 速览：三个数由看板数据抽取，非硬编码
  if (stats.length) {
    T.push('<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed">');
    T.push("<tr>");
    const n = stats.length;
    stats.forEach((s, i) => {
      const gold = i === 1; // 天台县（本所驻地）用金，单屏金色用量压在 2 次内
      T.push(
        '<td style="padding:12px 6px;text-align:center;vertical-align:top;' +
          (i < n - 1 ? "border-right:1px solid #E4E4E4;" : "") +
          '">' +
          '<div style="font-size:22px;font-weight:600;line-height:1.2;color:' +
          (gold ? "#B8860B" : "#00338D") +
          '">' +
          esc(s.n) +
          "</div>" +
          '<div style="font-size:11px;color:#6f6f6f;line-height:1.5;margin-top:2px">' +
          esc(s.l) +
          "</div></td>"
      );
    });
    T.push("</tr></table>");
  }

  const secHead = (no, title, note) =>
    '<div style="padding:20px 16px 0">' +
    '<div style="font-size:10px;letter-spacing:1.5px;color:#8a8a8a;line-height:1.4">SECTION ' +
    no +
    "</div>" +
    '<div style="font-size:16px;font-weight:600;color:#00338D;line-height:1.5;margin-top:2px">' +
    title +
    "</div>" +
    '<div style="height:1px;background:#D8D8D8;margin:9px 0 0"></div>' +
    (note
      ? '<div style="font-size:11.5px;color:#6f6f6f;line-height:1.65;margin-top:8px">' + note + "</div>"
      : "") +
    "</div>";

  // ── Section 01 商机 ──
  T.push(secHead("01", "台州本地商机", "近 7 天发布；NEW=近 2 天发布，急=≤7 天截止。已定标 / 已过截止的历史单不进看板。仅作情报提示，对外动作须经负责人复核。"));
  T.push('<div style="padding:0 16px">');
  if (ttText) {
    T.push('<div style="border:1px solid #D8D8D8;background:#FAFAFA;padding:12px;margin-top:12px">');
    T.push('<div style="font-size:13px;font-weight:600;color:#1a1a1a;line-height:1.5"><span style="color:#B8860B;font-weight:700">■</span> 天台县专项（本所驻地 · 最高优先）</div>');
    T.push('<div style="font-size:12.5px;color:#393939;line-height:1.7;margin-top:6px">' + ttText + "</div>");
    T.push("</div>");
  }
  if (!cols.length) {
    T.push('<div style="border:1px solid #E4E4E4;padding:12px;margin-top:12px;font-size:13px;color:#6f6f6f">近 7 天未检索到进行中的相关采购。</div>');
  }
  cols.forEach((col) => {
    if (col.head) T.push('<div style="font-size:12px;color:#525252;line-height:1.6;margin:16px 0 8px">' + esc(col.head) + "</div>");
    col.cards.forEach((c) => {
      const cut = c.indexOf('<dl class="meta"');
      const title = textOf((c.match(/<h4 class="c-title"[^>]*>([\s\S]*?)<\/h4>/i) || [])[1] || "");
      const topTags = tagObjs(cut > 0 ? c.slice(0, cut) : "");
      const meta = metaPairs(c)
        .map(
          ([k, v]) =>
            '<tr><td style="width:64px;padding:3px 8px 3px 0;color:#6f6f6f;font-size:12px;line-height:1.65;vertical-align:top;white-space:nowrap">' +
            esc(k) +
            '</td><td style="padding:3px 0;color:#262626;font-size:12.5px;line-height:1.65;vertical-align:top">' +
            esc(v) +
            "</td></tr>"
        )
        .join("");
      const bottomTags = tagObjs(cut > 0 ? c.slice(cut) : c);
      const follow = textOf((c.match(/<div class="follow"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "").replace(
        /^跟进[：:]\s*/,
        ""
      );
      const href = (c.match(/<a class="c-link"[^>]*href="([^"]*)"/i) || [])[1] || "";
      T.push('<div style="border:1px solid #D8D8D8;background:#ffffff;padding:12px;margin-bottom:10px">');
      T.push('<div style="font-size:15px;font-weight:600;color:#1a1a1a;line-height:1.5">' + esc(title) + "</div>");
      if (topTags) T.push('<div style="margin-top:8px">' + topTags + "</div>");
      if (meta) T.push('<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:8px">' + meta + "</table>");
      if (bottomTags) T.push('<div style="margin-top:8px">' + bottomTags + "</div>");
      if (P.followLen && follow)
        T.push(
          '<div style="margin-top:10px;background:#F4F4F4;padding:8px 10px;font-size:12.5px;color:#393939;line-height:1.7">' +
            "<b style=\"color:#00338D\">跟进：</b>" +
            esc(clip(follow, P.followLen)) +
            "</div>"
        );
      if (href)
        T.push(
          '<div style="margin-top:10px"><a href="' +
            esc(href) +
            '" style="color:#0F62FE;text-decoration:none;border-bottom:1px solid #0F62FE;font-size:12.5px">查看原文 ↗</a></div>'
        );
      T.push("</div>");
    });
  });
  T.push("</div>");

  // ── Section 02 热点 ──
  const hotShown = Math.min(P.hotN, news.length);
  if (hotShown > 0) {
    T.push(secHead("02", "行业热点", esc(hotNote)));
    T.push('<div style="padding:0 16px">');
    news.slice(0, hotShown).forEach((n, i) => {
      T.push('<div style="padding:12px 0' + (i ? ";border-top:1px solid #E4E4E4" : ";border-top:1px solid #E4E4E4;margin-top:10px") + '">');
      T.push('<div style="font-size:14px;font-weight:600;color:#1a1a1a;line-height:1.55">' + esc(n.title) + "</div>");
      if (n.tags) T.push('<div style="margin-top:6px">' + n.tags + "</div>");
      if (P.relLen && n.rel)
        T.push('<div style="margin-top:6px;font-size:12.5px;color:#393939;line-height:1.75">' + clip(n.rel, P.relLen) + "</div>");
      T.push("</div>");
    });
    if (hotShown < news.length)
      T.push('<div style="padding:10px 0;font-size:12px;color:#8a8a8a">余 ' + (news.length - hotShown) + " 条热点见邮件完整看板。</div>");
    T.push("</div>");
  }

  // ── Section 03 提示 ──
  if (tips.length) {
    T.push(secHead("03", "今日提示", ""));
    T.push('<div style="padding:0 16px">');
    tips.forEach((t, i) => {
      T.push('<div style="padding:10px 0' + (i ? ";border-top:1px solid #EFEFEF" : ";border-top:1px solid #E4E4E4;margin-top:10px") + '">');
      T.push('<div style="font-size:12.5px;color:#262626;line-height:1.75"><span style="color:#00338D;font-weight:600;margin-right:6px">' + (i + 1) + "</span>" + t + "</div>");
      T.push("</div>");
    });
    T.push("</div>");
  }

  // 页脚
  T.push('<div style="background:#F7F7F7;border-top:1px solid #D8D8D8;padding:14px 16px;margin-top:20px">');
  T.push('<div style="font-size:11px;color:#6f6f6f;line-height:1.75">数据来源：审计热点站 · 浙江政府采购网 · 中国政府采购网 · 台州浙里招标 · 台州中介服务网 · 台州阳光采购 · 天台县政府门户公共资源交易 · 天台阳光招采 · 浙江省公共资源交易平台；抓取于 ' + esc(dateStr) + "。商机仅作情报提示，金额、截止时间与资质门槛以公告原文为准，不得据此直接承诺投标；对外动作须经负责人（及事务所）人工复核。</div>");
  T.push('<div style="font-size:10px;color:#8a8a8a;line-height:1.7;margin-top:8px">天台天信会计师事务所 · TIANXIN CPA · 由「天信每日日报」自动生成</div>');
  T.push("</div>");

  T.push("</div>");
  return T.join("").replace(/\n/g, ""); // 容器 pre-line：绝不能留换行
}

/**
 * 生成服务号看板并按 2 万字上限逐档收缩。
 * @returns {{html:string, level:number, len:number}}
 */
function wechatBoard(html, dateStr) {
  const plans = [
    { followLen: 9999, relLen: 9999, hotN: 99 }, // 0 全量
    { followLen: 9999, relLen: 140, hotN: 7 },
    { followLen: 90, relLen: 100, hotN: 6 },
    { followLen: 0, relLen: 80, hotN: 5 },
    { followLen: 0, relLen: 0, hotN: 4 },
    { followLen: 0, relLen: 0, hotN: 2 },
  ];
  let last = "";
  for (let i = 0; i < plans.length; i++) {
    last = buildWechatBoard(html, dateStr, plans[i]);
    if (last.length <= WX_LIMIT) return { html: last, level: i, len: last.length };
  }
  return { html: last.slice(0, WX_LIMIT - 60) + "…", level: plans.length, len: WX_LIMIT };
}

function prepare(raw) {
  let html = minify(raw);
  if (html.length <= LIMIT) return { html, trimmed: false };
  // 仍超限：在最后一个 </section> 前硬截断并附说明（模板已移除「历史参考」列，正常不会走到这里）
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

async function main() {
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
  // ⚠️ 顺序关键：必须先 absAssets 再 prepare。
  //    看板为单文件自包含（logo 内联为 data URI，约 227KB×2），若先 prepare 会被 2 万字
  //    上限硬截断，正文和短信抽取都会丢。换成公网地址后体积回落到 20KB 级。
  const full = absAssets(raw);
  const { html, trimmed } = prepare(full);
  console.log("看板字符数:", html.length, trimmed ? "（已精简至 2 万字内）" : "（原始，未超上限）");
  const inlined = inlineCss(html); // 邮件：CSS 转内联（jsdom 可用且不超上限时才用）
  const date = (String(titleArg).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || todayStr();

  // ① 全文文案（编号 + 要点）：不依赖任何外链即可读全
  let smsBody = buildSmsText(html, date).trim();
  if (smsBody.length < 120) {
    // 模板结构异常时的兜底：剥离标签取正文
    smsBody =
      "天信每日日报 · " +
      date +
      "\n" +
      html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]*>/g, "\n")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);
  }

  // ② 不发布到任何公网。
  //    GitHub Pages 路线已废弃：云端执行环境无 git 写凭据（push 必然失败），
  //    且 Pages 构建需数十秒到数分钟，链接发出时大概率 404。
  //    三个通道各自自带内容，都不依赖自建外链。

  // ③ 5G 消息：template:"txt" 发全文文案（pushplus 对 txt 正文会尽量完整展示）
  console.log(
    "短信正文字符数:",
    smsBody.length,
    "｜代码残留:",
    /:root|var\(--|--bg|\{/.test(smsBody) ? "有（异常）" : "无"
  );
  console.log("--- 短信正文 ---\n" + smsBody + "\n----------------");
  const cmcc = await send(token, "cmcc", titleArg, smsBody, "txt");
  console.log(cmcc);

  // ④ 服务号：template:"html" 发移动端看板（全内联、单列、零 <style>）
  const wx = wechatBoard(html, date);
  console.log(
    "服务号版式:",
    "移动端单列 · 全内联",
    "｜字符数:", wx.len,
    "｜收缩档:", wx.level + "/" + (wx.level === 0 ? "全量" : "已收缩"),
    "｜style 残留:", wx.html.indexOf("<style") >= 0 ? "有（异常）" : "无",
    "｜换行:", /\n/.test(wx.html) ? "有（异常）" : "无"
  );
  const wechat = await send(token, "wechat", titleArg, wx.html, "html");
  console.log(wechat);

  // ⑤ 邮件：完整看板（桌面版式，CSS 变量落地）
  const lean = resolveStyleVars(html); // 保留 <style>，但 CSS 变量全部落地（基于已 minify 的 html，避免超 2 万字）
  const mailBody = inlined && inlined.length <= LIMIT ? inlined : lean;
  console.log(
    "邮件版式:",
    mailBody === inlined ? "CSS 已内联" : "保留 <style>（变量已落地，邮件端兼容性更好）",
    "｜字符数:", mailBody.length, "｜var 残留:", mailBody.indexOf("var(--") >= 0 ? "有" : "无"
  );
  const mail = await send(token, "mail", titleArg, mailBody, "html");
  console.log(mail);
}

module.exports = {
  buildSmsText,
  buildWechatBoard,
  wechatBoard,
  inlineCss,
  resolveStyleVars,
  prepare,
  absAssets,
  minify,
  textOf,
  matchBlocks,
};

if (require.main === module) main();
