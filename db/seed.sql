-- =============================================================================
-- 파워넷 ESG 데이터 입력플랫폼 — 기준정보 초기 데이터
-- 적용 순서: schema.sql -> seed.sql
--
-- 배출계수(factor)와 환율(fx_rate)은 이 파일에 넣지 않는다. db/factors.sql 로 분리했다.
-- 계수는 매년 갱신되므로 기준정보와 생애주기가 다르고, 새 version 으로만 추가되기 때문이다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 법인 (fiscal_year_start / calc_standard 는 EP8 B1·B3 확정 후 검증 필요)
-- -----------------------------------------------------------------------------
INSERT INTO entity (code, name_ko, name_zh, name_vi, country, currency,
                    fiscal_year_start, locale_default, calc_standard, grid_region) VALUES
 ('HQ','파워넷 본사','帕沃奈特 总部','Powernet Trụ sở','KR','KRW',1,'ko',
  '온실가스 배출권거래제 운영 지침 (산정·보고 지침)','KR'),
 ('SY','심양법인','沈阳法人','Chi nhánh Thẩm Dương','CN','CNY',1,'zh',
  'GB/T 32150-2025 산업기업 온실가스 배출 산정 및 보고 통칙','CN-NE'),
 ('VP','빈푹법인','永福法人','Chi nhánh Vĩnh Phúc','VN','VND',1,'vi',
  'Decree 06/2022/ND-CP 온실가스 인벤토리 방법론','VN');

-- -----------------------------------------------------------------------------
-- 사업장 (본사는 임대 — 배분 기준·비율·근거가 없으면 CHECK 제약으로 저장 거부)
-- allocation_ratio 는 EP8 B5 확정 후 실제 값으로 교체
-- -----------------------------------------------------------------------------
INSERT INTO site (id, entity_code, name_ko, name_local, ownership,
                  allocation_basis, allocation_ratio, allocation_evidence, valid_from) VALUES
 (1,'HQ','서울 본사 사무소','Seoul Head Office','leased',
  'area', 0.342, '[확인 필요] 임대차계약서 전용면적 기준 — EP8 B5', '2025-01-01'),
 (2,'SY','심양 제1공장','沈阳第一工厂','owned', NULL, NULL, NULL, '2025-01-01'),
 (3,'VP','빈푹 제1공장','Nhà máy Vĩnh Phúc 1','owned', NULL, NULL, NULL, '2025-01-01');

-- -----------------------------------------------------------------------------
-- 역할 (R85 — label 은 직무명이며 개인명이 아니다)
-- 이메일 <-> 역할 매핑은 Cloudflare Access 에서만 관리한다.
-- 해외법인 부담당자 인력 여력이 없으면, Access 에서 본사 ESG 총괄 담당자의
-- 이메일을 SY_BACKUP / VP_BACKUP 에 함께 매핑한다 (EP8 5절).
-- -----------------------------------------------------------------------------
INSERT INTO role (code, entity_code, label_ko, label_zh, label_vi, scope, locale) VALUES
 ('HQ_LEAD',    'HQ','경영지원실 파트장',      NULL, NULL, 'approver',  'ko'),
 ('HQ_ESG',     'HQ','본사 ESG 데이터 총괄',   NULL, NULL, 'manager',   'ko'),
 ('HQ_FACILITY','HQ','본사 총무·시설 담당',    NULL, NULL, 'entry',     'ko'),
 ('HQ_HR',      'HQ','본사 인사 담당',         NULL, NULL, 'entry',     'ko'),
 ('HQ_SAFETY',  'HQ','본사 안전보건 담당',     NULL, NULL, 'entry',     'ko'),
 ('HQ_PROD',    'HQ','본사 생산관리 담당',     NULL, NULL, 'entry',     'ko'),
 ('HQ_PROC',    'HQ','본사 구매 담당',         NULL, NULL, 'entry',     'ko'),
 ('HQ_EXEC',    'HQ','대표이사',               NULL, NULL, 'executive', 'ko'),
 ('HQ_ADMIN',   'HQ','시스템 관리',            NULL, NULL, 'admin',     'ko'),
 ('SY_OWNER',   'SY','심양법인 업무담당',      '沈阳法人 主担当', NULL, 'entry', 'zh'),
 ('SY_BACKUP',  'SY','심양법인 부담당',        '沈阳法人 副担当', NULL, 'entry', 'zh'),
 ('VP_OWNER',   'VP','빈푹법인 업무담당',      NULL, 'Chi nhánh Vĩnh Phúc - Phụ trách chính', 'entry', 'vi'),
 ('VP_BACKUP',  'VP','빈푹법인 부담당',        NULL, 'Chi nhánh Vĩnh Phúc - Phụ trách phụ',   'entry', 'vi');

