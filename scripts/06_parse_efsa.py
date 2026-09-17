#!/usr/bin/env python3
"""
EFSA OpenFoodTox 엑셀 → CSV 추출 (근거 DB C층 기초)

입력  data/raw/efsa/OFT3.0 export repository.xlsx   (22.6MB)
출력  data/prepared/efsa_substances.csv    물질명·CAS·IUPAC  (REF_SUB)
      data/prepared/efsa_toxref.csv        기준값(ADI 등)     (FLEX_SUM.ToxRefValues)

openpyxl 없이 표준 라이브러리만 쓴다 (xlsx = zip + xml).
"""
import csv, io, os, re, zipfile
import xml.etree.ElementTree as ET

SRC = "data/raw/efsa/OFT3.0 export repository.xlsx"
OUT = "data/prepared"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
WANT = {
    "REF_SUB": ("efsa_substances.csv", None),          # 물질 기준정보 (이름·CAS)
    "SUB": ("efsa_sub.csv", None),                     # 물질 → 기준정보 연결
    "DOSSIER": ("efsa_dossier.csv", None),             # 평가서 → 물질 연결
    "FLEX_SUM.ToxRefValues": ("efsa_toxref.csv", None),  # ADI 등 기준값
    # 문서 → 평가서 연결. ADI 행에는 평가서 참조 칸이 없어서 이 표로 거슬러 올라가야 한다
    "DOSSIER_DOCS": ("efsa_dossier_docs.csv", None),
}


def col_index(ref):
    """A1 → 0, AB12 → 27"""
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
    if "xl/sharedStrings.xml" in z.namelist():
        data = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
        for si in re.findall(r"<si>(.*?)</si>", data, re.S):
            shared.append("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)))
        print(f"공유 문자열 {len(shared):,}개")

    wb = z.read("xl/workbook.xml").decode("utf-8")
    sheets = re.findall(r'<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"', wb)
    rels = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"',
                           z.read("xl/_rels/workbook.xml.rels").decode("utf-8")))

    def text(c):
        t = c.get("t")
        v = c.find(f"{NS}v")
        if t == "s" and v is not None:
            i = int(v.text)
            return shared[i] if i < len(shared) else ""
        if t == "inlineStr":
            is_ = c.find(f"{NS}is")
            return "".join(x.text or "" for x in is_.iter(f"{NS}t")) if is_ is not None else ""
        return (v.text or "") if v is not None else ""

    for name, rid in sheets:
        if name not in WANT:
            continue
        out_name, _ = WANT[name]
        path = "xl/" + rels[rid].lstrip("/").replace("xl/", "")
        dst = os.path.join(OUT, out_name)
        n = ncol = 0
        with io.open(dst, "w", encoding="utf-8", newline="") as fo:
            w = csv.writer(fo)
            with z.open(path) as f:
                for ev, el in ET.iterparse(f, events=("end",)):
                    if el.tag != f"{NS}row":
                        continue
                    cells = el.findall(f"{NS}c")
                    if not cells:
                        el.clear(); continue
                    # 빈 칸이 생략돼 있으므로 열 위치를 복원한다
                    width = max((col_index(c.get("r")) or 0) for c in cells) + 1
                    row = [""] * max(width, ncol)
                    for c in cells:
                        i = col_index(c.get("r"))
                        if i is not None and i < len(row):
                            row[i] = text(c)
                    if n == 0:
                        ncol = len(row)
                    w.writerow(row); n += 1
                    el.clear()
        print(f"  {name:<28} {n:>8,}행 · {ncol}열 → {dst} "
              f"({os.path.getsize(dst)/1048576:.1f} MB)")


if __name__ == "__main__":
    main()
