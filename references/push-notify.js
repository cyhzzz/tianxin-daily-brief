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
  const cmcc = await send(token, "cmcc", titleArg, html, "html");
  console.log(cmcc);
  const mail = await send(token, "mail", titleArg, html, "html");
  console.log(mail);
})();
