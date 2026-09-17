#!/usr/bin/env python3
"""
K-FIND 가공식품 영양성분 DB → CSV (영양 레이어)

입력  data/raw/kfind/20260828_가공식품DB_316734건.xlsx  (압축 192MB / 전개 2.1GB)
출력  data/prepared/kfind_nutrients.csv

왜 필요한가
  원재료 표시 순서로는 함량을 알 수 없다. 2% 미만은 순서 예외가 있기 때문이다.
  그런데 영양성분표의 당류·나트륨은 제조사가 신고한 실제 수치다.
  특히 이 DB에는 당류가 자당·과당·포도당·유당·맥아당·알룰로오스·에리스리톨로
  쪼개져 있다. 우리가 근거를 모아온 성분들과 정확히 겹친다.

어떻게 붙는가
  품목제조보고번호(155번 칸)가 우리 제품 DB의 prdlst_report_no 와 같은 키다.

openpyxl 없이 표준 라이브러리만 쓴다. 2.1GB 를 통째로 올릴 수 없어 스트리밍한다.
"""
import csv, io, os, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
SRC = "data/raw/kfind/20260828_가공식품DB_316734건.xlsx"
DST = "data/prepared/kfind_nutrients.csv"

# (열 번호, 출력 이름) — 판정과 표시에 쓸 것만 고른다
COLS = [
    (155, "prdlst_report_no"), (0, "food_cd"), (1, "food_nm"), (156, "maker"),
    (16, "basis"), (153, "serving"), (154, "weight"),
    (17, "kcal"), (22, "carb_g"), (23, "sugar_g"), (29, "sodium_mg"),
    (39, "sat_fat_g"), (40, "trans_fat_g"), (24, "fiber_g"),
    # 당류 세부 — 성분 사전과 직접 연결되는 칸
    (70, "sucrose_g"), (64, "fructose_g"), (72, "glucose_g"), (69, "lactose_g"),
    (66, "maltose_g"), (63, "galactose_g"), (71, "tagatose_g"),
    (67, "allulose_g"), (68, "erythritol_g"), (65, "sugar_alcohol_g"),
    (165, "base_date"),
]


def col_index(ref):
    m = re.match(r"([A-Z]+)", ref or "")
    if not m:
        return None
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def main():
    z = zipfile.ZipFile(SRC)
    shared = []
    data = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
    for si in re.findall(r"<si>(.*?)</si>", data, re.S):
        shared.append("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)))
    del data
    print(f"공유 문자열 {len(shared):,}")

    def text(c):
        t = c.get("t")
        v = c.find(NS + "v")
        if t == "s" and v is not None:
            i = int(v.text)
            return shared[i] if i < len(shared) else ""
        if t == "inlineStr":
            is_ = c.find(NS + "is")
            return "".join(x.text or "" for x in is_.iter(NS + "t")) if is_ is not None else ""
        return (v.text or "") if v is not None else ""

    want = [c for c, _ in COLS]
    top = max(want)
    n = 0
    with io.open(DST, "w", encoding="utf-8", newline="") as fo:
        w = csv.writer(fo)
        w.writerow([name for _, name in COLS])
        with z.open("xl/worksheets/sheet1.xml") as f:
            for ev, el in ET.iterparse(f, events=("end",)):
                if el.tag != NS + "row":
                    continue
                cells = el.findall(NS + "c")
                if cells:
                    row = [""] * (top + 1)
                    for c in cells:
                        i = col_index(c.get("r"))
                        if i is not None and i <= top:
                            row[i] = text(c)
                    n += 1
                    if n > 1:                       # 1행은 머리글
                        # BOM·전각 공백이 섞여 있다
                        out = [row[c].strip().lstrip("\ufeff") for c in want]
                        w.writerow(out)
                el.clear()
                if n % 50000 == 0:
                    print(f"\r  {n:,}행", end="", flush=True)
    print(f"\r  {n - 1:,}행 → {DST} ({os.path.getsize(DST)/1048576:.1f} MB)")


if __name__ == "__main__":
    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