-- -----------------------------------------------------------------------------
-- 미확보 사유 (R87 — 6개 선택지만. "기타(자유입력)"을 두지 않는다)
-- 부족하면 선택지를 추가하고, 자유 입력칸은 만들지 않는다.
-- -----------------------------------------------------------------------------
INSERT INTO unavailable_reason (code, label_ko, label_zh, label_vi, sort_order) VALUES
 ('INVOICE_PENDING',   '고지서·전표 미도착', '凭证未收到',   'Chưa nhận được hóa đơn', 1),
 ('NOT_APPLICABLE',    '해당 없음',          '不适用',       'Không áp dụng',          2),
 ('DEPT_NO_REPLY',     '담당부서 미회신',    '相关部门未回复','Bộ phận chưa phản hồi',  3),
 ('RETENTION_EXPIRED', '보관기간 경과',      '保管期已过',   'Đã hết thời hạn lưu',    4),
 ('SYSTEM_NOT_AGGREGATED','시스템 미집계',   '系统未汇总',   'Hệ thống chưa tổng hợp', 5),
 ('MEASUREMENT_UNAVAILABLE','측정 불가',     '无法测量',     'Không thể đo lường',     6);

-- -----------------------------------------------------------------------------
-- 지표 마스터 — 환경(E) 입력 14개
-- -----------------------------------------------------------------------------
INSERT INTO metric (code, category, name_ko, name_zh, name_vi, unit_standard,
  period_type, aggregation, definition_ko, help_ko, help_zh, help_vi,
  disclosure_level, evidence_policy, gri_code, kssb_code,
  factor_type, ghg_scope, sort_order, active_from) VALUES
 ('E01','E','전력 사용량','用电量','Điện năng tiêu thụ','kWh','monthly','sum',
  '해당 월 전력 사용량. 임대 사업장은 site.allocation_ratio 로 배분한다.',
  '전기요금 고지서의 당월 사용량','电费发票的当月用电量','Sản lượng điện trên hóa đơn tháng',
  'public','required','302-1','S2','electricity',2,101,'2025-01'),
 ('E02','E','도시가스 사용량','天然气用量','Khí thiên nhiên tiêu thụ','Nm3','monthly','sum',
  '해당 월 도시가스 사용량.','가스요금 고지서의 당월 사용량','燃气费发票的当月用量','Lượng khí trên hóa đơn tháng',
  'public','required','302-1','S2','natural_gas',1,102,'2025-01'),
 ('E03','E','경유 사용량 (설비·발전기)','柴油用量(设备·发电机)','Dầu diesel (thiết bị)','L','monthly','sum',
  '설비·비상발전기용 경유. 차량 연료는 E06 에 입력한다.','경유 구매 전표 합계','柴油采购单合计','Tổng phiếu mua dầu diesel',
  'public','required','302-1','S2','diesel',1,103,'2025-01'),
 ('E04','E','LPG 사용량','液化石油气用量','Khí LPG tiêu thụ','kg','monthly','sum',
  '해당 월 LPG 사용량.','LPG 구매 전표 합계','液化气采购单合计','Tổng phiếu mua LPG',
  'public','required','302-1','S2','lpg',1,104,'2025-01'),
 ('E05','E','차량 휘발유 사용량','车辆汽油用量','Xăng xe tiêu thụ','L','monthly','sum',
  '업무용 차량 휘발유.','유류카드 명세서 합계','油卡明细合计','Tổng bảng kê thẻ nhiên liệu',
  'public','required','302-1','S2','gasoline',1,105,'2025-01'),
 ('E06','E','차량 경유 사용량','车辆柴油用量','Dầu diesel xe','L','monthly','sum',
  '업무용 차량 경유.','유류카드 명세서 합계','油卡明细合计','Tổng bảng kê thẻ nhiên liệu',
  'public','required','302-1','S2','diesel_vehicle',1,106,'2025-01'),
 ('E07','E','스팀·온수 구매량','蒸汽·热水采购量','Hơi nước mua vào','GJ','monthly','sum',
  '외부에서 구매한 스팀·온수. 해당 없으면 미확보(해당 없음) 처리한다.',
  '열요금 고지서','热力费发票','Hóa đơn nhiệt',
  'public','required','302-1','S2','steam',2,107,'2025-01'),
 ('E08','E','용수 취수량','取水量','Lượng nước cấp','ton','monthly','sum',
  '상수도·지하수 취수량 합계.','수도요금 고지서의 당월 사용량','水费发票的当月用量','Lượng nước trên hóa đơn tháng',
  'public','required','303-3',NULL,NULL,NULL,108,'2025-01'),
 ('E09','E','용수 배출량','排水量','Lượng nước thải','ton','monthly','sum',
  '하수 배출량. 측정값이 없으면 하수요금 고지서 기준.','하수요금 고지서','污水费发票','Hóa đơn nước thải',
  'public','required','303-4',NULL,NULL,NULL,109,'2025-01'),
 ('E10','E','일반폐기물 발생량','一般废弃物产生量','Chất thải thông thường','ton','monthly','sum',
  '위탁처리한 일반(사업장)폐기물 발생량.','위탁처리 전표의 당월 합계','委托处理单当月合计','Tổng phiếu xử lý trong tháng',
  'public','required','306-3',NULL,NULL,NULL,110,'2025-01'),
 ('E11','E','지정폐기물 발생량','危险废弃物产生量','Chất thải nguy hại','ton','monthly','sum',
  '위탁처리한 지정(유해)폐기물 발생량.','지정폐기물 인계서 합계','危废转移单合计','Tổng phiếu chuyển giao CTNH',
  'public','required','306-3',NULL,NULL,NULL,111,'2025-01'),
 ('E12','E','폐기물 재활용량','废弃物回收量','Chất thải tái chế','ton','monthly','sum',
  '재활용으로 처리된 폐기물량.','위탁처리 전표의 처리방법별 구분','委托处理单按处理方式区分','Phân loại theo phương pháp xử lý',
  'public','required','306-4',NULL,NULL,NULL,112,'2025-01'),
 ('E13','E','폐기물 소각·매립량','废弃物焚烧·填埋量','Chất thải đốt và chôn lấp','ton','monthly','sum',
  '소각·매립으로 처리된 폐기물량.','위탁처리 전표의 처리방법별 구분','委托处理单按处理方式区分','Phân loại theo phương pháp xử lý',
  'public','required','306-5',NULL,NULL,NULL,113,'2025-01'),
 ('E14','E','대기오염물질 배출량','大气污染物排放量','Phát thải khí ô nhiễm','kg','quarterly','sum',
  '측정 대상 대기오염물질 배출량 합계. 대상 설비가 없으면 해당 없음.',
  '자가측정 성적서','自行监测报告','Báo cáo tự quan trắc',
  'public','required','305-7',NULL,NULL,NULL,114,'2025-01');

