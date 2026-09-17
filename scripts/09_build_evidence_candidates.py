#!/usr/bin/env python3
"""
근거 카드 후보 일괄 생성 — C층 전체

감미료 15종을 손으로 확인하며 알아낸 방식을 전 성분에 적용한다.
자동으로 할 수 있는 데까지 하고, 사람이 볼 목록을 빈도순으로 내놓는다.

  등장 빈도   우리 제품 DB (169만 건)에서 몇 번 쓰였나
  국내 기준   I1020 USE_CND_STDR_CN — 어떤 식품에 얼마까지
  지정 여부   I0950 식품첨가물공전 664품목
  영문명      I1020 / I2520 ENG_NM — EFSA 로 건너가는 다리
  국제 기준   EFSA ADI, 또는 수치가 없을 때의 결론 문장

매칭은 정확 일치만 인정한다. 부분 일치는 '자당' 에 '자당지방산에스테르' 를 붙인다.

출력: data/prepared/evidence_candidates.csv
"""
import csv, io, os, re, sys

csv.field_size_limit(10**9)
PREP, RAW = "data/prepared", "data/raw"
MIN_OCC = 50          # 이보다 드물면 카드를 만들 이유가 없다


def norm_kr(s):
    return re.sub(r"[\s\-_,.()·ㆍ・/]", "", (s or "").strip())


def norm_en(s):
    return re.sub(r"[\s\-_,.()]", "", (s or "").strip().lower())


