#!/usr/bin/env python3
"""
기준 원재료 → 원재료 토큰 대응표 (판정의 핵심)

사용자가 "설탕·밀가루·돼지고기 안 먹음" 을 고르면, 라벨의 `백설탕`·`박력분`·`돼지등심` 도 걸려야 한다.
완성된 단어만 보는 규칙은 표기 변형을 놓친다(돼지+부위·소+부위·제분 등급 약 22만 회).
반대로 넓은 부분 일치는 엉뚱한 것을 잡는다(당 → 당근, 밀 → 밀크, 콘 → 글루콘산).

규칙 (data/curated/criteria_rules.csv)
  정확  토큰 전체가 같다
  접두  토큰이 그것으로 시작한다
  포함  토큰 안에 들어 있다
  제외  들어 있으면 그 기준에서 뺀다 (가장 먼저 적용)
  제외접미  그것으로 끝나면 뺀다 (대두 기준에서 '…대두유' 는 빼되 '대두유래' 는 남긴다)
구체적인 규칙이 이긴다 — 정확 > 접두 > 포함. 같은 종류끼리는 직접 > 추정.

확신
  직접  그 원재료 자체이거나 확실한 유래물
  추정  대개 들어가지만 제품마다 다르다 → 판정에서 "발견" 이 아니라 "확인 필요"

묶음 표기 (data/curated/opaque_terms.csv)
  복합조미식품·혼합제제·향료처럼 무엇이 들었는지 알 수 없는 표기. 판정에서 "확인 불가" 로 센다.

출력
  data/prepared/criteria_tokens.csv   기준 × 토큰 대응 (등장 횟수·규칙 포함)
  data/prepared/opaque_tokens.csv     묶음 표기 토큰
"""
import csv, io, os, re, sys
from collections import defaultdict

csv.field_size_limit(10**9)
PREP, CUR = "data/prepared", "data/curated"
KIND_RANK = {"정확": 0, "접두": 1, "접미": 1, "포함": 2}

# 향료 표기는 그 원재료가 들었다는 뜻이 아니다 (흑설탕향·막걸리향·우지향·베이컨향).
# 그렇다고 빼 버리면 '쇠고기맛분말' 이 소고기를 피하는 사용자에게 "없음" 으로 나간다.
# 거짓 안심을 막기 위해, 향료 표기가 기준에 걸리면 '추정(확인 필요)' 으로만 올린다.
# 향신료는 향료가 아니다.
FLAVOR = re.compile(
    r"((향|후레바|후레버|플레이버|에센스|flavou?r)(료|분말|베이스|키베이스|오일|액|유|파우더|[#a-z0-9]*)?"
    r"|맛(엑기스|분말|오일|베이스|파우더|파우다|[#a-z0-9]*))$")

# 추정 규칙은 양념·소스 맥락이면 뺀다 (우동소스·라면스프·비프시즈닝분말).
SEASONING = ("소스", "스프", "다시", "쓰유", "양념", "시즈닝", "씨즈닝", "건더기", "조미", "용액", "베이스")
CONF_RANK = {"직접": 0, "추정": 1}

# 향료 자체를 고른 기준은 향료 표기가 곧 발견이다.
FLAVOR_CRITERIA = {"flavor"}
# 「땅콩또는견과류가공품」·「대두유또는채종유」 는 둘 중 무엇인지 알 수 없다 → 추정.


def parts(s):
    return [x.strip().lower() for x in (s or "").split("|") if x.strip()]


def load(p):
    with io.open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def hit(kind, pat, t):
    return (t == pat if kind == "정확" else
            t.startswith(pat) if kind == "접두" else
            t.endswith(pat) if kind == "접미" else
            pat in t)


def load_criteria():
    crit = {}
    for r in load(os.path.join(CUR, "criteria_rules.csv")):
        c = crit.setdefault(r["기준ID"], {"name": r["기준명"], "group": r["분류"],
                                          "rules": [], "exclude": [], "exclude_suffix": []})
        if r["규칙"] == "제외":
            c["exclude"] += parts(r["패턴"])
        elif r["규칙"] == "제외접미":
            c["exclude_suffix"] += parts(r["패턴"])
        else:
            for pat in parts(r["패턴"]):
                c["rules"].append((r["규칙"], r["확신"], pat))
    return crit