-- -----------------------------------------------------------------------------
-- 지표 마스터 — 사회(S) 입력 20개
--   R86: 인사·안전 지표(S01~S17)는 evidence_policy='none' — 증빙 첨부 기능이 없다.
--        급여대장·근태표·재해조사표가 올라갈 경로 자체를 만들지 않는다.
--   구매 지표(S18~S20)는 개인정보를 포함하지 않으므로 증빙 필수.
--   모든 값은 집계 숫자다. 개인 단위 데이터는 어떤 항목에도 들어가지 않는다 (P-8, R70).
-- -----------------------------------------------------------------------------
INSERT INTO metric (code, category, name_ko, name_zh, name_vi, unit_standard,
  period_type, aggregation, definition_ko, help_ko, help_zh, help_vi,
  disclosure_level, evidence_policy, gri_code, sort_order, active_from) VALUES
 ('S01','S','임직원 수 (정규직)','员工人数(正式)','Số lao động (chính thức)','명','monthly','eop',
  '월말 기준 정규직 인원 수.','인사 시스템 월말 재적 인원','人事系统月末在册人数','Số lao động cuối tháng',
  'public','none','2-7',201,'2025-01'),
 ('S02','S','임직원 수 (비정규직)','员工人数(非正式)','Số lao động (không chính thức)','명','monthly','eop',
  '월말 기준 기간제·단시간·파견 인원 수.','인사 시스템 월말 재적 인원','人事系统月末在册人数','Số lao động cuối tháng',
  'public','none','2-7',202,'2025-01'),
 ('S03','S','임직원 수 (남성)','员工人数(男)','Số lao động (nam)','명','monthly','eop',
  '월말 기준 남성 인원 수. S01+S02 합계와 S03+S04 합계는 일치해야 한다.',
  '인사 시스템 월말 재적 인원','人事系统月末在册人数','Số lao động cuối tháng',
  'public','none','405-1',203,'2025-01'),
 ('S04','S','임직원 수 (여성)','员工人数(女)','Số lao động (nữ)','명','monthly','eop',
  '월말 기준 여성 인원 수.','인사 시스템 월말 재적 인원','人事系统月末在册人数','Số lao động cuối tháng',
  'public','none','405-1',204,'2025-01'),
 ('S05','S','신규 채용 인원','新入职人数','Số lao động mới','명','monthly','sum',
  '해당 월 신규 입사자 수.','인사 시스템 입사 발령 건수','人事系统入职人数','Số người vào làm trong tháng',
  'public','none','401-1',205,'2025-01'),
 ('S06','S','자발적 퇴사 인원','主动离职人数','Số người tự nguyện thôi việc','명','monthly','sum',
  '해당 월 자발적 퇴사자 수. 이직률(S-C1)의 분자다.',
  '인사 시스템 퇴사 사유 구분','人事系统离职原因区分','Phân loại lý do thôi việc',
  'public','none','401-1',206,'2025-01'),
 ('S07','S','비자발적 퇴사 인원','被动离职人数','Số người bị chấm dứt HĐ','명','monthly','sum',
  '해당 월 비자발적 퇴사자 수(계약만료·해고 등).',
  '인사 시스템 퇴사 사유 구분','人事系统离职原因区分','Phân loại lý do thôi việc',
  'internal','none','401-1',207,'2025-01'),
 ('S08','S','산업재해 발생 건수','工伤事故件数','Số vụ tai nạn lao động','건','monthly','sum',
  '해당 월 산업재해 발생 건수. 재해자 개인정보는 입력하지 않는다.',
  '산업재해 기록 건수','工伤记录件数','Số vụ ghi nhận',
  'internal','none','403-9',208,'2025-01'),
 ('S09','S','재해 근로손실일수','工伤损失工日','Số ngày công mất','일','monthly','sum',
  '해당 월 재해로 인한 근로손실일수 합계. 강도율(S-C3)의 분자다.',
  '산업재해 기록의 요양일수 합계','工伤记录的休工日合计','Tổng số ngày nghỉ do tai nạn',
  'internal','none','403-9',209,'2025-01'),
 ('S10','S','총 근로시간','总工时','Tổng giờ làm việc','시간','monthly','sum',
  '해당 월 전 임직원 총 근로시간(연장근로 포함). 도수율·강도율의 분모다.',
  '근태 시스템 월 합계','考勤系统月合计','Tổng giờ trên hệ thống chấm công',
  'customer','none','403-9',210,'2025-01'),
 ('S11','S','안전보건 교육시간','安全卫生培训时间','Giờ đào tạo ATVSLĐ','시간','monthly','sum',
  '해당 월 안전보건 교육 총 시간(인원×시간).',
  '안전교육 실시 기록','安全培训记录','Hồ sơ đào tạo an toàn',
  'public','none','403-5',211,'2025-01'),
 ('S12','S','일반 교육시간','一般培训时间','Giờ đào tạo chung','시간','monthly','sum',
  '해당 월 직무·법정 외 교육 총 시간(인원×시간).',
  '교육 실시 기록','培训记录','Hồ sơ đào tạo',
  'public','none','404-1',212,'2025-01'),
 ('S13','S','직업병 발생 건수','职业病件数','Số ca bệnh nghề nghiệp','건','quarterly','sum',
  '해당 분기 직업병 진단 건수. 개인 상병 정보는 입력하지 않는다.',
  '보건관리 기록','健康管理记录','Hồ sơ quản lý sức khỏe',
  'internal','none','403-10',213,'2025-01'),
 ('S14','S','관리직 인원 (남성)','管理层人数(男)','Số quản lý (nam)','명','annual','eop',
  '연말 기준 관리직(팀장 이상) 남성 인원 수.','인사 시스템 직책자 현황','人事系统管理岗现状','Hiện trạng cấp quản lý',
  'public','none','405-1',214,'2025-01'),
 ('S15','S','관리직 인원 (여성)','管理层人数(女)','Số quản lý (nữ)','명','annual','eop',
  '연말 기준 관리직 여성 인원 수. 여성관리자비율(S-C5)의 분자다.',
  '인사 시스템 직책자 현황','人事系统管理岗现状','Hiện trạng cấp quản lý',
  'public','none','405-1',215,'2025-01'),
 ('S16','S','육아휴직 사용 인원','育儿假使用人数','Số người nghỉ thai sản','명','annual','sum',
  '연간 육아휴직 개시 인원 수.','인사 시스템 휴직 발령 건수','人事系统休假人数','Số người nghỉ theo hệ thống',
  'public','none','401-3',216,'2025-01'),
 ('S17','S','육아휴직 복귀 인원','育儿假复职人数','Số người trở lại sau nghỉ','명','annual','sum',
  '연간 육아휴직 후 복귀 인원 수. 복귀율(S-C6)의 분자다.',
  '인사 시스템 복직 발령 건수','人事系统复职人数','Số người trở lại theo hệ thống',
  'public','none','401-3',217,'2025-01'),
 ('S18','S','협력사 수','供应商数量','Số nhà cung cấp','개','quarterly','eop',
  '해당 분기말 거래 협력사 수.','구매 시스템 거래처 현황','采购系统供应商现状','Hiện trạng nhà cung cấp',
  'internal','required','204-1',218,'2025-01'),
 ('S19','S','자재 구매 금액','材料采购金额','Giá trị vật tư mua','현지통화','quarterly','sum',
  '해당 분기 자재 구매 금액(현지통화). 환율은 시스템이 적용한다.',
  '구매 시스템 분기 합계','采购系统季度合计','Tổng mua theo quý',
  'internal','required','204-1',219,'2025-01'),
 ('S20','S','자재 구매 중량','材料采购重量','Khối lượng vật tư mua','ton','monthly','sum',
  '해당 월 주요 자재 구매 중량. Scope 3 산정을 위한 원천 데이터로 축적한다(1차에서 산정하지 않음).',
  '구매 시스템 월 합계','采购系统月合计','Tổng mua theo tháng',
  'internal','required',NULL,220,'2025-01');

