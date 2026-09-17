# 설치 절차 (W0 — G0 게이트)

목표: **브라우저에서 화면이 뜨고, 로그인이 걸리고, 데이터베이스와 파일 저장소가 연결된 상태.**
반나절 작업이며, 여기까지 되면 기술적 불확실성의 대부분이 해소된다.

각 단계 끝에 **확인** 항목이 있다. 확인이 안 되면 다음 단계로 넘어가지 않는다.

---

## 0. 준비

| 항목 | 내용 |
|---|---|
| Cloudflare 계정 | 없으면 생성. **Workers Paid 구독 필요** (월 $5) |
| 도메인 | 회사 도메인의 서브도메인 사용 (예: `esg.powernet.co.kr`). 도메인이 Cloudflare에 등록되어 있어야 한다 |
| 설치 | Node.js 20 이상 |

```bash
git clone <이 저장소>
cd dashboard
npm install
```

> `npm install` 이 설치하는 것은 **wrangler 하나**다. 빌드 도구·프레임워크를 쓰지 않는다.

**확인** — `npx wrangler --version` 이 버전을 출력한다.

---

## 1. Cloudflare 로그인

```bash
npx wrangler login
```

브라우저가 열리고 권한을 승인하면 끝난다.

**확인** — `npx wrangler whoami` 가 계정 이메일을 출력한다.

---

## 2. 데이터베이스와 파일 저장소 생성 (최초 1회)

```bash
npx wrangler d1 create powernet-esg
npx wrangler r2 bucket create powernet-esg-evidence
```

첫 명령이 출력하는 `database_id` 를 복사해서 **`wrangler.toml`** 의 아래 부분에 붙여 넣는다.

```toml
[[d1_databases]]
binding = "DB"
database_name = "powernet-esg"
database_id = "여기에 붙여넣는다"
```

**확인** — `npx wrangler d1 list` 에 `powernet-esg` 가 보인다.

---

## 3. 스키마와 기준정보 적용

먼저 **로컬**에 적용해서 확인한다. 실수해도 되돌리기 쉽다.

```bash
npm run db:local
npm run db:count
```

`db:count` 결과가 **HQ 29 / SY 29 / VP 29** 여야 한다.
해외법인 담당자 1인이 매월 입력할 항목 수다.

제약이 살아있는지도 확인한다.

```bash
npm run verify
```

`통과 23 / 실패 0` 이 나와야 한다.

로컬이 정상이면 **운영**에 적용한다.

```bash
npm run db:remote
```

**확인** — 위 세 명령이 모두 통과한다.

---

## 4. 로컬에서 먼저 띄워보기

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

브라우저에서 `http://localhost:8787` 을 연다.

이 단계에서는 로그인이 없으므로 **인증 항목이 "실패"** 로 나오는 것이 정상이다.
**데이터베이스와 파일 저장소가 "정상"** 이면 된다.

**확인** — 화면이 뜨고, 데이터베이스 카드에 `법인 3 · 지표 49 · 담당배정 111` 이 보인다.

---

## 5. 배포

```bash
npm run check    # 설정 검증 (실제 배포 안 함)
npm run deploy
```

**확인** — 배포 후 출력된 주소를 열면 로컬과 같은 화면이 나온다.

---

## 6. 커스텀 도메인 연결

Cloudflare 대시보드 → **Workers & Pages** → `powernet-esg` → **Settings** → **Domains & Routes**
→ **Add** → **Custom domain** → `esg.powernet.co.kr` 입력.

**확인** — `https://esg.powernet.co.kr` 로 화면이 열린다.

> 🔴 심양법인 접속 테스트를 이 시점에 한다. 심양 담당자에게 이 주소를 보내
> ① 회사 유선망 ② 모바일 데이터 두 경로로 열리는지 확인받는다. (EP6 1절)

---

## 7. 🔴 workers.dev 라우트 비활성화 — 건너뛰면 안 된다

**Settings** → **Domains & Routes** → `powernet-esg.<계정>.workers.dev` 항목을 **Disable**.

### 왜 필요한가

이 시스템은 Cloudflare Access 가 붙여주는 헤더로 사용자를 식별한다.
`workers.dev` 주소가 열려 있으면 **Access 를 우회해서 그 헤더를 위조**할 수 있다.
커스텀 도메인만 남기고 닫아야 Access 가 실질적인 문이 된다.

**확인** — `workers.dev` 주소가 더 이상 열리지 않는다.

---

## 8. Cloudflare Access 설정

Cloudflare 대시보드 → **Zero Trust** → **Access** → **Applications** → **Add an application**
→ **Self-hosted**

| 항목 | 값 |
|---|---|
| Application name | `POWERNET ESG` |
| Session duration | 24 hours (권장) |
| Domain | `esg.powernet.co.kr` |

**Policy** 추가:

| 항목 | 값 |
|---|---|
| Policy name | `사내 담당자` |
| Action | Allow |
| Include | **Emails** → 사용할 10명의 이메일을 나열 |

