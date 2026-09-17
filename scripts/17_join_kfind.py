#!/usr/bin/env python3
"""
K-FIND 영양성분 ↔ 우리 제품 DB 결합표

왜 따로 만드나
  K-FIND 의 품목제조보고번호 칸에 `2009026203637/2009026203638` 처럼
  번호 여러 개가 `/` 로 묶인 행이 1,568개 있다. 통째로 비교하면 어느 제품에도 붙지 않는다.
  번호별로 풀어서 잇는다.

  반대로 한 보고번호에 K-FIND 행이 여러 개인 경우도 있다(용량·맛이 다른 제품).
  하나를 골라 버리지 않고 모두 남기고 개수를 적는다.

입력  data/prepared/kfind_nutrients.csv, data/prepared/products.csv
출력  data/prepared/kfind_by_report.csv   보고번호 1개 = 행 1개 (K-FIND 행이 여럿이면 여러 행)
"""
import csv, io, os, sys
from collections import Counter

csv.field_size_limit(10**9)
PREP = "data/prepared"


def main():
    with io.open(os.path.join(PREP, "kfind_nutrients.csv"), encoding="utf-8", newline="") as f:
        rd = csv.DictReader(f)
        fields = rd.fieldnames
        rows = list(rd)

    out = []
    multi_raw = 0
    for r in rows:
        raw = (r["prdlst_report_no"] or "").strip()
        parts = [p.strip() for p in raw.split("/") if p.strip()]
        if len(parts) > 1:
            multi_raw += 1
        for p in parts:
            x = dict(r)
            x["prdlst_report_no"] = p
            x["report_no_raw"] = raw
            x["report_no_split"] = len(parts)
            out.append(x)

    per_no = Counter(x["prdlst_report_no"] for x in out)
    for x in out:
        x["kfind_rows_for_no"] = per_no[x["prdlst_report_no"]]

    products = set()
    with io.open(os.path.join(PREP, "products.csv"), encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            products.add(r["prdlst_report_no"].strip())
    for x in out:
        x["in_products"] = "Y" if x["prdlst_report_no"] in products else ""

    F = fields + ["report_no_raw", "report_no_split", "kfind_rows_for_no", "in_products"]
    dst = os.path.join(PREP, "kfind_by_report.csv")
    with io.open(dst, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=F)
        w.writeheader(); w.writerows(out)

    whole = {(r["prdlst_report_no"] or "").strip() for r in rows}
    joined_before = len(products & whole)
    joined_after = len(products & set(per_no))
    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(f"K-FIND {len(rows):,}행 · 번호가 묶인 행 {multi_raw:,} → 풀어서 {len(out):,}행 → {dst}")
    print(f"고유 보고번호 {len(per_no):,} · 한 번호에 K-FIND 행이 여러 개 {sum(1 for v in per_no.values() if v > 1):,}")
    print(f"제품 결합: 통째 비교 {joined_before:,} → 번호별 {joined_after:,} "
          f"(+{joined_after - joined_before:,}) / 제품 {len(products):,} = {joined_after/len(products):.1%}")


if __name__ == "__main__":
    main()
