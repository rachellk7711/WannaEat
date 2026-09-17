#!/usr/bin/env python3
"""
EFSA 기준값 → ADI 표 · 수치 없는 결론 표 (근거 DB C층)

연결 고리 (실측으로 확인)
  FLEX_SUM.ToxRefValues.Parent UUID        →  SUB.Document UUID
  SUB.ReferenceSubstance.ReferenceSubstance →  REF_SUB.Document UUID (이름·CAS)
  FLEX_SUM.ToxRefValues.Document UUID       →  DOSSIER_DOCS → DOSSIER (평가일·문서·분야)

원칙 (2026-09-17 검증 반영)
  - 원 기록을 합치지 않는다. 물질 하나당 한 행만 남기던 처리를 없앴다.
    대상(population)·단위가 다른 평가가 서로 다른 행으로 남는다.
  - 평가서는 그 기준값 문서가 실제로 들어 있는 평가서만 붙인다.
    예전에는 물질의 평가서 전체 중 최신 연도를 붙여서, 옛 평가의 값에 새 연도가 붙었다.
    연결이 없으면 '문헌 연결 미확인' 으로 둔다. 추정하지 않는다.
  - 같은 (물질, 대상, 분야) 안에서 가장 최근 평가서에 속한 행에 latest=Y 를 붙인다.
    옛 행은 지우지 않는다.

출력
  data/prepared/efsa_adi.csv        ADI 원 기록 (행 = ToxRef 문서 하나)
  data/prepared/efsa_remarks.csv    수치 없는 결론 원 기록
  data/prepared/ingredient_efsa.csv 우리 성분(한글) ↔ EFSA ADI (최신 · 식품 분야)
"""
import csv, io, os, re, sys
from collections import defaultdict

csv.field_size_limit(10**9)
PREP, RAW = "data/prepared", "data/raw"
A = "HumanHealthHazardCharacteristics.AcceptableDailyIntake."
O = "HumanHealthHazardCharacteristics.OtherReferenceValues."
FOOD_DOMAIN = {"food additives", "nutrient sources", "flavourings", "novel foods"}


def domain_of(d):
    """평가서의 분야. 311건이 'other:' 로만 적혀 있고 실제 분야는 보조 칸에 있다.
    아세설팜칼륨 2020·에리스리톨 2023·사카린 2024 재평가가 여기에 들어 있어서,
    'other:' 를 식품이 아니라고 보면 옛 값이 최신으로 뽑힌다."""
    fd = v(d, "Domain.FoodDomain")
    if fd and fd != "other:":
        return fd
    oth = v(d, "Domain.FoodDomain.Other").lower()
    if oth and oth != "no category":
        return {"food additive": "food additives"}.get(oth, oth)
    reg = (v(d, "Domain.Regulation") + " " + v(d, "Domain.Regulation.Other"))
    panel = v(d, "Domain.ExpertGroup")
    if "1333/2008" in reg or "FAF" in panel or "ANS" in panel:
        return "food additives"
    if "2015/2283" in reg or "258/1997" in reg:
        return "novel foods"
    return fd or ""


def num(x):
    """7.0000000000000007E-2 → 0.07 (엑셀 부동소수 표기 정리)"""
    x = (x or "").strip()
    try:
        f = float(x)
    except ValueError:
        return x
    return ("%.6g" % f) if f else "0"


