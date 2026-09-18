---
# Gen Artifact
pipeline_id: 20260917-231945
phase: 07-attachments
feature: 테스트 데이터 첨부파일 — 코드 시나리오에 파일을 올리고 setInputFiles 로 쓰기
branch: feat/scenario-attachments
base: main
---

# 07 — 테스트 데이터 첨부파일

작성: 2026-09-18 · 브랜치 `feat/scenario-attachments` (main 에서 분기) · **push 하지 않음**

---

## 0. 한 줄 요약

**첨부 없이 실패(`failed`) → 첨부하면 성공(`passed`) 을 docker·local 양쪽에서 실측했다.**
`setInputFiles` 의 상대 경로 기준이 **테스트 프로세스의 `process.cwd()`** 라는 것을 직접 재서
확인했고(추측하지 않았다), 그에 맞춰 첨부를 **작업공간 루트**에 푼다 — 두 모드가 같은 코드로 돈다.
**`STORAGE_KEY_PATTERN` 은 한 글자도 넓히지 않았다.** 증적 다운로드의 traversal 방어가
여전히 유효함을 DB 직접 오염으로 실측했다. 검증 중 **고아 파일 97MB**를 발견해 고쳤다.

---

## 1. 검증 결과 요약표

| 항목 | 기준 | 결과 | 판정 |
|---|---|---|---|
| `pnpm typecheck` | 7/7 | **7 successful, 7 total** | ✅ |
| `pnpm lint` | 0 problems | **7/7 · 0 problems** | ✅ |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 경고 0건** (최대 청크 330.22KB) | ✅ |
| `pnpm test` | 516건 이상 | **616건** (contracts 199 · api 129 · runner 232 · web 56) | ✅ **+100** |
| HEX 리터럴 (스타일 값) | 0건 | **0건** (JSDoc 시안 출처 표기만 — 기준선과 동일) | ✅ |
| `style={{` | 신규 0건 | **2건**(기존 CSS 변수 주입) · 신규 **0건** | ✅ |
| **★ 첨부 없이 실패 → 첨부하면 성공** | 증명 | **local `failed`→`passed` · docker `failed`→`passed`** | ✅ |
| **★ traversal 방어 (업로드 14종)** | 전부 거부 | **14/14 거부(400)** | ✅ |
| **★ traversal 방어 (DB 직접 오염 → 증적 다운로드)** | 전부 거부 | **5/5 거부(400) · `/etc/passwd` 유출 0건** | ✅ |
| **★ traversal 방어 (DB 직접 오염 → 첨부 다운로드)** | 전부 거부 | **4/4 거부(400) · 유출 0건** | ✅ |
| **★ traversal 방어 (DB 직접 오염 → Runner 작업공간 쓰기)** | 차단 | **차단 · 임의 경로 쓰기 0건** | ✅ |
| **★ 한글 파일명 왕복** | 무손실 | 업로드→목록→다운로드→컨테이너 배치→`setInputFiles` **전 구간 일치** | ✅ |
| **용량 상한 초과 거부** | 413 | 개당 **413** · 개수 **413** · 합계 **413** · 빈 파일 **400** | ✅ |
| **실행 후 임시 파일 정리** | 잔재 0 | `/tmp/testflow-code-*` **0건** · docker 작업공간 루트 **0건** | ✅ |
| **회귀 — 첨부 없는 코드 실행** | 정상 | **passed 2/2** | ✅ |
| **회귀 — 녹화(steps) 시나리오 실행** | 정상 | **passed 2/2** | ✅ |
| **웹 UI 콘솔 에러** | 0건 | **0건** | ✅ |
| 초기 로드 JS | 546.38KB 에서 유의미 증가 없음 | **548.86KB** (+2.48KB, +0.45%) | ⚠ 수치 보고 |

---

## 2. ★★ Playwright `setInputFiles` 상대 경로 해석 기준 — **실측한 사실**

계획이 "추측하지 마라"고 못 박은 지점이다. Playwright **1.63.0** 으로 직접 쟀다.

### 2.1 측정 설계

작업공간 `W` 를 만들고 `W/playwright.config.mjs`(`testDir: "./specs"`),
`W/specs/probe.spec.ts` 를 두고, **cwd 를 `W/runfrom` 으로 두고** 실행했다.
spec 은 `page.setContent('<input type="file">')` 후 `setInputFiles("marker.txt")` 만 한다.
`marker.txt` 를 **한 곳에만** 두고 3회 반복했다.

### 2.2 결과 (원문)

```
### CASE 1: marker only in CWD (runfrom/)
PROBE cwd=/mnt/c/Users/jhson1/sifprobe/runfrom
PROBE RESULT=OK name=marker.txt size=11
  1 passed (9.9s)
### CASE 2: marker only in testDir (specs/)
PROBE RESULT=FAIL Error: ENOENT: no such file or directory, stat 'marker.txt'
  1 passed (3.3s)
### CASE 3: marker only in config/root dir (W/)
PROBE RESULT=FAIL Error: ENOENT: no such file or directory, stat 'marker.txt'
  1 passed (4.4s)
```

| 파일을 둔 곳 | 결과 |
|---|---|
| 테스트 프로세스의 **cwd** | **OK** (`name=marker.txt size=11`) |
| `testDir`(spec 과 같은 디렉토리) | `ENOENT: stat 'marker.txt'` |
| config / rootDir | `ENOENT: stat 'marker.txt'` |

### 2.3 한글 파일명도 같은 규칙으로 동작한다

```
PROBE cwd=/mnt/c/Users/jhson1/sifprobe/runfrom
PROBE RESULT=OK 테스트용 파일-1.docx:8 | 테스트용 파일-2.docx:9
  1 passed (3.7s)
```

