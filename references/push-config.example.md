# pushplus 推送配置（公开示例 · 不含真实 token）

> 本文件为公开仓库模板，真实 token 见本地 `references/push-secrets.json`（gitignore，不入库）。
> 云端 agent 请将 token 设为环境变量 `PUSHPLUS_TOKEN`。

## 接口
- 地址：`POST https://www.pushplus.plus/send/{token}`
- token 同时放在 URL 路径与 body 的 `token` 字段
- 官方文档：https://www.pushplus.plus/doc/channel/cmcc.html （5G 消息）、https://www.pushplus.plus/doc/extend/mail.html （邮件）

## 渠道与接收端
| 用途 | channel | 接收端 | 前置绑定（一次性） |
|---|---|---|---|
| 5G 消息（爸爸手机） | `cmcc` | 爸爸已绑定的中国移动号码 | pushplus 个人中心 → 渠道配置 → 新消息ClawBot（发短信"绑定龙虾"到 12520098 授权） |
| 邮件（245830958@qq.com） | `mail` | 该邮箱（须绑定到 pushplus 账号邮箱；若是他人邮箱则加为好友并以 `to` 指定） | pushplus 小程序 → 个人资料 → 邮箱 → 验证 |

## 请求示例
5G 消息：
```bash
curl -sS -X POST https://www.pushplus.plus/send/$PUSHPLUS_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"token":"'$PUSHPLUS_TOKEN'","title":"天信日报 · 日期","content":"纯文本摘要","channel":"cmcc","template":"txt"}'
```
邮件：
```bash
curl -sS -X POST https://www.pushplus.plus/send/$PUSHPLUS_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"token":"'$PUSHPLUS_TOKEN'","title":"天信每日日报 · 日期","content":"HTML或Markdown全文","channel":"mail","template":"html"}'
```
