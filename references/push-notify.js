#!/usr/bin/env node
/**
 * pushplus 推送助手（天信每日日报）
 * 用途：把日报推送到 ① 爸爸手机(5G消息 cmcc) ② 245830958@qq.com(邮件 mail)
 * 用法：node references/push-notify.js "<标题>" "<纯文本摘要>" "<HTML全文>"
 * token 读取优先级：环境变量 PUSHPLUS_TOKEN > 同目录 push-secrets.json（本地，gitignore）
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

function getToken() {
  if (process.env.PUSHPLUS_TOKEN) return process.env.PUSHPLUS_TOKEN;
  const f = path.join(__dirname, "push-secrets.json");
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")).token; } catch (e) {}
  }
  return null;
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

(async () => {
  const token = getToken();
  if (!token) {
    console.log("SKIP: 未找到 PUSHPLUS_TOKEN（环境变量）或 push-secrets.json，跳过推送。");
    process.exit(0);
  }
  const [title, txt, html] = process.argv.slice(2);
  if (!title) {
    console.log("SKIP: 缺少标题参数，跳过推送。");
    process.exit(0);
  }
  const cmcc = await send(token, "cmcc", title, txt || title, "txt");
  console.log(cmcc);
  const mail = await send(token, "mail", title, html || txt || title, "html");
  console.log(mail);
})();