### 2.4 → 설계 귀결

**기준은 `process.cwd()` 다.** Runner 의 cwd 는 두 모드 모두 **작업공간 루트**다:

| 모드 | cwd 를 정하는 코드 | 실측 |
|---|---|---|
| `local` | `spawn(node, [cli,…], { cwd: ws.dir })` (`code-executor.ts`) | `passed 4/4` |
| `docker` | `-v <ws>:/ws` + **`-w /ws`** (`code-container.ts`) | `docker inspect` `WorkingDir: /ws` · `passed 4/4` |

그래서 첨부를 **작업공간 루트에 평평하게** 푼다. spec 이 `specs/` 아래에 있는 것은 무관하다.
**두 모드가 분기 없이 같은 코드로 동작한다.**

---

## 3. ★★ `STORAGE_KEY_PATTERN` 을 **넓히지 않았다** — 별도 패턴을 새로 뒀다

### 3.1 왜 넓히지 않았나

계획은 "패턴을 넓혀야 한다"고 했지만, 넓히는 순간 라운드 1이 경고한 그대로
**증적 다운로드(`GET /api/artifacts/:id`)의 traversal 방어 표면이 같이 넓어진다.**
`resolveArtifactPath()` 가 `StorageKeySchema`(= `STORAGE_KEY_PATTERN`)를 **그대로 쓰기 때문**이다.

그래서 요구의 *의도*(첨부는 run 이 아니라 scenario 에 속한다)를 만족시키되
**표면은 넓히지 않는 길**을 택했다 — 별도 패턴을 **새로** 만들었다.

```
STORAGE_KEY_PATTERN             ^runs\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]+$        ← 무변경
ATTACHMENT_STORAGE_KEY_PATTERN  ^scenario-attachments\/[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.bin$
```

- `packages/contracts/src/storage.ts` — **`git diff` 0줄**
- `apps/api/src/modules/artifacts/**` — **`git diff` 0줄**
- `apps/runner/src/storage/**` — **`git diff` 0줄**

**증적 다운로드 경로는 코드가 한 글자도 바뀌지 않았다.** 그리고 두 해석기는 **서로의 키를 거부**한다.

### 3.2 첨부 키에는 사용자 문자열이 한 글자도 없다

키의 두 토막이 전부 **서버 생성 UUID** 다. 한글 파일명은 DB 컬럼(`filename`)에만 살고
**경로에 절대 쓰이지 않는다.** 그 결과:

- UUID 문자집합(`[0-9a-fA-F-]`)에 `.`·`/`·`\` 가 없어 **`..` 가 만들어질 수 없다.**
- 파일시스템 유니코드 정규화(macOS NFD)에 저장이 영향받지 않는다.
- 확장자를 원본이 아니라 **`.bin` 으로 고정** — 저장소가 언젠가 정적 서빙돼도
  `.php`·`.html` 이 디스크에 생기지 않는다.

### 3.3 ★★ traversal 방어가 여전히 유효한가 — **실측**

#### (a) 업로드 입구 — 공격 14종 전부 거부

```
거부 ✔  상위 이동                    → 400 첨부파일 이름이 올바르지 않습니다.
거부 ✔  한 단계 상위                  → 400
거부 ✔  절대 경로                    → 400
거부 ✔  하위 디렉토리                  → 400
거부 ✔  백슬래시                     → 400
거부 ✔  윈도우 드라이브                 → 400
거부 ✔  점 둘                      → 400
거부 ✔  숨김 파일                    → 400
거부 ✔  따옴표(헤더 탈출)               → 400
거부 ✔  개행(헤더 인젝션)               → 400
거부 ✔  NUL                      → 400
거부 ✔  예약 이름(config 덮어쓰기)       → 400
거부 ✔  예약 이름(node_modules)      → 400
거부 ✔  URL 인코딩 ..%2f            → 400
```
(local · docker 양쪽 회차에서 동일하게 14/14.)

#### (b) ★ DB 직접 오염 → **증적 다운로드**를 때린다 (표면 공유 확인)

`artifacts.storage_key` 에 traversal 을 직접 INSERT 하고 `GET /api/artifacts/:id` 를 호출했다.
**네 번째는 일부러 "첨부처럼 생긴" 키**다 — 새 패턴이 옛 해석기로 새지 않는지 보기 위해서다.

```
  #01 runs/<runId>/../../../../../../etc/passwd          → HTTP 400 허용되지 않은 storage_key 입니다
  #02 ../../../../../../etc/passwd                       → HTTP 400
  #03 /etc/passwd                                        → HTTP 400
  #04 scenario-attachments/<sid>/../../../../etc/passwd  → HTTP 400   ← 첨부 모양도 거부
  #05 C:\Windows\win.ini                                 → HTTP 400
=== /etc/passwd 내용이 새어 나왔나 ===
유출 0건 ✔
```

**→ 증적 다운로드의 방어는 약화되지 않았다.** (약화시켰다면 여기에 그렇게 썼을 것이다.)

#### (c) DB 직접 오염 → **첨부 다운로드**

`scenario_attachments.storage_key` 를 오염시키고 `GET …/attachments/:aid` 를 호출했다.

```
  #01 scenario-attachments/<sid>/../../../../../../etc/passwd → 400 허용되지 않은 첨부 storage_key
  #02 ../../../../../../etc/passwd                            → 400
  #03 /etc/passwd                                             → 400
  #04 runs/<runId>/video.webm                                 → 400   ← 증적 키도 거부
