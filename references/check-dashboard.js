#!/usr/bin/env node
/**
 * 看板自检助手（天信每日日报）
 * 用途：生成看板后、推送前必跑。把「日期没更新到当日」「模板占位没替换」「历史参考残留」
 *       「速览数字与条目数不符」「框架协议核查未留痕」这五类问题机械拦下。
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
const statOf = (label) => {
  const re = /<div class="stat[^"]*">\s*<div class="n">([^<]*)<\/div>\s*<div class="l">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) if (m[2].indexOf(label) >= 0) return parseInt(m[1].trim(), 10);
  return null;
};
const countBlocks = (cls) => {
  const re = new RegExp('<div class="' + cls + '"', "g");
  return (html.match(re) || []).length;
};
const oppSec = (html.match(/<section id="opportunities"[\s\S]*?<\/section>/) || [])[0] || "";
const cardCount = (oppSec.match(/<h4 class="c-title"/g) || []).length;
const hotSec = (html.match(/<section id="hotspots"[\s\S]*?<\/section>/) || [])[0] || "";
const newsCount = (hotSec.match(/<h3 class="n-title"/g) || []).length;
const tipCount = ((html.match(/<section id="tips"[\s\S]*?<\/section>/) || [])[0] || "").match(/<span class="t-body"/g) || [];
const nLive = statOf("活单");
const nTT = statOf("天台县");
const nHot = statOf("热点");
if (nLive === null) warns.push("速览未找到「活单」数字");
else if (nLive !== cardCount) fails.push("速览活单数 " + nLive + " ≠ 商机卡片数 " + cardCount);
else ok("速览活单数 = 卡片数 = " + cardCount);
if (nHot === null) warns.push("速览未找到「热点」数字");
else if (nHot !== newsCount) warns.push("速览热点数 " + nHot + " ≠ 热点条目数 " + newsCount + "（若末条为汇总条目可忽略）");
else ok("速览热点数 = 热点条目数 = " + newsCount);
if (nTT !== null && nTT > 0 && !/天台县/.test(oppSec)) warns.push("速览天台县 > 0，但商机区未出现天台县条目");
console.log("  统计：卡片 " + cardCount + " / 热点 " + newsCount + " / 提示 " + tipCount.length);

// 5) 框架协议固定核查项必须留痕
const tipSec = (html.match(/<section id="tips"[\s\S]*?<\/section>/) || [])[0] || "";
if (!/框架协议/.test(tipSec)) warns.push("板块三未见「框架协议」核查结论（命中与否都要写一行）");
else ok("板块三含框架协议核查结论");

// 6) 结构完整性（短信全文抽取依赖）
["opportunities", "hotspots", "tips"].forEach((id) => {
  if (html.indexOf('id="' + id + '"') < 0) fails.push("缺少 <section id=\"" + id + "\">（短信全文抽取依赖）");
});
if (!/assets\/tianxin-logo\.svg/.test(html)) warns.push("未见 logo 引用（应为 ./assets/tianxin-logo.svg）");

console.log("");
if (warns.length) warns.forEach((w) => console.log("  WARN " + w));
if (fails.length) {
  fails.forEach((f) => console.log("  FAIL " + f));
  console.log("\n结果：不通过（" + fails.length + " 项必须修正后再推送）");
  process.exit(1);
}
console.log("结果：通过" + (warns.length ? "（" + warns.length + " 项提醒）" : ""));
process.exit(0);
