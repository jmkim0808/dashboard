-- =============================================================================
-- 파워넷 ESG 데이터 입력플랫폼 — 데이터베이스 스키마
-- 대상: Cloudflare D1 (SQLite)
-- 근거: docs/planning/ep05-design.md (데이터 모델), ep08-roadmap.md (개인정보 Zero)
--
-- 이 스키마는 W1(2026-09-22~26)에 확정하고 이후 3주간 변경하지 않는다.
-- 스키마가 흔들리면 이미 만든 화면을 전부 다시 만들어야 한다. (EP8 원칙 4)
-- =============================================================================
--
-- ## 불변 규칙 (EP5 2-1절)
--   D-1  원본값은 덮어쓰지 않는다 — entry.value_raw + unit_raw 로 저장, 환산은 view/calc
--   D-2  '미입력'과 '미확보'는 다른 상태다 — entry.status 로 구분, NULL로 뭉치지 않는다
--   D-3  산정 결과는 적용 계수 버전을 스냅샷으로 보유 — calc_result.factor_version
--   D-4  물리적 삭제는 없다 — DELETE 트리거로 차단, 변경은 audit_log
--
-- ## 개인정보 Zero (EP8 4절)
--   R84  이 스키마에는 개인 식별 컬럼이 존재하지 않는다.
--        이름 / 사번 / 이메일 / 연락처 / 주민번호 / 여권번호 컬럼이 없다.
--        role.label_* 은 사람 이름이 아니라 직무명("본사 총무·시설 담당")이다.
--   R85  모든 행위자는 role.code 로 기록된다 (SY_OWNER, HQ_HR ...).
--        이메일 <-> 역할 매핑은 Cloudflare Access(인증 계층)에만 존재하며 여기에 없다.
--   R86  metric.evidence_policy='none' 인 지표는 증빙 첨부가 트리거로 차단된다.
--   R87  자유 텍스트 입력칸이 없다. 미확보 사유·반송 사유는 모두 코드값이다.
--
-- ## 설계 원칙: 지표 하나 = 숫자 하나
--   성별·고용형태 세분화를 차원 테이블로 만들지 않고 지표를 나눈다.
--   (예: S03 임직원수(남) / S04 임직원수(여))
--   입력자는 칸 하나에 숫자 하나만 넣고, 비율은 전부 계산지표가 만든다.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. 법인 · 사업장
-- -----------------------------------------------------------------------------

