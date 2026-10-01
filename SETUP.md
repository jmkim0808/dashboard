# 설치 절차

목표: **3법인 담당자가 로그인해서 자기 항목을 입력할 수 있는 상태.**

두 단계로 나눈다.

| 단계 | 소요 | 끝나면 |
|---|---|---|
| **A. 테스트 배포** | 30분 | 인터넷 주소가 생기고 **본인이** 전 화면을 눌러볼 수 있다 |
| **B. 운영 전환** | 30분 | 로그인이 걸리고 **3법인 담당자가** 각자 역할로 쓸 수 있다 |

A만 해도 "진짜로 도는지"는 확인된다. **A에서 멈춰도 된다 — 단, A 상태는 주소를 아는 사람이면
누구나 들어온다. 그동안은 가짜 데이터만 넣는다.**

각 단계 끝에 **확인** 항목이 있다. 확인이 안 되면 다음으로 넘어가지 않는다.

---

# A. 테스트 배포

## A-0. 준비

| 항목 | 내용 |
|---|---|
| Cloudflare 계정 | 없으면 생성 (무료) |
| Node.js | 20 이상 |
| 결제수단 | **R2(파일 저장소) 생성에 카드 등록이 필요하다.** 무료 사용량 안에서는 청구되지 않는다 |

> 예상 비용은 월 1만원 이하다. 10명·3법인 규모는 D1·R2·Workers 모두 무료 사용량 안에 들어간다.
> 요금제는 바뀔 수 있으니 결제 화면의 표시를 기준으로 본다.

```bash
git clone https://github.com/jmkim0808/dashboard.git
cd dashboard
git checkout claude/esg-data-platform-planning-yimv1i
npm install
```

> `npm install` 이 설치하는 것은 **wrangler 하나**다. 빌드 도구·프레임워크를 쓰지 않는다.

**확인** — `npx wrangler --version` 이 버전을 출력한다.

### 🪟 Windows · PowerShell 에서 `npx wrangler` 가 안 될 때

`npx` 가 wrangler 를 못 찾는 경우가 있다. 설치는 정상이고 `npx` 만 문제다.
아래로 확인한다.

```powershell
.\node_modules\.bin\wrangler --version
```

여기서 버전이 나오면 짧은 별명을 만들어 쓴다. **이 문서의 `npx wrangler` 를 전부 `wr` 로 바꿔 읽으면 된다.**

```powershell
$repo = $PWD.Path
function wr { & "$repo\node_modules\.bin\wrangler" @args }
wr --version
```

PowerShell 창을 닫았다 열면 위 두 줄을 다시 실행한다.
`npm run dev` · `npm run deploy` 같은 `npm run ~` 명령은 별명 없이도 동작한다.

> `npm install` 이 **`allow-scripts`** 경고를 내며 `esbuild` · `workerd` 설치 스크립트를
> 막았다면 wrangler 가 아예 실행되지 않는다. `workerd` 는 Cloudflare 런타임 실행파일이다.
> ```powershell
> npm approve-scripts esbuild
> npm approve-scripts workerd
> npm install
> ```
> `npm audit fix` 는 실행하지 않는다. wrangler 버전이 바뀔 수 있다.

---

## A-1. Cloudflare 로그인

```bash
npx wrangler login
```

브라우저가 열리고 권한을 승인하면 끝난다.

**확인** — `npx wrangler whoami` 가 계정 이메일을 출력한다.

---

## A-2. 데이터베이스와 파일 저장소 만들기 (최초 1회)

```bash
npx wrangler d1 create powernet-esg
npx wrangler r2 bucket create powernet-esg-evidence
```

첫 명령이 출력하는 `database_id` 를 복사해서 **`wrangler.toml`** 에 붙여 넣는다.

```toml
[[d1_databases]]
binding = "DB"
database_name = "powernet-esg"
database_id = "여기에 붙여넣는다"      ← 지금은 "[확인 필요 ...]" 로 되어 있다
```

**확인** — `npx wrangler d1 list` 에 `powernet-esg` 가 보인다.

---

## A-3. 로컬에서 먼저 확인

실수해도 되돌리기 쉬운 쪽부터 한다.

```bash
npm run db:local        # 스키마 + 기준정보
npm run db:factors      # 배출계수
npm run db:count
npm run verify
```

| 명령 | 기대 출력 |
|---|---|
| `db:count` | **HQ 29 · SY 29 · VP 29** (해외법인 담당자 1인이 매월 입력할 항목 수) |
| `verify` | **통과 24 / 실패 0** |

---

## A-4. 운영 데이터베이스에 적용

```bash
npm run db:remote           # 스키마 + 기준정보
npm run db:factors:remote   # 배출계수 ← 이걸 빼면 산정이 전부 "미산정" 으로 나온다
```

**확인** — 오류 없이 끝난다.

---

## A-5. 로그인 없이 한 번 띄워보기

Access 를 아직 안 걸었으므로, 잠시 인증 요구를 끈다.
**`wrangler.toml`** 의 아래 값을 바꾼다.

