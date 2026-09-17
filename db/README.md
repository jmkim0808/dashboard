# 데이터베이스

파워넷 ESG 데이터 입력플랫폼의 데이터 구조. 대상은 **Cloudflare D1 (SQLite)** 이다.

| 파일 | 내용 |
|---|---|
| `schema.sql` | 테이블 15개 · 트리거 7개 · 뷰 3개 |
| `seed.sql` | 기준정보 — 법인 3, 사업장 3, 역할 13, 지표 49, 담당배정 111 |
| `verify.py` | 설계 원칙이 DB 수준에서 강제되는지 검증 (23개 항목) |

---

## 적용

### 1. D1 데이터베이스 생성 (최초 1회)

```bash
npx wrangler d1 create powernet-esg
```

출력된 `database_id` 를 `wrangler.toml` 의 해당 항목에 붙여 넣는다.

### 2. 스키마와 기준정보 적용

```bash
# 로컬 (내 PC에서 먼저 확인)
npx wrangler d1 execute powernet-esg --local --file=db/schema.sql
npx wrangler d1 execute powernet-esg --local --file=db/seed.sql

# 운영 (확인 후)
npx wrangler d1 execute powernet-esg --remote --file=db/schema.sql
npx wrangler d1 execute powernet-esg --remote --file=db/seed.sql
```

### 3. 확인

```bash
npx wrangler d1 execute powernet-esg --local \
  --command="SELECT entity_code, COUNT(*) FROM v_expected_entry WHERE period_type='monthly' GROUP BY 1"
```

법인마다 **29** 가 나오면 정상이다. 해외법인 담당자 1인이 매월 입력할 항목 수다.

### 4. 제약 검증

```bash
python3 db/verify.py
```

`통과 23 / 실패 0` 이 나와야 한다. **schema.sql 을 수정한 뒤에는 반드시 돌린다.**

---

## 이 스키마가 DB 수준에서 강제하는 것

설계 원칙이 주석에만 있고 제약에는 없으면 언젠가 깨진다. 아래는 코드가 아니라 **DB가** 막는다.

| 원칙 | 강제 방식 |
|---|---|
| **R84** 개인정보 Zero | 이름·사번·이메일·연락처 컬럼이 **존재하지 않는다**. `verify.py`가 컬럼명을 스캔해 확인 |
| **R85** 사람이 아니라 역할을 기록 | 모든 행위자 컬럼이 `role(code)` 참조. 이메일 매핑은 Cloudflare Access에만 |
| **R86** S 지표 증빙 차단 | `trg_evidence_policy_none` — 급여대장·재해조사표 업로드가 **거부**된다 |
| **R87** 자유 텍스트 없음 | 미확보 사유는 `unavailable_reason` FK, 반송 사유는 CHECK 4개 코드 |
| **R67** 부담당자 필수 | `metric_assignment.backup_role NOT NULL` — 1인 의존 배정이 저장되지 않는다 |
| **R69** 계산지표 입력 불가 | `trg_entry_no_calculated` |
| **D-1** 원본값 불변 | `value_raw` + `unit_raw` 저장, 환산은 `v_entry`가 계산 |
| **D-2** 미입력 ≠ 미확보 | `status` CHECK 3개 — 미확보는 값이 NULL이고 사유가 필수 |
| **D-4** 물리삭제 없음 | `trg_entry_no_delete`, `trg_evidence_no_delete` |
| **R58** 변경은 이력으로 | `trg_entry_audit_value`, `trg_entry_audit_status` |
| **R59** 계수 불변 | `trg_factor_immutable` — 수정 대신 새 버전 등록 |
| **R61** 임대 배분 근거 | `site` CHECK — 임대인데 배분기준·비율·근거가 없으면 저장 거부 |
| **R64** 비율지표 재계산 | `metric.numerator_codes` / `denominator_codes` / `multiplier` — 비율값을 평균하지 않는다 |

---

## 설계 메모

### 지표 하나 = 숫자 하나

성별·고용형태 세분화를 차원(dimension) 테이블로 만들지 않고 **지표를 나눴다.**
`S03 임직원수(남)` / `S04 임직원수(여)` 처럼 둔다.

차원 테이블을 쓰면 입력 화면·집계·비율계산이 모두 복잡해진다. 지표를 나누면
입력자는 칸 하나에 숫자 하나만 넣고, 비율은 전부 계산지표가 만든다.

### 비율지표를 데이터로 표현한 이유

