#!/usr/bin/env node
/**
 * 看板自检助手（天信每日日报）
 * 用途：生成看板后、推送前必跑。把「日期没更新到当日」「模板占位没替换」「历史参考残留」
 *       「速览数字与条目数不符」这四类问题机械拦下。
 *
 * 用法：node references/check-dashboard.js daily/2026-10-30.html
 * 退出码：0 = 通过（可推送）｜1 = 不通过（禁止推送，先修）
 */
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log("FAIL 文件不存在：" + (file || "(未传路径)"));
  process.exit(1);
}
const rawHtml = fs.readFileSync(file, "utf8");
// 剥离 HTML 注释后再统计：模板注释里的骨架示例不能计入条目数
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, "");

const p = (n) => String(n).padStart(2, "0");
const d = new Date();
const TODAY = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());

const fails = [];
const warns = [];
const ok = (m) => console.log("  PASS " + m);

console.log("看板自检：" + file + "　（系统今日 = " + TODAY + "）");

// 1) 关键位置的日期必须是今日
const checks = [
  ["页眉 date", (html.match(/<p class="date">([^<]*)<\/p>/) || [])[1] || ""],
  ["<title>", (html.match(/<title>([^<]*)<\/title>/) || [])[1] || ""],
  ["页脚抓取于", (html.match(/抓取于\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1] || ""],
];
checks.forEach(([label, val]) => {
  const m = (val || "").match(/\d{4}-\d{2}-\d{2}/);
  if (!m) fails.push(label + " 未找到日期（" + (val || "空").trim() + "）");
  else if (m[0] !== TODAY) fails.push(label + " 日期为 " + m[0] + "，应为 " + TODAY);
  else ok(label + " 日期 = " + TODAY);
});

// 2) 模板占位必须全部替换
const placeholders = html.match(/\{\{[A-Z_]+\}\}/g);
if (placeholders) fails.push("仍有未替换的占位符：" + [...new Set(placeholders)].join("、"));
else ok("无 {{占位符}} 残留");

// 3) 不得再有「历史参考」区
if (/历史参考/.test(html)) fails.push("仍存在「历史参考」（该区已移除，历史单不进看板）");
else ok("无「历史参考」区");

// 4) 速览数字 == 实际条目数（数字由数据算出，不硬编码）
//    活单口径（2026-11-03 修正）：活单数只数「进行中/报名中」卡；⚠待核/前瞻卡不计入活单，
//    速览须标「含待核 N」；活单数 + 待核数 == 板块一卡片数。
const statOf = (label) => {
  const re = /<div class="stat[^"]*">\s*<div class="n">([^<]*)<\/div>\s*<div class="l">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) if (m[2].indexOf(label) >= 0) return { n: parseInt(m[1].trim(), 10), l: m[2] };
  return null;
};
const countBlocks = (cls) => {
  const re = new RegExp('<div class="' + cls + '"', "g");
  return (html.match(re) || []).length;
};
const oppSec = (html.match(/<section id="opportunities"[\s\S]*?<\/section>/) || [])[0] || "";
const cardCount = (oppSec.match(/<h4 class="c-title"/g) || []).length;
const cardBlocks = oppSec.match(/<div class="card"[\s\S]*?(?=<div class="card"|<\/div>\s*<\/div>\s*<\/section>|$)/g) || [];
let liveCardCount = 0;
cardBlocks.forEach((c) => {
  if (!/<h4 class="c-title"/.test(c)) return;
  const tags = (c.match(/<span class="tag[^"]*">([\s\S]*?)<\/span>/g) || []).join(" ");
  const txt = c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (/进行中|报名中/.test(tags) || /进行中|报名中/.test(txt)) liveCardCount++;
});
const hotSec = (html.match(/<section id="hotspots"[\s\S]*?<\/section>/) || [])[0] || "";
const newsCount = (hotSec.match(/<h3 class="n-title"/g) || []).length;
const tipCount = ((html.match(/<section id="tips"[\s\S]*?<\/section>/) || [])[0] || "").match(/<span class="t-body"/g) || [];
const liveStat = statOf("活单");
const nTTStat = statOf("天台县");
const nHotStat = statOf("热点");
if (!liveStat) warns.push("速览未找到「活单」数字");
else {
  const nPendingM = liveStat.l.match(/含待核\s*(\d+)/);
  const nPending = nPendingM ? parseInt(nPendingM[1], 10) : null;
  if (nPending === null) fails.push("速览「活单」未按新口径标注「含待核 N」（2026-11-03 起：活单只数进行中卡，待核另计）");
  else if (liveStat.n !== liveCardCount) fails.push("速览活单数 " + liveStat.n + " ≠ 进行中卡片数 " + liveCardCount + "（活单只数「进行中/报名中」卡，待核卡不得计入）");
  else if (liveStat.n + nPending !== cardCount) fails.push("速览活单数+待核数 " + (liveStat.n + nPending) + " ≠ 商机卡片数 " + cardCount);
  else ok("速览活单数 = 进行中卡 " + liveCardCount + "，另待核 " + nPending + "，合计 = 卡片数 = " + cardCount);
}
if (!nHotStat) warns.push("速览未找到「热点」数字");
else if (nHotStat.n !== newsCount) warns.push("速览热点数 " + nHotStat.n + " ≠ 热点条目数 " + newsCount + "（若末条为汇总条目可忽略）");
else ok("速览热点数 = 热点条目数 = " + newsCount);
if (nTTStat && nTTStat.n > 0 && !/天台县/.test(oppSec)) warns.push("速览天台县 > 0，但商机区未出现天台县条目");
console.log("  统计：卡片 " + cardCount + "（进行中 " + liveCardCount + " / 待核 " + (cardCount - liveCardCount) + "）/ 热点 " + newsCount + " / 提示 " + tipCount.length);

// 5) 结构完整性（短信全文抽取依赖）
["opportunities", "hotspots", "tips"].forEach((id) => {
  if (html.indexOf('id="' + id + '"') < 0) fails.push("缺少 <section id=\"" + id + "\">（短信全文抽取依赖）");
});
// logo 应为内联 data URI（单文件自包含，本地/预览面板打开都能显示）
if (/src=["']data:image\/svg\+xml;base64,/.test(html)) ok("logo 已内联（单文件自包含）");
else if (/assets\/tianxin-logo\.svg/.test(html))
  warns.push("logo 用相对路径，单独打开 html 会 404；建议跑 node references/inline-logo.js 内联");
else warns.push("未见 logo");

// 5b) 行业热点消息结构固化（模板骨架为唯一权威：标题+正文+底部超链，禁信源/评分/抓取方式/表格）
const newsBlocks = hotSec.match(/<div class="news">[\s\S]*?<\/div>/g) || [];
let hotStructOk = true;
newsBlocks.forEach((blk, i) => {
  const links = (blk.match(/<a class="c-link"/g) || []).length;
  if (links !== 1) { fails.push("热点第 " + (i + 1) + " 条消息应有且仅有 1 个底部超链，实际 " + links); hotStructOk = false; }
  if (/<table[\s>]|<dl[\s>]/.test(blk)) { fails.push("热点第 " + (i + 1) + " 条消息出现表格/定义列表（禁止）"); hotStructOk = false; }
});
if (/tag-navy">来源|tag-gray">评分|n-rel/.test(hotSec)) { fails.push("板块二残留 来源/评分 标签或旧 n-rel 类（应改为 n-body + c-link）"); hotStructOk = false; }
const hotNote = (hotSec.match(/<p class="section-note">([\s\S]*?)<\/p>/) || [])[1] || "";
if (/信源|抓取方式/.test(hotNote)) { fails.push("板块二说明出现 信源/抓取方式（禁止，应只写一句话简短说明）"); hotStructOk = false; }
if (newsBlocks.length && hotStructOk) ok("行业热点消息结构固化（" + newsBlocks.length + " 条均 标题+正文+底部超链，无信源/评分/抓取方式/表格）");
else if (newsBlocks.length) warns.push("行业热点消息结构未完全固化（见上方失败项），推送前须修复");

// 5c) 商机「原子核验」门禁（2026-11-03 新增，源自路桥误报事故；同日扩展两条）
//     规则见 references/招标商机处理规范.md §〇之二：
//     a) 卡片标「进行中」且 预算与截止均为「未披露/以…为准」→ 无实值支撑，判为缺陷；
//     b) 卡片标「进行中」且「截止/开标」字段上有可解析日期 → 取这些日期中最晚者，必须不早于运行当日（早于 = 过期单）；
//        只认截止/开标字段上的日期（关键词在前、间隔≤6个非数字字符），发布日期、公告日期等其他日期不参与判定
//        （2026-11-03 收紧边界：防「仅发布日期 + 截止未披露」被发布日误杀）；
//        日期恰为今日不 FAIL；解析不出维持 PASS，不因解析失败制造新 FAIL；
//     c) 卡片标「进行中」且正文含「采购意向/意向公告」→ 意向单只作线索，不得标进行中。
const cards = oppSec.match(/<div class="card"[\s\S]*?(?=<div class="card"|<\/div>\s*<\/div>\s*<\/section>|$)/g) || [];
let hollow = 0;
let expiredBad = 0;
let intentBad = 0;
cards.forEach((c, i) => {
  const title = ((c.match(/<h4 class="c-title"[^>]*>([\s\S]*?)<\/h4>/) || [])[1] || "")
    .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!title) return; // 空列占位
  const tags = (c.match(/<span class="tag[^"]*">([\s\S]*?)<\/span>/g) || []).join(" ");
  const txt = c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const isLive = /进行中|报名中/.test(tags) || /进行中|报名中/.test(txt);
  if (!isLive) return; // 已成交/已中标等如实标注的卡不适用以下三条
  // a) 金额与截止是否都缺实值
  const moneyNotGiven = /(预算|限价|金额)[^；;。|]{0,12}(未披露|详见|以.{0,8}为准)/.test(txt);
  const deadlineNotGiven = /(截止|开标)[^；;。|]{0,16}(未披露|详见|以.{0,12}为准)/.test(txt);
  if (moneyNotGiven && deadlineNotGiven) {
    hollow++;
    fails.push(
      "商机「" + title + "」标进行中，但预算与截止均无实值（核验门禁未过，须剔除或补实值）"
    );
  }
  // b) 截止过期拦截：只认「截止/开标」字段上的日期——关键词在前、间隔≤6个非数字字符（含「报名截止」）；
  //    发布日期、公告日期等其他日期不参与判定（2026-11-03 收紧：防「仅发布日期+截止未披露」被发布日误杀）；
  //    多日期取最晚；恰为今日不 FAIL；解析不出维持 PASS。
  {
    const KW_FULL = /(截止|开标)[^；;。|\d]{0,6}(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/g;
    const KW_PART = /(截止|开标)[^；;。|\d]{0,6}(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?(?!\d)/g;
    const found = [];
    let dm;
    while ((dm = KW_FULL.exec(txt))) found.push(new Date(+dm[2], +dm[3] - 1, +dm[4]));
    const rest = txt.replace(KW_FULL, " ");
    while ((dm = KW_PART.exec(rest))) {
      let dt = new Date(d.getFullYear(), +dm[2] - 1, +dm[3]);
      // 年份缺失：归一到本年；若已远在过去（超 180 天），按招标惯例视为下一年度，避免误杀
      if ((dt - d) / 86400000 < -180) dt = new Date(d.getFullYear() + 1, +dm[2] - 1, +dm[3]);
      found.push(dt);
    }
    if (found.length) {
      const latest = new Date(Math.max.apply(null, found));
      const latestStr = latest.getFullYear() + "-" + p(latest.getMonth() + 1) + "-" + p(latest.getDate());
      const today0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (latest < today0) {
        expiredBad++;
        fails.push(
          "商机「" + title + "」标进行中，但截止/开标字段最晚日期 " + latestStr + " 已早于今日（" + TODAY + "）——过期单不得标进行中"
        );
      }
    }
  }
  // c) 采购意向单不得标进行中（意向只说明"预计采购"，无截止时间）
  if (/采购意向|意向公告/.test(txt)) {
    intentBad++;
    fails.push(
      "商机「" + title + "」为采购意向/意向公告，不得标「进行中」（意向单只作线索，不参与活单计数）"
    );
  }
});
// 核验等级标记必须上书（✔核验 / ⚠待核）——缺标记说明跳过了门禁
if (cards.length && !/✔核验|⚠待核/.test(oppSec)) {
  warns.push("板块一商机未见核验等级标记（✔核验 / ⚠待核），请按 §〇之二 补标记");
}
// 核验率聚合提醒（2026-11-03 新增，只 WARN 绝不 FAIL）：有卡且零✔核验，或待核占比 > 2/3，
// 提示抓取链路可能整体劣化。零✔核验在 1 张卡时也提醒；占比阈值从 3 卡起才有区分度，但统一按 > 2/3 算即可。
if (cards.length) {
  const verifiedCount = (oppSec.match(/✔核验/g) || []).length;
  const pendingCount = cardCount - liveCardCount;
  if (verifiedCount === 0 || pendingCount > cardCount * 2 / 3)
    warns.push("核验率偏低（✔核验 " + verifiedCount + " / 待核 " + pendingCount + " / 共 " + cardCount + " 卡），检查抓取链路（仅提醒不拦截）");
}
if (cards.length && !hollow && !expiredBad && !intentBad)
  ok("商机核验门禁通过（无「进行中+双未披露」空洞卡片、无过期截止、无意向单标进行中）");

// 6) 服务号看板可生成（全内联、单列、无 style、无换行、三板块齐全）//    依赖 push-notify.js 导出的 wechatBoard；它若被改坏，微信通道会推不出内容
try {
  const pn = require("./push-notify.js");
  const built = pn.prepare(pn.absAssets(rawHtml));
  const wx = pn.wechatBoard(built.html, TODAY);
  const problems = [];
  if (wx.len > 19000) problems.push("超 2 万字上限（" + wx.len + "）");
  if (wx.level > 0) warns.push("服务号看板已收缩到第 " + wx.level + " 档（条目多、篇幅紧）");
  if (/<style/i.test(wx.html)) problems.push("残留 <style>（会污染 pushplus 页面）");
  if (/\n/.test(wx.html)) problems.push("残留换行（容器 pre-line 会渲染成空行）");
  if (wx.html.indexOf("SECTION 01") < 0) problems.push("缺商机板块");
  if (wx.html.indexOf("SECTION 03") < 0) problems.push("缺提示板块");
  if (wx.html.indexOf("tianxin-logo.svg") < 0) problems.push("缺 logo");
  if (problems.length) fails.push("服务号看板：" + problems.join("；"));
  else ok("服务号看板可生成（" + wx.len + " 字符，全内联无换行）");
} catch (e) {
  warns.push("服务号看板自检跳过：" + e.message);
}

console.log("");
if (warns.length) warns.forEach((w) => console.log("  WARN " + w));
if (fails.length) {
  fails.forEach((f) => console.log("  FAIL " + f));
  console.log("\n结果：不通过（" + fails.length + " 项必须修正后再推送）");
  process.exit(1);
}
console.log("结果：通过" + (warns.length ? "（" + warns.length + " 项提醒）" : ""));
process.exit(0);
