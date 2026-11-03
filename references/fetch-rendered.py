#!/usr/bin/env python3
"""
渲染页抓取助手（天信每日日报 · 反爬升级链路）

用途：公告详情页正文取不到时（政采云 luban/detail 为代表），按链路逐级升级，
      直到拿到正文；仍取不到才允许判"无法核验"（见 references/反爬与渲染页抓取.md）。

用法：
  python3 references/fetch-rendered.py <URL>
  python3 references/fetch-rendered.py <URL> --json          # 只输出 JSON
  python3 references/fetch-rendered.py <URL> --field 预算     # 打印含该词的上下文

链路（自动，前一级失败降后一级）：
  1. 政采云 portal 接口直取（最快、最干净，纯 HTTP 无需浏览器）
  2. Playwright 无头浏览器渲染（等 DOM + 抓 XHR）
  3. agent-browser CLI
  4. 内置 Chromium（--dump-dom）

输出：统一 JSON（title / publish / expired / budget / deadline / text / via）
"""
import sys, re, json, ssl, html as htmllib, subprocess, shutil, time, urllib.request, urllib.error

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

# 不校验证书：多个政务站证书链不完整（政采云实测 ERR_CERT_AUTHORITY_INVALID）
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def strip_html(h):
    h = re.sub(r"<style[\s\S]*?</style>", "", h, flags=re.I)
    h = re.sub(r"<script[\s\S]*?</script>", "", h, flags=re.I)
    h = re.sub(r"<br\s*/?>", "\n", h, flags=re.I)
    h = re.sub(r"</(p|div|tr|li|h\d)>", "\n", h, flags=re.I)
    t = re.sub(r"<[^>]+>", "", h)
    t = htmllib.unescape(t)
    t = re.sub(r"[ \t\u3000]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t)
    return t.strip()


def get(url, referer=None, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Referer": referer} if referer else {})})
    return urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout).read().decode("utf-8", "ignore")


def extract(text):
    """从正文提取结构化字段。取不到就留空——绝不猜。"""
    t = re.sub(r"\s+", "", text)
    out = {}

    # 预算 / 最高限价
    # 公告常见为表格：标项|采购内容|单位|数量|预算价|最高投标限价|服务期（strip_html 后按行保留）
    # 优先做「表头 → 数据行」按列对齐；失败再退回关键词窗口（仅接受"万/万元"带单位形态）
    amt = r"(?<![\d.])([\d,]+(?:\.\d+)?)\s*(万元|万|元)"
    lines = [x.strip() for x in text.split("\n")]

    def by_table():
        for idx, ln in enumerate(lines):
            if not re.fullmatch(r"(预算价|预算金额|采购预算|项目预算|最高投标限价|最高限价)", ln):
                continue
            # 收集连续的表头行（表格被拆成多行）
            heads, j = [], idx
            while j < len(lines) and re.fullmatch(
                r"(标项|序号|采购内容|标的名称|单位|数量|预算价|预算金额|采购预算|项目预算|"
                r"最高投标限价|最高限价|服务期|简要技术要求|备注)", lines[j]
            ):
                heads.append(lines[j]); j += 1
            if "预算价" not in heads and "最高投标限价" not in heads:
                continue
            # 找数据行：从 j 开始，后面第一个"整行是金额"的位置
            for val in lines[j:j + 14]:
                m = re.fullmatch(amt, val)
                if m:
                    num, unit = m.group(1).replace(",", ""), m.group(2)
                    return (f"{num}万元" if unit.startswith("万") else f"{num}元"), val
        return None

    tb = by_table()
    if tb:
        out["budget"], out["budget_raw"] = tb
        out["budget_kw"] = "表头对齐"
    else:
        for kw in ["最高投标限价", "最高限价", "预算价", "预算金额", "采购预算", "项目预算"]:
            i = t.find(kw)
            if i < 0:
                continue
            m = re.search(amt, t[i:i + 160])
            if m:
                num, unit = m.group(1).replace(",", ""), m.group(2)
                out["budget"] = f"{num}万元" if unit.startswith("万") else f"{num}元"
                out["budget_kw"], out["budget_raw"] = kw, m.group(0).strip()
                break
            if out.get("budget"):
                break

    # 投标截止 / 开标时间（"2026年07月22日下午14:00"）
    dt = r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(上午|下午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})"
    for kw in ["投标截止时间及开标时间", "开标时间", "投标截止时间", "响应文件递交截止时间", "提交投标文件截止时间"]:
        i = t.find(kw)
        if i < 0:
            continue
        m = re.search(dt, t[i:i + 220])
        if m:
            y, mo, d, ap, hh, mm = m.groups()
            hh = int(hh)
            if ap == "下午" and hh < 12:
                hh += 12
            out["deadline"] = f"{int(y):04d}-{int(mo):02d}-{int(d):02d} {hh:02d}:{mm}"
            out["deadline_kw"] = kw
            break

    # 项目编号
    m = re.search(r"项目编号[:：]?\s*([A-Za-z0-9\-－—_/（）()]+)", text)
    if m:
        out["projectCode"] = m.group(1).strip()[:60]

    # 是否允许联合体
    if re.search(r"不\s*允许\s*联合体|不接受联合体", t):
        out["consortium"] = False
    elif re.search(r"允许\s*联合体|接受联合体", t):
        out["consortium"] = True

    # 资质关键词
    quals = []
    for k in ["会计师事务所执业证书", "证券", "会计师事务所执业资格", "注册会计师"]:
        if k in t:
            quals.append(k)
    if quals:
        out["qualifications"] = quals
    return out