```
값 = (Σ numerator_codes) / (Σ denominator_codes) × multiplier
```

이 한 줄로 비율·집약도 8개가 전부 표현된다.

```
이직률        = (S06) / (S01,S02) × 100
재해 도수율    = (S08) / (S10) × 1,000,000
1인당 교육시간  = (S11,S12) / (S01,S02) × 1
배출 집약도    = (E-C3,E-C4) / (P03) × 1
```

**"3법인 이직률의 평균 ≠ 그룹 이직률"** 이라는 실무에서 가장 흔한 오류가
구조적으로 발생할 수 없다. 분자·분모를 각각 합산한 뒤 나누기 때문이다.
새 비율지표를 추가할 때도 코드 수정이 아니라 마스터 한 줄 추가로 끝난다 (R73).

### 단위 환산

`metric_unit_override` 가 법인별 입력 단위를 고정한다. 심양 전력은 `万kWh` 로 받고
`factor_to_standard = 10000` 으로 kWh 환산한다. **담당자는 환산하지 않는다** (P-1, P-5).

EP1의 "만kWh 사건"이 발생할 수 없는 지점이다.

### 배출량 산정을 데이터로

`metric.factor_type` + `metric.ghg_scope` + `factor` 테이블로 산정이 돌아간다.
`calc.js` 에 지표 코드나 계수값을 하드코딩하지 않는다.

→ 계수가 개정되거나 연료 항목이 추가돼도 **마스터 화면에서 처리**된다 (R73).
   이것이 유지보수 1인 의존 리스크의 핵심 완화책이다.

---

## 🔴 실제 값 입력이 필요한 항목

아래는 `[확인 필요]` 상태로 배포된다. **추측값을 넣으면 안 된다** — 그 값으로 산정 로직을
검증하게 되고, 실제 값이 들어오면 전부 다시 해야 한다.

| 항목 | 위치 | 근거 과제 | 기한 |
|---|---|---|---|
| **배출계수** (3개 지역 전력 + 연료별) | `seed.sql` 하단 템플릿 | EP8 B4 | 2026-09-30 |
| **순발열량계수** (TJ 환산) | 동일 | EP8 B4 | 2026-09-30 |
| **적용 GWP 버전** (AR5 / AR6) | `factor.gwp_set` | EP8 B3 | 2026-09-26 |
| **환율** (CNY·VND 연평균) | `seed.sql` 하단 템플릿 | — | 2026-10 |
| **본사 임대 배분율** | `site.allocation_ratio` (현재 0.342 가정) | EP8 B5 | 2026-09-26 |
| **3법인 회계연도 시작월** | `entity.fiscal_year_start` (현재 전부 1월) | EP8 B1 | 2026-09-24 |
| **법인별 해당 없는 항목** | `metric_assignment.is_applicable` | EP8 B6 | 2026-09-30 |
| **확보 가능 최초 연도** | `data_availability` (현재 전부 `NOT_SURVEYED`) | EP8 A3 | 2026-09-30 |

확인처
- **한국** 온실가스종합정보센터 / 전력거래소 — 전력 간접배출계수, 국가 고유 배출계수
- **중국** 생태환경부 지역 전력망 배출계수(동북전망) + GB/T 32150-2025
- **베트남** MONRE 고시 전력망 배출계수 + Decree 06/2022 부속 방법론

> 배출계수가 없으면 `calc_result` 가 만들어지지 않는다. 입력·검증 화면은 정상 동작하므로
> **W1~W2 개발은 계수 없이 진행할 수 있고**, W3(산정 로직) 전까지만 확보하면 된다.

---

## 변경 규칙

> **W1(2026-09-22~26)에 확정하고 이후 3주간 변경하지 않는다.** (EP8 원칙 4)
> 스키마가 흔들리면 이미 만든 화면을 전부 다시 만들어야 한다.

부득이하게 변경할 때:

1. `schema.sql` 을 고친다 (마이그레이션 파일을 따로 만들지 않는다 — 아직 운영 데이터가 없다)
2. `python3 db/verify.py` 로 제약이 살아있는지 확인한다
3. 로컬에 다시 적용해 본다 (`--local` 로 재생성)
4. 운영 적용 전에 어떤 화면이 영향을 받는지 먼저 확인한다

운영 데이터가 들어간 뒤에는 이 방식이 불가능하다. 그때부터는
`db/migrations/NNN-설명.sql` 을 추가하는 방식으로 바꾼다.
