#!/usr/bin/env python3
"""
JECFA(FAO/WHO 합동 식품첨가물전문가위원회) ADI 조회

왜 필요한가
  EFSA OpenFoodTox 에서 식품 분야로 쓸 수 있는 ADI 는 100건뿐이다.
  당알콜 4종이 그랬듯, 오래된 국제 기준은 JECFA 에만 있다.
  그리고 같은 성분에 기관마다 값이 다르다 — 타트라진은 JECFA 0~10, EFSA 7.5 다.
  한쪽만 보여주면 사실을 왜곡한다.

경로
  https://apps.who.int/food-additives-contaminants-jecfa-database/api/SearchChemical/ByPartialName/<name>
  앞글자 일치이고 최대 11건을 돌려준다. 정확히 같은 이름만 채택한다.

출력: data/prepared/jecfa_adi.csv
"""
import csv, io, json, os, re, ssl, sys, time, urllib.parse, urllib.request

PREP = "data/prepared"
API = ("https://apps.who.int/food-additives-contaminants-jecfa-database"
       "/api/SearchChemical/ByPartialName/")
MIN_OCC = 300
CAFILE = "/mingw64/etc/ssl/certs/ca-bundle.crt"   # Git Bash 의 CA 번들
PAUSE = 0.4


def norm(s):
    return re.sub(r"[\s\-_,.()]", "", (s or "").strip().lower())


ctx = ssl.create_default_context(cafile=CAFILE if os.path.exists(CAFILE) else None)


def query(name):
    url = API + urllib.parse.quote(name)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40, context=ctx) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# 국내 식용색소 번호명 → JECFA 국제명. 번호명은 이름에 마침표가 있어 API 가 JSON 대신
# 리다이렉트를 주고, 성공해도 JECFA 는 국제명을 쓰므로 적중하지 않는다.
QUERY_ALIAS = {
    "food blue no.1": "Brilliant Blue FCF",
    "food red no.2": "Amaranth",
    "food red no.3": "Erythrosine",
    "food red no.40": "Allura Red AC",
    "food red no.40 aluminium lake": "Allura Red AC",
    "food yellow no.4": "Tartrazine",
    "food yellow no.4 aluminium lake": "Tartrazine",
    "food yellow no.5": "Sunset Yellow FCF",
}


def kr_norm(s):
    return re.sub(r"[\s\-_,.()·ㆍ・/]", "", (s or "").strip())


def build_targets():
    raw = "data/raw"
    eng = {}
    for fn in ("I1020_rawmtrl_info.csv", "I2520_rawmtrl_code.csv"):
        with io.open(os.path.join(raw, fn), encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                n = kr_norm(r.get("RPRSNT_RAWMTRL_NM"))
                e = (r.get("ENG_NM") or "").strip()
                if n and e and n not in eng:
                    eng[n] = e
    targets = {}
    with io.open(os.path.join(PREP, "ingredient_tokens.csv"), encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            occ = int(r["occurrences"])
            if occ < MIN_OCC:
                continue
            e = eng.get(kr_norm(r["std_name"] or r["token"]), "")
            for part in re.split(r"[,;/]", e):
                p = part.strip()
                if len(p) >= 3 and norm(p) not in targets:
                    targets[norm(p)] = (p, r["token"], occ)
    with io.open(os.path.join(PREP, "jecfa_query_targets.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f); w.writerow(["query", "token", "occurrences"])
        w.writerows(sorted(targets.values(), key=lambda x: -x[2]))
    return targets


def main():
    # 조회 대상 — 원천 자료에서 직접 만든다.
    # 예전에는 09 의 산출물(evidence_candidates.csv)을 읽었는데, 09 는 다시 이 스크립트의 결과를 읽는다.
    # 순환을 끊기 위해 성분 사전 + I1020/I2520 영문명으로 대상 목록을 만들고 파일로 남긴다.
    targets = build_targets()
    order = sorted(targets.values(), key=lambda x: -x[2])
    print(f"조회 대상 영문명 {len(order):,}개 (등장 {MIN_OCC}회 이상 토큰)")

    done, out = set(), []
    # 모든 조회를 기록한다 — 적중하지 않은 것도. 예전에는 적중만 남겨서 실행할 때마다
    # 700여 건을 처음부터 다시 물었다. 응답 건수·시각도 남긴다.
    qlog_path = os.path.join(PREP, "jecfa_query_log.csv")
    if os.path.exists(qlog_path):
        with io.open(qlog_path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                done.add(norm(r["query"]))
    qlog_new = not os.path.exists(qlog_path)
    qlog = io.open(qlog_path, "a", encoding="utf-8", newline="")
    qw = csv.writer(qlog)
    if qlog_new:
        qw.writerow(["query", "asked", "results", "hit", "fetched_at"])
    dst = os.path.join(PREP, "jecfa_adi.csv")
    if os.path.exists(dst):                      # 이어받기
        with io.open(dst, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                done.add(norm(r["query"]))
                out.append(r)
        print(f"  이전 결과 {len(out):,}건 이어받음")

    F = ["query", "token", "occurrences", "matched_name", "adi",
         "cas", "fema_no", "jecfa_no", "functional_class"]
    n = hit = 0
    for name, token, occ in order:
        if norm(name) in done:
            continue
        n += 1
        ask = QUERY_ALIAS.get(name.strip().lower(), name)
        if "." in ask:
            # 균주 학명 등 — JECFA 대상이 아니고 API 도 받지 못한다
            continue
        try:
            res = query(ask)
        except Exception as e:
            print(f"\n  !! {name}: {e}")
            time.sleep(3)
            continue
        # 앞글자 일치라 엉뚱한 것이 섞인다. 이름이 정확히 같은 것만 쓴다.
        exact = [x for x in res if norm(x.get("Name")) == norm(ask)
                 and (x.get("ADI") or "").strip()]
        qw.writerow([name, ask, len(res), "Y" if exact else "",
                     time.strftime("%Y-%m-%dT%H:%M:%S")])
        qlog.flush()
        if exact:
            x = exact[0]; hit += 1
            out.append({"query": name, "token": token, "occurrences": occ,
                        "matched_name": x.get("Name", ""),
                        "adi": (x.get("ADI") or "").strip(),
                        "cas": x.get("CAS_NO") or "", "fema_no": x.get("FEMA_NO") or "",
                        "jecfa_no": x.get("JECFA_NO") or "",
                        "functional_class": x.get("FunctionalClass") or ""})
        if n % 25 == 0:
            with io.open(dst, "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=F); w.writeheader(); w.writerows(out)
            print(f"\r  {n:,}/{len(order):,} 조회 · 적중 {hit:,}", end="", flush=True)
        time.sleep(PAUSE)

    qlog.close()
    with io.open(dst, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=F); w.writeheader(); w.writerows(out)
    print(f"\r  {n:,}건 조회 · 적중 {hit:,} · 누적 {len(out):,} → {dst}")


if __name__ == "__main__":
    if (sys.stdout.encoding or "").lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