# ── 通路 1：政采云 portal 接口 ──────────────────────────────
def via_zcy_portal(url):
    m = re.search(r"[?&]articleId=([^&]+)", url)
    if not m or "zfcg.czt.zj.gov.cn" not in url:
        return None
    aid = m.group(1)
    api = f"https://zfcg.czt.zj.gov.cn/portal/detail?articleId={aid}"
    try:
        d = json.loads(get(api, referer="https://zfcg.czt.zj.gov.cn/"))
        data = (d.get("result") or {}).get("data") or {}
    except Exception as e:
        return {"via": "zcy-portal", "error": f"接口失败：{e}"}
    content = data.get("content") or ""
    text = strip_html(content)
    if len(text) < 80:
        return {"via": "zcy-portal", "error": "接口返回正文过短"}
    res = {
        "via": "zcy-portal",
        "title": data.get("title"),
        "publish": time.strftime("%Y-%m-%d %H:%M", time.localtime(data["publishDate"] / 1000)) if data.get("publishDate") else None,
        "expiredAt": data.get("expiredAt"),
        "projectName": data.get("projectName"),
        "projectCode": data.get("projectCode"),
        "purchaser": data.get("author"),
        "text": text,
        "attachments": [a.get("fileName") or a.get("name") for a in (data.get("attachmentList") or [])][:10],
    }
    res.update(extract(text))
    return res


# ── 通路 2：Playwright ────────────────────────────────────
def via_playwright(url):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--no-sandbox"])
            ctx = b.new_context(ignore_https_errors=True, locale="zh-CN", user_agent=UA,
                                viewport={"width": 1440, "height": 900})
            pg = ctx.new_page()
            # 不用 networkidle：政务站常有长轮询，永远不 idle
            pg.goto(url, wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_timeout(8000)
            # 正文可能在 iframe
            text = ""
            for fr in pg.frames:
                try:
                    t = fr.inner_text("body")
                    if len(t) > len(text):
                        text = t
                except Exception:
                    pass
            title = pg.title()
            b.close()
        if len(text) < 80:
            return {"via": "playwright", "error": "渲染后正文仍过短"}
        res = {"via": "playwright", "title": title, "text": text}
        res.update(extract(text))
        return res
    except Exception as e:
        return {"via": "playwright", "error": str(e)[:200]}


# ── 通路 3：agent-browser ────────────────────────────────
def via_agent_browser(url):
    exe = shutil.which("agent-browser")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "fetch", url, "--format", "text"],
                           capture_output=True, text=True, timeout=120)
        text = (r.stdout or "").strip()
        if len(text) < 80:
            return {"via": "agent-browser", "error": (r.stderr or "输出过短")[:200]}
        res = {"via": "agent-browser", "text": text}
        res.update(extract(text))
        return res
    except Exception as e:
        return {"via": "agent-browser", "error": str(e)[:200]}


# ── 通路 4：内置 Chromium --dump-dom ─────────────────────
def via_chromium(url):
    exe = shutil.which("chromium") or shutil.which("google-chrome")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "--headless=new", "--no-sandbox", "--disable-gpu",
                            "--ignore-certificate-errors", "--virtual-time-budget=12000",
                            "--dump-dom", url], capture_output=True, text=True, timeout=120)
        text = strip_html(r.stdout or "")
        if len(text) < 80:
            return {"via": "chromium-dump", "error": "DOM 短或无内容"}
        res = {"via": "chromium-dump", "text": text}
        res.update(extract(text))
        return res
    except Exception as e:
        return {"via": "chromium-dump", "error": str(e)[:200]}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    url = sys.argv[1]
    as_json = "--json" in sys.argv
    field = None
    if "--field" in sys.argv:
        field = sys.argv[sys.argv.index("--field") + 1]

    tried = []
    result = None
    for fn in (via_zcy_portal, via_playwright, via_agent_browser, via_chromium):
        r = fn(url)
        if r is None:
            tried.append({"via": fn.__name__, "skip": "环境无此工具"})
            continue
        if r.get("error"):
            tried.append({"via": r.get("via"), "error": r["error"]})
            continue
        result = r
        break

    if not result:
        out = {"url": url, "ok": False, "tried": tried,
               "conclusion": "全部通路失败，判『无法核验』→ 该条不得进板块一"}
    else:
        out = {"url": url, "ok": True, "tried": tried, **result}
        # 完整抓取的判定
        if out.get("budget") or out.get("deadline"):
            out["verify"] = "字段已取到，可进核验"
        else:
            out["verify"] = "正文已取到但预算/截止仍未见，标 ⚠待核"

    if as_json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return
    print(f"URL: {url}")
    for t in tried:
        print(f"  [跳过/失败] {t}")
    if result:
        print(f"抓取通路: {result.get('via')}")
        for k in ["title", "publish", "expiredAt", "projectCode", "purchaser",
                  "budget", "deadline", "consortium", "qualifications"]:
            if result.get(k) not in (None, "", []):
                print(f"  {k}: {result[k]}")
        print(f"  正文: {len(result.get('text',''))} 字")
        print(f"  核验: {out['verify']}")
        if field:
            t = result.get("text", "")
            for m in re.finditer(re.escape(field), t):
                seg = t[max(0, m.start() - 150):m.start() + 200].replace("\n", " ")
                print(f"\n[{field}] …{seg}…")
                break
    else:
        print("全部通路失败：", out["conclusion"])


if __name__ == "__main__":
    main()