def load(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


# ── 1. 국내 — 분류·사용기준·영문명 ──────────────────────
PRIO = ["식품첨가물(B코드)", "식품원료(A코드)", "복합원료(U코드)",
        "건강기능식품(C코드)", "식품유형"]


def prio(r):
    c = (r.get("LCLAS_NM") or "").strip()
    return PRIO.index(c) if c in PRIO else len(PRIO)


kr = {}
kr_all = {}   # 같은 이름의 레코드 전부 — 사용상태가 서로 다른 경우가 245개 있다
for r in load(os.path.join(RAW, "I1020_rawmtrl_info.csv")):
    names = [r.get("RPRSNT_RAWMTRL_NM") or ""]
    names += re.split(r"[,;/]", r.get("RAWMTRL_NCKNM") or "")
    for n in names:
        n = norm_kr(n)
        if not n:
            continue
        kr_all.setdefault(n, []).append(r)
        if n not in kr or prio(r) < prio(kr[n]):
            kr[n] = r


def status_candidates(n):
    """먹는 것 분류의 (분류|상태) 조합을 전부 돌려준다.
    쌀은 식품원료 안에 '사용가능'과 '사용불가'가 함께 있다(부위가 다르다).
    하나를 골라 확정하지 않고 사람이 보도록 남긴다."""
    seen = []
    for r in kr_all.get(n, []):
        if prio(r) >= len(PRIO):          # 위생용품·기구는 먹는 것이 아니다
            continue
        c = f'{(r.get("LCLAS_NM") or "").strip()}|{(r.get("USE_CND_NM") or "").strip()}'
        if c not in seen:
            seen.append(c)
    return seen

# 영문명 보강 — I2520 에만 있는 것이 있다
eng_extra = {}
for r in load(os.path.join(RAW, "I2520_rawmtrl_code.csv")):
    n = norm_kr(r.get("RPRSNT_RAWMTRL_NM") or "")
    e = (r.get("ENG_NM") or "").strip()
    if n and e and n not in eng_extra:
        eng_extra[n] = e

# 공전 지정 품목
kadd = set()
for r in load(os.path.join(RAW, "I0950_additive_std.csv")):
    n = norm_kr(r.get("PC_KOR_NM") or "")
    if n:
        kadd.add(n)

print(f"국내 표제어 {len(kr):,} · 영문명 보강 {len(eng_extra):,} · 공전 {len(kadd):,}품목")

# ── 2. EFSA — 수치와 결론 문장 ──────────────────────────
# EFSA 자료에는 사료·농약·살생물제 평가가 함께 들어 있다.
# ADI 804건 중 564건이 농약이다. 식품 근거로 쓸 수 있는 분야만 남긴다.
FOOD_DOMAIN = {"food additives", "nutrient sources", "flavourings", "novel foods"}


def is_food(r):
    return any(x.strip().lower() in FOOD_DOMAIN for x in (r.get("domain") or "").split("|"))


def pick_rank(r):
    """여러 원 기록 중 카드에 쓸 대표 행: 최신 평가서 > 일반 소비자 대상 > 평가일."""
    return (r.get("latest") == "Y", r.get("population") == "consumers", r.get("eval_date") or "")


adi = {}
adi_all = {}   # 대표로 뽑히지 않은 원 기록도 개수로 남긴다
for r in load(os.path.join(PREP, "efsa_adi.csv")):
    if not is_food(r):
        continue
    k = norm_en(r["substance"])
    if not k:
        continue
    adi_all[k] = adi_all.get(k, 0) + 1
    if k not in adi or pick_rank(r) > pick_rank(adi[k]):
        adi[k] = r

# 한 물질에 결론 행이 여러 개다. 아무거나 집으면 안 된다 — 잔탄검은 첫 행이
# '생산균주 정보가 불완전하다' 는 다른 얘기였고, ADI 결론은 두 번째 행에 있었다.
# ADI 를 직접 언급한 문장을 고른다.
def rem_state(r):
    """결론 문장을 읽어 상태를 정한다. 판정 기준을 한 곳에만 둔다."""
    c = (r.get("conclusion") or "").lower()
    d = (r.get("descriptor") or "").lower()
    if ("no need for a numerical" in c or "considered unnecessary" in c
            or "not necessary" in c):
        return "수치 불필요"
    if "insufficient" in c or "incomplete" in d:
        return "자료 부족"
    if "no concern" in c or "low concern" in c:
        return "우려 없음"
    return "결론 문장 있음"


ORDER = ["수치 불필요", "자료 부족", "우려 없음", "결론 문장 있음"]


def rem_rank(r):
    return ORDER.index(rem_state(r))


rem = {}
for r in load(os.path.join(PREP, "efsa_remarks.csv")):
    if (r.get("population") or "") != "consumers":     # 사람 대상만
        continue
    if not is_food(r):                                 # 식품 분야만
        continue
    k = norm_en(r["substance"])
    if k and (k not in rem or (rem_rank(r), not r.get("latest")) < (rem_rank(rem[k]), not rem[k].get("latest"))):
        rem[k] = r

print(f"EFSA ADI {len(adi):,}종 · 결론 문장 {len(rem):,}종")


def efsa_lookup(eng_field):
    """영문명 한 칸에 이명이 여러 개 들어 있다. 정확 일치만 본다."""
    for part in re.split(r"[,;/]", eng_field or ""):
        k = norm_en(part)
        if not k:
            continue
        if k in adi:
            r = adi[k]
            return (("향료 평가(수치 있음)" if flavour_only(r) else "수치 있음"),
                    r["substance"], r["adi_low"], r["unit"],
                    r.get("eval_year", ""), r.get("source_link", ""),
                    r.get("basis", ""), efsa_ctx(r, adi_all.get(k, 1)))
        if k in rem:
            r = rem[k]
            st0 = rem_state(r)
            return ((f"향료 평가({st0})" if flavour_only(r) else st0), r["substance"], "", "",
                    r.get("eval_year", ""), r.get("source_link", ""), r["conclusion"],
                    efsa_ctx(r, 1))
    return ("", "", "", "", "", "", "", "")


def flavour_only(r):
    """향료 평가에서만 나온 결론인가. 향료로서의 평가(사용량 수준의 우려)는
    첨가물 안전성 결론과 성격이 다르다 — 젖산·타우린·말톨의 '자료 부족' 이 이 경우다."""
    doms = [x.strip().lower() for x in (r.get("domain") or "").split("|") if x.strip()]
    return bool(doms) and all(d == "flavourings" for d in doms)


def efsa_ctx(r, n):
    """어느 분야의 평가인지 · 평가서 연결 상태 · 대상. 향료 평가의 결론을
    첨가물 안전성 결론처럼 읽지 않도록 함께 남긴다."""
    bits = [r.get("domain") or "분야 미상", r.get("link_status") or "", r.get("population") or ""]
    if n > 1:
        bits.append(f"원 기록 {n}건")
    return " · ".join(b for b in bits if b)


# ── 2b. FDA — 역할(용도)과 GRAS 결론 ───────────────────
#  국내 자료에는 '이 성분이 무슨 일을 하는가' 칸이 없다. FDA 에는 있다.
#  CAS 도 있으나 EFSA 쪽 CAS 보유가 573건뿐이라 다리로는 약하다. 영문명으로 잇는다.
fda, scogs = {}, {}
p = os.path.join(PREP, "fda_substances.csv")
if os.path.exists(p):
    for r in load(p):
        for n in [r["substance"]] + re.split(r"\|", r["other_names"] or ""):
            k = norm_en(n)
            if k and k not in fda:
                fda[k] = r
p = os.path.join(PREP, "fda_scogs.csv")
if os.path.exists(p):
    for r in load(p):
        for n in [r["substance"]] + re.split(r"\|", r["other_names"] or ""):
            k = norm_en(n)
            if k and k not in scogs:
                scogs[k] = r
print(f"FDA 물질 {len(fda):,}표제어 · SCOGS {len(scogs):,}표제어")


def fda_lookup(eng_field):
    """영문명 정확 일치. 역할·CFR 조항·SCOGS 결론을 돌려준다."""
    for part in re.split(r"[,;/]", eng_field or ""):
        k = norm_en(part)
        if not k:
            continue
        f, sc = fda.get(k), scogs.get(k)
        if f or sc:
            return ((f or {}).get("technical_effect", ""),
                    (f or {}).get("cfr", ""),
                    (sc or {}).get("conclusion", ""),
                    (sc or {}).get("year", ""))
    return ("", "", "", "")


# ── 2b-2. JECFA — EFSA 가 다루지 않는 국제 기준 ──────────
#  같은 성분에 기관마다 값이 다르다. 타트라진은 JECFA 0~10, EFSA 7.5 다.
#  한쪽만 보여주면 사실이 왜곡되므로 따로 담아 나란히 보인다.
jecfa = {}
p = os.path.join(PREP, "jecfa_adi.csv")
if os.path.exists(p):
    for r in load(p):
        k = norm_en(r["query"])
        if k and k not in jecfa:
            jecfa[k] = r
print(f"JECFA {len(jecfa):,}표제어")

# ── 2b-3. EU — '평가 결과' 가 아니라 '허용 조건' 이다 ─────
#  ADI 와 같은 칸에 넣지 않는다. 어떤 식품에 얼마까지 쓸 수 있는가의 문제다.
eu_sub, eu_use = {}, {}
p = os.path.join(PREP, "eu_additives.csv")
if os.path.exists(p):
    for r in load(p):
        for n in [r["name"]] + re.split(r"[,;/|]", r["synonyms"] or ""):
            k = norm_en(n)
            if k and k not in eu_sub:
                eu_sub[k] = r
p = os.path.join(PREP, "eu_additive_uses.csv")
if os.path.exists(p):
    for r in load(p):
        eu_use.setdefault(r["policy_code"], []).append(r)
print(f"EU 첨가물 {len(eu_sub):,}표제어 · 사용조건 {sum(len(v) for v in eu_use.values()):,}건")


def eu_lookup(eng_field):
    """E번호와 허용 조건 요약. 국내 자료에 E번호가 없어 영문명으로 잇는다."""
    for part in re.split(r"[,;/]", eng_field or ""):
        r = eu_sub.get(norm_en(part))
        if not r:
            continue
        us = eu_use.get(r["policy_code"], [])
        ml = [u for u in us if u["restriction_type"] == "FAD_RT_ML"]
        qs = [u for u in us if u["restriction_type"] == "FAD_RT_QS"]
        bits = []
        if ml:
            bits.append(f"최대허용량 지정 {len(ml)}개 식품군")
        if qs:
            bits.append(f"양 제한 없음(quantum satis) {len(qs)}개 식품군")
        return r["e_number"], (" · ".join(bits) or "조건 정보 없음"), len(us)
    return ("", "", 0)


# ── 2c. 사람이 확정한 값 — 자동 추출보다 우선한다 ────────
manual = {}
p = os.path.join("data/curated", "evidence_manual.csv")
if os.path.exists(p):
    for r in load(p):
        # 라벨은 '설탕' 이라 쓰고 기준은 '자당' 으로 적혀 있다. 별칭을 손으로 잇는다.
        # 별칭 구분자는 쉼표로 통일했지만, | 로 적힌 과거 행이 있어서 둘 다 받는다
        keys = [r["성분"]] + re.split(r"[,;/|]", r.get("별칭") or "")
        keys.append(re.sub(r"\(.*?\)", "", r["성분"]))      # 자당(설탕) → 자당
        for k in keys:
            k = norm_kr(k)
            if k:
                manual.setdefault(k, []).append(r)
print(f"사람 확정 {len({r['성분'] for v in manual.values() for r in v}):,}종 "
      f"(별칭 포함 표제어 {len(manual):,})")

# ── 3. 우리 토큰과 대조 ─────────────────────────────────
UNKNOWN_COND = "조건 정보 미확인"


def has_cond(v):
    return bool(v) and v != UNKNOWN_COND


out, stat = [], {"국내기준": 0, "EFSA": 0, "둘다": 0, "아무것도": 0}
confirmed_occ = 0
for t in load(os.path.join(PREP, "ingredient_tokens.csv")):
    occ = int(t["occurrences"])
    if occ < MIN_OCC:
        continue
    name = t["std_name"] or t["token"]
    n = norm_kr(name)
    k = kr.get(n)

    kr_cls = (k.get("LCLAS_NM") or "").strip() if k else ""
    # 사용 상태(사용가능/사용불가/제한적사용)는 조건 문구와 다른 칸에 있다.
    # 조건 문구가 비었다고 '제한 없음'으로 채우면 사용불가가 허용으로 뒤집힌다(14건 확인).
    kr_status = (k.get("USE_CND_NM") or "").strip() if k else ""
    cands = status_candidates(n)
    if len({c.split("|")[1] for c in cands}) > 1:
        kr_status = f"상태 엇갈림({kr_status} 채택)"
    elif k and prio(k) == PRIO.index("건강기능식품(C코드)"):
        # 말토덱스트린은 건기식 '사용불가(전량수출용)' 기록뿐이다. 이것을 일반 식품의 사용 상태로 읽으면 안 된다.
        kr_status = f"건기식 기록뿐({kr_status}) — 일반 식품 기준 아님"
    kr_use = (k.get("USE_CND_STDR_CN") or "").strip() if k else ""
    if k and not kr_use:
        kr_use = UNKNOWN_COND
    if kr_status.startswith("건기식 기록뿐"):
        kr_use = f"[건기식 기록] {kr_use}"
    eng = ((k.get("ENG_NM") or "").strip() if k else "") or eng_extra.get(n, "")

    st, sub, val, unit, year, link, concl, efsa_note = efsa_lookup(eng)

    # 영문명 칸에 이름이 여럿이면, 기관마다 서로 다른 물질을 가리킬 수 있다.
    # 예전에는 처음 걸린 것만 썼다. 전부 모아 두고, EFSA 쪽이 여럿이면 값을 붙이지 않는다.
    parts = [x for x in re.split(r"[,;/]", eng or "") if norm_en(x)]

    def distinct(idx, key):
        got = []
        for x in parts:
            r0 = idx.get(norm_en(x))
            if r0 and r0.get(key) and r0[key] not in got:
                got.append(r0[key])
        return got

    cand_efsa = distinct(adi, "substance")
    cand_efsa += [x for x in distinct(rem, "substance") if x not in cand_efsa]
    cand_fda = distinct(fda, "substance")
    cand_eu = distinct(eu_sub, "name")
    cand_jecfa = distinct(jecfa, "matched_name")
    multi = [f"{lab}:{' | '.join(c)}" for lab, c in
             (("EFSA", cand_efsa), ("FDA", cand_fda), ("EU", cand_eu), ("JECFA", cand_jecfa)) if len(c) > 1]
    if len(cand_efsa) > 1:
        st, sub, val, unit, year, link = "후보 여러 개", "", "", "", "", ""
        concl = f"영문명이 서로 다른 물질 {len(cand_efsa)}개를 가리킨다: " + " | ".join(cand_efsa)
        efsa_note = "묶음 이름 또는 동의어 충돌 — 사람 확인 필요"
    effect, cfr, scogs_concl, scogs_year = fda_lookup(eng)
    jx = None
    for part in re.split(r"[,;/]", eng or ""):
        jx = jecfa.get(norm_en(part))
        if jx:
            break
    jecfa_adi = (jx or {}).get("adi", "")
    jecfa_class = (jx or {}).get("functional_class", "")
    e_number, eu_cond, eu_n = eu_lookup(eng)

    src = "자동"
    review = "자동 후보 — 미검토" if st else ""
    m = manual.get(n) or manual.get(norm_kr(t["token"]))
    if m:
        # 여러 기관이 같은 성분을 다루면 수치가 있는 쪽을 먼저 보인다
        best = sorted(m, key=lambda x: (not x["값"], x["평가연도"]))[0]
        st, val, unit = best["상태"], best["값"], best["단위"]
        year, concl, link = best["평가연도"], best["결론 문구"], best["출처"]
        sub = best["기관"]
        src = f'사람 확인 {best["확인일"]}'
        efsa_note = best.get("검토 상태", "")
        review = best.get("검토 상태", "") or "사람 확인(검토 상태 미기재)"
        confirmed_occ += occ

    has_kr, has_ef = has_cond(kr_use), bool(st)
    stat["둘다" if (has_kr and has_ef) else
         "국내기준" if has_kr else "EFSA" if has_ef else "아무것도"] += 1

    out.append([t["token"], occ, name, t["class"],
                kr_cls, "지정" if n in kadd else "", kr_use,
                eng, st, sub, val, unit, year, link, concl, src,
                effect, cfr, scogs_concl, scogs_year,
                jecfa_adi, jecfa_class, e_number, eu_cond, eu_n, kr_status,
                " ; ".join(cands), efsa_note, " ; ".join(multi), review])

F = ["토큰", "등장", "표준명", "분류", "국내 분류", "공전 지정", "국내 사용기준",
     "영문명", "국제 상태", "기관·물질명", "값", "단위", "평가연도", "링크",
     "결론 문구", "확보 경로",
     "역할(FDA)", "미국 CFR 조항", "SCOGS 결론", "SCOGS 연도",
     "JECFA ADI", "JECFA 용도", "E번호", "EU 허용조건", "EU 식품군 수",
     "국내 사용상태", "국내 상태 후보", "국제 근거 맥락", "영문명 후보 충돌", "검토 상태"]
dst = os.path.join(PREP, "evidence_candidates.csv")
with io.open(dst, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(F); w.writerows(out)

if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

tot = len(out)
print(f"\n등장 {MIN_OCC}회 이상 토큰 {tot:,}종 → {dst}")
for k2, v in stat.items():
    print(f"   {k2:<8}{v:>6,}종 ({v/tot:>5.1%})")

# 사람이 볼 순서 — 많이 쓰이는데 아직 근거가 없는 것부터
gap = [r for r in out if not r[8] and not has_cond(r[6])]
print(f"\n근거가 전혀 없는 상위 20 (총 {len(gap):,}종)")
for r in gap[:20]:
    print(f"   {r[1]:>8,}  {r[0][:24]:<26}{r[3]}")

ready = [r for r in out if r[8] and has_cond(r[6])]
print(f"\n국내·국제 기준이 모두 붙은 상위 20 (총 {len(ready):,}종)")
for r in ready[:20]:
    print(f"   {r[1]:>8,}  {r[0][:20]:<22}{r[8]:<10}{(r[10] or '—'):<8}{r[9][:26]}")