유출 0건 ✔
```

#### (d) ★ DB 직접 오염 → **Runner 작업공간 쓰기** (가장 위험한 경로)

`filename` 에 traversal 과 예약 이름을 직접 INSERT 한 뒤 **실제로 실행**했다.
뚫리면 Runner 호스트에 **임의 파일 쓰기**가 된다.

```
[첨부] 작업공간에 9건 배치 (50332575B) — bulk-0.bin · … · 테스트용 파일-2.docx
[첨부] ★ 배치 실패 — ../../../../../../tmp/TF-PWNED-A.txt: 작업공간에 놓을 수 없는 첨부 파일명입니다
[첨부] ★ 배치 실패 — playwright.config.mjs: 작업공간에 놓을 수 없는 첨부 파일명입니다
=== 임의 경로 쓰기 성공했나 ===
쓰기 없음 ✔ (/tmp/TF-PWNED-A.txt 없음)
```

**3중 방어가 전부 살아 있다**: API 입구(`AttachmentFilenameSchema`) → Runner 재검증
(`resolveAttachmentTarget`) → resolve 후 작업공간 접두 검사.

---

## 4. ★★ 첨부 없이 실패 → 첨부하면 성공 (이 기능의 증명)

### 4.1 무엇으로 검증했나

- 사용자의 실제 테스트 10건 중 **8건**이 `setInputFiles('테스트용 파일-N.docx')` 를 쓴다
  (`project-save` · `project-temp-save` · `project-comment-add` · `project-update` ·
  `project-status-change` · `project-requester-replying-change` ·
  `project-legal-review-in-progress-change` · `project-security-check` 계열).
- **`테스트용 파일-*.docx` 실물이 어디에도 없어** 유효한 OOXML `.docx` 4개를 **직접 만들었다**
  (`[Content_Types].xml` + `_rels/.rels` + `word/document.xml`, 각 927B,
  `file(1)` 판정 **`Microsoft Word 2007+`**).
- **운영(`https://live.law365ai.com`)에는 한 건도 실행하지 않았다.** 지시대로
  `input[type=file]` 이 있는 **로컬 더미 업로드 페이지**를 만들어(`127.0.0.1:4998/upload.html`)
  그것으로만 검증했다. 운영에 남긴 쓰기 **0건**.
- 검증 spec 은 사용자 코드와 **같은 형태**다:
  ```ts
  await page.goto("/upload.html");
  await page.locator('input[type="file"]').setInputFiles(['테스트용 파일-1.docx', '테스트용 파일-2.docx']);
  await expect(page.locator("#result")).toContainText("업로드됨 2건");
  await expect(page.locator("#result")).toContainText("테스트용 파일-1.docx");
  ```

### 4.2 실측 결과

| 모드 | 첨부 **없이** | 첨부 **있음** | 판정 |
|---|---|---|---|
| `local` | `status=failed` **steps 1/1** | `status=passed` **steps 4/4** | **증명 성공** |
| `docker` | `status=failed` **steps 1/1** | `status=passed` **steps 4/4** | **증명 성공** |

첨부 없이 실패한 지점은 `setInputFiles` 그 자체다(`goto` 1스텝만 통과).
첨부를 올리면 `goto` → `setInputFiles` → `expect` ×2 = **4/4** 가 전부 통과한다.

### 4.3 docker 모드 상세 — 격리 규율이 유지되는가

실행 **중** `docker inspect` 를 캡처했다:

```
★ Mounts:
    /mnt/c/Users/jhson1/tfws/testflow-code-f5b845f4-edkXXE -> /ws      rw
    /mnt/c/Users/jhson1/Documents/GitHub/testflow/apps/runner/dist -> /tfdist  ro
★ WorkingDir: /ws
★ ARTIFACT_ROOT(artifacts 디렉토리) 마운트? False        ← 라운드 1·2 규율 유지
★ Env 에 TESTFLOW_VAR_* 있나? False
★ docker inspect 전문 평문 비밀 grep: 0 건
★ 전문에 한글 첨부 파일명 등장? 0 건
Env: [TESTFLOW_PW_HEADLESS, TESTFLOW_PW_VIEWPORT_W, TESTFLOW_PW_CDP_PORT, FORCE_COLOR,
      TESTFLOW_PW_REPORTER, TESTFLOW_BASE_URL, TESTFLOW_PW_VIEWPORT_H, TESTFLOW_ENV_LABEL,
      CI, TESTFLOW_PW_EVENTS_URL, PATH, LANG, LC_ALL, PLAYWRIGHT_BROWSERS_PATH,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD]
```

**마운트는 여전히 2개뿐**이고 `ARTIFACT_ROOT` 는 없다. 첨부 원본은
`ARTIFACT_ROOT/scenario-attachments/` 에 있지만 **호스트 쪽 Runner 가 작업공간으로 복사**하고,
컨테이너는 이미 마운트된 `/ws` 에서 본다 — 증적이 `/ws/out` 에 쌓였다가 호스트가 꺼내는 것과
**방향만 반대인 같은 구조**다. `code-container.ts` 는 **한 줄도 고치지 않았다.**

Runner 로그 (docker):
```
[격리] docker — 컨테이너 testflow-code-ededf765-5156 · 이미지 testflow/playwright-code-exec:1.63.0
       · 작업공간 /mnt/c/Users/jhson1/tfws/testflow-code-ededf765-lYzpIT → /ws
[첨부] 작업공간에 2건 배치 (1854B) — 테스트용 파일-1.docx · 테스트용 파일-2.docx
```

---

## 5. ★ 한글 파일명 왕복 — 전 구간 실측

