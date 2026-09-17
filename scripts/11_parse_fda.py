#!/usr/bin/env python3
"""
FDA 식품성분 자료 정리 — 미국 근거 (C층)

받은 것 (확장자는 .xls 지만 실제로는 CSV)
  FoodSubstances  3,971종  CAS·물질명·이명·용도(Technical Effect)·21 CFR 조항
  SCOGS             381종  GRAS 재평가 결론 (1~5 유형)
  GRASNotices     1,336건  1998년 이후 GRAS 통지와 FDA 회신

왜 중요한가
  1. CAS 번호가 있다. EFSA 자료에도 CAS 가 있으므로 이름이 아니라 번호로 이을 수 있다.
     이름 매칭에서 났던 사고(자당 → 자당지방산에스테르)를 원천적으로 피한다.
  2. 'Used for (Technical Effect)' 가 성분의 역할이다. 국내 자료에는 이 칸이 없었다.

출력: data/prepared/fda_substances.csv, fda_scogs.csv, fda_gras.csv
"""
import csv, io, os, re, sys

csv.field_size_limit(10**9)
RAW, PREP = "data/raw/fda", "data/prepared"

# SCOGS 결론 유형 — FDA 가 정의한 5단계
SCOGS_TYPE = {
    "1": "현재 사용량과 예상 증가량에서 위해 근거 없음",
    "2": "현재 사용량에서 위해 근거 없으나, 사용량이 크게 늘면 자료가 부족함",
    "3": "위해 근거는 없으나 불확실성이 남아 추가 연구가 필요함",
    "4": "안전한 사용 조건을 정하려면 제한이 필요함",
    "5": "안전성을 판단할 자료가 부족함",
}


def clean(v):
    """=T("1") 같은 엑셀 수식 껍데기와 HTML 조각을 벗긴다."""
    v = (v or "").strip()
    m = re.fullmatch(r'=T\("(.*)"\)', v)
    if m:
        v = m.group(1)
    v = re.sub(r"&diams;|<br\s*/?>", " | ", v)
    v = re.sub(r"<[^>]+>", "", v)
    return re.sub(r"\s*\|\s*", " | ", v).strip(" |").strip()


def read(name):
    lines = io.open(os.path.join(RAW, name + ".csv"),
                    encoding="utf-8", errors="replace").read().split("\n")
    hi = next(i for i, l in enumerate(lines)
              if l.count(",") >= 3 and not l.startswith("Downloaded"))
    rows = list(csv.DictReader(io.StringIO("\n".join(lines[hi:]))))
    return [{k: clean(v) for k, v in r.items() if k} for r in rows]


def write(name, rows, fields):
    p = os.path.join(PREP, name)
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader(); w.writerows(rows)
    return p


# ── 1. Substances Added to Food ─────────────────────────
subs = []
for r in read("FoodSubstances"):
    # 21 CFR 조항 번호가 여러 칸에 흩어져 있다. 한 칸으로 모은다.
    regs = [v for k, v in r.items() if k.startswith(("Reg col", "Reg add")) and v]
    subs.append({
        "cas": r.get("CAS Reg No (or other ID)", ""),
        "substance": r.get("Substance", ""),
        "other_names": r.get("Other Names", ""),
        "technical_effect": r.get("Used for (Technical Effect)", ""),
        "cfr": " | ".join(regs),
        "prohibited": r.get("Reg prohibited189", ""),
        "fema_no": r.get("FEMA No", ""),
        "jecfa_no": r.get("JECFA Flavor Number", ""),
    })
p1 = write("fda_substances.csv", subs,
           ["cas", "substance", "other_names", "technical_effect",
            "cfr", "prohibited", "fema_no", "jecfa_no"])

# ── 2. SCOGS ────────────────────────────────────────────
scogs = []
for r in read("SCOGS"):
    t = r.get("SCOGS Type of Conclusion", "")
    scogs.append({
        "substance": r.get("GRAS Substance", ""),
        "other_names": r.get("Other Names", ""),
        "cas": r.get("CAS Reg. No. or other ID CODE", ""),
        "year": r.get("Year of Report", ""),
        "conclusion_type": t,
        "conclusion": SCOGS_TYPE.get(t, ""),
        "report_no": r.get("SCOGS Report Number", ""),
    })
p2 = write("fda_scogs.csv", scogs,
           ["substance", "other_names", "cas", "year",
            "conclusion_type", "conclusion", "report_no"])

# ── 3. GRAS Notices ─────────────────────────────────────
gras = []
for r in read("GRASNotices"):
    gras.append({
        "grn_no": r.get("GRAS Notice (GRN) No.", ""),
        "substance": r.get("Substance", ""),
        "intended_use": r.get("Intended Use", ""),
        "basis": r.get("Basis", ""),
        "notifier": r.get("Notifier", ""),
        "filed": r.get("Date of filing", ""),
        "closed": r.get("Date of closure", ""),
        "fda_letter": r.get("FDA's Letter", ""),
    })
p3 = write("fda_gras.csv", gras,
           ["grn_no", "substance", "intended_use", "basis",
            "notifier", "filed", "closed", "fda_letter"])

if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from collections import Counter
print(f"물질 {len(subs):,}종 → {p1}")
print(f"   CAS 보유 {sum(1 for r in subs if r['cas']):,} · "
      f"용도 기재 {sum(1 for r in subs if r['technical_effect']):,}")
print(f"SCOGS {len(scogs):,}종 → {p2}")
for t, c in sorted(Counter(r["conclusion_type"] for r in scogs).items()):
    print(f"   유형 {t or '(빈칸)'}: {c:>3}종  {SCOGS_TYPE.get(t,'')[:44]}")
print(f"GRAS 통지 {len(gras):,}건 → {p3}")
