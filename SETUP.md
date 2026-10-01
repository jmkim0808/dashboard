# 설치 절차

목표: **3법인 담당자가 로그인해서 자기 항목을 입력할 수 있는 상태.**

두 단계로 나눈다.

| 단계 | 소요 | 결제수단 | 끝나면 |
|---|---|---|---|
| **A. 테스트 배포** | 20분 | **필요 없음** | 인터넷 주소가 생기고 **본인이** 전 화면을 눌러볼 수 있다 |
| **B. 운영 전환** | 30분 | 필요 (R2) | 로그인이 걸리고 **3법인 담당자가** 각자 역할로 쓸 수 있다 |

A만 해도 "진짜로 도는지"는 확인된다. **A에서 멈춰도 된다 — 단, A 상태는 주소를 아는 사람이면
누구나 들어온다. 그동안은 가짜 데이터만 넣는다.**

A 단계는 **파일 저장소(R2) 없이** 올린다. R2 는 결제수단 등록이 있어야 켜지기 때문이다.
R2 가 빠지면 **증빙 파일 첨부**와 **제출 산출물 보관** 두 가지만 꺼지고,
입력 · 승인 · 확정 · 배출량 산정 · 조회 · 데이터북 · 경영진 화면은 전부 동작한다.

각 단계 끝에 **확인** 항목이 있다. 확인이 안 되면 다음으로 넘어가지 않는다.

---

# A. 테스트 배포

## A-0. 준비

| 항목 | 내용 |
|---|---|
| Cloudflare 계정 | 없으면 생성 (무료) |
| Node.js | 20 이상 |
| 결제수단 | **A 단계에서는 필요 없다.** B 단계의 R2(파일 저장소) 활성화 때 카드 등록을 요구한다 |

> 10명·3법인 규모는 D1·Workers·R2 모두 무료 사용량 안에 들어갈 것으로 본다.
> 실제 무료 한도와 초과 요금은 바뀔 수 있으니 결제 화면에 표시되는 값을 기준으로 본다.

```bash
git clone https://github.com/jmkim0808/dashboard.git
cd dashboard
git checkout claude/esg-data-platform-planning-yimv1i
npm install
```

> `npm install` 이 설치하는 것은 **wrangler 하나**다. 빌드 도구·프레임워크를 쓰지 않는다.

**확인** — `npx wrangler --version` 이 버전을 출력한다.

### 🪟 Windows · PowerShell 에서 `npx wrangler` 가 안 될 때

`npx wrangler` 가 아무것도 출력하지 않거나 버전이 안 나오는 경우가 있다.
설치는 정상이고, `npx` · `.cmd` · `.ps1` 같은 **실행 중계 파일**이 환경에 따라 다르게 동작하기 때문이다.

**Node 로 wrangler 를 직접 실행하면 중계 파일을 거치지 않는다.** 아래 두 줄로 짧은 별명을 만든다.

```powershell
$repo = $PWD.Path
function wr { node "$repo\node_modules\wrangler\bin\wrangler.js" @args }
```

**이 문서의 `npx wrangler` 를 전부 `wr` 로 바꿔 읽으면 된다.** (예: `npx wrangler login` → `wr login`)

- PowerShell 창을 닫았다 열면 위 두 줄을 다시 실행한다. **반드시 `dashboard` 폴더 안에서** 실행한다.
- `npm run dev` · `npm run deploy` 같은 `npm run ~` 명령은 별명 없이도 동작한다.
- `wr --version` 이 출력되지 않아도 **`wr login` 에서 브라우저가 열리면 정상**이다.

> 실제 설치(2026-10-01)에서 `npx wrangler`, `node_modules\.bin\wrangler.cmd` 를 가리킨 별명이
> 모두 무출력으로 끝났고, Node 직접 실행으로 로그인까지 완료했다.

### `npm install` 이 `allow-scripts` 경고를 낼 때

`esbuild` · `workerd` 설치 스크립트가 차단되면 wrangler 가 실행되지 않는다.
`workerd` 는 Cloudflare 런타임 실행파일이다.

```powershell
npm approve-scripts esbuild
npm approve-scripts workerd
npm install
```

`npm audit fix` 는 실행하지 않는다. wrangler 버전이 바뀔 수 있다.
`vulnerabilities` · `looking for funding` 메시지는 오류가 아니다.

### 관리자 권한으로 PowerShell 을 열지 않는다

관리자 권한으로 열면 시작 폴더가 `C:\Windows\System32` 라 `git clone` 이 `Permission denied` 로 실패한다.
일반 PowerShell 을 쓰거나, 먼저 `cd $HOME` 으로 옮긴다.

---

## A-1. Cloudflare 로그인

```bash
npx wrangler login
```

브라우저가 열리고 권한을 승인하면 끝난다.

**확인** — `npx wrangler whoami` 가 계정 이메일을 출력한다.

---

## A-2. 데이터베이스 만들기 (최초 1회)

```bash
npx wrangler d1 create powernet-esg
```

출력되는 `database_id` 를 **`wrangler.toml`** 의 **두 곳**(맨 위 `[[d1_databases]]` 와
아래 `[[env.preview.d1_databases]]`)에 붙여 넣는다.

> 이 저장소에는 이미 `3c853e68-…` 가 들어 있다(2026-10-01 생성). **같은 계정이면 다시 만들지 않는다.**
> 다른 Cloudflare 계정으로 새로 설치할 때만 이 단계를 한다.

**확인** — `npx wrangler d1 list` 에 `powernet-esg` 가 보인다.

> 파일 저장소(R2)는 **B-0** 에서 만든다. A 단계에는 필요 없다.

---

## A-3. 로컬에서 먼저 확인 (선택)

