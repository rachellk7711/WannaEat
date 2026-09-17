#!/usr/bin/env python3
"""
EU 식품첨가물 DB · 신소재식품 목록 파싱

왜 필요한가 (raw/README.md 의 구분을 지킨다)
  EFSA·JECFA 는 '안전성 평가 결과'다 — ADI 같은 수치.
  EU DB 는 '어떤 식품에 어떤 조건으로 허용되는가'다 — 최대 사용량·quantum satis.
  둘은 다른 것이다. 같은 '승인' 값으로 합치지 않는다.

받은 곳
  https://ec.europa.eu/food/food-feed-portal/backend/api/policy-items
      ?foodDomain=fin&authorisationType=fad_auth   첨가물 412항목 (12.5MB)
      ?foodDomain=nf&authorisationType=nf_auth     신소재식품 33항목

출력
  data/prepared/eu_additives.csv        E번호·물질명·그룹
  data/prepared/eu_additive_uses.csv    물질 × 식품군별 사용조건
  data/prepared/eu_novel_foods.csv      승인 신소재식품
"""
import csv, io, json, os, sys

RAW, PREP = "data/raw/eu", "data/prepared"


def kids(n, vid=None):
    cs = n.get("childrenValues") or []
    return [c for c in cs if vid is None or c.get("valueIdentifier") == vid]


def one(n, vid):
    c = kids(n, vid)
    return c[0] if c else None


def leaves(n, out=None):
    """말단 값만 평평하게 모은다. 같은 이름이 여러 번 나오면 첫 값을 쓴다."""
    out = {} if out is None else out
    for c in n.get("childrenValues") or []:
        if c.get("childrenValues"):
            leaves(c, out)
        elif c.get("valueIdentifier"):
            out.setdefault(c["valueIdentifier"], c.get("value"))
    return out


def load(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def write(name, rows, fields):
    p = os.path.join(PREP, name)
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader(); w.writerows(rows)
    return p, len(rows)


# ── 첨가물 ──────────────────────────────────────────────
subs, uses, skipped = [], [], []
for n in load(os.path.join(RAW, "additives/policy_items_fad.json")):
    sp = one(n, "policyItemSpecs")
    if not sp:
        continue
    s = leaves(sp)
    code = (one(n, "policyItemCode") or {}).get("value", "")
    rec = {
        "policy_code": code,
        "e_number": (s.get("eNumber") or "").strip(),
        "name": (s.get("identifyingName") or s.get("displayName") or "").strip(),
        "synonyms": (s.get("synonyms") or "").strip(),
        "ins_number": (s.get("insNumber") or "").strip(),
        "type": (s.get("policyItemType") or "").strip(),
        "group_of": (s.get("memberOfFADGroup") or "").strip(),
    }
    subs.append(rec)

    cu = one(n, "conditionsOfUse")
    for idx, c in enumerate(kids(cu) if cu else []):
        # 한 식품군 조건 안에 제한(restriction)과 주석(note)이 여러 개 들어 있다.
        # 예전에는 말단 값을 평평하게 모아 첫 값만 남겨서 2,772개가 사라졌다.
        # 제한 하나당 한 행으로 풀고, 주석은 모두 이어 붙인다.
        cats = [x.get("value") for fc in kids(c, "foodCategory")
                for x in kids(fc, "foodCategoryId") if x.get("value")]
        restr = [leaves(r) for r in kids(c, "restriction")]
        notes = [leaves(x) for x in kids(c, "foodCategoryRestrictionNote")]
        legis = next((x.get("value") for x in kids(c, "restrictionsSourceLegislationID")), "") or ""
        if not cats and not any(any(r.values()) for r in restr):
            skipped.append((code, idx, "빈 조건 노드"))
            continue
        note_txt = " || ".join((x.get("foodCategoryRestrictionNoteText") or "").strip()
                               for x in notes if x.get("foodCategoryRestrictionNoteText"))
        note_no = ",".join(str(x.get("foodCategoryRestrictionNoteNumber")) for x in notes
                           if x.get("foodCategoryRestrictionNoteNumber"))
        for cat in cats or [""]:
            for j, r in enumerate(restr or [{}]):
                uses.append({
                    "policy_code": code,
                    "e_number": rec["e_number"],
                    "name": rec["name"],
                    "node": f"{idx}.{j}",
                    "food_category_id": cat or "",
                    # FAD_RT_QS = quantum satis(양을 정하지 않음), FAD_RT_ML = 최대 허용량
                    "restriction_type": r.get("restrictionType") or "",
                    "value": r.get("restrictionValue") or "",
                    "unit": r.get("restrictionUnit") or "",
                    "comment": (r.get("restrictionComment") or "").strip(),
                    "note_no": note_no,
                    "note": note_txt,
                    "legislation_id": legis,
                })

p1, n1 = write("eu_additives.csv", subs,
               ["policy_code", "e_number", "name", "synonyms", "ins_number",
                "type", "group_of"])
p2, n2 = write("eu_additive_uses.csv", uses,
               ["policy_code", "e_number", "name", "node", "food_category_id",
                "restriction_type", "value", "unit", "comment", "note_no", "note",
                "legislation_id"])
write("eu_additive_uses_skipped.csv",
      [{"policy_code": a, "node": b, "reason": c} for a, b, c in skipped],
      ["policy_code", "node", "reason"])

# ── 신소재식품 ──────────────────────────────────────────
nf = []
path = os.path.join(RAW, "novel-foods/policy_items_nf.json")
if os.path.exists(path):
    for n in load(path):
        s = leaves(n)
        nf.append({
            "policy_code": s.get("policyItemCode") or "",
            "name": (s.get("identifyingName") or s.get("displayName") or "").strip(),
            "status": s.get("policyItemStatus") or "",
            "computed_id": s.get("policyItemComputedID") or "",
        })
p3, n3 = write("eu_novel_foods.csv", nf,
               ["policy_code", "name", "status", "computed_id"])

if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from collections import Counter
print(f"첨가물 {n1:,}종 → {p1}")
print(f"   E번호 보유 {sum(1 for r in subs if r['e_number']):,}")
print(f"사용조건 {n2:,}건 → {p2} (제외한 빈 노드 {len(skipped):,})")
print("   조건 유형:", Counter(r["restriction_type"] for r in uses).most_common(5))
print(f"신소재식품 {n3:,}종 → {p3}")