-- -----------------------------------------------------------------------------
-- 지표 마스터 — 생산(PROD) 입력 3개 (집약도 분모 · 제품별 배분 기준)
-- -----------------------------------------------------------------------------
INSERT INTO metric (code, category, name_ko, name_zh, name_vi, unit_standard,
  period_type, aggregation, definition_ko, help_ko, help_zh, help_vi,
  disclosure_level, evidence_policy, sort_order, active_from) VALUES
 ('P01','PROD','제품 생산 수량','产品生产数量','Số lượng sản phẩm','EA','monthly','sum',
  '해당 월 제품 생산 수량 합계.','ERP 생산실적 추출','ERP生产实绩导出','Xuất kết quả sản xuất ERP',
  'internal','required',301,'2025-01'),
 ('P02','PROD','제품 생산 중량','产品生产重量','Khối lượng sản phẩm','kg','monthly','sum',
  '해당 월 제품 생산 중량 합계. 제품별 배분 시 가중치로 사용한다.',
  'ERP 생산실적 추출','ERP生产实绩导出','Xuất kết quả sản xuất ERP',
  'internal','required',302,'2025-01'),
 ('P03','PROD','매출액','销售额','Doanh thu','현지통화(백만)','monthly','sum',
  '해당 월 매출액(현지통화 백만 단위). 집약도 지표의 분모다. 환율은 시스템이 적용한다.',
  '회계 마감 자료','会计结账资料','Số liệu kế toán',
  'internal','required',303,'2025-01');

