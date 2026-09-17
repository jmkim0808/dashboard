#!/usr/bin/env python3
"""
스키마 검증 — 설계 원칙이 DB 수준에서 실제로 강제되는지 확인한다.

사용:  python3 db/verify.py

schema.sql 을 수정한 뒤에는 반드시 이것을 돌린다.
"모르는 것은 모른다고 남긴다", "개인정보는 넣을 곳이 없다" 같은 원칙이
주석에만 있고 제약에는 없으면, 언젠가 반드시 깨진다.
"""
import sqlite3, sys, os, re, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ok = fail = 0

def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1; print(f"  PASS  {name}")
    else:
        fail += 1; print(f"  FAIL  {name}" + (f"\n        {detail}" if detail else ""))

def rejects(conn, sql, params=()):
    """해당 SQL이 거부되어야 한다. 거부되면 True."""
    try:
        conn.execute(sql, params); conn.rollback(); return False
    except sqlite3.Error:
        conn.rollback(); return True

db = os.path.join(tempfile.mkdtemp(), "verify.db")
conn = sqlite3.connect(db)
conn.executescript(open(os.path.join(HERE, "schema.sql"), encoding="utf-8").read())
conn.executescript(open(os.path.join(HERE, "seed.sql"), encoding="utf-8").read())
conn.execute("PRAGMA foreign_keys = ON")

print("\n[1] 개인정보 Zero — 스키마에 개인 식별 컬럼이 존재하지 않는다 (R84)")
banned = ("name_of", "person", "employee_name", "staff_name", "email", "phone",
          "mobile", "tel", "resident", "ssn", "passport", "birth", "address",
          "emp_no", "employee_no", "staff_id", "user_name", "full_name")