| 구간 | 결과 |
|---|---|
| 업로드 요청 (쿼리스트링 퍼센트 인코딩) | `201` |
| 업로드 응답 `filename` | `"테스트용 파일-1.docx"` — **일치** |
| DB 저장 (`HEX(filename)`) | `ED858CEC8AA4ED8AB8EC9AA920ED8C8CEC9DBC2D322E646F6378` → UTF-8 디코드 `테스트용 파일-2.docx` — **NFC 무손실** |
| 목록 응답 | `["테스트용 파일-1.docx","테스트용 파일-2.docx"]` |
| 다운로드 바이트 | `927B` · **바이트 일치 = true** |
| `Content-Disposition` | `attachment; filename="_______-1.docx"; filename*=UTF-8''%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%9A%A9%20%ED%8C%8C%EC%9D%BC-1.docx` |
| `filename*` 디코드 | `테스트용 파일-1.docx` — **원본 일치 = true** |
| 컨테이너 배치 | `[첨부] 작업공간에 2건 배치 — 테스트용 파일-1.docx · 테스트용 파일-2.docx` |
| `setInputFiles` 동작 | **passed 4/4** (업로드된 파일명이 페이지에서 확인됨) |
| 웹 UI 목록 | `["테스트용 파일-1.docx","테스트용 파일-2.docx"]` · `<a download>` 속성도 원본 이름 |

### 왜 파일명을 헤더가 아니라 **쿼리스트링**으로 받는가

HTTP 헤더 값은 latin1 로 해석된다. 한글을 커스텀 헤더에 실으면 깨지고, Node 가
`ERR_INVALID_CHAR` 를 던지기도 한다. 쿼리스트링은 퍼센트 인코딩이 규격이라 무손실이다.

### `Content-Disposition` 은 **두 벌**을 낸다

`filename="<ASCII 대체본>"`(아주 오래된 클라이언트) + `filename*=UTF-8''<퍼센트 인코딩>`(RFC 5987).
ASCII 대체본은 `[A-Za-z0-9._-]` 로 **한 번 더** 좁힌다 — 방어는 겹쳐야 한다.
헤더 전체에 CR/LF 가 없음을 단위 테스트로 고정했다.

---

## 6. 용량 상한 — 근거와 실측

### 6.1 값과 근거

| 상한 | 값 | 근거 |
|---|---|---|
| 개당 | **10MiB** | 대상은 "테스트 데이터"다. 사용자 시나리오의 실물은 수십 KB 이지만 법무 시스템 첨부는 스캔 PDF 가 섞인다. 국내 전자소송(대법원 ECFS)의 첨부 1건 상한이 10MB 라 **그보다 큰 파일을 업로드 테스트에 쓸 일이 없다.** |
| 개수 | **20개** | 첨부 전량이 **실행 1건마다 작업공간으로 복사된다** — 개수가 곧 실행 지연이다. 사용자 시나리오의 최대 참조 수는 4개(`파일-1~4`)이고 20이면 5배 여유다. |
| 합계 | **50MiB** | 개당·개수만 두면 20 × 10MiB = **200MiB** 가 허용된다. 그 시나리오를 돌릴 때마다 200MiB 를 복사하고 docker 면 bind mount 로 한 번 더 읽는다. **세 개를 다 두어야 상한이 닫힌다.** |

`MAX_ATTACHMENT_TOTAL_BYTES < MAX_ATTACHMENT_BYTES × MAX_ATTACHMENTS_PER_SCENARIO`
라는 관계를 **단위 테스트로 고정**했다.

### 6.2 실측

```
개당 상한 초과(11MiB) → 413 파일이 너무 큽니다 — 11.0MB / 개당 상한 10.0MB.
빈 파일              → 400 빈 파일은 올릴 수 없습니다.
합계 상한 초과        → 9번째(6MiB×9=54MiB)에서 413 첨부파일 합계가 상한을 넘습니다 — 54.0MB / 합계 상한 50.0MB.
                       (응답 추이 201,201,201,201,201,201,201,201,413)
개수 상한            → 21번째에서 413 — 첨부파일은 시나리오당 20개까지입니다 (현재 20개).
```

전송 상한(`express.raw` limit)은 의미 상한 + 1MiB 다. **거부 주체가
`ScenarioAttachmentService`(413 + 한국어 사유)** 여야 하고, express 의 영어
`request entity too large` 가 사용자에게 보이면 안 되기 때문이다 — 라운드 2가 JSON 본문에서
배운 교훈 그대로다.

---

## 7. 설계 결정과 근거

### 7.1 스키마 — `scenario_attachments` (1:N), 마이그레이션 012

```sql
CREATE TABLE scenario_attachments (
  id CHAR(36), scenario_id CHAR(36), filename VARCHAR(255),
  content_type VARCHAR(255), size_bytes INT UNSIGNED, storage_key VARCHAR(500),
  created_at, updated_at,
  CONSTRAINT pk_scenario_attachments PRIMARY KEY (id),
  CONSTRAINT uq_scenario_attachments_name UNIQUE (scenario_id, filename),
  CONSTRAINT fk_scenario_attachments_scenario FOREIGN KEY (scenario_id)
    REFERENCES scenarios(id) ON DELETE CASCADE,
  INDEX ix_scenario_attachments_scenario (scenario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

- **별도 테이블인 이유** = `scenario_codes` 와 같은 논리. `scenarios` 는 목록이 페이지당 20행
  읽는 뜨거운 테이블이고 TypeORM `find()` 는 전 컬럼을 선택한다. 목록 쿼리는 이 테이블을
  조인하지 않는다.
- **1:1 이 아니라 1:N** — 사용자 코드가 `setInputFiles([...2개])` 를 쓴다. 1:1 은 그 사용례를
  표현할 수 없다. (`scenario_codes` 가 1:1 인 것은 "코드 본문은 1개"라는 계약 때문이고,
  첨부에는 그 계약이 없다.)
- **★ 바이트는 DB 에 넣지 않았다** — `scenario_codes.content` 가 `MEDIUMTEXT` 인 것과 **반대**
  결정이다. ① 코드 본문은 에디터에 보여야 해서 조회가 곧 표시지만 첨부 바이트는 화면에
  절대 표시되지 않는다. ② 개당 10MiB × 20을 `MEDIUMBLOB` 으로 읽으면 `max_allowed_packet`
  (기본 64MB)과 버퍼풀을 정면으로 때린다. ③ `artifacts` 가 이미 **"메타는 DB · 바이트는
  `ARTIFACT_ROOT`"** 규약을 쓴다 — 두 벌의 규약을 만들지 않는다.
- `(scenario_id, filename)` UNIQUE — 같은 이름이 2건이면 Runner 가 작업공간에 무엇을 쓸지
  정할 수 없어 **실행이 비결정적**이 된다. 재업로드는 **덮어쓰기**가 된다(실측: `id 동일=true`).
  인덱스 길이 `36 + 255×4 = 1056`B < InnoDB DYNAMIC 3072B.
- `down()` 은 테이블만 지운다 — 마이그레이션 롤백이 사용자 파일을 지우게 만들지 않는다.

### 7.2 저장 경로

```
$ARTIFACT_ROOT/
  runs/<runId>/…                              ← 증적 (건드리지 않았다)
  scenario-attachments/<scenarioId>/<id>.bin  ← 첨부 (이번에 추가, runs/ 와 형제)
