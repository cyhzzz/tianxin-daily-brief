# CLAUDE.md — 天信日报skill（天台天信会计师事务所 · 所内赋能子项目）

> 本目录是天信「所内赋能」的一个独立子项目：**天信每日行业与商机日报** Skill。
> 它服务事务所自身（行业情报 + 商机捕捉 + 每日推送），**不对应某个付费客户**，归 `天信本身/`。

---

## 1. 项目身份

- **性质**：WorkBuddy Skill（自动化情报采集 + 三通道推送），是天信内部日常运营工具。
- **归属**：`天信本身/`（所内赋能），非 `企业咨询/`（客户项目）。
- **物理位置**：`D:/AIproject/爸爸/天信本身/天信日报skill/`（本目录即 git 本地仓）。
- **加载方式**：WorkBuddy 只从 `.workbuddy/skills/` 加载 Skill，故此处通过
  `D:/AIproject/爸爸/.workbuddy/skills/tianxin-daily-brief` 的 **目录 junction** 指回本目录。
  **⚠️ 勿删除该 junction**，否则 Skill 消失、日报停更。
- **版本控制**：远端 `git@github.com:cyhzzz/tianxin-daily-brief.git`（SSH）。本目录 `.git` 即仓库。

---

## 2. 权威源（单一真相）

| 文件 | 作用 |
|------|------|
| `SKILL.md` | 技能定义、生成流程、自检清单（生成日报的唯一流程入口） |
| `references/推送规范.md` | 推送三通道（5G 消息 / 微信服务号 / 邮件）的唯一权威，含约束、格式、排错 |
| `references/push-notify.js` | 推送执行助手（含 `buildWechatBoard` 服务号专用重排版） |
| `references/check-dashboard.js` | 机械自检（日期==当日、无占位符残留、三板块齐全、服务号可生成等 6 项） |
| `templates/dashboard-template.html` | 只含结构与 `{{占位符}}`，零真实内容（防过拟合） |
| `daily/{日期}.html` / `.md` / `latest.html` | 当日产出 |
| `assets/tianxin-logo.svg` | 官网红色印章 logo，**逐字节复制**，严禁任何修改 |

---

## 3. 目录结构

```
天信日报skill/
├── SKILL.md                  # 权威·流程入口
├── CLAUDE.md                 # 本文件
├── assets/tianxin-logo.svg   # 官网红章（原样引用）
├── templates/                # 模板（仅占位符，无内容）
├── daily/                    # 每日产出（html + md + latest.html）
├── examples/                 # 样例看板（与模板/产出分目录）
├── references/               # 推送规范、推送助手、自检脚本、信源清单
└── .git/                     # 本地仓（remote: cyhzzz/tianxin-daily-brief）
```

---

## 4. 红线（继承全局 + 本项目硬性）

- **天信品牌规范**（全局 §4.2）：0 圆角、navy `#00338D` + 亮蓝 `#0F62FE` + 金 `#B8860B`、Noto Sans SC；禁渐变 hero / 堆叠金条 / 虚线金框 / emoji / 紫 / 暖米底。
- **演示文案两禁**（全局 §4.1）：① 数据口径差异不上界面（含糊化即可）；② 内部规划/流程文案不上界面。
- **logo**：只允许逐字节复制官网 `tianxin-logo.svg`，严禁重绘 / 精简 / 改色（可加浅色底衬或反白以适应深底）。
- **不编造**：不虚构内部数据、不给 ROI 承诺；检索不到写"未检索到"。
- **推送纪律**：短信只发纯文本（≤420 字要点版），绝不可把 HTML 塞进 `txt` 通道；服务号因注入容器带 `pre-line` 且禁用 `<style>`，须用 `buildWechatBoard` 全内联单列重排，不可直接复用桌面看板。
- **GitHub Pages 路线已证伪**（云端无写凭据 + 构建延迟致链接 404），日报一律不依赖外链，全文走短信 / 邮件 / 服务号。

---

## 5. 日常运行

```bash
# 1) 取系统日期，生成当日看板（先 daily 后推送）
node references/check-dashboard.js daily/{日期}.html     # 机械自检 6 项
node references/push-notify.js "天信每日日报 · {日期}" "daily/{日期}.html"   # 三通道实推
```

- 凭证：`PUSHPLUS_TOKEN` 环境变量优先；否则 `references/push-secrets.json`（`.gitignore` 已排除，绝不入库）。
- 改动推送逻辑：**先改 `references/推送规范.md`，再改 `push-notify.js`**。
