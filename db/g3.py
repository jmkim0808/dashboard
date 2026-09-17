#!/usr/bin/env python3
"""
G3 게이트 — 산정값 검산.

사용:  npm run g3                    (dev 서버가 떠 있어야 한다)
       python3 db/g3.py --base http://127.0.0.1:8787

무엇을 하는가:
  로컬 D1 파일에서 **원본 입력값만** 읽어, 이 파일이 직접 파이썬으로 다시 계산한 뒤
  API(/api/calc/*)가 낸 값과 비교한다.

왜 필요한가:
  화면은 틀리면 고치면 된다. 틀린 배출량을 고객사에 제출하면 되돌릴 수 없다.
  따라서 산정 로직은 "돌아간다"가 아니라 "손계산과 일치한다"까지 확인해야 한다.
  계산식을 calc.js 에서 옮겨오지 않고 아래 주석의 정의대로 다시 썼다.
  같은 코드를 두 번 돌리면 같이 틀리기 때문이다.

  산정식
    표준단위값 = 입력값 × 단위환산계수
    배분값     = 표준단위값 × 사업장 배분율          (임대 사업장, R61)
    tCO2       = 배분값 × 배출계수
    TJ         = 배분값 × 순발열량계수
    TOE        = TJ × 1000 ÷ 41.868
    비율지표   = (Σ분자 ÷ Σ분모) × 배수             (R64 — 법인별 값의 평균이 아니다)
    금액 분모  = Σ(법인 현지통화 금액 × 연평균환율)   (R65)
"""
import json, os, sqlite3, sys, urllib.request, glob, argparse

GJ_PER_TOE = 41.868
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ap = argparse.ArgumentParser()
ap.add_argument('--base', default=os.environ.get('G3_BASE', 'http://127.0.0.1:8787'))
ap.add_argument('--year', type=int, default=2026)
ap.add_argument('--as-role', default=os.environ.get('G3_EMAIL', ''),
                help='Cf-Access-Authenticated-User-Email 로 보낼 값 (REQUIRE_ACCESS=true 일 때 필요)')
args = ap.parse_args()

ok = fail = 0
def check(name, got, want, tol=0.0005):
    global ok, fail
    if want is None or got is None:
        good = (want is None and got is None)
    else:
        good = abs(got - want) <= max(tol, abs(want) * 1e-6)
    if good:
        ok += 1; print(f"  PASS  {name}\n          손계산 {want}  =  API {got}")
    else:
        fail += 1; print(f"  FAIL  {name}\n          손계산 {want}  ≠  API {got}")

def api(path):
    req = urllib.request.Request(args.base + path)
    if args.as_role:
        req.add_header('Cf-Access-Authenticated-User-Email', args.as_role)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"\n  API 호출 실패: {path}\n  {e}\n  dev 서버가 떠 있는지, --base 주소가 맞는지 확인하세요.")
        sys.exit(2)

# ── 로컬 D1 파일 열기 ────────────────────────────────────────────────────────
cands = [p for p in glob.glob(os.path.join(ROOT, '.wrangler/state/v3/d1/**/*.sqlite'),
                              recursive=True) if not p.endswith('metadata.sqlite')]
if not cands:
    print("  로컬 D1 파일이 없습니다. npm run db:local 을 먼저 실행하세요.")
    sys.exit(2)
conn = sqlite3.connect('file:' + max(cands, key=os.path.getmtime) + '?mode=ro', uri=True)
conn.row_factory = sqlite3.Row
q = lambda sql, p=(): [dict(r) for r in conn.execute(sql, p).fetchall()]

YEAR = args.year
periods = [f"{YEAR}-{m:02d}" for m in range(1, 13)]

entities = {e['code']: e for e in q("SELECT code, currency, grid_region FROM entity WHERE is_active=1")}
sites = {s['entity_code']: s for s in q("SELECT entity_code, ownership, allocation_ratio FROM site WHERE is_active=1")}
metrics = {m['code']: m for m in q("SELECT code, unit_standard, aggregation, factor_type, ghg_scope, is_calculated FROM metric")}
overrides = {(o['metric_code'], o['entity_code']): o['factor_to_standard']
             for o in q("SELECT metric_code, entity_code, factor_to_standard FROM metric_unit_override")}