def load(p):
    with io.open(os.path.join(PREP, p), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def norm_en(s):
    return re.sub(r"[\s\-_,.]", "", (s or "").strip().lower())


def v(t, k):
    return (t.get(k) or "").strip()


# ── 0. 공통 색인 ────────────────────────────────────────
ref = {r["Document UUID"]: r for r in load("efsa_substances.csv") if r.get("Document UUID")}
sub = {r["Document UUID"]: r for r in load("efsa_sub.csv") if r.get("Document UUID")}
dos = {r["Document UUID"]: r for r in load("efsa_dossier.csv") if r.get("Document UUID")}
doc2dos = defaultdict(set)
for r in load("efsa_dossier_docs.csv"):
    if r.get("DOSSIER UUID") in dos:
        doc2dos[r["DOCUMENT UUID"]].add(r["DOSSIER UUID"])
tox = load("efsa_toxref.csv")


def substance_of(t):
    s = sub.get(v(t, "Parent UUID"))
    if not s:
        return "", "", ""
    r = ref.get(v(s, "ReferenceSubstance.ReferenceSubstance"))
    name = (v(r, "ReferenceSubstanceName") or v(r, "CAS name")) if r else ""
    cas = v(r, "Inventory.CASNumber") if r else ""
    return (name or v(s, "ChemicalName")), cas, v(s, "Document UUID")


def dossier_of(t):
    """이 기준값 문서가 들어 있는 평가서. 여러 개면 가장 최근 것을 대표로 쓰고 개수를 남긴다."""
    ds = [dos[d] for d in doc2dos.get(v(t, "Document UUID"), ())]
    if not ds:
        return {"link_status": "문헌 연결 미확인", "dossier_count": 0,
                "eval_date": "", "eval_year": "", "eval_year_first": "",
                "source_title": "", "source_link": "", "domain": "", "domain_raw": "", "panel": ""}
    ds.sort(key=lambda d: v(d, "LiteratureReference.DateOfEvaluation"))
    last, first = ds[-1], ds[0]
    yr = lambda d: (re.search(r"(19|20)\d{2}", v(d, "LiteratureReference.DateOfEvaluation")) or [""])[0]
    return {
        "link_status": "직접 연결" if len(ds) == 1 else f"평가서 {len(ds)}개",
        "dossier_count": len(ds),
        "eval_date": v(last, "LiteratureReference.DateOfEvaluation"),
        "eval_year": yr(last),
        "eval_year_first": yr(first),
        "source_title": v(last, "LiteratureReference.EFSAOutputTitle"),
        "source_link": v(last, "LiteratureReference.LinkToPersistentIdentifier"),
        # 분야가 평가서마다 다르면 모두 남긴다 — 식품 여부 판단에 쓴다
        "domain": " | ".join(sorted({domain_of(d) for d in ds if domain_of(d)})),
        "domain_raw": " | ".join(sorted({v(d, "Domain.FoodDomain") for d in ds if v(d, "Domain.FoodDomain")})),
        "panel": " | ".join(sorted({v(d, "Domain.ExpertGroup") for d in ds if v(d, "Domain.ExpertGroup")})),
    }


def is_food(domain):
    return any(x.strip().lower() in FOOD_DOMAIN for x in (domain or "").split("|"))


def mark_latest(rows, key):
    """같은 묶음 안에서 가장 최근 평가서의 행에 latest=Y. 연결이 없는 행은 비교에서 뺀다."""
    best = {}
    for r in rows:
        if not r["eval_date"]:
            continue
        k = key(r)
        if k not in best or r["eval_date"] > best[k]:
            best[k] = r["eval_date"]
    for r in rows:
        r["latest"] = "Y" if r["eval_date"] and r["eval_date"] == best.get(key(r)) else ""


# ── 1. ADI 원 기록 ──────────────────────────────────────
adi_rows = []
for t in tox:
    lo, hi = v(t, A + "Adi.lowerValue"), v(t, A + "Adi.upperValue")
    if not lo and not hi:
        continue
    name, cas, sub_uuid = substance_of(t)
    d = dossier_of(t)
    adi_rows.append({
        "toxref_uuid": v(t, "Document UUID"), "sub_uuid": sub_uuid,
        "substance": name, "cas": cas,
        # 단일 값은 upperValue 에만 적힌다. 범위이면 둘 다 남긴다
        "adi_low": num(lo or hi), "adi_high": num(hi) if lo else "",
        "qualifier_low": v(t, A + "Adi.lowerQualifier"),
        "qualifier_high": v(t, A + "Adi.upperQualifier"),
        "unit": v(t, A + "Adi.Unit"),
        "population": v(t, A + "Population"),
        "population_remarks": v(t, A + "Population.Remarks"),
        "assessment_body": v(t, A + "AssessmentBody.Other") or v(t, A + "AssessmentBody"),
        # 무엇을 기준으로 한 값인지(아질산 이온, 유리 이미드 …)는 이 문장에 있다
        "basis": v(t, A + "JustificationAndComments") or v(t, A + "Justification"),
        "uncertainty_factor": v(t, A + "OverallUncertainty"),
        **d,
    })
mark_latest(adi_rows, lambda r: (r["substance"].lower(), r["population"], is_food(r["domain"])))

F_ADI = ["substance", "cas", "adi_low", "adi_high", "qualifier_low", "qualifier_high",
         "unit", "population", "population_remarks", "assessment_body", "basis",
         "uncertainty_factor", "domain", "domain_raw", "panel", "eval_date", "eval_year",
         "eval_year_first", "dossier_count", "link_status", "latest",
         "source_title", "source_link", "toxref_uuid", "sub_uuid"]
with io.open(os.path.join(PREP, "efsa_adi.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=F_ADI)
    w.writeheader(); w.writerows(adi_rows)

# ── 2. 수치 없는 결론 원 기록 ───────────────────────────
#  '수치 없음' 은 한 가지가 아니다 — '필요 없음' 과 '자료 부족' 은 정반대다.
#  결론 문장을 그대로 싣는다.
remarks = []
for t in tox:
    just = v(t, O + "JustificationAndComments")
    if not just:
        continue
    name, cas, sub_uuid = substance_of(t)
    if not name:
        continue
    d = dossier_of(t)
    remarks.append({
        "substance": name, "cas": cas,
        "descriptor": v(t, O + "ReferenceValueDescriptor.Other") or v(t, O + "ReferenceValueDescriptor"),
        "population": v(t, O + "Population"),
        "conclusion": just,
        "value_low": num(v(t, O + "RefValue.lowerValue")),
        "value_high": num(v(t, O + "RefValue.upperValue")),
        "unit": v(t, O + "RefValue.Unit.Other") or v(t, O + "RefValue.Unit"),
        "toxref_uuid": v(t, "Document UUID"), "sub_uuid": sub_uuid,
        **d,
    })
mark_latest(remarks, lambda r: (r["substance"].lower(), r["population"], is_food(r["domain"])))

F_REM = ["substance", "cas", "descriptor", "population", "conclusion",
         "value_low", "value_high", "unit", "domain", "domain_raw", "panel", "eval_date",
         "eval_year", "eval_year_first", "dossier_count", "link_status", "latest",
         "source_title", "source_link", "toxref_uuid", "sub_uuid"]
with io.open(os.path.join(PREP, "efsa_remarks.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=F_REM)
    w.writeheader(); w.writerows(remarks)

# ── 3. 우리 성분(한글) ↔ EFSA ADI (식품 분야 최신만) ─────
kor = {}
with io.open(os.path.join(RAW, "I2520_rawmtrl_code.csv"), encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        k = v(r, "RPRSNT_RAWMTRL_NM")
        for part in re.split(r"[,;/]", r.get("ENG_NM") or ""):
            p = norm_en(part)
            if p and k:
                kor.setdefault(p, k)
joined = [(kor[norm_en(r["substance"])], r["substance"], r["adi_low"], r["unit"], r["population"], r["eval_year"])
          for r in adi_rows
          if r["latest"] and is_food(r["domain"]) and norm_en(r["substance"]) in kor]
with io.open(os.path.join(PREP, "ingredient_efsa.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["ingredient_kr", "efsa_substance", "adi", "unit", "population", "eval_year"])
    w.writerows(joined)

# ── 요약 ────────────────────────────────────────────────
if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from collections import Counter
print(f"ADI 원 기록 {len(adi_rows):,}건 (합치지 않음)")
print("   연결:", dict(Counter(r["link_status"].split()[0] if r["link_status"].startswith("평가서") else r["link_status"] for r in adi_rows)))
print(f"   대상 기재 {sum(1 for r in adi_rows if r['population']):,} · 기준 문장 {sum(1 for r in adi_rows if r['basis']):,}")
print(f"   식품 분야 {sum(1 for r in adi_rows if is_food(r['domain'])):,} · 그중 latest {sum(1 for r in adi_rows if is_food(r['domain']) and r['latest']):,}")
print(f"수치 없는 결론 {len(remarks):,}건 · 식품 분야 {sum(1 for r in remarks if is_food(r['domain'])):,}")
print(f"우리 성분 ↔ EFSA ADI (식품·최신) {len(joined):,}건")
