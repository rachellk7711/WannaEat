#!/usr/bin/env python3
"""
사진 판독 오독 보정의 안전장치

사진에서 글자를 읽으면 자모 하나가 틀린다 — 옥배유→육배유(모음), 호라산→호란산(받침).
한 글자 차이로 판정이 뒤집히므로, 앱은 기준에 걸리지 않은 표기가 규칙 패턴과 자모 하나만 다르면
「가능성이 있어요」에 올린다(발견으로 단정하지 않는다).

그런데 패턴의 어떤 자리는 틀려도 정보가 없다. `꿀분말` 의 첫 자리는 `출분말`(추출분말)과 자모 하나 차이라
`○○추출분말` 이 모두 꿀이 된다. 공공DB 전체 표기로 패턴의 자리마다 몇 종이 걸리는지 세고,
많이 걸리는 자리는 보정에 쓰지 않는다. 걸리더라도 흔한 정상 표기는 예외로 둔다.

입력  data/curated/criteria_rules.csv · data/prepared/ingredient_tokens.csv
출력  data/prepared/typo_guard.json  {blocked: [[패턴, 자리]], exceptions: [표기]}
      앱의 판정 규칙 스냅샷에 함께 실린다(apps/wannaeat/scripts/sync-analysis-assets.py).
"""
import csv, importlib.util, io, json, os, sys
from collections import Counter

MAX_SPREAD = 3      # 한 자리에서 이보다 많은 표기가 걸리면 그 자리는 정보가 없다
COMMON = 50         # 이만큼 자주 나오는 정상 표기가 걸리면 예외로 둔다
# 흔한 표기인데 걸린 것 중 실제로는 기준과 무관한 것. 나머지(소꾸리살·도다리 등)는 규칙에 직접 넣었다.
NOT_A_TYPO = {"레드비트분말", "초코플레이크", "분말소스", "유자추출물", "애프리코트혼당"}


def jamo(ch):
    c = ord(ch) - 0xAC00
    return (c // 588, (c % 588) // 28, c % 28) if 0 <= c < 11172 else None


def near(a, b):
    ja, jb = jamo(a), jamo(b)
    return ja is not None and jb is not None and sum(x != y for x, y in zip(ja, jb)) == 1


def main():
    spec = importlib.util.spec_from_file_location("crit", os.path.join("scripts", "18_build_criteria_map.py"))
    crit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(crit)
    rules = crit.load_criteria()
    match = crit.make_matcher(rules)

    # 앱과 같은 패턴 — 직접 규칙의 포함·접두·정확 중 3글자 이상
    patterns = [(pat, cid) for cid, c in rules.items() for kind, conf, pat in c["rules"]
                if conf == "직접" and len(pat) >= 3 and kind in ("포함", "접두", "정확")]

    def hits(token):
        out = set()
        for pat, cid in patterns:
            p = len(pat)
            for i in range(len(token) - p + 1):
                diffs = [k for k in range(p) if token[i + k] != pat[k]]
                if len(diffs) == 1 and near(token[i + diffs[0]], pat[diffs[0]]):
                    if not any(x in token for x in rules[cid]["exclude"]):
                        out.add((cid, pat, diffs[0]))
                    break
        return out

    tokens = [(r["token"], int(r["occurrences"])) for r in csv.DictReader(io.open(
        os.path.join("data", "prepared", "ingredient_tokens.csv"), encoding="utf-8"))]
    spread, flagged = Counter(), []
    for t, o in tokens:
        if len(t) < 3 or match(t):
            continue
        h = hits(t)
        for _, pat, pos in h:
            spread[(pat, pos)] += 1
        if h:
            flagged.append((t, o, h))

    blocked = sorted([pat, pos] for (pat, pos), n in spread.items() if n > MAX_SPREAD)
    blocked_set = {tuple(b) for b in blocked}
    kept = [(t, o) for t, o, h in flagged if any((pat, pos) not in blocked_set for _, pat, pos in h)]
    common = sorted(t for t, o in kept if o >= COMMON)
    unexpected = [t for t in common if t not in NOT_A_TYPO]
    exceptions = sorted(NOT_A_TYPO)

    out = {"blocked": blocked, "exceptions": exceptions}
    p = os.path.join("data", "prepared", "typo_guard.json")
    with io.open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    total = sum(o for _, o in tokens)
    occ = sum(o for t, o in kept if t not in NOT_A_TYPO)
    print(f"{p} · 막는 자리 {len(blocked)} · 예외 {len(exceptions)} · {os.path.getsize(p):,} bytes")
    print(f"공공DB 표기 중 보정 후보 {len(kept):,}종 · 등장 {occ:,}회 ({occ / total:.3%})")
    if unexpected:
        print("!! 흔한 표기인데 예외에도 규칙에도 없는 것 — 규칙에 넣거나 NOT_A_TYPO 에 더할 것:", unexpected)


if __name__ == "__main__":
    main()