def make_matcher(crit=None):
    """문자열 하나 → [(기준ID, 확신, 규칙)] . 토큰 목록에 없던 문자열(괄호 안 한정어 등)에도 쓴다."""
    crit = crit or load_criteria()
    cache = {}

    def match(t):
        t = (t or "").strip().lower()
        if t in cache:
            return cache[t]
        is_flavor = bool(FLAVOR.search(t)) and "향신" not in t
        is_seasoning = any(x in t for x in SEASONING)
        found = []
        for cid, c in crit.items():
            if any(x in t for x in c["exclude"]) or t.endswith(tuple(c["exclude_suffix"]) or ("\0",)):
                continue
            best = None
            for kind, conf, pat in c["rules"]:
                if conf == "추정" and is_seasoning:
                    continue
                if hit(kind, pat, t):
                    key = (KIND_RANK[kind], CONF_RANK[conf], -len(pat))
                    if best is None or key < best[0]:
                        best = (key, kind, conf, pat)
            if best:
                _, kind, conf, pat = best
                if is_flavor and cid not in FLAVOR_CRITERIA:
                    conf, kind = "추정", "향료표기·" + kind
                elif "또는" in t:
                    conf, kind = "추정", "또는표기·" + kind
                found.append((cid, conf, f"{kind}:{pat}"))
        cache[t] = found
        return found

    match.is_flavor = lambda t: bool(FLAVOR.search(t or "")) and "향신" not in (t or "")
    return match


def main():
    crit = load_criteria()
    match = make_matcher(crit)

    opaque = [(r["규칙"], p) for r in load(os.path.join(CUR, "opaque_terms.csv")) for p in parts(r["패턴"])]

    toks = [(r["token"], int(r["occurrences"])) for r in load(os.path.join(PREP, "ingredient_tokens.csv"))]

    # 오타·변형(소백분·찹살·마아가린)은 규칙에 직접 걸리지 않는다. LLM 분류(05)가 붙인
    # 표준명으로 한 번 더 본다. 검증되지 않은 정규화이므로 걸려도 '추정' 으로만 올린다.
    llm_std = {}
    p = os.path.join(PREP, "ingredient_classified.csv")
    if os.path.exists(p):
        for r in load(p):
            if r.get("category") not in ("실패", "미응답", "불명", "") and r.get("std_name"):
                llm_std[r["token"]] = r["std_name"].strip().lower()

    out, op_out, flavor_out = [], [], []
    per = defaultdict(lambda: {"직접": [0, 0], "추정": [0, 0]})
    for t, occ in toks:
        # 묶음 표기
        op = next((f"{k}:{p}" for k, p in opaque
                   if (t == p if k == "정확" else t.endswith(p) if k == "접미" else p in t)), "")
        if op:
            op_out.append({"토큰": t, "등장": occ, "규칙": op})
        # 기준 원재료
        if match.is_flavor(t):
            flavor_out.append({"토큰": t, "등장": occ})
        found = match(t)
        if not found and t in llm_std and llm_std[t] != t:
            found = [(cid, "추정", f"표준명경유({llm_std[t]})·{rule}")
                     for cid, _, rule in match(llm_std[t])]
        for cid, conf, rule in found:
            c = crit[cid]
            out.append({"기준ID": cid, "기준명": c["name"], "분류": c["group"],
                        "확신": conf, "토큰": t, "등장": occ,
                        "규칙": rule, "묶음표기": "Y" if op else ""})
            per[cid][conf][0] += 1
            per[cid][conf][1] += occ

    out.sort(key=lambda r: (r["기준ID"], r["확신"], -r["등장"]))
    F = ["기준ID", "기준명", "분류", "확신", "토큰", "등장", "규칙", "묶음표기"]
    with io.open(os.path.join(PREP, "criteria_tokens.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=F); w.writeheader(); w.writerows(out)
    op_out.sort(key=lambda r: -r["등장"])
    with io.open(os.path.join(PREP, "opaque_tokens.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["토큰", "등장", "규칙"]); w.writeheader(); w.writerows(op_out)

    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    total = sum(o for _, o in toks)
    print(f"토큰 {len(toks):,}종 · 등장 {total:,}")
    print(f"{'기준':<22}{'직접 종':>8}{'직접 등장':>11}{'추정 종':>8}{'추정 등장':>10}")
    for cid, c in crit.items():
        d, g = per[cid]["직접"], per[cid]["추정"]
        print(f"{c['name']:<22}{d[0]:>8,}{d[1]:>11,}{g[0]:>8,}{g[1]:>10,}")
    ot = sum(r["등장"] for r in op_out)
    print(f"\n묶음 표기 {len(op_out):,}종 · 등장 {ot:,} ({ot/total:.1%})")
    ft = sum(r["등장"] for r in flavor_out)
    print(f"향료 표기 {len(flavor_out):,}종 · 등장 {ft:,} — 기준에 걸리면 추정으로만 올림")
    with io.open(os.path.join(PREP, "flavor_tokens.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["토큰", "등장"]); w.writeheader()
        w.writerows(sorted(flavor_out, key=lambda r: -r["등장"]))


if __name__ == "__main__":
    main()
