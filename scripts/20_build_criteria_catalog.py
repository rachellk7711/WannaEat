#!/usr/bin/env python3
"""
기준 설정 화면용 카탈로그 — 앱 번들에 넣는 작은 JSON

구조 (2026-09-18 결정 · docs/24 §2)
  분류 6개 → 소분류 → 기준(칩)
  - 판정 단위는 기준(가장 잘게 쪼갠 것). 화면 묶음은 data/curated/criteria_layout.csv 에서만 바꾼다.
    묶음을 바꿔도 규칙·사용자 저장값·이력은 그대로다.
  - selectAll=Y 인 소분류는 "전체 선택" 을 준다. 사용자가 전체를 고르면 앱은 소분류 ID 로 저장하고,
    판정 때 그 시점 카탈로그로 펼친다 — 나중에 기준이 늘어나도 사용자의 뜻("종자유 전부") 이 유지된다.
  - 프리셋 없음. 강도(피해요 / 알려만 줘요)는 앱이 정한다.
  - includedIn: 이 기준의 직접 표기가 거의 다(90% 이상) 다른 기준에도 걸리면 적는다 (타르색소 → 착색료).
    결과 화면에서 같은 표기를 두 번 세지 않게 하는 데 쓴다.

검색어(aliases)는 규칙이 '직접' 으로 잇는 표기 중 등장 20회 이상만 싣는다.
판정은 서버의 규칙 엔진(18)이 한다. 이 파일은 고르고 찾는 데만 쓴다.

입력  data/curated/criteria_layout.csv · criteria_rules.csv
      data/prepared/criteria_tokens.csv · criteria_measure.csv
출력  data/prepared/criteria_catalog.json
"""
import csv, io, json, os, sys
from collections import defaultdict

PREP, CUR = "data/prepared", "data/curated"
EXAMPLES, ALIAS_MIN, CONTAIN = 8, 20, 0.9
RULESET_VERSION = "2026-09-18"


def load(p):
    with io.open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def main():
    crit, excl = {}, defaultdict(list)
    for r in load(os.path.join(CUR, "criteria_rules.csv")):
        crit.setdefault(r["기준ID"], {"name": r["기준명"], "group": r["분류"]})
        if r["규칙"].startswith("제외"):
            excl[r["기준ID"]] += [p for p in r["패턴"].split("|") if p]

    layout = load(os.path.join(CUR, "criteria_layout.csv"))
    ids = [r["기준ID"] for r in layout]
    dup = {i for i in ids if ids.count(i) > 1}
    assert not dup, f"배치 파일에 두 번 나온 기준: {dup}"
    assert set(ids) == set(crit), f"배치 파일과 규칙 파일이 다르다: {set(ids) ^ set(crit)}"
    for r in layout:
        assert crit[r["기준ID"]]["group"] == r["분류"], f"분류가 다르다: {r['기준ID']}"

    direct = defaultdict(dict)
    for r in load(os.path.join(PREP, "criteria_tokens.csv")):
        if r["확신"] == "직접":
            direct[r["기준ID"]][r["토큰"]] = int(r["등장"])

    included = defaultdict(list)
    for a in crit:
        total = sum(direct[a].values())
        for b in crit:
            if a != b and total:
                shared = sum(o for t, o in direct[a].items() if t in direct[b])
                if shared / total >= CONTAIN:
                    included[a].append(b)

    found = {r["기준ID"]: int(r["발견"]) for r in load(os.path.join(PREP, "criteria_measure.csv"))}

    groups = {}
    for r in layout:
        g = groups.setdefault(r["분류"], {"name": r["분류"], "subgroups": {}})
        sg = g["subgroups"].setdefault(r["소분류ID"], {
            "id": r["소분류ID"], "name": r["소분류"],
            "selectAll": r["묶음선택"] == "Y", "criteria": []})
        cid = r["기준ID"]
        toks = sorted(((o, t) for t, o in direct[cid].items()), reverse=True)
        item = {
            "id": cid,
            "name": crit[cid]["name"],
            "examples": [t for _, t in toks[:EXAMPLES]],
            "notMatched": excl[cid][:6],
            "aliases": [t for o, t in toks if o >= ALIAS_MIN],
            "productsFound": found.get(cid, 0),
        }
        if included[cid]:
            item["includedIn"] = included[cid]
        if r["비고"]:
            item["note"] = r["비고"]
        sg["criteria"].append(item)

    out = {"version": RULESET_VERSION,
           "groups": [{"name": g["name"], "subgroups": list(g["subgroups"].values())}
                      for g in groups.values()]}
    p = os.path.join(PREP, "criteria_catalog.json")
    with io.open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    n_alias = sum(len(c["aliases"]) for g in out["groups"] for s in g["subgroups"] for c in s["criteria"])
    print(f"{p} · {os.path.getsize(p)/1024:.0f} KB · 기준 {len(crit)} · 검색어 {n_alias:,}")
    for g in out["groups"]:
        print(f"  {g['name']}")
        for s in g["subgroups"]:
            mark = "전체선택" if s["selectAll"] else "개별만"
            print(f"    {s['name']} ({mark}): " + " · ".join(c["name"] for c in s["criteria"]))
    print("포함 관계 (90%↑):")
    for a, bs in included.items():
        if bs:
            print(f"  {crit[a]['name']} ⊂ " + ", ".join(crit[b]["name"] for b in bs))


if __name__ == "__main__":
    main()
