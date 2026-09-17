#!/usr/bin/env python3
"""
기준 원재료 대응 검수 시트

기준마다 직접 상위 30 · 추정(등장 100회 이상) 상위 40 을 뽑는다.
이미 적힌 판정·메모는 (기준, 토큰) 이 같으면 옮겨 적는다 — 다시 만들어도 검수한 내용이 사라지지 않는다.

입력  data/prepared/criteria_tokens.csv · (있으면) data/review/검수_기준원재료.csv
출력  data/review/검수_기준원재료.csv  (Excel 에서 바로 열리도록 utf-8-sig)
"""
import csv, io, os
from collections import defaultdict

SRC = "data/prepared/criteria_tokens.csv"
OUT = "data/review/검수_기준원재료.csv"
JUDGE = "판정(맞음/틀림/추정으로/직접으로)"
TOP_DIRECT, TOP_GUESS, GUESS_MIN = 30, 40, 100


def main():
    kept = {}
    if os.path.exists(OUT):
        with io.open(OUT, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                if r.get(JUDGE) or r.get("메모"):
                    kept[(r["기준"], r["토큰"])] = (r.get(JUDGE, ""), r.get("메모", ""))

    by = defaultdict(list)
    with io.open(SRC, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            by[(r["기준명"], r["확신"])].append(r)

    rows, names = [], list(dict.fromkeys(k[0] for k in by))
    for name in names:
        d = sorted(by[(name, "직접")], key=lambda r: -int(r["등장"]))[:TOP_DIRECT]
        g = [r for r in by[(name, "추정")] if int(r["등장"]) >= GUESS_MIN]
        g = sorted(g, key=lambda r: -int(r["등장"]))[:TOP_GUESS]
        for r in d + g:
            j, m = kept.pop((name, r["토큰"]), ("", ""))
            rows.append([name, r["확신"], r["토큰"], r["등장"], r["규칙"], j, m])

    with io.open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["기준", "확신", "토큰", "등장", "규칙", JUDGE, "메모"])
        w.writerows(rows)
    print(f"{OUT} · {len(rows)}행 · 기준 {len(names)}개 · 옮겨 적은 판정 {sum(1 for r in rows if r[5] or r[6])}"
          + (f" · 목록에서 빠진 판정 {len(kept)}" if kept else ""))


if __name__ == "__main__":
    main()
