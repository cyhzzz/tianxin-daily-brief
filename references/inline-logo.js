#!/usr/bin/env node
/**
 * logo 内联助手（天信每日日报）
 *
 * 为什么需要：看板 html 会被单独打开（本地双击、WorkBuddy 预览面板、发给他人），
 * 这些场景里只有 html 一个文件，`../assets/tianxin-logo.svg` 会 404 → logo 加载不出来。
 * 故把 logo 以 data URI 内联进 html，做到单文件自包含。
 *
 * 推送时 push-notify.js 的 absAssets() 会把 data URI 换回 GitHub 原文件地址
 * （data URI 约 23 万字符，直接发会爆 pushplus 2 万字上限）。
 * 内联的仍是 `assets/tianxin-logo.svg` 原件，不重绘、不精简、不改 opacity。
 *
 * 用法：node references/inline-logo.js daily/2026-10-30.html [更多 html...]
 * 退出码：0 = 成功（含"无需内联"）｜1 = 失败
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOGO = path.join(ROOT, "assets", "tianxin-logo.svg");

const files = process.argv.slice(2).filter(Boolean);
if (!files.length) {
  console.log("用法：node references/inline-logo.js <html路径> [更多路径...]");
  process.exit(1);
}
if (!fs.existsSync(LOGO)) {
  console.log("FAIL 找不到 logo 原件：" + LOGO);
  process.exit(1);
}

const svg = fs.readFileSync(LOGO);
const dataUri = "data:image/svg+xml;base64," + svg.toString("base64");
console.log("logo 原件: " + (svg.length / 1024).toFixed(0) + " KB → data URI " +
  (dataUri.length / 1024).toFixed(0) + " KB");

let failed = 0;
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log("FAIL 文件不存在：" + f);
    failed++;
    continue;
  }
  let html = fs.readFileSync(f, "utf8");
  if (html.indexOf("data:image/svg+xml;base64,") >= 0) {
    console.log("SKIP 已内联：" + f);
    continue;
  }
  const before = html.length;
  // 同时覆盖 ../assets/、./assets/、assets/ 三种写法
  html = html.replace(/(src=)(["'])\.{0,2}\/?assets\/tianxin-logo\.svg\2/g, function (_m, _s, q) {
    return "src=" + q + dataUri + q;
  });
  if (html === fs.readFileSync(f, "utf8")) {
    console.log("WARN 未找到 logo 引用，未改动：" + f + "（检查 src 是否为 assets/tianxin-logo.svg）");
    continue;
  }
  fs.writeFileSync(f, html);
  console.log("OK  " + f + "  " + (before / 1024).toFixed(0) + " KB → " +
    (html.length / 1024).toFixed(0) + " KB（已内联，单文件自包含）");
}

process.exit(failed ? 1 : 0);