-- -----------------------------------------------------------------------------
-- 지표 마스터 — 계산지표 12개 (R69: 입력 불가. 트리거가 차단한다)
--   R64: 비율·집약도는 분자·분모를 각각 보유하고 집계 시 재계산한다.
--        값 = (Σ numerator_codes) / (Σ denominator_codes) × multiplier
--        3법인 합산도 이 식으로 재계산되므로 "비율의 평균" 오류가 발생하지 않는다.
--   에너지·배출량(calc_kind='energy'|'emission')만 calc.js 가 factor 테이블로 계산한다.
-- -----------------------------------------------------------------------------
INSERT INTO metric (code, category, name_ko, name_zh, name_vi, unit_standard,
  period_type, aggregation, definition_ko, disclosure_level, evidence_policy,
  gri_code, kssb_code, is_calculated, calc_kind,
  numerator_codes, denominator_codes, multiplier, sort_order, active_from) VALUES
 ('E-C1','E','총 에너지 사용량','总能源消耗量','Tổng năng lượng','TJ','monthly','sum',
  'Σ(연료·전력 사용량 × 순발열량계수). factor(purpose=heating_value) 적용.',
  'public','none','302-1','S2',1,'energy',NULL,NULL,NULL,151,'2025-01'),
 ('E-C2','E','총 에너지 사용량 (TOE)','总能源消耗量(TOE)','Tổng năng lượng (TOE)','TOE','annual','sum',
  'E-C1 × 1000 / 41.868. 베트남 Decree 06/2022 의 1,000 TOE 판정 기준 대응(R10·R33).',
  'internal','none','302-1','S2',1,'energy',NULL,NULL,NULL,152,'2025-01'),
 ('E-C3','E','Scope 1 배출량','范围一排放量','Phát thải Scope 1','tCO2eq','monthly','sum',
  'Σ(ghg_scope=1 지표 사용량 × 배출계수 × GWP).','public','none','305-1','S2',1,'emission',
  NULL,NULL,NULL,153,'2025-01'),
 ('E-C4','E','Scope 2 배출량 (location)','范围二排放量','Phát thải Scope 2','tCO2eq','monthly','sum',
  'Σ(ghg_scope=2 지표 사용량 × 지역 전력·스팀 배출계수). location-based.',
  'public','none','305-2','S2',1,'emission',NULL,NULL,NULL,154,'2025-01'),
 -- 집약도의 분모(P03 매출액)는 법인별 현지통화로 입력되고, 집계 시 연평균환율로
 -- 원화 환산된 뒤 합산된다 (R65). 따라서 분모 단위는 "백만원"이다.
 -- 배수는 읽을 수 있는 자릿수를 만들기 위한 것이다.
 --   에너지: TJ/백만원 × 100,000 = GJ/억원   (1 TJ = 1,000 GJ · 1 억원 = 100 백만원)
 --   배출량: tCO2eq/백만원 × 100 = tCO2eq/억원
 -- 배수 없이 두면 0.0000027 같은 값이 나와 보고서에 쓸 수 없다.
 ('E-C5','E','에너지 집약도','能源强度','Cường độ năng lượng','GJ/억원','annual','avg',
  'E-C1 ÷ P03 × 100,000. 분자·분모를 각각 합산한 뒤 재계산한다. 분모는 원화 환산 매출액.',
  'public','none','302-3','S2',1,'ratio','E-C1','P03',100000.0,155,'2025-01'),
 ('E-C6','E','배출 집약도','排放强度','Cường độ phát thải','tCO2eq/억원','annual','avg',
  '(E-C3 + E-C4) ÷ P03 × 100. 분자·분모를 각각 합산한 뒤 재계산한다. 분모는 원화 환산 매출액.',
  'public','none','305-4','S2',1,'ratio','E-C3,E-C4','P03',100.0,156,'2025-01'),
 ('S-C1','S','이직률','离职率','Tỷ lệ thôi việc','%','annual','avg',
  'S06 ÷ (S01 + S02) × 100. 자발적 퇴사자 기준.',
  'public','none','401-1',NULL,1,'ratio','S06','S01,S02',100.0,251,'2025-01'),
 ('S-C2','S','재해 도수율','事故频率','Tần suất tai nạn','건/백만시간','annual','avg',
  'S08 ÷ S10 × 1,000,000.','internal','none','403-9',NULL,1,'ratio','S08','S10',1000000.0,252,'2025-01'),
 ('S-C3','S','재해 강도율','事故严重率','Mức độ nghiêm trọng','일/천시간','annual','avg',
  'S09 ÷ S10 × 1,000.','internal','none','403-9',NULL,1,'ratio','S09','S10',1000.0,253,'2025-01'),
 ('S-C4','S','1인당 교육시간','人均培训时间','Giờ đào tạo bình quân','시간','annual','avg',
  '(S11 + S12) ÷ (S01 + S02).','public','none','404-1',NULL,1,'ratio','S11,S12','S01,S02',1.0,254,'2025-01'),
 ('S-C5','S','여성 관리자 비율','女性管理层比例','Tỷ lệ quản lý nữ','%','annual','avg',
  'S15 ÷ (S14 + S15) × 100.','public','none','405-1',NULL,1,'ratio','S15','S14,S15',100.0,255,'2025-01'),
 ('S-C6','S','육아휴직 복귀율','育儿假复职率','Tỷ lệ trở lại sau nghỉ','%','annual','avg',
  'S17 ÷ S16 × 100.','public','none','401-3',NULL,1,'ratio','S17','S16',100.0,256,'2025-01');