found = []
for (tbl,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
    for col in conn.execute(f"PRAGMA table_info({tbl})").fetchall():
        c = col[1].lower()
        if any(b in c for b in banned):
            found.append(f"{tbl}.{col[1]}")
check("개인 식별 컬럼 없음", not found, f"발견: {found}")

print("\n[2] 부담당자 강제 — 1인 의존을 허용하지 않는다 (R67 / P-7)")
check("부담당자 없이 배정 저장 거부",
      rejects(conn, "INSERT INTO metric_assignment (metric_code, entity_code, owner_role, backup_role) "
                    "VALUES ('E01','HQ','HQ_FACILITY',NULL)"))
check("주담당 = 부담당 동일 지정 거부",
      rejects(conn, "INSERT INTO metric_assignment (metric_code, entity_code, owner_role, backup_role) "
                    "VALUES ('E14','HQ','HQ_ESG','HQ_ESG')"))
check("현재 배정에 부담당자 미지정 0건",
      conn.execute("SELECT COUNT(*) FROM metric_assignment WHERE backup_role IS NULL").fetchone()[0] == 0)

print("\n[3] 계산지표 — 사람이 값을 넣을 수 없다 (R69)")
check("계산지표 입력 거부",
      rejects(conn, "INSERT INTO entry (entity_code, site_id, metric_code, period, value_raw, unit_raw, status) "
                    "VALUES ('SY',2,'E-C3','2026-09',100,'tCO2eq','entered')"))

print("\n[4] 미입력과 미확보의 분리 (D-2 / P-2)")
check("미확보인데 값이 있으면 거부",
      rejects(conn, "INSERT INTO entry (entity_code, site_id, metric_code, period, value_raw, unit_raw, "
                    "status, unavailable_reason_code) VALUES ('SY',2,'E10','2026-09',5,'ton','unavailable','INVOICE_PENDING')"))
check("미확보인데 사유가 없으면 거부",
      rejects(conn, "INSERT INTO entry (entity_code, site_id, metric_code, period, status) "
                    "VALUES ('SY',2,'E10','2026-09','unavailable')"))
check("입력완료인데 값이 없으면 거부",
      rejects(conn, "INSERT INTO entry (entity_code, site_id, metric_code, period, status) "
                    "VALUES ('SY',2,'E10','2026-09','entered')"))
check("반송인데 사유코드가 없으면 거부",
      rejects(conn, "INSERT INTO entry (entity_code, site_id, metric_code, period, value_raw, unit_raw, status) "
                    "VALUES ('SY',2,'E10','2026-09',5,'ton','returned')"))
conn.execute("INSERT INTO entry (entity_code, site_id, metric_code, period, status, unavailable_reason_code, "
             "entered_by_role, entered_at) VALUES ('SY',2,'E10','2026-09','unavailable','INVOICE_PENDING','SY_OWNER',datetime('now'))")
conn.commit()
check("미확보 상태 정상 저장", conn.execute(
      "SELECT COUNT(*) FROM entry WHERE status='unavailable'").fetchone()[0] == 1)

print("\n[5] 자유 텍스트 없음 — 미확보 사유는 코드값만 (R87)")
check("등록되지 않은 사유코드 거부",
      rejects(conn, "INSERT INTO entry (entity_code, site_id, metric_code, period, status, unavailable_reason_code) "
                    "VALUES ('SY',2,'E11','2026-09','unavailable','기타 담당자가 자리에 없어서')"))
check("사유 선택지는 6개", conn.execute("SELECT COUNT(*) FROM unavailable_reason").fetchone()[0] == 6)
check("'기타/자유입력' 선택지 없음", conn.execute(
      "SELECT COUNT(*) FROM unavailable_reason WHERE code LIKE '%OTHER%' OR code LIKE '%ETC%'").fetchone()[0] == 0)

print("\n[6] 원본값 보존과 단위 환산 (D-1 / R26 / P-5)")
conn.execute("INSERT INTO entry (entity_code, site_id, metric_code, period, value_raw, unit_raw, status, "
             "entered_by_role, entered_at, last_changed_by_role, updated_at) "
             "VALUES ('SY',2,'E01','2026-09',126.5,'万kWh','entered','SY_OWNER',datetime('now'),'SY_OWNER',datetime('now'))")
conn.commit()
r = conn.execute("SELECT value_raw, unit_raw, value_std, unit_standard FROM v_entry "
                 "WHERE metric_code='E01' AND period='2026-09'").fetchone()
check(f"원본 {r[0]} {r[1]} 그대로 보존", r[0] == 126.5 and r[1] == '万kWh')
check(f"표준단위 자동 환산 -> {r[2]:,.0f} {r[3]}", abs(r[2] - 1265000.0) < 0.001)

print("\n[7] 증빙 — 인사·안전 지표에는 첨부 경로가 없다 (R86)")
eid_social = conn.execute("SELECT id FROM entry WHERE metric_code='E10'").fetchone()[0]
conn.execute("INSERT INTO entry (entity_code, site_id, metric_code, period, value_raw, unit_raw, status, "
             "entered_by_role, entered_at) VALUES ('SY',2,'S08','2026-09',1,'건','entered','SY_OWNER',datetime('now'))")
conn.commit()
eid_s08 = conn.execute("SELECT id FROM entry WHERE metric_code='S08'").fetchone()[0]
ev = ("INSERT INTO evidence (entry_id, r2_key, original_filename, content_type, byte_size, sha256, "
      "uploaded_by_role, uploaded_at) VALUES (?, ?, ?, 'application/pdf', 1, 'x', 'SY_OWNER', datetime('now'))")
check("산업재해 지표에 증빙 첨부 거부 (급여대장·재해조사표 차단)",
      rejects(conn, ev, (eid_s08, "k1", "工伤调查表.pdf")))
conn.execute(ev, (eid_social, "k2", "危废转移单.pdf")); conn.commit()
check("환경 지표 증빙 첨부는 정상", conn.execute("SELECT COUNT(*) FROM evidence").fetchone()[0] == 1)

print("\n[8] 삭제 없음 · 변경은 이력으로 (D-4 / R58)")
eid_e01 = conn.execute("SELECT id FROM entry WHERE metric_code='E01'").fetchone()[0]
check("입력값 삭제 거부", rejects(conn, "DELETE FROM entry WHERE id=?", (eid_e01,)))
check("증빙 삭제 거부", rejects(conn, "DELETE FROM evidence WHERE entry_id=?", (eid_social,)))
conn.execute("UPDATE entry SET value_raw=1265, last_changed_by_role='HQ_ESG', updated_at=datetime('now') WHERE id=?", (eid_e01,))
conn.execute("UPDATE entry SET status='approved', approved_by_role='HQ_ESG', last_changed_by_role='HQ_ESG', updated_at=datetime('now') WHERE id=?", (eid_e01,))
conn.commit()
logs = conn.execute("SELECT field, old_value, new_value, changed_by_role FROM audit_log "
                    "WHERE row_key=? ORDER BY id", (str(eid_e01),)).fetchall()
check(f"값 변경 이력 자동 기록 ({len(logs)}건)", len(logs) == 2)
if len(logs) == 2:
    print(f"        {logs[0][0]}: {logs[0][1]} -> {logs[0][2]} (by {logs[0][3]})")
    print(f"        {logs[1][0]}: {logs[1][1]} -> {logs[1][2]} (by {logs[1][3]})")

print("\n[9] 배출계수 불변 — 과거 산출물이 재현되어야 한다 (R59 / D-3)")
conn.execute("INSERT INTO factor (factor_type, purpose, region, year, value, unit, gwp_set, source, published_at, version) "
             "VALUES ('electricity','emission','CN-NE',2025,0.001,'tCO2eq/kWh','AR5','테스트','2025-01-01','v2026.1')")
conn.commit()
check("기존 계수값 수정 거부 (새 버전으로만 등록)",
      rejects(conn, "UPDATE factor SET value=0.002 WHERE version='v2026.1'"))

print("\n[10] 임대 사업장 배분 근거 (R61 / EP1 3월 5일)")
check("임대인데 배분 기준·근거 없이 저장 거부",
      rejects(conn, "INSERT INTO site (entity_code, name_ko, name_local, ownership, valid_from) "
                    "VALUES ('HQ','제2사무소','Office 2','leased','2026-01-01')"))

print("\n[11] 중복 입력 방지")
check("같은 사업장·지표·기간 중복 저장 거부",
      rejects(conn, "INSERT INTO entry (entity_code, site_id, metric_code, period, value_raw, unit_raw, status) "
                    "VALUES ('SY',2,'E01','2026-09',999,'万kWh','entered')"))

print(f"\n{'='*58}\n  통과 {ok} / 실패 {fail}\n{'='*58}")
conn.close()
sys.exit(1 if fail else 0)
