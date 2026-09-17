#!/usr/bin/env python3
"""
감미료 10종 근거 조회 — EFSA ADI + 국내 지정 여부

부분 일치는 쓰지 않는다. '자당' 이 'Sucrose esters of fatty acids' 에
걸리는 사고가 실제로 났다. 이름이 비슷하면 기계는 구분하지 못한다.
영문 별칭은 손으로 붙이고, 매칭은 정확 일치만 인정한다.

결과는 세 가지로 구분해서 기록한다. 셋은 뜻이 전혀 다르다.
  ADI 있음        기관이 섭취허용량을 수치로 정했다
  ADI 미설정      물질은 평가됐으나 수치를 두지 않았다 (당알콜이 대개 이렇다)
  평가 없음       EFSA 자료에 물질 자체가 없다 (미승인·심사중일 수 있다)

출력: data/prepared/sweetener_evidence.csv
"""
import csv, io, os, re, sys

csv.field_size_limit(10**9)
PREP, RAW, CUR = "data/prepared", "data/raw", "data/curated"

# 한글 표준명 → (EFSA 물질명 정확 표기 후보, 국내 첨가물공전 품목명 후보)
# EFSA 표기는 efsa_substances.csv 에서, 국내 표기는 I0950 품목명에서
# 눈으로 확인한 문자열만 넣는다. 공전은 'D-소비톨' 처럼 라벨과 다르게 쓴다.
SWEETENERS = [
    ("알룰로오스",      [],                                              []),
    ("에리스리톨",      ["Erythritol"],                                  ["에리스리톨"]),
    ("자일리톨",        ["Xylitol"],                                     ["자일리톨"]),
    ("말티톨",          ["Maltitols", "Maltitol", "Maltitol syrup"],     ["D-말티톨", "말티톨액"]),
    ("소르비톨",        ["Sorbitol", "D-Sorbitol"],                      ["D-소비톨", "D-소비톨액"]),
    ("스테비올배당체",  ["Steviol Glycosides", "Steviol glycosides"],    ["스테비올배당체"]),
    ("수크랄로스",      ["Sucralose"],                                   ["수크랄로스"]),
    ("아스파탐",        ["Aspartame"],                                   ["아스파탐"]),
    ("아세설팜칼륨",    ["Acesulfame K", "Acesulfame potassium"],        ["아세설팜칼륨"]),
    ("폴리글리시톨시럽", ["Polyglycitol Syrup"],                          ["폴리글리시톨액"]),
    # 국내 지정 감미료 중 위 10종에 빠져 있던 것
    ("락티톨",          ["Lactitol"],                                    ["락티톨"]),
    ("만니톨",          ["Mannitol", "D-Mannitol"],                      ["만니톨"]),
    ("사카린나트륨",    ["Saccharin", "Sodium saccharin"],               ["사카린나트륨"]),
    ("네오탐",          ["Neotame"],                                     ["네오탐"]),
    ("토마틴",          ["Thaumatin"],                                   ["토마틴"]),
    # 참고 — 저탄고지에서 함께 확인되는 당류 (첨가물이 아니라 식품원료다)
    ("자당(설탕)",      ["Sucrose"],                                     []),
    ("과당",            ["Fructose", "D-Fructose"],                      []),
    ("포도당",          ["Glucose", "D-Glucose", "Dextrose"],            []),
]


def norm_en(s):
    return re.sub(r"[\s\-_,.]", "", (s or "").strip().lower())


def norm_kr(s):
    return re.sub(r"[\s\-_,.()]", "", (s or "").strip())


