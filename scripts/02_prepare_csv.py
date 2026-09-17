#!/usr/bin/env python3
"""
data/raw/*.csv (식품안전나라 원본) → data/prepared/products.csv (Supabase COPY 대상)

하는 일:
  - C002 + C006 + C003 를 products 스키마로 통합
  - BOM 제거, 날짜 YYYYMMDD → YYYY-MM-DD, 빈 문자열 → NULL
  - source 컬럼 부여 (F/L/H)
  - C003 부가정보는 별도 파일로

중복 처리 (사용자 결정 2026-09-14):
  같은 품목번호가 여러 번 나올 때,
    - 내용이 완전히 같으면  → 하나만 남긴다
    - 내용이 다르면        → 그 품목번호는 **전부 폐기**한다
  부정확한 정보를 보여주느니 "정보 없음"이 낫다는 판단이다.
  폐기 목록은 _conflicts.csv 로 남겨 원인을 추적한다.

바코드(C005)는 적재하지 않는다 — MVP에 바코드 입력이 없고,
2018년 이후 갱신이 중단됐으며, 바코드 13,740개가 서로 다른 제품에 연결돼 있다.

실행: python scripts/02_prepare_csv.py  (2패스: 충돌 탐지 → 기록)
"""
import csv, io, os, sys

RAW = "data/raw"
OUT = "data/prepared"
os.makedirs(OUT, exist_ok=True)

def d(s):
    """YYYYMMDD → YYYY-MM-DD, 그 외 → 빈칸"""
    s = (s or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return ""

def load(fn):
    f = io.open(os.path.join(RAW, fn), encoding="utf-8-sig", newline="")
    r = csv.reader(f)
    hdr = next(r)
    idx = {c: i for i, c in enumerate(hdr)}
    for row in r:
        if len(row) < len(hdr):
            row += [""] * (len(hdr) - len(row))
        yield idx, row
    f.close()

# ── 1패스: 충돌 품목번호 찾기 ────────────────────────────
# 같은 품목번호인데 제품명·원재료·순서가 다르면 → 그 품목번호 전체를 폐기 대상으로
SRCS = [("C002.csv", "F"), ("C006.csv", "L"), ("C003.csv", "H")]

def content_key(row, idx):
    return (row[idx["PRDLST_NM"]],
            row[idx["RAWMTRL_NM"]],
            row[idx["RAWMTRL_ORDNO"]] if "RAWMTRL_ORDNO" in idx else "")

first_seen = {}     # rno → content_key
conflicts = {}      # rno → [서로 다른 content_key ...]

for fn, src in SRCS:
    for idx, row in load(fn):
        rno = row[idx["PRDLST_REPORT_NO"]]
        if not rno or not row[idx["PRDLST_NM"]] or not row[idx["RAWMTRL_NM"]]:
            continue
        key = content_key(row, idx)
        if rno not in first_seen:
            first_seen[rno] = key
        elif first_seen[rno] != key:
            conflicts.setdefault(rno, [first_seen[rno]]).append(key)

# 충돌 목록 기록 (원인 추적용)
cf = io.open(os.path.join(OUT, "_conflicts.csv"), "w", encoding="utf-8", newline="")
cw = csv.writer(cf)
cw.writerow(["prdlst_report_no", "prdlst_nm", "rawmtrl_nm", "rawmtrl_ordno"])
for rno, keys in conflicts.items():
    for k in keys:
        cw.writerow([rno, *k])
cf.close()

# ── 2패스: products ─────────────────────────────────────
PCOLS = ["prdlst_report_no","source","prdlst_nm","bssh_nm","prdlst_dcnm",
         "rawmtrl_nm","rawmtrl_ordno","xport_yn","prms_dt","chng_dt"]
pf = io.open(os.path.join(OUT, "products.csv"), "w", encoding="utf-8", newline="")
pw = csv.writer(pf)
pw.writerow(PCOLS)

seen = set()
counts = {"F":0, "L":0, "H":0, "dup":0, "conflict":0, "missing":0}

def emit(rno, src, nm, bssh, dcnm, raw, ordno, xport, prms, chng):
    if not rno or not nm or not raw:
        counts["missing"] += 1
        return
    if rno in conflicts:               # 내용이 엇갈리는 품목번호는 통째로 제외
        counts["conflict"] += 1
        return
    if rno in seen:                    # 완전히 같은 중복 → 하나만
        counts["dup"] += 1
        return
    seen.add(rno)
    counts[src] += 1
    pw.writerow([rno, src, nm, bssh, dcnm, raw, ordno,
                 xport or "", d(prms), d(chng)])

# C002 (식품)
for idx, row in load("C002.csv"):
    emit(row[idx["PRDLST_REPORT_NO"]], "F",
         row[idx["PRDLST_NM"]], row[idx["BSSH_NM"]], row[idx["PRDLST_DCNM"]],
         row[idx["RAWMTRL_NM"]], row[idx["RAWMTRL_ORDNO"]],
         row[idx["ETQTY_XPORT_PRDLST_YN"]],
         row[idx["PRMS_DT"]], row[idx["CHNG_DT"]])

# C006 (축산물) - xport 컬럼 없음
for idx, row in load("C006.csv"):
    emit(row[idx["PRDLST_REPORT_NO"]], "L",
         row[idx["PRDLST_NM"]], row[idx["BSSH_NM"]], row[idx["PRDLST_DCNM"]],
         row[idx["RAWMTRL_NM"]], row[idx["RAWMTRL_ORDNO"]],
         "", row[idx["PRMS_DT"]], row[idx["CHNG_DT"]])

# C003 (건기식) - ORDNO 없음, DCNM 없음, CHNG_DT 대신 LAST_UPDT_DTM
hf = io.open(os.path.join(OUT, "product_health_ext.csv"), "w", encoding="utf-8", newline="")
hw = csv.writer(hf)
hw.writerow(["prdlst_report_no","primary_fnclty","ntk_mthd","prdt_shap"])
for idx, row in load("C003.csv"):
    rno = row[idx["PRDLST_REPORT_NO"]]
    emit(rno, "H",
         row[idx["PRDLST_NM"]], row[idx["BSSH_NM"]], "",
         row[idx["RAWMTRL_NM"]], "",
         "", row[idx["PRMS_DT"]], row[idx["LAST_UPDT_DTM"]])
    if rno in seen:
        hw.writerow([rno,
                     row[idx["PRIMARY_FNCLTY"]][:500],
                     row[idx["NTK_MTHD"]][:300],
                     row[idx["PRDT_SHAP_CD_NM"]]])
hf.close()
pf.close()

print("=== 변환 완료 ===")
print(f"  products.csv")
print(f"    F 식품(C002)    {counts['F']:>9,}")
print(f"    L 축산물(C006)  {counts['L']:>9,}")
print(f"    H 건기식(C003)  {counts['H']:>9,}")
print(f"    합계            {counts['F']+counts['L']+counts['H']:>9,}")
print(f"    ─ 제외 ─")
print(f"    필수값 부족      {counts['missing']:>9,}")
print(f"    동일 중복        {counts['dup']:>9,}")
print(f"    내용 충돌 폐기   {counts['conflict']:>9,}  (품목번호 {len(conflicts):,}종 → _conflicts.csv)")
print()
for fn in ["products.csv","product_health_ext.csv","_conflicts.csv"]:
    p = os.path.join(OUT, fn)
    print(f"  {fn:28s} {os.path.getsize(p)/1048576:8.1f} MB")