```toml
REQUIRE_ACCESS = "false"     # ← A 단계 동안만. B-4 에서 반드시 "true" 로 되돌린다
```

```bash
npm run check     # 설정 검증 (배포 안 함)
npm run deploy
```

배포가 끝나면 `https://powernet-esg.<계정>.workers.dev` 주소가 출력된다. 그 주소를 연다.

**확인** — 네 가지가 보인다.

| 항목 | 기대 상태 |
|---|---|
| 화면 | 경영진 현황 또는 기준정보 화면이 뜬다 |
| 데이터베이스 (D1) | **정상** — 법인 3 · 지표 49 · 담당배정 111 |
| 파일 저장소 (R2) | **정상** |
| 배출계수 | **정상** — v2026.1 · 4건 |

`#/health` 주소를 직접 열면 위 항목을 한 화면에서 볼 수 있다.

> 🔴 **이 상태는 주소를 아는 사람이면 누구나 들어온다.** 실데이터를 넣지 않는다.
> 심양·빈푹 담당자에게 주소를 보내 **접속만** 확인받는 용도로는 지금이 가장 빠르다. (EP6 1절)

### ✅ A 단계 통과 조건

- 화면이 뜨고 데이터베이스·파일 저장소·배출계수가 모두 **정상**
- 심양·빈푹에서 그 주소가 열린다

여기까지 되면 기술적 불확실성은 거의 해소된 것이다.

---

# B. 운영 전환

실데이터를 넣기 전에 **반드시** 끝낸다.

## B-1. 커스텀 도메인 연결

Cloudflare 대시보드 → **Workers & Pages** → `powernet-esg` → **Settings**
→ **Domains & Routes** → **Add** → **Custom domain** → `esg.powernet.co.kr`

> 회사 도메인이 Cloudflare에 등록되어 있어야 한다. 등록되어 있지 않으면
> 네임서버 변경이 필요하고 반영까지 수 시간 걸린다. **이것이 B 단계에서 가장 오래 걸리는 일이다.**
> 전산 담당이 없으므로 도메인 관리 주체를 먼저 확인한다.

**확인** — `https://esg.powernet.co.kr` 로 화면이 열린다.

---

## B-2. Cloudflare Access 설정

대시보드 → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**

| 항목 | 값 |
|---|---|
| Application name | `POWERNET ESG` |
| Session duration | 24 hours |
| Domain | `esg.powernet.co.kr` |

**Policy** 추가:

| 항목 | 값 |
|---|---|
| Policy name | `사내 담당자` |
| Action | Allow |
| Include | **Emails** → 사용할 10명의 이메일을 나열 |

> 10명이므로 이메일을 직접 나열하는 것이 가장 단순하다.
> 회사 계정(Google Workspace·Microsoft 365)이 있으면 **Login methods** 에 연동해도 된다.
> 연동하지 않으면 이메일로 일회용 코드(OTP)가 오는 방식으로 동작한다.
>
> **Access 는 50명까지 무료다.** 10명 규모는 비용이 발생하지 않는다.

**확인** — `https://esg.powernet.co.kr` 접속 시 로그인 화면이 먼저 나온다.

---

## B-3. 역할 매핑 등록

로그인한 사람이 어떤 역할인지 시스템에 알려준다.

```bash
npx wrangler secret put ROLE_MAP
```

프롬프트가 뜨면 아래 형태의 **JSON 한 줄**을 붙여 넣는다. (`.dev.vars.example` 에 예시가 있다.)

```json
{"lead@powernet.co.kr":["HQ_LEAD","HQ_ADMIN"],"esg@powernet.co.kr":["HQ_ESG","SY_BACKUP","VP_BACKUP"],"facility@powernet.co.kr":["HQ_FACILITY"],"hr@powernet.co.kr":["HQ_HR"],"safety@powernet.co.kr":["HQ_SAFETY"],"prod@powernet.co.kr":["HQ_PROD"],"proc@powernet.co.kr":["HQ_PROC"],"ceo@powernet.co.kr":["HQ_EXEC"],"sy.ga@powernet.com.cn":["SY_OWNER"],"vp.ga@powernet.com.vn":["VP_OWNER"]}
```

**B-2 의 Access Policy 에 넣은 이메일과 정확히 같아야 한다.** 한쪽에만 있으면
로그인은 되는데 역할이 없는 상태(또는 그 반대)가 된다.

### 이메일이 데이터베이스에 들어가지 않는 이유

이 매핑은 **시크릿에만 존재하고 데이터베이스에 저장되지 않는다.**
Worker 는 로그인한 이메일을 역할코드로 바꾼 직후 버리고, 응답·로그·DB 어디에도 남기지 않는다.

그래서 이 시스템에는 개인정보가 **한 건도** 없다. 중국·베트남의 개인정보 국외이전
규제(2026년 1월 강화) 적용 대상 자체가 되지 않는다. (R84 / R85)

> 해외법인 부담당자 인력 여력이 없으면, 본사 ESG 총괄 이메일에
> `SY_BACKUP` · `VP_BACKUP` 을 함께 넣는다. 위 예시가 그렇게 되어 있다.