# ── 1. EFSA: 물질 목록과 ADI 를 따로 읽는다 ──────────────
#    물질이 있는데 ADI 가 없는 경우를 구분하려면 둘을 분리해야 한다
efsa_subs = set()
with io.open(os.path.join(PREP, "efsa_substances.csv"), encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        for c in ("ReferenceSubstanceName", "CAS name"):
            v = (r.get(c) or "").strip()
            if v:
                efsa_subs.add(norm_en(v))

adi = {}
with io.open(os.path.join(PREP, "efsa_adi.csv"), encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        if r["substance"]:
            adi.setdefault(norm_en(r["substance"]), []).append(r)

# 수치가 없을 때의 결론 문장 — '필요 없음' 과 '자료 부족' 은 정반대다
rem = {}
p = os.path.join(PREP, "efsa_remarks.csv")
if os.path.exists(p):
    with io.open(p, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if (r.get("population") or "") == "consumers":   # 사람 대상만
                rem.setdefault(norm_en(r["substance"]), r)

# ── 2. 국내 식품첨가물공전 지정 품목 ────────────────────
kadd = {}
with io.open(os.path.join(RAW, "I0950_additive_std.csv"), encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        n = (r.get("PC_KOR_NM") or "").strip()
        if n:
            kadd.setdefault(norm_kr(n), n)

# ── 2a-2. 국내 사용기준 — I1020 의 USE_CND_STDR_CN ──────
#  '어떤 식품에 얼마까지' 가 여기 있다. I0950(성분규격)에는 없다.
#  24,877행 중 11,950행(48%)에 기재돼 있다. 빈칸은 '제한 없음'이 아니라 '확인 안 됨'이다.
#  사용 상태(사용가능/사용불가/제한적사용)는 USE_CND_NM 에 따로 있다.
#  같은 이름이 여러 분류에 있다 — '포도당' 은 위생용품에도 있다.
#  먹는 것에 대한 기준을 먼저 본다.
PRIO = ["식품첨가물(B코드)", "식품원료(A코드)", "복합원료(U코드)",
        "건강기능식품(C코드)", "식품유형"]


def prio(r):
    c = (r.get("LCLAS_NM") or "").strip()
    return PRIO.index(c) if c in PRIO else len(PRIO)


kuse = {}
with io.open(os.path.join(RAW, "I1020_rawmtrl_info.csv"), encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        names = [r.get("RPRSNT_RAWMTRL_NM") or ""]
        names += re.split(r"[,;/]", r.get("RAWMTRL_NCKNM") or "")
        for n in names:
            n = norm_kr(n)
            if n and (n not in kuse or prio(r) < prio(kuse[n])):
                kuse[n] = r

# ── 2b. 사람이 원문을 읽고 확정한 값 ────────────────────
#  자동 추출이 닿지 않는 자리다. EFSA OpenFoodTox 에 없는 옛 JECFA 평가가 여기 있다.
#  자동 결과보다 우선한다 — 사람이 1차 출처를 직접 본 값이기 때문이다.
manual = {}
p = os.path.join(CUR, "evidence_manual.csv")   # sweetener_manual.csv 는 여기로 통합됐다
if os.path.exists(p):
    with io.open(p, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            manual[r["성분"].strip()] = r

# ── 3. 대조 ─────────────────────────────────────────────
out = []
for kor, en_names, kr_names in SWEETENERS:
    # EFSA
    hit_adi = None
    hit_sub = ""
    for e in en_names:
        ne = norm_en(e)
        if ne in adi and not hit_adi:
            hit_adi = (e, adi[ne][0])
        if ne in efsa_subs and not hit_sub:
            hit_sub = e
    year = title = link = concl = ""
    if hit_adi:
        e, _ = hit_adi
        # 원 기록이 여러 개다. 최신 평가서 · 식품 분야 · 일반 소비자 대상 행을 대표로 쓴다
        food = lambda x: any(d.strip() in ("food additives", "nutrient sources", "flavourings", "novel foods")
                             for d in (x.get("domain") or "").split("|"))
        r = max(adi[norm_en(e)], key=lambda x: (food(x), x.get("latest") == "Y",
                                                 x.get("population") == "consumers", x.get("eval_date") or ""))
        efsa_state, efsa_sub = "수치 있음", r["substance"]
        adi_val, adi_unit, pop = r["adi_low"], r["unit"], r["population"]
        year, title, link = r.get("eval_year", ""), r.get("source_title", ""), r.get("source_link", "")
    elif hit_sub:
        efsa_sub = hit_sub
        adi_val = adi_unit = pop = ""
        r = rem.get(norm_en(hit_sub)) or {}
        # 결론 문장을 읽어 갈래를 나눈다. 읽히지 않으면 사람이 확인해야 한다.
        c = (r.get("conclusion") or "").lower()
        d = (r.get("descriptor") or "").lower()
        if "unnecessary" in c or "not necessary" in c or "no concern" in c:
            efsa_state = "수치 불필요"
        elif "insufficient" in c or "incomplete" in d:
            efsa_state = "자료 부족"
        elif c:
            efsa_state = "결론 문장 있음"
        else:
            efsa_state = "확인 필요"
        year = r.get("eval_year", ""); title = r.get("source_title", "")
        link = r.get("source_link", ""); concl = r.get("conclusion", "")
    else:
        efsa_state, efsa_sub = "평가 없음", ""
        adi_val = adi_unit = pop = ""

    m = manual.get(kor)
    if m:
        efsa_state = m["상태"]
        adi_val, adi_unit = m["값"], m["단위"]
        concl = m["결론 문구"]
        year, title = m["평가연도"], m["기관"]
        link = m["출처"]
        src = f'{m["기관"]} (사람 확인 {m["확인일"]})'
    else:
        src = "EFSA OpenFoodTox (자동)"

    # 국내 — 공전 지정 여부(I0950)와 사용기준(I1020)
    k = next((kadd[norm_kr(n)] for n in kr_names if norm_kr(n) in kadd), "")
    kr_state = "지정 첨가물" if k else ("식품원료" if not kr_names else "미지정")

    u = next((kuse[norm_kr(n)] for n in [kor] + kr_names if norm_kr(n) in kuse), None)
    kr_cls = (u.get("LCLAS_NM") or "").strip() if u else ""
    kr_use = (u.get("USE_CND_STDR_CN") or "").strip() if u else ""
    kr_status = (u.get("USE_CND_NM") or "").strip() if u else ""
    if u and not kr_use:
        kr_use = "조건 정보 미확인"
    if kr_status:
        kr_use = f"[{kr_status}] {kr_use}"

    out.append([kor, efsa_state, efsa_sub, adi_val, adi_unit, pop,
                concl, year, title, link, src, kr_state, k, kr_cls, kr_use])

with io.open(os.path.join(PREP, "sweetener_evidence.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["성분", "상태", "EFSA 물질명", "값", "단위", "대상", "결론 문구",
                "평가연도", "기관·문서", "링크", "확보 경로", "국내 상태", "공전 품목명",
                "국내 분류", "국내 사용기준"])
    w.writerows(out)

enc = sys.stdout.encoding or ""
if enc.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

print(f"{'성분':<16}{'상태':<10}{'값':<7}{'연도':<7}{'국내':<12}{'확보 경로'}")
print("-" * 86)
for r in out:
    print(f"{r[0]:<16}{r[1]:<10}{r[3] or '—':<7}{r[7] or '':<7}{r[11]:<12}{r[10]}")

# 확정은 '사람이 1차 출처를 본 것' 만이다. 자동 추출값은 아직 후보다.
done = [r[0] for r in out if r[0] in manual]
auto = [r[0] for r in out if r[0] not in manual and r[1] not in ("확인 필요", "평가 없음")]
gap = [r[0] for r in out
       if r[0] not in manual and r[1] in ("확인 필요", "평가 없음")]
print(f"\n확정(사람 확인) {len(done)}/{len(out)}종")
if auto:
    print(f"  검증 대기(자동 추출 후보) {len(auto)}종: {', '.join(auto)}")
if gap:
    print(f"  근거 없음 {len(gap)}종: {', '.join(gap)}")
