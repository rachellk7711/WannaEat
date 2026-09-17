#!/usr/bin/env python3
"""
알레르기 유발물질 19항목 → 우리 원재료 토큰 대응표

왜 필요한가
  라벨에는 알레르기 표시란이 법으로 따로 있다. 사진 경로에서는 그걸 읽으면 된다.
  그런데 제품명으로 찾는 경로에는 공공DB(C002)에 알레르기 필드가 없다.
  원재료명에서 짚어내는 수밖에 없고, 그래서 이 표가 필요하다.

왜 조심해야 하는가
  부분 일치는 알레르기에서 특히 위험하다. 실제로 이런 것들이 걸렸다.
    메밀가루 → '밀'      메밀은 밀이 아니다
    둥굴레   → '굴'
    식물성크림 → '우유'   식물성이다
    밀납·밀크향·α아밀라아제 → '밀'
  그래서 포함 규칙과 함께 제외 규칙을 둔다.

확신 단계를 나눈다
  직접   성분 자체이거나 직접 유래물 (밀가루, 탈지분유)
  추정   대개 들어가지만 제품에 따라 다름 (간장→대두, 햄→돼지고기)
  추정은 '있다'고 단정하지 않는다. 라벨 표시란이 있으면 그쪽이 우선이다.

출력: data/prepared/allergen_tokens.csv
"""
import csv, io, os, sys

csv.field_size_limit(10**9)
PREP, CUR = "data/prepared", "data/curated"


def parts(s):
    return [x.strip() for x in (s or "").split("|") if x.strip()]


rules = []
with io.open(os.path.join(CUR, "allergen_map.csv"), encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        rules.append((r["항목"], parts(r["포함_직접"]), parts(r["포함_추정"]),
                      parts(r["제외"]), r["비고"]))

toks = []
with io.open(os.path.join(PREP, "ingredient_tokens.csv"), encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        toks.append((r["token"], int(r["occurrences"])))

out, summary = [], []
for item, direct, guess, excl, note in rules:
    hits = {"직접": [], "추정": []}
    for t, c in toks:
        if any(e in t for e in excl):
            continue
        if any(k in t for k in direct):
            hits["직접"].append((t, c))
        elif any(k in t for k in guess):
            hits["추정"].append((t, c))
    for lv in ("직접", "추정"):
        for t, c in hits[lv]:
            out.append([item, lv, t, c])
    summary.append((item, len(hits["직접"]), sum(c for _, c in hits["직접"]),
                    len(hits["추정"]), sum(c for _, c in hits["추정"])))

dst = os.path.join(PREP, "allergen_tokens.csv")
with io.open(dst, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["항목", "확신", "토큰", "등장"])
    w.writerows(out)

if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

print(f"{'항목':<16}{'직접(종)':>9}{'직접 등장':>11}{'추정(종)':>9}{'추정 등장':>11}")
print("-" * 58)
for s in summary:
    print(f"{s[0]:<16}{s[1]:>9,}{s[2]:>11,}{s[3]:>9,}{s[4]:>11,}")
print(f"\n대응 토큰 {len(out):,}개 → {dst}")