---

## B-4. 🔴 인증 요구 되돌리기

A-5 에서 꺼 두었던 것을 **반드시** 켠다. **`wrangler.toml`**:

```toml
REQUIRE_ACCESS = "true"
```

```bash
npm run deploy
```

**확인** — 로그아웃 상태(시크릿 창)로 접속하면 로그인 화면이 먼저 나온다.

---

## B-5. 🔴 workers.dev 라우트 비활성화 — 건너뛰면 안 된다

**Settings** → **Domains & Routes** → `powernet-esg.<계정>.workers.dev` 항목을 **Disable**.

### 왜 필요한가

이 시스템은 Cloudflare Access 가 붙여주는 헤더로 사용자를 식별한다.
`workers.dev` 주소가 열려 있으면 **Access 를 우회해서 그 헤더를 위조**할 수 있다.
커스텀 도메인만 남기고 닫아야 Access 가 실질적인 문이 된다.

**B-2(Access 설정)를 먼저 끝낸 뒤에 닫는다.** 순서가 바뀌면 들어갈 문이 없어진다.

**확인** — `workers.dev` 주소가 더 이상 열리지 않는다.

---

## B-6. 최종 확인

`https://esg.powernet.co.kr` 를 열고 `#/health` 를 확인한다.

| 항목 | 기대 상태 |
|---|---|
| 인증 (Cloudflare Access) | **정상** — 내 역할과 담당 항목 수가 표시됨 |
| 데이터베이스 (D1) | **정상** — 법인 3 · 지표 49 · 담당배정 111 |
| 파일 저장소 (R2) | **정상** |
| 배출계수 | **정상** — v2026.1 |

이어서 **역할별로** 한 번씩 열어본다. 담당자가 교육 때 보게 될 화면이다.

| 계정 | 기대 화면 |
|---|---|
| 파트장 | 경영진 현황. 메뉴에 검증·승인 · 데이터북 · 기준정보가 모두 보인다 |
| 심양 담당 | **중국어** 월간 입력 시트. 메뉴에 데이터북·기준정보가 **안 보인다** |
| 빈푹 담당 | **베트남어** 월간 입력 시트 |

### ✅ B 단계 통과 조건

- 로그인 없이는 아무것도 열리지 않는다
- 각 담당자가 자기 역할의 화면만 본다
- 심양·빈푹에서 접속된다

여기까지 되면 **담당자 교육**(`docs/ops/w4-test.md`)으로 넘어간다.

---

## 실데이터를 넣기 전에

A 단계에서 넣은 테스트 데이터가 남아 있으면 지운다.

```bash
npx wrangler d1 execute powernet-esg --remote --command="SELECT COUNT(*) FROM entry"
```

0 이 아니면, 스키마부터 다시 적용해 비운다. **입력값은 트리거가 삭제를 막으므로(D-4),
지우는 방법은 데이터베이스를 다시 만드는 것뿐이다.**

```bash
npx wrangler d1 delete powernet-esg      # 되돌릴 수 없다. 테스트 데이터만 들어 있을 때만 한다
npx wrangler d1 create powernet-esg      # 새 database_id 를 wrangler.toml 에 다시 붙여넣는다
npm run db:remote && npm run db:factors:remote && npm run deploy
```

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

### 자주 막히는 곳

| 증상 | 원인 | 조치 |
|---|---|---|
| 배포는 됐는데 화면이 "로그인 필요"만 뜬다 | `REQUIRE_ACCESS="true"` 인데 Access 미설정 | A 단계면 `"false"` 로, B 단계면 B-2 를 끝낸다 |
| 로그인은 되는데 "역할 미매핑" | `ROLE_MAP` 에 그 이메일이 없다 | B-3 의 JSON 과 B-2 의 Policy 이메일을 맞춘다 |
| 산정값이 전부 "미산정" | 배출계수 미적용 | `npm run db:factors:remote` |
| `db:remote` 가 "table already exists" | 이미 적용된 DB | 정상이다. 다시 적용할 필요 없다 |
| 심양에서만 안 열린다 | 망 경로 | 모바일 데이터로 재시도 → 되면 사내망 문제. EP6 1절 |

---

## 명령 요약

| 명령 | 용도 |
|---|---|
| `npm run dev` | 로컬에서 띄우기 (`localhost:8787`) |
| `npm run check` | 설정 검증 (배포 안 함) |
| `npm run deploy` | 운영 배포 |
| `npm run db:local` / `db:factors` | 로컬 DB에 스키마·기준정보 / 배출계수 |
| `npm run db:remote` / `db:factors:remote` | 운영 DB에 적용 |
| `npm run db:count` | 법인별 월간 항목 수 (각 29) |
| `npm run verify` | 제약 검증 (24항목) |
| `npm run g3` | 산정 검산 (84항목) — dev 서버를 띄운 상태에서 |
| `npx wrangler tail` | 운영 로그 실시간 보기 |

> Windows 에서 `npx wrangler` 가 안 되면 A-0 의 `wr` 별명을 쓴다.
