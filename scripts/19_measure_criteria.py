#!/usr/bin/env python3
"""
기준 원재료 판정의 제품 단위 측정

각 기준에 대해 제품 168.7만 건을 세 갈래로 나눈다.
  발견        직접 대응 토큰이 있다
  확인 필요   직접은 없고 추정 대응 토큰이 있다
  확인 불가   둘 다 없고 묶음 표기(복합조미식품·향료 등)가 있다
  없음        셋 다 아니다

비교 기준선 — 완성된 단어만 보는 규칙(설탕·백설탕 / 밀가루 / 돼지고기 / 소고기·쇠고기 / 닭고기 …)
새 규칙이 기준선보다 얼마나 더 찾는지, 그 차이가 곧 "예전 방식이면 '없음' 으로 나갔을 제품" 이다.

입력  data/prepared/products.csv · criteria_tokens.csv · opaque_tokens.csv
출력  data/prepared/criteria_measure.csv
"""
import csv, io, os, re, sys
from collections import defaultdict

csv.field_size_limit(10**9)
PREP = "data/prepared"

BASELINE = {
    "sugar": {"설탕", "백설탕"}, "fructose": {"과당"}, "glucose": {"포도당"},
    "syrup": {"물엿"}, "wheat": {"밀가루"}, "rice": {"쌀"}, "corn": {"옥수수"},
    "starch": {"전분"}, "soy_oil": {"대두유", "콩기름"},
    "pork": {"돼지고기"}, "beef": {"소고기", "쇠고기"}, "chicken": {"닭고기"},
}

# 04_build_dictionary.py 와 같은 토큰화 — 두 곳이 어긋나면 측정이 틀린다
KEEP_NUM_BASE = ("폴리소르베이트",)


def strip_trailing_num(s):
    m = re.search(r"\d+(\.\d+)?%?$", s)
    if not m:
        return s
    num, head = m.group(0), s[:m.start()]
    if num.endswith("%") or "." in num:
        return head
    if head and re.match(r"[A-Za-z]", head[-1]):
        return s
    if head.endswith(KEEP_NUM_BASE):
        return s
    return head


def norm(s):
    s = (s or "").split("(")[0]
    s = re.sub(r"[\s·ㆍ・/\-‐‑–—_]", "", s)
    s = strip_trailing_num(s)
    s = s.replace(".", "")
    return s.strip().lower()


def split_top(s):
    out, depth, cur = [], 0, []
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append("".join(cur).strip()); cur = []
        else:
            cur.append(ch)
    if cur:
        out.append("".join(cur).strip())
    return [x for x in out if x]


def qualifiers(raw):
    """최상위 원재료마다 괄호 안 한정어를 돌려준다.
    공공DB 의 괄호는 하위 원료 목록이 아니라 '어떤 것인지' 를 밝힌다.
    가공유지(대두유) · 식용유지(옥배유) · 식용유지(유채유 또는 카놀라유)"""
    out = []
    for top in split_top(raw):
        for inner in re.findall(r"\(([^()]*)\)", top):
            for q in re.split(r"[,:]|또는", inner):
                q = norm(q)
                if q:
                    out.append((norm(top), q))
    return out


def main():
    import importlib.util
    spec = importlib.util.spec_from_file_location("crit", os.path.join("scripts", "18_build_criteria_map.py"))
    crit_mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(crit_mod)
    match = crit_mod.make_matcher()

    direct, guess, names = defaultdict(set), defaultdict(set), {}
    with io.open(os.path.join(PREP, "criteria_tokens.csv"), encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            (direct if r["확신"] == "직접" else guess)[r["기준ID"]].add(r["토큰"])
            names[r["기준ID"]] = r["기준명"]
    with io.open(os.path.join(PREP, "opaque_tokens.csv"), encoding="utf-8", newline="") as f:
        opaque = {r["토큰"] for r in csv.DictReader(f)}

    ids = list(names)
    cnt = {c: defaultdict(int) for c in ids}
    n = 0
    with io.open(os.path.join(PREP, "products.csv"), encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            n += 1
            toks = {norm(t) for t in split_top(row["rawmtrl_nm"])}
            toks.discard("")
            has_op = bool(toks & opaque)
            # 괄호 안 한정어로 찾은 것. 부모가 향료 표기면 추정으로만 본다
            qd, qg = set(), set()
            for parent, q in qualifiers(row["rawmtrl_nm"]):
                for cid, conf, _ in match(q):
                    if conf == "직접" and not match.is_flavor(parent):
                        qd.add(cid)
                    else:
                        qg.add(cid)
            for c in ids:
                d = bool(toks & direct[c]) or c in qd
                g = bool(toks & guess[c]) or c in qg
                if c in qd and not (toks & direct[c]):
                    cnt[c]["괄호 한정어로 발견"] += 1
                b = bool(toks & BASELINE.get(c, set()))
                if d:
                    cnt[c]["발견"] += 1
                elif g:
                    cnt[c]["확인 필요"] += 1
                elif has_op:
                    cnt[c]["확인 불가"] += 1
                else:
                    cnt[c]["없음"] += 1
                if c in BASELINE:
                    cnt[c]["기준선 발견"] += b
                    if d and not b:
                        cnt[c]["기준선이 놓친 발견"] += 1

    F = ["기준ID", "기준명", "발견", "확인 필요", "확인 불가", "없음", "기준선 발견", "기준선이 놓친 발견", "괄호 한정어로 발견"]
    with io.open(os.path.join(PREP, "criteria_measure.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f); w.writerow(F)
        for c in ids:
            w.writerow([c, names[c]] + [cnt[c][k] for k in F[2:]])

    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(f"제품 {n:,}")
    print(f"{'기준':<16}{'발견':>9}{'확인 필요':>10}{'확인 불가':>10}{'기준선':>9}{'기준선이 놓침':>12}{'괄호로 발견':>10}")
    for c in ids:
        x = cnt[c]
        bl = f"{x['기준선 발견']:,}" if c in BASELINE else "—"
        miss = f"{x['기준선이 놓친 발견']:,}" if c in BASELINE else "—"
        print(f"{names[c]:<16}{x['발견']:>9,}{x['확인 필요']:>10,}{x['확인 불가']:>10,}{bl:>9}{miss:>12}{x['괄호 한정어로 발견']:>10,}")


if __name__ == "__main__":
    main()
