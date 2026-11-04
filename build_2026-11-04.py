#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io, sys

TPL = "templates/dashboard-template.html"
OUT = "daily/2026-11-04.html"

DATE = "2026-11-04"
WEEKDAY = "星期三"
N_LIVE = "2"
N_PENDING = "0"
N_TIANTAI = "0"
N_HOT = "7"

TIANTAI_TEXT = ("近 7 天（2026-10-28 至 2026-11-04）未检索到天台县相关会计 / 审计 / 代理记账 / "
    "绩效评价类采购活单。已核查天台县政府门户公共资源交易栏目、天台县阳光招采平台、浙江政采网"
    "（天台采购意向 / 框架协议）、浙江省公共资源交易服务平台四个本地入口，命中条目均为工程 / 货物类"
    "或已定标结果——天台县会计审计·预算绩效框架协议（TTCG-2025-KJ002）已发布入围结果（杭州天启、"
    "金华君安等入围）。提醒负责人确认天信在库状态及有效期限，关注下一轮征集窗口（换库出局风险）。")

OPPORTUNITY_COLUMNS = '''
<div class="col">
  <div class="col-head">台州其他县市区 <span class="cnt">2</span></div>
  <div class="col-stack">
    <div class="card">
      <div class="c-top"><h4 class="c-title">台州市交通投资集团 2026-2028 年度财务报表审计、2027-2028 年季度财务报表审阅</h4></div>
      <div class="c-tags"><span class="tag tag-navy">✔核验</span><span class="tag tag-blue">进行中</span><span class="tag tag-blue">国企采购</span><span class="tag tag-urgent">急 · 11-05 开标</span><span class="tag tag-gray">评分 高</span></div>
      <dl class="meta">
        <dt>采购人</dt><dd>台州市交通投资集团有限公司（椒江区 · 市本级）</dd>
        <dt>预算·限价</dt><dd class="num">136 万元/年（年度审计 116 + 季度审阅 20）</dd>
        <dt>开标</dt><dd class="num">2026-11-05 09:00</dd>
        <dt>资质门槛</dt><dd>须证券服务业务备案 + 项目负责人 10 年及以上 CPA 经验</dd>
        <dt>地区</dt><dd>椒江区（市本级）</dd>
        <dt>发布</dt><dd class="num">2026-10-15</dd>
      </dl>
      <div class="c-tags"><span class="tag tag-navy">🔶 需联合 / 下级（暂无证券资格）</span></div>
      <div class="follow"><b>跟进：</b>招标中，明日（11-05 09:00）开标；天信无证券资格，建议联系中证天通等中标所探讨分包或下级公司审计合作，须负责人复核。</div>
      <a class="c-link" href="https://ggzy.tzztb.zjtz.gov.cn/jyxx/002007/002007001/20261015/351f68d8-5cbf-41d1-8342-222de3869ea0.html" target="_blank" rel="noopener">查看原文 ↗</a>
    </div>
    <div class="card">
      <div class="c-top"><h4 class="c-title">一江山大道（228国道至沿海高速段）提质升级工程（主线工程）全过程跟踪审计 · 招标文件公示</h4></div>
      <div class="c-tags"><span class="tag tag-navy">有效</span><span class="tag tag-blue">招标文件公示</span><span class="tag tag-blue">工程跟踪审计</span><span class="tag tag-gray">评分 中</span></div>
      <dl class="meta">
        <dt>招标人</dt><dd>台州循环经济发展有限公司（市本级国企）</dd>
        <dt>预算·限价</dt><dd class="num">未披露（原文查看）</dd>
        <dt>公示期</dt><dd class="num">2026-10-30 至 2026-11-04 23:59</dd>
        <dt>投标截止</dt><dd class="num">未披露（正式招标公告待发，原文查看）</dd>
        <dt>资质门槛</dt><dd>财务跟踪审计在招标范围内，须具会计师事务所执业证书；证券资格要求待公告明确</dd>
        <dt>地区</dt><dd>市本级（椒江区）</dd>
        <dt>发布</dt><dd class="num">2026-10-30 18:42</dd>
      </dl>
      <div class="c-tags"><span class="tag tag-navy">🔶 需联合 / 下级（财务跟踪审计属天信业务域）</span></div>
      <div class="follow"><b>跟进：</b>公示期内（至 11-04 23:59）可提异议；正式招标公告发布后第一时间核对预算、投标截止与是否要求证券资格三项，再决定是否联合投标。来源：浙江省公共资源交易服务平台（招标文件公示栏目）。</div>
      <a class="c-link" href="https://ggzy.zj.gov.cn/jyxxgk/002001/002001011/20261030/1efc746c-add9-4a5a-b2e9-c42d200eed68.html" target="_blank" rel="noopener">查看原文 ↗</a>
    </div>
  </div>
</div>
<div class="closed-band">
  <h4 class="closed-head"><span class="flag">■</span>近期已终结线索（商机终结）</h4>
  <div class="closed-item">
    <h4 class="closed-title">黄岩区商务局 2026 年度消费品以旧换新项目专项审计</h4>
    <div class="closed-meta">采购人 台州市黄岩区商务局 · 方式 竞争性磋商 · 定标 2026-09-07 · 中标方 北京中诺源会计师事务所（普通合伙） · 中标价 23.8 万元（结算率 32%） · 合同 2026-09-30 已签</div>
    <div class="closed-note">已定标并签合同，商机终结、不再跟踪。可作黄岩区同类专项审计的报价与中标所参照。</div>
    <a class="c-link" href="https://ggzy.zj.gov.cn/jyxxgk/002002/002002002/20260907/ea595139-78b9-462e-9eef-1657e8c03c3e.html" target="_blank" rel="noopener">查看结果公告 ↗</a>
  </div>
</div>
<p class="section-note" style="grid-column:1/-1;margin-top:8px">周边县市（宁海县·宁波市／新昌县·绍兴市／嵊州市·绍兴市）：近 7 天未检索到可承接的会计 / 审计类采购活单。绍兴市会计审计框架协议（2025-12-0006）已于 2026-02 定标、天信已核实未入围；宁海暂无新一轮框架征集；三县小额单当前不可承接 · 须先入库，不计入可承接机会统计。</p>
'''