> 사용자가 10명이므로 이메일을 직접 나열하는 것이 가장 단순하다.
> 회사 계정(Google Workspace·Microsoft 365)이 있으면 **Login methods** 에 연동해도 된다.
> 연동하지 않으면 이메일로 일회용 코드(OTP)가 발송되는 방식으로 동작한다.

**Zero Trust 요금** — Access 는 **50명까지 무료**다. 10명 규모는 비용이 발생하지 않는다.

**확인** — `https://esg.powernet.co.kr` 접속 시 로그인 화면이 먼저 나온다.

---

## 9. 역할 매핑 등록

로그인한 사람이 어떤 역할인지 시스템에 알려준다.

```bash
npx wrangler secret put ROLE_MAP
```

프롬프트가 뜨면 아래 형태의 **JSON 한 줄**을 붙여 넣는다.
(`.dev.vars.example` 에 예시가 있다.)

```json
{"lead@powernet.co.kr":["HQ_LEAD","HQ_ADMIN"],"esg@powernet.co.kr":["HQ_ESG","SY_BACKUP","VP_BACKUP"],"facility@powernet.co.kr":["HQ_FACILITY"],"hr@powernet.co.kr":["HQ_HR"],"safety@powernet.co.kr":["HQ_SAFETY"],"prod@powernet.co.kr":["HQ_PROD"],"proc@powernet.co.kr":["HQ_PROC"],"ceo@powernet.co.kr":["HQ_EXEC"],"sy.ga@powernet.com.cn":["SY_OWNER"],"vp.ga@powernet.com.vn":["VP_OWNER"]}
```

### 이메일이 데이터베이스에 들어가지 않는 이유

이 매핑은 **시크릿에만 존재하고 데이터베이스에 저장되지 않는다.**
Worker 는 로그인한 이메일을 역할코드로 바꾼 직후 버리고, 응답·로그·DB 어디에도 남기지 않는다.

그래서 이 시스템에는 개인정보가 **한 건도** 없다. 중국·베트남의 개인정보 국외이전
규제(2026년 1월 강화) 적용 대상 자체가 되지 않는다. (R84 / R85)

> 해외법인 부담당자 인력 여력이 없으면, 본사 ESG 총괄 담당자의 이메일에
> `SY_BACKUP` · `VP_BACKUP` 을 함께 넣는다. 위 예시가 그렇게 되어 있다.

**확인** — 화면의 **내 역할** 영역에 자신의 역할과 담당 항목 수가 표시된다.

---

## 10. 재배포 후 최종 확인

```bash
npm run deploy
```

`https://esg.powernet.co.kr` 를 열고 네 항목을 확인한다.

| 항목 | 기대 상태 |
|---|---|
| 인증 (Cloudflare Access) | **정상** — 부여된 역할이 표시됨 |
| 데이터베이스 (D1) | **정상** — 법인 3 · 지표 49 · 담당배정 111 · 월간 항목 각 29 |
| 파일 저장소 (R2) | **정상** |
| 배출계수 | **주의** ← 이 단계에서는 정상이다 |

**배출계수가 "주의"인 것은 정상이다.** 실제 고시값(EP8 B4) 확인 후 등록하며,
입력·검증 화면은 계수 없이 동작한다. 산정 로직(W3, 10/6~10) 전까지 확보하면 된다.

### ✅ G0 게이트 통과 조건

- 인증 · 데이터베이스 · 파일 저장소 = **정상**
- 심양·빈푹 담당자가 해당 주소에 접속 가능

여기까지 되면 **W1(2026-09-22~26, 기준정보 관리 화면)** 으로 넘어간다.

---

## 문제가 생겼을 때

1. 화면의 각 항목에 **무엇을 하면 되는지 안내 문구**가 표시된다. 먼저 그것을 따른다.
2. 해결되지 않으면 **원본 응답 보기** 버튼을 눌러 내용을 **전부 복사**해서 AI에게 붙여 넣는다.
3. 서버 로그가 필요하면 다음을 실행하고 출력을 그대로 붙여 넣는다.

```bash
npx wrangler tail
```

> 요약하지 말고 **오류 메시지 전문**을 붙여 넣는다. AI는 오류 한 줄로 원인을 특정할 수 있지만,
> 요약된 증상으로는 추측만 한다. (EP8 원칙 6)

---

## 명령 요약

| 명령 | 용도 |
|---|---|
| `npm run dev` | 로컬에서 띄우기 |
| `npm run check` | 설정 검증 (배포 안 함) |
| `npm run deploy` | 운영 배포 |
| `npm run db:local` | 로컬 DB에 스키마·기준정보 적용 |
| `npm run db:remote` | 운영 DB에 적용 |
| `npm run db:count` | 법인별 월간 항목 수 확인 (각 29) |
| `npm run verify` | 제약 검증 (23항목) |
| `npx wrangler tail` | 운영 로그 실시간 보기 |