entries = q(f"SELECT entity_code, metric_code, period, value_raw, status FROM entry "
            f"WHERE period LIKE '{YEAR}-%' AND value_raw IS NOT NULL")

version = api('/api/calc/year?year=%d' % YEAR)['version']
factors = q("SELECT factor_type, purpose, region, year, value FROM factor WHERE version=? ORDER BY year DESC", (version,))
fxver = api('/api/calc/year?year=%d' % YEAR).get('fx_version')
fx = {'KRW': 1.0}
if fxver:
    for r in q("SELECT currency, rate_avg FROM fx_rate WHERE year=? AND version=?", (YEAR, fxver)):
        fx[r['currency']] = r['rate_avg']

def factor(ftype, purpose, region):
    for r in factors:
        if r['factor_type'] == ftype and r['purpose'] == purpose and r['region'] == region and r['year'] <= YEAR:
            return r['value']
    for r in factors:
        if r['factor_type'] == ftype and r['purpose'] == purpose and r['region'] == 'GLOBAL' and r['year'] <= YEAR:
            return r['value']
    return None

def allocated(entity, metric_code, value):
    std = value * overrides.get((metric_code, entity), 1.0)
    s = sites[entity]
    return std * (s['allocation_ratio'] if s['ownership'] == 'leased' and s['allocation_ratio'] else 1.0)

# ── 월별 산정 검산 ──────────────────────────────────────────────────────────
print(f"\n[1] 월별 배출량·에너지 — 입력값에서 손계산으로 다시 만든다 ({YEAR})")
monthly = {}
for code, e in entities.items():
    for period in periods:
        s1 = s2 = tj = 0.0
        rows = [r for r in entries if r['entity_code'] == code and r['period'] == period]
        if not rows:
            continue
        for r in rows:
            m = metrics[r['metric_code']]
            if not m['factor_type']:
                continue
            a = allocated(code, r['metric_code'], r['value_raw'])
            ef = factor(m['factor_type'], 'emission', e['grid_region'])
            hv = factor(m['factor_type'], 'heating_value', e['grid_region'])
            if ef and m['ghg_scope']:
                if m['ghg_scope'] == 1: s1 += a * ef
                else: s2 += a * ef
            if hv:
                tj += a * hv
        monthly[(code, period)] = {
            'scope1': round(s1, 4), 'scope2': round(s2, 4),
            'energy_tj': round(tj, 6), 'energy_toe': round(tj * 1000 / GJ_PER_TOE, 3)}

checked = 0
for (code, period), want in sorted(monthly.items()):
    got = api(f'/api/calc/month?entity={code}&period={period}')['results']
    for key in ('scope1', 'scope2', 'energy_tj', 'energy_toe'):
        check(f"{code} {period} {key}", got[key], want[key])
    checked += 1
print(f"        검산한 법인·월 조합: {checked}")

# ── 연간 합산 검산 ──────────────────────────────────────────────────────────
print(f"\n[2] 연간 합산 — 월별 산출값의 합이어야 한다 (보고서 수치와 월 보고가 어긋나면 안 된다)")
year = api('/api/calc/year?year=%d' % YEAR)
grp = {'scope1': 0.0, 'scope2': 0.0, 'energy_tj': 0.0, 'energy_toe': 0.0}
for e in year['entities']:
    code = e['entity_code']
    want = {k: round(sum(v[k] for (c, p), v in monthly.items() if c == code),
                     3 if k.startswith('scope') else (4 if k == 'energy_tj' else 2))
            for k in grp}
    for k in grp:
        check(f"{code} 연간 {k}", e[k], want[k])
        grp[k] += want[k]
for k in grp:
    check(f"그룹 합산 {k}", year['group'][k],
          round(grp[k], 3 if k.startswith('scope') else (4 if k == 'energy_tj' else 2)))

