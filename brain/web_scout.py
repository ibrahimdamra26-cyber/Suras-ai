import os
import re
import traceback
from urllib.parse import urljoin, urlparse
from fastapi import APIRouter, Form, HTTPException

router = APIRouter()

CORE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(CORE_DIR, '..', 'server', '.env')

STOP_TAGS = ["script", "style", "iframe", "noscript", "template"]
MAX_LINES = 120
MAX_AUTONOMOUS_PAGES = 6
MAX_LINES_PER_PAGE = 30

ARABIC_STOP = frozenset([
    "في", "من", "على", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "تلك",
    "التي", "الذي", "الذين", "التى", "لا", "ما", "لم", "لن", "حتى",
    "أو", "ثم", "بل", "يا", "أي", "كل", "بكل", "قد", "كان", "كانت",
    "يكون", "تكون", "هو", "هي", "هم", "هن", "أنت", "أنا", "نحن",
    "لكن", "لكنه", "لكنها", "إذا", "لو", "عند", "بين", "بعد", "قبل",
    "أن", "إن", "كانوا", "كما", "أيضا", "غير", "غيرها", "بها",
    "بأن", "عليها", "فيها", "لها", "له", "لهم", "عنه", "فيه",
])


def get_master_key():
    cfg = {}
    try:
        with open(ENV_PATH, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    key = cfg.get('SURAS_MASTER_KEY') or os.environ.get('SURAS_MASTER_KEY', '')
    if not key:
        key = 'SURAS_SECRET_EXTREME_2026'
    return key


def _tokenize(text):
    words = re.findall(r'[\w\u0600-\u06FF]{2,}', text.lower())
    return [w for w in words if w not in ARABIC_STOP]


def _score_link(anchor_text, href_text, nearby_text, keywords):
    combined = (anchor_text + ' ' + href_text + ' ' + nearby_text).lower()
    hits = sum(1 for kw in keywords if kw in combined)
    return hits


async def _fetch_page(pw_browser, url):
    page = await pw_browser.new_page()
    try:
        await page.goto(url, timeout=15000, wait_until="domcontentloaded")
        html = await page.content()
        return html
    except Exception:
        return None
    finally:
        try:
            await page.close()
        except Exception:
            pass


def _extract_text(html):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    for tag in STOP_TAGS:
        for node in soup.find_all(tag):
            node.decompose()
    lines = [ln.strip() for ln in soup.get_text(separator="\n").splitlines() if ln.strip()]
    return lines, soup


def _extract_links(html, base_url):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        full = urljoin(base_url, href)
        if not full.startswith(("http://", "https://")):
            continue
        anchor = a.get_text(separator=" ", strip=True)
        parent = a.parent
        nearby = ""
        if parent and parent.name in ("h1", "h2", "h3", "h4", "h5", "li", "td", "th", "p"):
            nearby = parent.get_text(separator=" ", strip=True)
        elif parent and parent.parent and parent.parent.name in ("h1", "h2", "h3", "h4"):
            nearby = parent.parent.get_text(separator=" ", strip=True)
        if full not in [l["url"] for l in links]:
            links.append({
                "url": full,
                "anchor": anchor,
                "nearby": nearby,
            })
    return links


def _filter_relevant(lines, keywords, max_lines=MAX_LINES_PER_PAGE):
    if not keywords:
        return lines[:max_lines]
    relevant = []
    for ln in lines:
        low = ln.lower()
        if any(kw in low for kw in keywords):
            relevant.append(ln)
            if len(relevant) >= max_lines:
                break
    if not relevant:
        return lines[:min(max_lines, 10)]
    return relevant


@router.post("/api/web-scout")
async def web_scout_scrape(
    target_url: str = Form(...),
    auth_key: str = Form(None),
    task: str = Form(None),
):
    try:
        if auth_key != get_master_key():
            return {
                "status": "simulated / gaslighting",
                "mode": "Safe Educational Mode",
                "message": "الوصول يتطلب صلاحيات المالك السيادية (auth_key).",
                "extracted_payload": None,
            }

        if not target_url.startswith(("http://", "https://")):
            target_url = f"https://{target_url}"

        from playwright.async_api import async_playwright

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])

            html0 = await _fetch_page(browser, target_url)
            if not html0:
                await browser.close()
                raise HTTPException(status_code=500, detail="تعذر فتح الصفحة المستهدفة")

            lines0, soup0 = _extract_text(html0)
            all_links = _extract_links(html0, target_url)

            if not task:
                final_summary = "\n".join(lines0[:MAX_LINES])
                internal_links = [l["url"] for l in all_links if urlparse(l["url"]).netloc == urlparse(target_url).netloc]
                external_links = [l["url"] for l in all_links if urlparse(l["url"]).netloc != urlparse(target_url).netloc]
                await browser.close()
                return {
                    "status": "unlocked",
                    "mode": "Sufah / Web Scout",
                    "message": f"تم سحب المحتوى من [{target_url}]:",
                    "target_url": target_url,
                    "extracted_payload": final_summary,
                    "line_count": len(lines0),
                    "internal_links": internal_links,
                    "external_links": external_links,
                }

            keywords = _tokenize(task)
            if not keywords:
                keywords = [task.strip().lower()]

            scored = []
            for link in all_links:
                sc = _score_link(link["anchor"], link["url"], link["nearby"], keywords)
                scored.append((sc, link))
            scored.sort(key=lambda x: x[0], reverse=True)

            selected = [(sc, lnk) for sc, lnk in scored[:MAX_AUTONOMOUS_PAGES] if sc > 0]
            if not selected:
                selected = [(0, lnk) for _, lnk in scored[:3]]

            findings = []
            for sc, link in selected:
                url = link["url"]
                try:
                    html = await _fetch_page(browser, url)
                    if not html:
                        findings.append({"url": url, "status": "failed", "relevance_score": sc, "lines": []})
                        continue
                    page_lines, _ = _extract_text(html)
                    relevant = _filter_relevant(page_lines, keywords)
                    findings.append({
                        "url": url,
                        "anchor": link["anchor"],
                        "nearby": link["nearby"],
                        "status": "ok",
                        "relevance_score": sc,
                        "total_lines": len(page_lines),
                        "relevant_lines": len(relevant),
                        "lines": relevant,
                    })
                except Exception:
                    findings.append({"url": url, "status": "error", "relevance_score": sc, "lines": []})

            await browser.close()

        all_text = []
        for f in findings:
            if f["status"] == "ok" and f["lines"]:
                all_text.extend(f["lines"])

        summary_text = "\n".join(all_text[:MAX_LINES])

        return {
            "status": "unlocked",
            "mode": "Autonomous Web Scout Agent",
            "task": task,
            "target_url": target_url,
            "keywords_used": keywords,
            "pages_opened": len([f for f in findings if f["status"] == "ok"]),
            "total_pages_found": len(all_links),
            "extracted_payload": summary_text,
            "findings": findings,
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"فشل محرك الزحف الشبكي: {str(e)}")