HOTSPOT_NOTE = ("行业热点来源 hot.auditdog.cn 最新一期为 2026-11-03（行业热点聚合常较当日滞后 0–1 天），"
    "以下为当期与天信业务最相关的条目；当日（2026-11-04）暂无更新的直接相关条目。")

HOTSPOT_ITEMS = '''
<div class="news">
  <h3 class="n-title">财政部解读新《注册会计师法》的监督制度安排<a class="src-link" href="https://hot.auditdog.cn/items/eoegtrby7xjxa1o22xw9345z8" target="_blank">源 ↗</a></h3>
  <p class="n-body">财政部监督评价局解读新修订《注册会计师法》，系统梳理财政部门监督检查、监管谈话、警示函、责令限期整改和审计档案境内存放等监督安排；该法自 2027-01-01 施行，将推动配套制度制修订。<b>对天信：</b>直接影响执业质量与档案管理合规，建议负责人提前研读。</p>
  <a class="c-link" href="https://www.cicpa.org.cn/xxfb/news/202610/t20261030_66143.html" target="_blank" rel="noopener">查看原文 ↗</a>
</div>
<div class="news">
  <h3 class="n-title">中小会计师事务所数据合规可按处理人数和业务类型分层管理<a class="src-link" href="https://hot.auditdog.cn/items/k91xu7dzai8y622140kwg4qin" target="_blank">源 ↗</a></h3>
  <p class="n-body">文章指出中小所数据合规可按个人信息处理人数和业务类型分层管理；2026-09-01 施行的《小型个人信息处理者个人信息保护简化措施规定》将处理不满 10 万人个人信息的主体界定为小型个人信息处理者，可简化处理要求。<b>对天信：</b>属小型所，可对照 28 项检查表分批落实整改。</p>
  <a class="c-link" href="https://mp.weixin.qq.com/s/pnPkVItfLvqK3d4rgyMeCg" target="_blank" rel="noopener">查看原文 ↗</a>
</div>
<div class="news">
  <h3 class="n-title">监管周报：证监会先行赔付征求意见稿拟将审计机构纳入赔付主体范围<a class="src-link" href="https://hot.auditdog.cn/items/u4i68qeq3p1op1rd5fen64oc5" target="_blank">源 ↗</a></h3>
  <p class="n-body">证监会 10-19 日发布先行赔付指导意见征求意见稿，拟将会计师事务所和律师事务所纳入先行赔付主体范围，征求意见至 11-18 截止；清越科技案将保荐机构、审计机构和实控人共同出资。<b>对天信：</b>审计机构追偿风险上升，建议关注意见反馈与职业责任保险安排。</p>
  <a class="c-link" href="https://mp.weixin.qq.com/s/cdRzUL-CgFNzD05hhuaMgw" target="_blank" rel="noopener">查看原文 ↗</a>
</div>
<div class="news">
  <h3 class="n-title">广西注协印发会员执业违规行为惩戒实施细则<a class="src-link" href="https://hot.auditdog.cn/items/muo5v9d7n5mm6x6xkw8lxjxxo" target="_blank">源 ↗</a></h3>
  <p class="n-body">广西注协 2026-10-21 印发《会员执业违规行为惩戒实施细则》，将训诫、通报批评、公开谴责列为惩戒种类，列举违反职业道德守则、业务准则、质量管理准则等具体情形，并明确 7 个工作日申诉期限。<b>对天信：</b>可对照执业红线与惩戒程序逐项核对。</p>
  <a class="c-link" href="https://mp.weixin.qq.com/s?__biz=MzA4ODA5MDI2Ng%3D%3D&mid=2652242885&idx=6&sn=6318ad42d76c17ac673ada73fd5f9c50&chksm=8a29670db62bf10a3dc4f23e4ec00aad8e9954e147102a8499a2f166bcecb129ea1b477e5151" target="_blank" rel="noopener">查看原文 ↗</a>
</div>
<div class="news">
  <h3 class="n-title">广东正中珠江就康美药业追偿案一审判决提起上诉，2026-11-03 开庭<a class="src-link" href="https://hot.auditdog.cn/items/a2heydnhwxoykay5cspu8oyh6" target="_blank">源 ↗</a></h3>
  <p class="n-body">广州中院 2026-07-16 判决正中珠江在 14,069.21 万元范围内承担补充清偿责任；正中珠江已上诉，2026-11-03 开庭审理。<b>对天信：</b>审计民事赔偿责任边界的持续判例，提示重大审计项目的执业风险。</p>
  <a class="c-link" href="https://mp.weixin.qq.com/s/k0NTE7AavvWyfTpsKYjr9w" target="_blank" rel="noopener">查看原文 ↗</a>
</div>
<div class="news">
  <h3 class="n-title">财政部就企业会计准则会计科目和主要账务处理修订征求意见<a class="src-link" href="https://hot.auditdog.cn/items/jn4ekr8bswnulsqzhj3d6zu0s" target="_blank">源 ↗</a></h3>
  <p class="n-body">财政部办公厅就《企业会计准则——会计科目和主要账务处理（修订征求意见稿）》公开征求意见（截止 2026-10-30）；修订稿配套新列报准则分步实施。<b>对天信：</b>涉及损益类科目与列报衔接，建议评估系统改造与转换工作量。</p>
  <a class="c-link" href="https://mp.weixin.qq.com/s?__biz=MzA4ODA5MDI2Ng%3D%3D&mid=2652241416&idx=2&sn=b923ae8e5bb16c05979bd79ac07a1e0f&chksm=8af41061506473a85c27bcc80bf9901cfbe50318af66afe4fca840465104d93b063a80ba8ce6" target="_blank" rel="noopener">查看原文 ↗</a>
</div>
<div class="news">
  <h3 class="n-title">中国邮政集团公开招标选聘 2026-2028 年度财务会计决算报告审计机构<a class="src-link" href="https://hot.auditdog.cn/items/nmd5r5tdqzsbweoshday9yb1g" target="_blank">源 ↗</a></h3>
  <p class="n-body">中国邮政集团公开招标选聘 2026-2028 年度财务会计决算报告审计机构，采购 1 家主审所 + 2 家参审所，服务期三年。<b>对天信：</b>行业大单情报（需证券资格，非县城所主场），可作市场参照。</p>
  <a class="c-link" href="https://mp.weixin.qq.com/s?__biz=MzA4ODA5MDI2Ng%3D%3D&mid=2652242885&idx=2&sn=20cbe35c4bc6213180655add9ff2b521&chksm=8ac331b463b8e26253f4650088352500a445d00b7f944be4a6fe0e7c1e8c3a3a64a956481e37" target="_blank" rel="noopener">查看原文 ↗</a>
</div>
'''