# ── 비율·집약도 검산 (R64) ──────────────────────────────────────────────────
print(f"\n[3] 비율·집약도 — 분자·분모를 각각 합산한 뒤 나눈다 (R64)")
calc_annual = {e['entity_code']: {'E-C1': e['energy_tj'], 'E-C2': e['energy_toe'],
                                  'E-C3': e['scope1'], 'E-C4': e['scope2']}
               for e in year['entities']}

def annual(code, metric_code):
    """한 법인·한 지표의 연간값. metric.aggregation 정의대로."""
    if metric_code in calc_annual.get(code, {}):
        return calc_annual[code][metric_code]
    m = metrics.get(metric_code)
    if not m: return None
    vals = [(r['period'], r['value_raw']) for r in entries
            if r['entity_code'] == code and r['metric_code'] == metric_code]
    if not vals: return None
    if m['aggregation'] == 'avg': return sum(v for _, v in vals) / len(vals)
    if m['aggregation'] == 'eop': return max(vals)[1]
    return sum(v for _, v in vals)

def ratio(codes, metric_code):
    d = q("SELECT numerator_codes, denominator_codes, multiplier FROM v_ratio_metric WHERE code=?",
          (metric_code,))[0]
    num = den = 0.0
    for side, field in (('n', 'numerator_codes'), ('d', 'denominator_codes')):
        for src in [x.strip() for x in d[field].split(',') if x.strip()]:
            money = metrics[src]['unit_standard'].startswith('현지통화')
            total, any_, fx_missing = 0.0, False, False
            for code in codes:
                v = annual(code, src)
                if v is None: continue
                if money:
                    rate = fx.get(entities[code]['currency'])
                    if rate is None: fx_missing = True; continue
                    total += v * rate
                else:
                    total += v
                any_ = True
            if not any_:
                return None
            if side == 'n': num += total
            else: den += total
            if fx_missing:
                return None
    if den == 0: return None
    v = (num / den) * d['multiplier']
    if v == 0: return 0.0
    import math
    mag = math.ceil(math.log10(abs(v)))
    p = 10 ** (6 - mag)
    return round(v * p) / p

codes = sorted(entities)
for r in year['ratios']:
    check(f"그룹 {r['code']} {r['name_ko']}", r['value'], ratio(codes, r['code']))
for code in codes:
    for r in year['ratios_by_entity'][code]:
        check(f"{code} {r['code']} {r['name_ko']}", r['value'], ratio([code], r['code']))

# ── R64 가 실제로 의미가 있는지 ────────────────────────────────────────────
print(f"\n[4] R64 — 법인별 비율의 평균은 그룹 비율과 다르다 (같으면 이 설계가 필요 없다는 뜻)")
for r in year['ratios']:
    per = [x['value'] for code in codes
           for x in year['ratios_by_entity'][code] if x['code'] == r['code']]
    per = [v for v in per if v is not None]
    if r['value'] is None or len(per) < 2:
        continue
    avg = sum(per) / len(per)
    diff = abs(avg - r['value']) / abs(r['value']) * 100 if r['value'] else 0
    mark = "차이 있음" if diff > 0.5 else "거의 같음"
    print(f"  {r['code']:5} {r['name_ko'][:12]:14} 그룹 {r['value']:>12}  법인평균 {round(avg,6):>12}  ({diff:.1f}% {mark})")

# ── 미산정 항목 ─────────────────────────────────────────────────────────────
print(f"\n[5] 미산정 — 계수가 없는 항목이 0 으로 취급되지 않았는지")
if year['unpriced']:
    for u in year['unpriced']:
        print(f"  미산정  {u['entity_code']} {u['metric_code']} {u['name_ko']} (계수 없음: {u['factor_type']})")
    print("        위 항목은 합계에 0 으로 들어가지 않고 별도로 표시된다. 계수 등록 시 자동 합산된다.")
else:
    print("  모든 항목에 계수가 등록되어 있다.")

print(f"\n{'='*58}\n  G3 게이트  통과 {ok} / 실패 {fail}\n{'='*58}")
conn.close()
sys.exit(1 if fail else 0)