실수해도 되돌리기 쉬운 쪽부터 한다.

> 이 단계는 **건너뛰어도 된다.** 같은 파일을 개발 쪽에서 이미 검증했다(제약 24 · 산정 84 통과).
> `npm run verify` 는 Python 이 필요하다. 설치되어 있지 않으면 A-4 로 바로 간다.

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

🪟 Windows 에서 `npm run` 이 아무것도 출력하지 않으면 같은 일을 `wr` 로 한다.
`-y` 는 "데이터베이스가 잠시 멈춥니다. 진행할까요?" 확인에 자동으로 예를 누른다.

```powershell
wr d1 execute powernet-esg --remote --file=db/schema.sql -y
wr d1 execute powernet-esg --remote --file=db/seed.sql -y
wr d1 execute powernet-esg --remote --file=db/factors.sql -y
```

**확인** — 오류 없이 끝난다.

---

## A-5. 테스트 배포

```bash
npx wrangler deploy --env preview
```

`--env preview` 는 `wrangler.toml` 아래쪽 `[env.preview]` 설정으로 올린다는 뜻이다. 운영과 다른 점:

| 항목 | 테스트(preview) | 운영 |
|---|---|---|
| 이름 · 주소 | `powernet-esg-preview` | `powernet-esg` |
| 로그인 | **없음** | Cloudflare Access |
| 파일 저장소(R2) | **연결 안 함** — 결제수단 불필요 | 연결 |
| 데이터베이스(D1) | 운영과 **같은 것** | — |

배포 중에 아래 경고가 나오는데 **의도한 것이다.** 테스트 배포에서 R2 를 일부러 뺐다는 뜻이다.

```
"r2_buckets" exists at the top level, but not on "env.preview".
```

배포가 끝나면 `https://powernet-esg-preview.<계정>.workers.dev` 주소가 출력된다. 그 주소를 연다.

**확인** — 네 가지가 보인다.

| 항목 | 기대 상태 |
|---|---|
| 화면 | 경영진 현황 또는 기준정보 화면이 뜬다 |
| 인증 | **주의** — "로그인 없이 열린 테스트 배포" ← 정상 |
| 데이터베이스 (D1) | **정상** — 법인 3 · 지표 49 · 담당배정 111 |
| 파일 저장소 (R2) | **주의** — "테스트 배포, R2 미연결" ← 정상 |
| 배출계수 | **정상** — v2026.1 · 4건 |

`#/health` 주소를 직접 열면 위 항목을 한 화면에서 볼 수 있다.

> 🔴 **이 상태는 주소를 아는 사람이면 누구나 들어온다.** 실데이터를 넣지 않는다.
> 심양·빈푹 담당자에게 주소를 보내 **접속만** 확인받는 용도로는 지금이 가장 빠르다. (EP6 1절)

테스트 배포에서는 누구나 **본사 ESG 총괄(HQ_ESG)** 권한으로 들어온다.
입력·검증·승인·조회·데이터북은 다 눌러볼 수 있고, **2단 확정과 산출물 생성(파트장 권한)** 만 안 된다.
심양 중국어 화면은 `#/sheet/SY` 에서 언어 버튼(中文)으로 볼 수 있다.

### ✅ A 단계 통과 조건

- 화면이 뜨고 데이터베이스 · 배출계수가 **정상**, 인증 · 파일 저장소는 **주의**
- 값을 하나 넣고 저장되는지, 조회 화면에서 배출량이 계산되는지
- 심양·빈푹에서 그 주소가 열린다

여기까지 되면 기술적 불확실성은 거의 해소된 것이다.

---

# B. 운영 전환

실데이터를 넣기 전에 **반드시** 끝낸다.

## B-0. 파일 저장소(R2) 활성화

R2 는 계정마다 처음 한 번 대시보드에서 켜야 한다. 명령으로는 켤 수 없다.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → 왼쪽 **R2 Object Storage**
   (안 보이면 **Storage & Databases** → **R2**)
2. 활성화 버튼 → 결제수단 등록
3. 버킷 생성:

```bash
npx wrangler r2 bucket create powernet-esg-evidence
```

활성화 전에 버킷을 만들면 아래 오류가 난다. 1~2 를 먼저 한다.

```
Please enable R2 through the Cloudflare Dashboard. [code: 10042]
```

**확인** — `npx wrangler r2 bucket list` 에 `powernet-esg-evidence` 가 보인다.

---

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

## B-4. 🔴 인증 요구 다시 켜기

**`--env preview` 없이** 배포하면 운영 설정(로그인 요구 · R2 연결)으로 올라간다.

```bash
npx wrangler deploy
```

`powernet-esg` 라는 **별도의 워커**로 올라가며, 테스트 배포(`powernet-esg-preview`)와는 주소가 다르다.

테스트 배포는 더 쓰지 않으면 지운다. 로그인 없이 열린 주소를 남겨두지 않는다.

```bash
npx wrangler delete --env preview
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
| 배포는 됐는데 화면이 "로그인 필요"만 뜬다 | Access 미설정 상태에서 운영 설정으로 배포함 | A 단계면 `deploy --env preview`, B 단계면 B-2 를 끝낸다 |
| `Please enable R2 through the Cloudflare Dashboard` | 계정에서 R2 를 아직 안 켬 | B-0. A 단계에서는 R2 가 필요 없다 |
| `"r2_buckets" ... not on "env.preview"` 경고 | 테스트 배포에서 R2 를 일부러 뺌 | 정상이다. 무시한다 |
| 증빙 첨부 시 "파일 저장소가 연결되어 있지 않습니다" | 테스트 배포 | 정상이다. B 단계 후 동작한다 |
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
