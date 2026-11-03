# AGENTS.md — 天信日报skill（天台天信会计师事务所 · 所内赋能子项目）

> 本目录是天信「所内赋能」的一个独立子项目：**天信每日行业与商机日报** Skill。
> 它服务事务所自身（行业情报 + 商机捕捉 + 每日推送），**不对应某个付费客户**，归 `天信本身/`。
>
> **本文件是本目录唯一权威规范入口**（`AGENTS.md` 为通用 agent 规范文件名，不绑定特定工具）。
> 早期曾用 `CLAUDE.md`，已于 2026-11-03 合并入本文件并删除——避免同一个项目出现两份规范、互相漂移。

---

## 1. 项目身份

- **性质**：WorkBuddy Skill（自动化情报采集 + 三通道推送），天信内部日常运营工具。
- **归属**：`天信本身/`（所内赋能），非 `企业咨询/`（客户项目）。
- **物理位置**：`D:/AIproject/爸爸/tianxin-daily-brief/`（本目录即 git 本地仓）。skill 源码在主仓 `D:/AIproject/爸爸/天信本身/运营/天信日报skill/`，本仓是其**镜像发布仓 + 每日产出归档仓**（2026-11-03 起不再作为 WorkBuddy 加载点，`skills/tianxin-daily-brief` junction 已随项目迁移撤销）。
- **加载方式**：skill 由主仓侧维护与加载；本仓仅供发布镜像与 `daily/` 归档，改 skill 逻辑去主仓（见 §6）。
- **版本控制**：远端 `github.com:cyhzzz/tianxin-daily-brief.git`。本目录 `.git` 即仓库。

---

## 2. 权威源（单一真相）

| 文件 | 作用 |
|------|------|
| `SKILL.md` | 技能定义、生成流程、自检清单（**生成日报的唯一流程入口**） |
| `AGENTS.md`（本文件） | 项目规范、目录结构、红线、协作约定（**唯一权威规范**） |
| `references/推送规范.md` | 推送三通道（5G 消息 / 微信服务号 / 邮件）的唯一权威，含约束、格式、排错 |
| `references/招标商机处理规范.md` | 商机加工范式 + 核验门禁（§〇之二）+ 辐射区规则（§〇之三）+ 事故复盘与已知陷阱 |
| `references/信源清单.md` | 信源本体 + 附录 A 辐射区信源 + 附录 B 有效性自评 |
| `references/信源扩充与PR流程.md` | 信源如何演进：验证 → 改清单 → 自测 → 提 PR（含 agent 边界） |
| `references/反爬与渲染页抓取.md` | **正文取不到时的升级链路**（Playwright / agent-browser / 内置浏览器 / 接口直取） |
| `references/push-notify.js` | 推送执行助手（含 `buildWechatBoard` 服务号专用重排版） |
| `references/check-dashboard.js` | 机械自检（日期、占位、核验门禁、服务号可生成等） |
| `templates/dashboard-template.html` | 只含结构与 `{{占位符}}`，零真实内容（防过拟合） |
| `daily/{日期}.html` / `.md` / `latest.html` | 当日产出 |
| `assets/tianxin-logo.svg` | 官网红色印章 logo，**逐字节复制**，严禁任何修改 |

---

## 3. 目录结构

```
天信日报skill/
├── SKILL.md                  # 权威·流程入口
├── AGENTS.md                 # 本文件（唯一权威规范）
├── assets/tianxin-logo.svg   # 官网红章（原样引用）
├── templates/                # 模板（仅占位符，无内容）
├── daily/                    # 每日产出（html + md + latest.html）
├── examples/                 # 样例看板（与模板/产出分目录）
├── references/               # 规范、推送助手、自检脚本、信源清单、反爬抓取
└── .git/                     # 本地仓（remote: cyhzzz/tianxin-daily-brief）
```

---

## 4. 红线（继承全局 + 本项目硬性）

- **天信品牌规范**（全局 §4.2）：0 圆角、navy `#00338D` + 亮蓝 `#0F62FE` + 金 `#B8860B`、Noto Sans SC；禁渐变 hero / 堆叠金条 / 虚线金框 / emoji / 紫 / 暖米底。
- **演示文案两禁**（全局 §4.1）：① 数据口径差异不上界面（含糊化即可）；② 内部规划/流程文案不上界面。
- **logo**：只允许逐字节复制官网 `tianxin-logo.svg`，严禁重绘 / 精简 / 改色（可加浅色底衬或反白以适应深底）。
- **不编造**：不虚构内部数据、不给 ROI 承诺；检索不到写"未检索到"。
- **商机核验门禁（血泪教训，2026-11-03 晚修正为有效性优先）**：2026-11-03 曾把已中标的「路桥青龙浦绩效评价」当活单推送。此后改为**有效性优先**：有截止/开标实值的，实值未过期才许写"进行中"；公示/征集类无实值的，须具备三件套（发布日期+公示期+原文链接）才可入板块一，缺一则剔除——**字段缺失本身不降级**（"预算未公开"等业务表述可正常入板）。每张卡片须带 `✔核验`/`有效`/`⚠待核` 标记。详见 `references/招标商机处理规范.md §〇之二`。
- **正文取不到 ≠ 可以放弃核验**：必须按 `references/反爬与渲染页抓取.md` 升级抓取手段；**仍取不到才允许判"无法核验"并剔除**，且须在运行记录写明尝试过哪些手段。
- **推送纪律**：短信只发纯文本（≤480 字要点版），绝不可把 HTML 塞进 `txt` 通道；服务号因注入容器带 `pre-line` 且禁用 `<style>`，须用 `buildWechatBoard` 全内联单列重排，不可直接复用桌面看板。
- **GitHub Pages 路线已证伪**（云端无写凭据 + 构建延迟致链接 404），日报一律不依赖外链，全文走短信 / 邮件 / 服务号。

---

## 5. 日常运行

```bash
# 1) 取系统日期，生成当日看板（先 daily 后推送）
node references/check-dashboard.js daily/{日期}.html     # 机械自检
node references/push-notify.js "天信每日日报 · {日期}" "daily/{日期}.html"   # 三通道实推
```

- 凭证：`PUSHPLUS_TOKEN` 环境变量优先；否则 `references/push-secrets.json`（`.gitignore` 已排除，绝不入库）。
- 改动推送逻辑：**先改 `references/推送规范.md`，再改 `push-notify.js`**。
- 改动信源：**先看 `references/信源清单.md` 附录 B 有效性自评，再按 `references/信源扩充与PR流程.md` 提 PR**。

---

## 6. 协作约定

- **规范文件只有一个**：本 `AGENTS.md`。不要再新建 `CLAUDE.md` / `.cursorrules` / `GEMINI.md` 等平行规范，需要的话在本文件加节。
- **改规则走 PR**，不直接推 `master`；分支名 `chore/{要点}-{YYYYMMDD}`。
- **文档改动须与代码/脚本同步**：改字段契约要同改 `check-dashboard.js`；改抓取方式要同改 `信源清单.md` 与 `SKILL.md` 信源段。
- **本仓是镜像发布仓 + 每日产出归档仓，不改 skill 代码**：skill 唯一源是主仓 `cyhzzz/tianxin-agents` 的 `运营/天信日报skill/`，改动在主仓做、合并后经 `sync-daily-brief.sh` 单向下发到本仓。本仓可直接写的只有 `daily/` 每日产出；要改 skill 逻辑，去主仓改再同步过来。⚠️ sync 方向是「本体 → 本仓」，逆行（在本仓改完跑 sync）会用旧内容覆盖新改动。