```

같은 볼륨을 쓰는 이유: **API 와 Runner 가 `ARTIFACT_ROOT` 를 공유한다**는 전제가 이미 서 있다
(02-context (b) 부가 제약). 새 공유 볼륨을 만들면 배포 전제가 하나 늘어난다.

### 7.3 API — **새 의존성 0개**

코드는 텍스트라 `File.text()` → JSON 으로 충분했지만 **첨부는 바이너리**다. 선택지 비교:

| 방법 | 새 의존성 | 오버헤드 | 판정 |
|---|---|---|---|
| `multipart/form-data` | **`multer` 필요** | 없음 | ✗ `.npmrc` `minimum-release-age` 검역 + 기조 위반 |
| JSON + base64 | 없음 | **+33%** (10MiB → 13.3MiB) | ✗ 얻는 것 없이 본문만 부푼다 |
| **`application/octet-stream` raw body** | **없음** | **0%** | **✓ 채택** |

`express.raw()` 는 `@nestjs/platform-express` 가 이미 가진 body-parser 다 —
`main.ts` 에 `app.useBodyParser("raw", { type: "application/octet-stream", limit })` **한 줄**.
`type` 을 좁히지 않으면 JSON 요청까지 가로채 **기존 API 전부가 깨진다**(그래서 명시했다).

| 엔드포인트 | 비고 |
|---|---|
| `GET    /api/scenarios/:id/attachments` | 메타만. 합계·상한을 같이 실어 화면이 계산하지 않는다 |
| `POST   /api/scenarios/:id/attachments?filename=…&contentType=…` | raw body. 400/413 |
| `DELETE /api/scenarios/:id/attachments/:attachmentId` | 204. DB → 파일 순서 |
| `GET    /api/scenarios/:id/attachments/:attachmentId` | 스트림. **항상 `attachment`** |

**다운로드를 `inline` 으로 내지 않는다** — 사용자가 올린 임의 바이트를 우리 오리진에서
렌더링하면 `.svg`/`.html` 로 저장형 XSS 가 된다. `X-Content-Type-Options: nosniff` 도 붙였다.
`content_type` 은 토큰 문법(RFC 9110)만 통과시키고 아니면 `application/octet-stream` 으로
떨어뜨린다 — 그 값이 헤더에 그대로 실리기 때문이다(CR/LF 인젝션 방어).

### 7.4 Runner

`code-attachments.ts` 신규. `code-executor.ts` 에 **배치 블록 한 개** 추가.
`code-workspace.ts` · `code-container.ts` · `pw-config.ts` 는 **손대지 않았다.**

정리 코드를 **따로 만들지 않았다** — 첨부는 작업공간 안에 있고 `CodeWorkspace.dispose()` 가
어떤 경로로 끝나도(성공·실패·취소·타임아웃·예외) 통째로 지운다. 정리 경로를 하나 더 만들면
그 하나가 언젠가 빠진다. 실측: `/tmp/testflow-code-*` **0건**, docker 작업공간 루트 **0건**.

배치 실패는 **실행을 죽이지 않는다**. 첨부 1건이 없으면 그 테스트만 실패하는 것이 맞고,
실행 전체를 `error` 로 접으면 나머지 테스트 결과까지 사라진다. 다만 **조용히 넘기지 않는다** —
놓은 것도 못 놓은 것도 로그에 남긴다(§3.3(d) 참조).

### 7.5 검증기 연동 — **구현했다**

`checkAttachmentReferences(content, attachmentNames)` 를 contracts 에 넣고,
`CODE_VALIDATION_CODES` 에 **`missing_attachment` 를 추가**했다(기존 값은 무변경).

- **`validateScenarioCode()` 안에 넣지 않았다** — 그 함수는 본문만 보는 순수 함수여야 하고,
  이 판정에는 **첨부 목록이라는 바깥 상태**가 필요하다. 서명을 오염시키면 서버(`PUT /code`)가
  같은 함수를 못 쓴다.
- **항상 `severity:"warning"`** 이다. 파일명을 코드가 동적으로 만드는 정상 코드를 막지 않는다.
  `blocked` 계산에 들어가지 않는다(실측: 경고가 떠도 **저장 버튼 활성**).
- 잡는 것: `setInputFiles('x')` · `"x"` · `` `x` ``(치환 없음) · 배열.
  포기하는 것(경고 안 냄): 변수 · 치환 있는 템플릿 · 객체 리터럴(인메모리 파일).
  경로가 든 참조(`fixtures/a.docx`)도 건너뛴다 — 우리가 판단할 근거가 없다.

### 7.6 Web

`AttachmentsField.tsx` 신규 + `useScenarioAttachments.ts` 신규 + 코드 화면에 배치.
`api.ts` 가 이미 갖고 있던 **`rawBody` 탈출구를 처음으로 사용**했다 — 새 클라이언트 코드 없음.
`useEffect` 0개(서버 상태는 전부 react-query). 인라인 CSS·HEX 신규 0건.
`queryKeys.scenarioAttachments` 를 `scenarioCode` 와 같은 규율로 분리했다.

---

## 8. ★ 검증 중 발견해 고친 것 — 고아 파일 97MB

**증상**: 시나리오를 삭제하면 `scenario_attachments` 행은 FK CASCADE 로 사라지는데
**디스크 파일은 아무도 지우지 않는다.** 검증 중 시나리오 8건을 지운 뒤 확인했다:

```
$ du -sh artifacts/scenario-attachments
97M     artifacts/scenario-attachments      ← 살아 있는 시나리오는 0건인데 97MB 가 남아 있었다
```

고아 파일은 **용량 상한을 통째로 무의미하게 만든다** — 상한은 "살아 있는 시나리오"만 세는데
디스크는 죽은 것까지 이고 있다.

**수정**: `ScenarioAttachmentService.purgeScenarioFiles()` 를 추가하고
`ScenariosController.remove()` 가 **파일 먼저, DB 나중** 순서로 부른다.

- 순서를 지키는 이유: 뒤집으면 "DB 삭제 성공 + 파일 삭제 실패"에서 **어느 시나리오의
  파일인지 알 방법이 사라진다**(행이 이미 없다).
- 오케스트레이션을 **컨트롤러에서** 하는 이유: `ScenariosService` 가 첨부 서비스를 주입받으면
  **순환 의존**이 된다(`ScenarioAttachmentService` 가 이미 `ScenariosService` 를 쓴다).
  그리고 "`ScenariosService` 는 첨부 리포지토리를 보지 않는다"는 규율이 유지된다.
- 경로를 문자열로 조립하지 않는다 — 유효한 키를 한 번 만들어 **검증기를 통과시킨 뒤**
  그 부모 디렉토리를 쓴다. `scenarioId` 가 오염돼도 검증기가 먼저 막는다(테스트로 고정).
- **증적(`runs/…`)에는 같은 처리를 하지 않는다** — `runs` 이력은 append-only 이고 시나리오가
  지워져도 남는 것이 계약이다(`runs.scenario_id` 가 NULL 이 된다). 첨부는 반대로 시나리오
  종속이라 시나리오가 없으면 존재 이유가 없다.

**수정 후 실측**:
```
업로드 201
디스크 디렉토리 존재: True ['e7781793-a0de-4fa2-ae8e-113d0dd841d2.bin']
시나리오 삭제: 204
★ 삭제 후 디스크 디렉토리 존재: False → 고아 없음 ✔
scenario-attachments 루트 잔여: []
```

(검증 중 쌓인 97MB 는 수동으로 지웠다.)

---

## 9. 웹 UI 실측

빌드 산출물을 `vite preview`(4173)로 띄우고 headless Chromium 이 화면을 조작했다.

```
① 첨부 패널 렌더: 테스트 데이터 (첨부파일)
  빈 상태 문구: 아직 올린 파일이 없습니다.