CREATE TABLE entity (
  code               TEXT PRIMARY KEY,                 -- HQ / SY / VP
  name_ko            TEXT NOT NULL,
  name_zh            TEXT NOT NULL,
  name_vi            TEXT NOT NULL,
  country            TEXT NOT NULL CHECK (country IN ('KR','CN','VN')),
  currency           TEXT NOT NULL CHECK (currency IN ('KRW','CNY','VND')),
  fiscal_year_start  INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
  locale_default     TEXT NOT NULL CHECK (locale_default IN ('ko','zh','vi')),
  calc_standard      TEXT NOT NULL,                    -- R11 적용 산정표준
  grid_region        TEXT NOT NULL,                    -- 전력 배출계수 적용 지역 (KR / CN-NE / VN)
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE TABLE site (
  id                   INTEGER PRIMARY KEY,
  entity_code          TEXT NOT NULL REFERENCES entity(code),
  name_ko              TEXT NOT NULL,
  name_local           TEXT NOT NULL,
  ownership            TEXT NOT NULL CHECK (ownership IN ('owned','leased')),
  -- 임대 사업장 배분 (R61 · EP1 3월 5일 사건 대응)
  allocation_basis     TEXT CHECK (allocation_basis IN ('area','headcount','submeter')),
  allocation_ratio     REAL CHECK (allocation_ratio > 0 AND allocation_ratio <= 1),
  allocation_evidence  TEXT,                            -- 근거 문서명 (계약서 면적 등)
  valid_from           TEXT NOT NULL,                   -- YYYY-MM-DD
  valid_to             TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  -- 임대 사업장은 배분 기준과 비율, 근거가 모두 있어야 한다
  CHECK (ownership = 'owned'
         OR (allocation_basis IS NOT NULL AND allocation_ratio IS NOT NULL
             AND allocation_evidence IS NOT NULL))
);

CREATE INDEX idx_site_entity ON site(entity_code, is_active);

-- -----------------------------------------------------------------------------
-- 2. 역할 (R85 — 사람이 아니라 역할을 기록한다)
-- -----------------------------------------------------------------------------

CREATE TABLE role (
  code         TEXT PRIMARY KEY,                        -- HQ_FACILITY / SY_OWNER ...
  entity_code  TEXT NOT NULL REFERENCES entity(code),
  label_ko     TEXT NOT NULL,                           -- 직무명. 개인명이 아니다
  label_zh     TEXT,
  label_vi     TEXT,
  scope        TEXT NOT NULL CHECK (scope IN ('entry','manager','approver','executive','admin')),
  locale       TEXT NOT NULL CHECK (locale IN ('ko','zh','vi')),
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE INDEX idx_role_entity ON role(entity_code, scope, is_active);

-- -----------------------------------------------------------------------------
-- 3. 지표 마스터 (R63 수집주기 · R44 프레임워크 매핑 · R68 활성기간 · R69 계산지표)
-- -----------------------------------------------------------------------------

CREATE TABLE metric (
  code               TEXT PRIMARY KEY,                  -- E01 / S01 / P01 / E-C1 / S-C1
  category           TEXT NOT NULL CHECK (category IN ('E','S','G','PROD')),
  name_ko            TEXT NOT NULL,
  name_zh            TEXT NOT NULL,
  name_vi            TEXT NOT NULL,
  unit_standard      TEXT NOT NULL,                     -- 내부 표준 단위
  period_type        TEXT NOT NULL CHECK (period_type IN ('monthly','quarterly','annual')),
  aggregation        TEXT NOT NULL CHECK (aggregation IN ('sum','avg','eop')),
  definition_ko      TEXT NOT NULL,                     -- R47 산정 정의 명문화
  help_ko            TEXT,                              -- R53 "이 숫자는 어디서 찾나"
  help_zh            TEXT,
  help_vi            TEXT,
  disclosure_level   TEXT NOT NULL CHECK (disclosure_level IN ('internal','customer','public')),
  evidence_policy    TEXT NOT NULL CHECK (evidence_policy IN ('required','none')),  -- R86
  gri_code           TEXT,
  kssb_code          TEXT,
  -- 계산지표 (R69: 입력 불가. 트리거로 차단)
  is_calculated      INTEGER NOT NULL DEFAULT 0 CHECK (is_calculated IN (0,1)),
  calc_kind          TEXT CHECK (calc_kind IN ('ratio','energy','emission')),
  -- R64: 비율·집약도는 분자·분모를 각각 보유하고 집계 시 재계산한다.
  --      값 = (Σ numerator_codes) / (Σ denominator_codes) × multiplier
  numerator_codes    TEXT,                              -- 콤마 구분 metric.code
  denominator_codes  TEXT,
  multiplier         REAL,
  -- 배출량·에너지 산정용 (calc.js가 이 값으로 동작한다 — 코드에 하드코딩 없음, R73)
  factor_type        TEXT,                              -- electricity / natural_gas / diesel ...
  ghg_scope          INTEGER CHECK (ghg_scope IN (1,2)),
  sort_order         INTEGER NOT NULL DEFAULT 0,
  active_from        TEXT NOT NULL,                     -- YYYY-MM
  active_to          TEXT,
  CHECK (is_calculated = 0 OR calc_kind IS NOT NULL),
  CHECK (is_calculated = 1 OR calc_kind IS NULL),
  CHECK (calc_kind IS NOT 'ratio'
         OR (numerator_codes IS NOT NULL AND denominator_codes IS NOT NULL AND multiplier IS NOT NULL)),
  -- 계산지표에는 증빙 개념이 없다
  CHECK (is_calculated = 0 OR evidence_policy = 'none')
);

CREATE INDEX idx_metric_active ON metric(category, period_type, active_to, sort_order);

-- 법인별 입력 단위 오버라이드 (R26 · P-5 현지 관행을 교정하지 않는다)
--   예: 심양 E01 은 万kWh 로 입력받고 factor_to_standard=10000 으로 kWh 환산
CREATE TABLE metric_unit_override (
  metric_code         TEXT NOT NULL REFERENCES metric(code),
  entity_code         TEXT NOT NULL REFERENCES entity(code),
  unit_input          TEXT NOT NULL,
  factor_to_standard  REAL NOT NULL CHECK (factor_to_standard > 0),
  PRIMARY KEY (metric_code, entity_code)
);

-- 지표 × 법인 담당 배정
--   R67: backup_role 이 NOT NULL 이다. 부담당자 없이는 저장되지 않는다 (P-7을 DB가 강제)
CREATE TABLE metric_assignment (
  metric_code    TEXT NOT NULL REFERENCES metric(code),
  entity_code    TEXT NOT NULL REFERENCES entity(code),
  owner_role     TEXT NOT NULL REFERENCES role(code),
  backup_role    TEXT NOT NULL REFERENCES role(code),
  is_applicable  INTEGER NOT NULL DEFAULT 1 CHECK (is_applicable IN (0,1)),
  PRIMARY KEY (metric_code, entity_code),
  CHECK (owner_role <> backup_role)
);

CREATE INDEX idx_assignment_owner ON metric_assignment(owner_role, is_applicable);

-- -----------------------------------------------------------------------------
-- 4. 코드 테이블 (R87 — 자유 입력칸을 만들지 않는다)
-- -----------------------------------------------------------------------------

CREATE TABLE unavailable_reason (
  code        TEXT PRIMARY KEY,
  label_ko    TEXT NOT NULL,
  label_zh    TEXT NOT NULL,
  label_vi    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- 5. 입력값 (핵심 테이블)
-- -----------------------------------------------------------------------------

CREATE TABLE entry (
  id                       INTEGER PRIMARY KEY,
  entity_code              TEXT NOT NULL REFERENCES entity(code),
  site_id                  INTEGER NOT NULL REFERENCES site(id),
  metric_code              TEXT NOT NULL REFERENCES metric(code),
  period                   TEXT NOT NULL,                -- YYYY-MM (연간 항목은 YYYY-12)
  -- D-1: 원본값·원본단위. 환산값은 저장하지 않고 v_entry / calc_result 가 만든다
  value_raw                REAL,
  unit_raw                 TEXT,
  -- D-2: 미입력(empty)과 미확보(unavailable)는 다른 상태다
  status                   TEXT NOT NULL DEFAULT 'empty'
                             CHECK (status IN ('empty','entered','unavailable','returned','approved','closed')),
  unavailable_reason_code  TEXT REFERENCES unavailable_reason(code),
  return_reason            TEXT CHECK (return_reason IN
                             ('UNIT_SUSPECT','VALUE_SUSPECT','EVIDENCE_MISSING','WRONG_PERIOD')),
  -- 이상치 (R60: 차단하지 않고 경고만 한다)
  flag_anomaly             INTEGER NOT NULL DEFAULT 0 CHECK (flag_anomaly IN (0,1)),
  anomaly_pct              REAL,
  -- R72: AI 추출값은 제안이며 확정값과 분리 저장한다
  ai_suggested_value       REAL,
  -- R85: 행위자는 역할코드로만 기록
  entered_by_role          TEXT REFERENCES role(code),
  entered_at               TEXT,
  approved_by_role         TEXT REFERENCES role(code),
  approved_at              TEXT,
  closed_at                TEXT,
  -- R12: 입력 시점과 데이터 귀속 기간을 분리한다 (소급 입력)
  is_retro                 INTEGER NOT NULL DEFAULT 0 CHECK (is_retro IN (0,1)),
  last_changed_by_role     TEXT REFERENCES role(code),
  updated_at               TEXT,
  UNIQUE (site_id, metric_code, period),
  -- 상태와 값의 정합성 (D-2)
  CHECK (status <> 'unavailable'
         OR (value_raw IS NULL AND unavailable_reason_code IS NOT NULL)),
  CHECK (status NOT IN ('entered','approved','closed')
         OR (value_raw IS NOT NULL AND unit_raw IS NOT NULL)),
  CHECK (status <> 'returned' OR return_reason IS NOT NULL)
);

CREATE INDEX idx_entry_period   ON entry(period, entity_code, status);
CREATE INDEX idx_entry_metric   ON entry(metric_code, period);
CREATE INDEX idx_entry_pending  ON entry(status, flag_anomaly, entity_code);

-- -----------------------------------------------------------------------------
-- 6. 증빙 (R2 1:1 연결 · R45 무변경 보존 · R86 S 지표 차단)
-- -----------------------------------------------------------------------------

CREATE TABLE evidence (
  id                 INTEGER PRIMARY KEY,
  entry_id           INTEGER NOT NULL REFERENCES entry(id),
  r2_key             TEXT NOT NULL UNIQUE,
  original_filename  TEXT NOT NULL,
  content_type       TEXT NOT NULL,
  byte_size          INTEGER NOT NULL,
  sha256             TEXT NOT NULL,
  uploaded_by_role   TEXT NOT NULL REFERENCES role(code),
  uploaded_at        TEXT NOT NULL
);

CREATE INDEX idx_evidence_entry ON evidence(entry_id);

-- -----------------------------------------------------------------------------
-- 7. 배출계수 · 환율 (R11 출처·고시일 · R59 버전)
-- -----------------------------------------------------------------------------

CREATE TABLE factor (
  id            INTEGER PRIMARY KEY,
  factor_type   TEXT NOT NULL,                           -- metric.factor_type 과 대응
  purpose       TEXT NOT NULL CHECK (purpose IN ('emission','heating_value')),
  region        TEXT NOT NULL,                            -- KR / CN-NE / VN / GLOBAL
  year          INTEGER NOT NULL,
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,                            -- tCO2eq/kWh, TJ/kL ...
  gwp_set       TEXT CHECK (gwp_set IN ('AR5','AR6')),
  source        TEXT NOT NULL,                            -- 고시 주체
  published_at  TEXT NOT NULL,                            -- 고시일
  version       TEXT NOT NULL,                            -- v2026.1
  UNIQUE (factor_type, purpose, region, year, version)
);

CREATE TABLE fx_rate (
  currency   TEXT NOT NULL,
  year       INTEGER NOT NULL,
  rate_avg   REAL NOT NULL,                               -- R65 연평균 환율 (KRW 기준)
  source     TEXT NOT NULL,
  version    TEXT NOT NULL,
  PRIMARY KEY (currency, year, version)
);

-- -----------------------------------------------------------------------------
-- 8. 산정 결과 (D-3 계수버전 스냅샷)
-- -----------------------------------------------------------------------------

CREATE TABLE calc_result (
  id              INTEGER PRIMARY KEY,
  entity_code     TEXT NOT NULL REFERENCES entity(code),
  site_id         INTEGER REFERENCES site(id),            -- NULL = 법인 합산
  period          TEXT NOT NULL,
  result_metric   TEXT NOT NULL,                          -- metric.code (계산지표)
  value           REAL,
  factor_version  TEXT NOT NULL,
  fx_version      TEXT,
  calculated_at   TEXT NOT NULL,
  UNIQUE (entity_code, site_id, period, result_metric, factor_version)
);

CREATE INDEX idx_calc_lookup ON calc_result(period, entity_code, result_metric);

-- -----------------------------------------------------------------------------
-- 9. 확보 가능 최초 연도 (R43 — 소급 범위는 증빙 확보 가능성이 결정한다)
-- -----------------------------------------------------------------------------

CREATE TABLE data_availability (
  entity_code       TEXT NOT NULL REFERENCES entity(code),
  metric_code       TEXT NOT NULL REFERENCES metric(code),
  earliest_year     INTEGER,                              -- NULL = 확보 불가
  reason_code       TEXT CHECK (reason_code IN
                      ('AVAILABLE','RETENTION_EXPIRED','SYSTEM_NOT_AGGREGATED',
                       'PREDECESSOR_LEFT','NOT_APPLICABLE','NOT_SURVEYED')),
  surveyed_at       TEXT,
  surveyed_by_role  TEXT REFERENCES role(code),
  PRIMARY KEY (entity_code, metric_code)
);

-- -----------------------------------------------------------------------------
-- 10. 제출 이력 (EP1 결손 1 — "3월에 뭘 냈는가"에 답한다)
-- -----------------------------------------------------------------------------

CREATE TABLE submission (
  id                INTEGER PRIMARY KEY,
  submitted_to      TEXT NOT NULL,                        -- 고객사명 / 관할 당국 / 보고서
  purpose           TEXT NOT NULL CHECK (purpose IN ('customer','regulatory','report','internal')),
  period_from       TEXT NOT NULL,
  period_to         TEXT NOT NULL,
  output_r2_key     TEXT,
  factor_version    TEXT NOT NULL,
  fx_version        TEXT,
  approved_by_role  TEXT NOT NULL REFERENCES role(code),  -- R54 최종 승인 없이 생성 불가
  submitted_at      TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- 11. 변경 이력 (D-4 · R45 · R58)
-- -----------------------------------------------------------------------------

CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY,
  table_name       TEXT NOT NULL,
  row_key          TEXT NOT NULL,
  field            TEXT NOT NULL,
  old_value        TEXT,
  new_value        TEXT,
  changed_by_role  TEXT REFERENCES role(code),
  changed_at       TEXT NOT NULL
);

CREATE INDEX idx_audit_row ON audit_log(table_name, row_key, changed_at);

-- =============================================================================
-- 트리거 — 설계 원칙을 DB가 강제한다
-- =============================================================================

-- R86: S(사회) 지표에는 증빙을 첨부할 수 없다.
--      "조심한다"가 아니라 "넣을 방법이 없다". 급여대장 업로드 경로를 원천 차단.
CREATE TRIGGER trg_evidence_policy_none
BEFORE INSERT ON evidence
FOR EACH ROW
WHEN (SELECT m.evidence_policy
        FROM entry e JOIN metric m ON m.code = e.metric_code
       WHERE e.id = NEW.entry_id) = 'none'
BEGIN
  SELECT RAISE(ABORT, 'evidence is not allowed for this metric (evidence_policy=none)');
END;

-- R69: 계산지표는 사람이 값을 넣을 수 없다.
CREATE TRIGGER trg_entry_no_calculated
BEFORE INSERT ON entry
FOR EACH ROW
WHEN (SELECT is_calculated FROM metric WHERE code = NEW.metric_code) = 1
BEGIN
  SELECT RAISE(ABORT, 'calculated metrics cannot be entered manually');
END;

-- D-4: 물리적 삭제는 없다.
CREATE TRIGGER trg_entry_no_delete
BEFORE DELETE ON entry
BEGIN
  SELECT RAISE(ABORT, 'entry rows are never deleted (D-4)');
END;

CREATE TRIGGER trg_evidence_no_delete
BEFORE DELETE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence rows are never deleted (D-4, R45)');
END;

-- D-4 / R58: 값 변경은 이력으로 남는다. 확정 후 수정도 차단하지 않고 기록한다.
CREATE TRIGGER trg_entry_audit_value
AFTER UPDATE OF value_raw ON entry
FOR EACH ROW WHEN OLD.value_raw IS NOT NEW.value_raw
BEGIN
  INSERT INTO audit_log (table_name, row_key, field, old_value, new_value, changed_by_role, changed_at)
  VALUES ('entry', CAST(NEW.id AS TEXT), 'value_raw',
          CAST(OLD.value_raw AS TEXT), CAST(NEW.value_raw AS TEXT),
          NEW.last_changed_by_role, COALESCE(NEW.updated_at, datetime('now')));
END;

CREATE TRIGGER trg_entry_audit_status
AFTER UPDATE OF status ON entry
FOR EACH ROW WHEN OLD.status IS NOT NEW.status
BEGIN
  INSERT INTO audit_log (table_name, row_key, field, old_value, new_value, changed_by_role, changed_at)
  VALUES ('entry', CAST(NEW.id AS TEXT), 'status', OLD.status, NEW.status,
          NEW.last_changed_by_role, COALESCE(NEW.updated_at, datetime('now')));
END;

-- R59: 계수는 수정하지 않고 새 버전으로 등록한다. 과거 산출물이 재현되어야 한다.
CREATE TRIGGER trg_factor_immutable
BEFORE UPDATE OF value, unit, gwp_set ON factor
BEGIN
  SELECT RAISE(ABORT, 'factors are immutable — register a new version instead (R59)');
END;

-- =============================================================================
-- 뷰 — 앱 코드를 줄인다 (EP8 원칙 1: 파일과 코드를 작게 유지)
-- =============================================================================

-- 입력값 + 지표정보 + 표준단위 환산값. 화면과 산정이 모두 이 뷰를 읽는다.
CREATE VIEW v_entry AS
SELECT
  e.id, e.entity_code, e.site_id, e.metric_code, e.period,
  m.category, m.name_ko, m.name_zh, m.name_vi,
  m.period_type, m.disclosure_level, m.evidence_policy,
  m.factor_type, m.ghg_scope,
  e.value_raw, e.unit_raw,
  CASE WHEN e.value_raw IS NULL THEN NULL
       ELSE e.value_raw * COALESCE(o.factor_to_standard, 1.0) END AS value_std,
  m.unit_standard,
  e.status, e.unavailable_reason_code, e.return_reason,
  e.flag_anomaly, e.anomaly_pct, e.ai_suggested_value, e.is_retro,
  e.entered_by_role, e.entered_at, e.approved_by_role, e.approved_at, e.closed_at,
  (SELECT COUNT(*) FROM evidence v WHERE v.entry_id = e.id) AS evidence_count
FROM entry e
JOIN metric m ON m.code = e.metric_code
LEFT JOIN metric_unit_override o
       ON o.metric_code = e.metric_code AND o.entity_code = e.entity_code;

-- 해당 법인이 해당 월에 입력해야 하는 항목과 그 상태. 월간 입력 시트(S1)와 현황 보드(S4)가 쓴다.
-- period_type 을 반영하므로 월간 시트에 분기·연간 항목이 섞이지 않는다 (R63).
CREATE VIEW v_expected_entry AS
SELECT
  a.entity_code,
  a.metric_code,
  m.category, m.period_type, m.sort_order,
  m.name_ko, m.name_zh, m.name_vi, m.unit_standard,
  COALESCE(o.unit_input, m.unit_standard) AS unit_input,
  m.evidence_policy, m.help_ko, m.help_zh, m.help_vi,
  a.owner_role, a.backup_role,
  m.active_from, m.active_to
FROM metric_assignment a
JOIN metric m ON m.code = a.metric_code
LEFT JOIN metric_unit_override o
       ON o.metric_code = a.metric_code AND o.entity_code = a.entity_code
WHERE a.is_applicable = 1
  AND m.is_calculated = 0;

-- 비율·집약도 지표의 분자·분모 정의. calc.js 가 이 뷰만 읽고 재계산한다 (R64).
CREATE VIEW v_ratio_metric AS
SELECT code, name_ko, unit_standard, numerator_codes, denominator_codes, multiplier
FROM metric
WHERE is_calculated = 1 AND calc_kind = 'ratio';