TIP_ITEMS = '''
<li><span class="idx">1</span><span class="t-body"><b>交投集团 136 万/年审计明日（11-05 09:00）开标</b>：天信暂无证券服务业务备案资格，不可独立投；建议尽快联系中证天通等中标所探讨分包，或争取其子公司 / 下级公司年度审计合作，抓住窗口期（参考：信永中和智能专业知识库）。</span></li>
<li><span class="idx">2</span><span class="t-body"><b>一江山大道跟踪审计招标文件公示今日（11-04 23:59）截止</b>：该单由台州循环经济发包、省平台 10-30 发布，财务跟踪审计属天信业务域，但天信暂无证券资格；公示期结束后正式招标公告将发布，须第一时间核对预算、投标截止与证券资格三项再决定是否联合投标。</span></li>
<li><span class="idx">3</span><span class="t-body"><b>黄岩区商务局消费品以旧换新专项审计已定标 → 商机终结</b>：2026-09-07 定标，北京中诺源会计师事务所（普通合伙）中标，23.8 万元（结算率 32%），2026-09-30 已签合同；不再跟踪，可作黄岩区同类专项审计的报价与中标所参照。</span></li>
<li><span class="idx">4</span><span class="t-body"><b>新《注册会计师法》2027-01-01 施行</b>：财政部已解读监督制度安排（监督检查、监管谈话、警示函、审计档案境内存放等），建议负责人研读配套制度修订，提前做好执业质量与档案管理合规。</span></li>
<li><span class="idx">5</span><span class="t-body"><b>证监会先行赔付征求意见稿（截止 11-18）</b>：拟将会计师事务所纳入先行赔付主体，审计机构追偿风险上升；建议关注意见反馈与职业责任保险安排。</span></li>
<li><span class="idx">6</span><span class="t-body"><b>天台县框架协议（TTCG-2025-KJ002）已发布入围结果</b>：杭州天启、金华君安等入围；提醒负责人确认天信在库状态与有效期限，避免错过下一轮征集导致本县单归零。</span></li>
'''

with io.open(TPL, encoding="utf-8") as f:
    html = f.read()

repl = {
    "{{DATE}}": DATE,
    "{{WEEKDAY}}": WEEKDAY,
    "{{N_LIVE}}": N_LIVE,
    "{{N_PENDING}}": N_PENDING,
    "{{N_TIANTAI}}": N_TIANTAI,
    "{{N_HOT}}": N_HOT,
    "{{TIANTAI_TEXT}}": TIANTAI_TEXT,
    "{{OPPORTUNITY_COLUMNS}}": OPPORTUNITY_COLUMNS,
    "{{HOTSPOT_NOTE}}": HOTSPOT_NOTE,
    "{{HOTSPOT_ITEMS}}": HOTSPOT_ITEMS,
    "{{TIP_ITEMS}}": TIP_ITEMS,
}
for k, v in repl.items():
    html = html.replace(k, v)

remaining = html.count("{{")
with io.open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

print("written:", OUT, "len:", len(html))
print("remaining {{ placeholders:", remaining)