-- -----------------------------------------------------------------------------
-- 법인별 입력 단위 오버라이드 (R26 · P-5)
--   심양법인 전기요금 고지서는 万kWh 단위를 쓴다. 담당자가 환산하지 않는다.
--   EP1 "만kWh 사건"이 구조적으로 발생할 수 없게 하는 지점이다.
-- -----------------------------------------------------------------------------
INSERT INTO metric_unit_override (metric_code, entity_code, unit_input, factor_to_standard) VALUES
 ('E01','SY','万kWh', 10000.0);

-- -----------------------------------------------------------------------------
-- 담당 배정 (R67: backup_role NOT NULL — 부담당자 없이는 저장되지 않는다)
--   해외법인은 담당자 1인이 전 항목을 담당한다 (EP3 P7·P8).
--   is_applicable 은 EP8 B6(법인별 해당 없는 항목 식별) 결과로 갱신한다.
-- -----------------------------------------------------------------------------
INSERT INTO metric_assignment (metric_code, entity_code, owner_role, backup_role, is_applicable)
SELECT
  m.code,
  e.code,
  CASE
    WHEN e.code <> 'HQ'                          THEN e.code || '_OWNER'
    WHEN m.category = 'E'                        THEN 'HQ_FACILITY'
    WHEN m.category = 'PROD'                     THEN 'HQ_PROD'
    WHEN m.code IN ('S08','S09','S11','S13')     THEN 'HQ_SAFETY'
    WHEN m.code IN ('S18','S19','S20')           THEN 'HQ_PROC'
    ELSE 'HQ_HR'
  END,
  CASE WHEN e.code = 'HQ' THEN 'HQ_ESG' ELSE e.code || '_BACKUP' END,
  1
FROM metric m
CROSS JOIN entity e
WHERE m.is_calculated = 0;

-- -----------------------------------------------------------------------------
-- 확보 가능 최초 연도 (R43)
--   EP8 2-1절 A3 조사 결과를 여기에 채운다. 조사 전에는 NOT_SURVEYED 다.
--   소급 범위(2025~2026)는 의지가 아니라 이 표가 결정한다.
-- -----------------------------------------------------------------------------
INSERT INTO data_availability (entity_code, metric_code, earliest_year, reason_code)
SELECT e.code, m.code, NULL, 'NOT_SURVEYED'
FROM metric m CROSS JOIN entity e
WHERE m.is_calculated = 0;

-- =============================================================================
-- 배출계수 · 환율
--
-- 별도 파일로 분리했다:  db/factors.sql
--   적용: npm run db:factors
--
-- 계수 정책(2026-09-17 확정)과 3개 지역 전력 배출계수의 출처·고시일이 그 파일에 있다.
-- 계수는 불변이며 값이 바뀌면 새 version 으로 등록한다(R59). seed 를 다시 돌리지 않는다.
-- =============================================================================