② ★ 첨부 없음 경고: 테스트용 파일-1.docx · 테스트용 파일-2.docx
  편집기 issue(경고): 5:59 경고 · setInputFiles 가 '테스트용 파일-1.docx' 를 쓰는데 첨부파일 목록에 없습니다…
                     5:77 경고 · setInputFiles 가 '테스트용 파일-2.docx' 를 쓰는데 …
  ★ 저장 버튼 비활성? (경고이므로 false 여야 한다): false
③ ★ UI 업로드 후 목록: ["테스트용 파일-1.docx","테스트용 파일-2.docx"]
  합계 표시: 2개 · 합계 1.8KB / 50MB
  ★ 경고 사라졌나: true
④ 다운로드 링크: /api/scenarios/<sid>/attachments/<aid>  download 속성: 테스트용 파일-1.docx
⑤ 삭제 후 건수: 1
  ★ 지우니 경고 재등장: 테스트용 파일-1.docx
⑥ 콘솔 에러: 0 []
```

스크린샷: `/tmp/tf-ui-1-empty.png` · `/tmp/tf-ui-2-filled.png` · `/tmp/tf-ui-3-deleted.png`.
경고 → 업로드 → 경고 소멸 → 삭제 → 경고 재등장이 **실시간으로 왕복**한다.

---

## 10. 회귀 확인 / 기준선 비교

### 10.1 회귀

| 항목 | 결과 |
|---|---|
| **첨부 없는 코드 실행** | `passed` **2/2** · `[첨부]` 로그 없음(조회조차 하지 않는다) |
| **녹화(steps) 시나리오 실행** — 라운드 1 실행 엔진 | `passed` **2/2** |
| 증적 다운로드 (`GET /api/artifacts/:id`) | 코드 무변경 · traversal 5종 전부 400 |
| `packages/contracts/src/storage.ts` | **`git diff` 0줄** |
| `apps/api/src/modules/artifacts/**` | **`git diff` 0줄** |
| `apps/runner/src/storage/**` | **`git diff` 0줄** |
| `apps/runner/src/execute/code-container.ts` · `code-workspace.ts` · `pw-config.ts` | **`git diff` 0줄** |
| `record/screencast.ts` · `input-bridge.ts` · `mask.ts` · `poc/**` · 기존 마이그레이션 · `docker-compose.yml` · `guard.ts` · `.gitattributes` · `.npmrc` | **무수정** |
| `packages/contracts` 기존 스키마 필드명·구조 | **무변경** (`CODE_VALIDATION_CODES` 에 값 1개 **추가**만) |
| `.env.example` | **무변경** — 새 환경변수 0개 |
| 원본 테스트 폴더 2개 · `Legal Project TestFlow/` | **읽기만 함 · 무수정** |

### 10.2 기준선 비교

| 지표 | 라운드 2 | 이번 | 델타 |
|---|---|---|---|
| `pnpm test` | 516 | **616** | **+100** |
| 초기 로드 JS | 546.38 KB | **548.86 KB** | +2.48 KB (+0.45%) |
| `index`(진입) | 218.64 KB | **218.64 KB** | 0 |
| `useProject`(공유 vendor+contracts) | 327.03 KB | **330.22 KB** | +3.19 KB |
| CSS | 40.67 KB | **40.67 KB** | 0 |
| `code` (lazy) | 12.15 KB | **17.79 KB** | +5.64 KB |
| 최대 청크 | 327.03 KB | **330.22 KB** | 500KB 경고 없음 |
| 런타임 의존성 | — | **추가 0개** | — |

`useProject` +3.19KB 는 contracts 가 barrel 재노출이라 `attachment.ts` 가 공유 청크에
들어오기 때문이다(라운드 2 의 `codegen.ts` 와 같은 구조적 이유). subpath export 가 답이지만
계약 패키지 구조 변경 + 3개 앱 import 경로 영향 대비 이득이 3.19KB 라 **하지 않았다.**

---

## 11. 생성·수정한 파일

### 신규 (11)

| 파일 | 내용 |
|---|---|
| `packages/contracts/src/attachment.ts` | 상한 3종 · `AttachmentFilenameSchema` · **`ATTACHMENT_STORAGE_KEY_PATTERN`(신규, 기존 패턴 무변경)** · `Content-Disposition`(RFC 5987) · `findSetInputFilesReferences` · `checkAttachmentReferences` |
| `packages/contracts/src/attachment.spec.ts` | **56건** — 한글 통과/경로 거부 · 두 패턴 상호 거부 · 헤더 인젝션 · 상한 관계 · 참조 스캐너 |
| `packages/db/src/entities/scenario-attachment.entity.ts` | 엔티티 (11번째) |
| `packages/db/src/migrations/012-create-scenario-attachments.ts` | 마이그레이션 (신규 파일 + 배열 끝 명시 등록) |
| `apps/api/src/modules/scenarios/attachment.path.ts` | 첨부 전용 3중 방어 (증적 해석기와 **분리**) |
| `apps/api/src/modules/scenarios/attachment.path.spec.ts` | **23건** — traversal 11종 · **두 해석기 상호 거부** · purge 경로 |
| `apps/api/src/modules/scenarios/scenario-attachment.service.ts` | 목록·업로드·삭제·다운로드·`purgeScenarioFiles` |
| `apps/api/src/modules/scenarios/scenario-attachment.controller.ts` | 4개 엔드포인트 |
| `apps/runner/src/execute/code-attachments.ts` | 조회 + 작업공간 배치 (3중 방어 마지막 겹) |
| `apps/runner/src/execute/code-attachments.spec.ts` | **21건** — 한글 배치 · traversal · 예약 이름 · 부분 실패 |
| `apps/web/src/pages/scenarios/code/AttachmentsField.tsx` | 업로드·목록·삭제 UI |
| `apps/web/src/hooks/useScenarioAttachments.ts` | react-query 훅 (`rawBody` 사용) |

### 수정 (10)

| 파일 | 변경 |
|---|---|
| `packages/contracts/src/index.ts` | `attachment.js` 재노출 1줄 |
| `packages/contracts/src/code-validation.ts` | `CODE_VALIDATION_CODES` 에 `missing_attachment` **추가만** |
| `packages/db/src/entities/index.ts` | 엔티티 등록 |
| `packages/db/src/migrations/index.ts` | 마이그레이션 등록 (배열 **끝**) |
| `apps/api/src/main.ts` | `useBodyParser("raw", …)` 1블록 추가 |
| `apps/api/src/modules/scenarios/scenarios.module.ts` | 컨트롤러·서비스·엔티티 등록 |
| `apps/api/src/modules/scenarios/scenarios.controller.ts` | `remove()` 가 첨부 파일까지 지운다 (§8) |
| `apps/runner/src/execute/code-executor.ts` | 첨부 배치 블록 1개 + `describeError` 헬퍼 |
| `apps/web/src/lib/queryClient.ts` | `scenarioAttachments` 키 |
| `apps/web/src/pages/scenarios/code/index.tsx` | 패널 배치 + 저장 시점 경고 + 안내 1줄 |
| `README.md` | **테스트 데이터 (첨부파일)** 절 (실측한 cwd 표 포함) |

### 커밋하지 않은 검증 자산

`/mnt/c/Users/jhson1/tfattach/` — 더미 `.docx` 4개 · 로컬 업로드 fixture 페이지 ·
`verify.mjs`(API 하네스) · `ui.mjs`(웹 UI 하네스).
`/mnt/c/Users/jhson1/sifprobe/` — `setInputFiles` cwd 측정 하네스.

---

## 12. ★ 미해결 · 미검증 (사실대로)

### 12.1 미해결

| # | 내용 | 영향 / 제안 |
|---|---|---|
| 1 | **첨부는 발행(version) 스냅샷에 포함되지 않는다.** `scenario_codes` 도 마찬가지이지만, 첨부는 실행 시점의 **현재 목록**을 읽는다 — 발행 후 첨부를 바꾸면 옛 버전을 재실행해도 새 파일로 돈다 | 라운드 2의 `scenario_codes` 와 동일한 성질이라 **새로 생긴 불일치는 아니다.** 버전별 첨부가 필요하면 `scenario_versions` 개념이 먼저 필요하다 |
| 2 | **업로드 중복 요청 경쟁**. 같은 파일명을 동시에 2번 올리면 `uq_scenario_attachments_name` 이 한쪽을 `ER_DUP_ENTRY` 로 떨어뜨리고 그것이 500 으로 나간다(트랜잭션·재시도 없음) | 실사용에서 재현하기 어렵고(사람이 같은 파일을 동시에 두 번 누르는 경우), 제약이 데이터 무결성은 지킨다. 409 로 옮기는 것이 다음 후보 |
| 3 | **합계 상한은 "업로드 시점"에만 본다**. DB 에 직접 INSERT 해 상한을 넘기면 목록은 그대로 보여 준다 | Runner 는 배치 시점에 합계를 다시 세어 초과분을 건너뛴다(실측: `첨부 합계 상한을 넘겨 더 놓지 않는다`). 화면은 넘친 수치를 그대로 보여 준다 |
| 4 | 라운드 2 미해결 이슈 1·2·3·4 (**빈 코드 시나리오 404 콘솔** · **코드 본문 평문 비밀번호가 Runner 로그에** · **docker 모드 루프백 안내 부재** · `ingestWsUrl` 잔재) | 이번 범위 밖. 그대로 이월한다 |

### 12.2 이번에 **검증하지 못한** 것

| 항목 | 상태 |
|---|---|
| **운영(`https://live.law365ai.com`) 대상 실행** | **의도적으로 하지 않았다.** 지시("운영에 쓰기를 남기는 실행은 최소화 · 운영 대상 실행은 하지 마라")에 따라 **로컬 더미 업로드 페이지로만** 검증했다. 운영 쓰기 **0건** |
| **사용자의 원본 `.spec.js` 10개를 그대로 실행** | 하지 않았다. 그 파일들은 `.js` 이고 운영 로그인·계정을 요구한다. **`setInputFiles` 호출 형태만 그대로 옮긴** spec 으로 검증했다(§4.1) |
| **10MB 에 가까운 실물 파일** | 상한 검사는 11MiB 더미(`Buffer.alloc`)로 했고, **실행 경로**는 927B 더미 docx 로만 돌렸다. 큰 파일의 복사·bind mount 지연은 측정하지 않았다 |
| **첨부 20개를 실제로 실행에 태우기** | 9건(50MB)까지 배치되는 것은 §3.3(d) 로그로 확인했지만, 20개 전량으로 실행 시간을 재지는 않았다 |
| **Firefox / Safari** | headless Chromium 만 썼다(라운드 1·2와 같은 한계) |
| **리눅스 네이티브 docker** | WSL + Docker Desktop 에서만 검증했다(`RUNNER_CODE_WORKSPACE_ROOT=/mnt/c/…` 필요). 네이티브는 기본값으로 돌아야 하지만 확인하지 않았다 |
| **동시 실행 2건이 같은 시나리오의 첨부를 쓰는 경우** | 작업공간이 run 마다 따로라 구조적으로 안전하지만 실측하지 않았다 |
| **첨부 파일명 유니코드 정규화(NFD)** | DB 는 NFC 로 무손실 왕복함을 HEX 로 확인했다. **macOS 파일시스템(NFD)에서의 동작은 확인하지 않았다** — 저장 키에 파일명이 없어 저장은 안전하지만, 작업공간에 쓴 뒤 `setInputFiles` 가 NFD 로 찾는 경우는 미검증 |
| **라운드 2 미검증 항목 전량** | 4401/4404 화면 문구 · nginx 프록시 뒤 · 다중 뷰어 · 토큰 TTL 초과 · 배포 서버 Node 버전 — 그대로 이월 |

### 12.3 검증 중 만든 데이터

검증용 시나리오 **9건**을 만들고 **전부 삭제**했다(`runs` 이력은 append-only 라 남겼다).
DB 에 직접 심은 오염 행(`artifacts` 5건 · `scenario_attachments` 6건)도 전부 지웠다.
고아 첨부 파일 97MB 도 지웠다. 삭제 후 `scenario_attachments` 행 수 **0**,
`artifacts/scenario-attachments/` **비어 있음**.

> 다만 **`runs` 이력에 검증 실행 약 20건이 남았다**(append-only 계약). 사실대로 적는다.

---

## 13. 다음 단계 제안

1. **발행 스냅샷에 첨부를 포함**(미해결 1). `scenario_versions` 가 생기면 그 안에서 같이 다룬다.
2. **업로드 동시성** — `ER_DUP_ENTRY` 를 409 로 옮기고 upsert 를 트랜잭션으로 묶는다.
3. **큰 파일 실측** — 10MB 급 첨부 20개로 실행 지연(복사 + bind mount)을 재고, 필요하면
   개수/합계 상한을 다시 조정한다. 지금 값은 사용자 시나리오(4개 × 수십 KB) 기준의 여유값이다.
4. **고아 스캐너** — 지금은 삭제 시점에만 지운다. 과거에 만들어진 고아(이번처럼 사고로 생긴 것)를
   찾아 주는 점검 명령이 있으면 좋다.
5. **첨부를 녹화 시나리오에도** — 현재는 코드 시나리오 전용이다(녹화 스텝에는 파일 업로드
   동작 자체가 없다). 녹화에 `upload` 액션을 넣으려면 스텝 계약 확장이 먼저다.
6. 라운드 2 의 다음 단계 제안 1~7 은 그대로 유효하다.
