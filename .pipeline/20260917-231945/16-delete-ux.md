# 16 — UI 에서 시나리오·실행 이력 지우기 (확인 대화상자 + 다중 삭제)

브랜치 `feat/delete-ux` (base `main e9f3da8`)

## 0. 한 줄 요약

시나리오와 실행 이력을 **화면에서** 지울 수 있게 했다. 핵심은 **디스크다** — 실행 이력을 지우면
`$ARTIFACT_ROOT/runs/<runId>/` 를 **디렉토리째** 지워 영상·trace·스크린샷이 함께 사라진다
(실측: 3파일 **1,025,739 bytes** 삭제, `artifacts/runs` 총량이 정확히 그만큼 줄었다).
**진행 중인 실행은 409 로 거부**하고, 확인 대화상자는 **무엇이 몇 개 지워지는지**와
**되돌릴 수 없다는 사실**을 적는다. 다중 삭제는 **부분 성공**을 그대로 돌려준다.

---

## 1. ★ 실행 삭제 시 증적 파일 디스크 실측 — 이번 작업의 핵심 증명

이 레포에는 같은 사고 이력이 있다. 07-attachments §8:

> 시나리오를 삭제하면 `scenario_attachments` 행은 FK CASCADE 로 사라지는데 **디스크 파일은
> 아무도 지우지 않는다.** 검증 중 시나리오 8건을 지운 뒤 `artifacts/scenario-attachments` 에
> **97MB 가 고아로 남아 있었다.**

증적(`runs/…`)은 한 실행이 영상 + trace + 스크린샷으로 **수십 MB**다. 같은 구조를 반복하면
이력을 지울수록 디스크만 찬다. 그래서 **204 를 돌려줬다는 사실이 아니라 디스크를 직접 봤다.**

### 1.1 실측 (`g16-verify.mjs` §1, 원본 로그 `g16-verify.log.md`)

```
ARTIFACT_ROOT = /mnt/c/Users/jhson1/Documents/GitHub/testflow/artifacts
[사전] artifacts/runs 전체 = 191,110,986 bytes (182.3 MB), 149 디렉토리

대상: RUN-0278 (0cc9b23f-d98d-4226-a395-8e2649447d75) status=failed

[before] artifacts/runs/0cc9b23f-…/
         존재=true  파일=3개  크기=1,025,739 bytes
         파일목록=["screenshot.png", "trace.zip", "video.webm"]
[before] DB  artifacts=3행  step_results=21행
[before] Redis 키 4/4 존재 (events · seq · 라이브 토큰 · 해시별 보조키)

DELETE /api/runs/0cc9b23f-… → 204

[after]  artifacts/runs/0cc9b23f-…/  존재=false  파일=0개  크기=0 bytes     ← ★
[after]  artifacts/runs 전체 = 190,085,247 bytes (줄어든 양 1,025,739 bytes) ← ★ 정확히 일치
[after]  DB  artifacts=0행  step_results=0행  runs=0행   (FK CASCADE)
[after]  scenarios.last_run_id 역참조 = 0행             (FK 가 없어 직접 NULL 로 끊는다)
[after]  Redis 키 0/4 존재
GET /api/runs/0cc9b23f-… → 404
```

두 번째 실행에서도 같다 — RUN-0281 (`video.webm` 42,932 bytes) 삭제 후
`artifacts/runs` 총량이 **정확히 42,932 bytes** 줄었다.

**고아 없음 최종 확인**: `scenario-attachments` 하위 디렉토리 **0개**, 총량 **0 bytes**.

### 1.2 왜 `artifacts` 행을 훑지 않고 **디렉토리를 지우는가**

`artifacts` 테이블의 `storage_key` 를 돌며 파일마다 지우면 **DB 행이 없는 파일이 영원히 남는다** —
Runner 가 파일은 썼는데 INSERT 전에 죽는 경로가 실제로 있다(13-artifacts-on-timeout 이 다룬 그 경로).
`runs/<runId>/` 는 그 run **전용** 디렉토리이므로 통째로 지우는 것이 고아까지 함께 지우는 유일한 방법이다.
단위 테스트로 고정했다(`artifacts.purge.spec.ts` — "DB 행이 없는 파일(고아)도 함께 지워진다").

### 1.3 경로 방어

경로를 문자열로 조립하지 않는다. `buildRunArtifactKey(runId, "probe.bin")` 으로 **유효한 키를 만들어
`resolveArtifactPath()`(3중 방어)를 통과시킨 뒤 그 부모 디렉토리**를 쓴다
— `purgeScenarioFiles()` 가 쓰는 수법 그대로다. `runId` 가 `../../etc` 여도 검증기가 먼저 막는다.

```
purgeRunFiles("../../etc") → {files:0, bytes:0}   아무것도 지우지 않는다
purgeRunFiles("..")        → {files:0, bytes:0}
purgeRunFiles("/etc/passwd") → {files:0, bytes:0}
purgeRunFiles("not-a-uuid")  → {files:0, bytes:0}
```
(`artifacts.purge.spec.ts` 가 이 4가지를 테스트로 고정한다. 같은 케이스에서 정상 디렉토리가
살아 있는 것도 함께 본다.)

### 1.4 실패해도 DB 삭제는 진행한다

`rm` 이 실패하면 **로그(`Logger.error`)에 남기고 `{files:0,bytes:0}` 을 돌려준 뒤 DB 삭제로 넘어간다.**
파일 하나 때문에 삭제가 막히면 사용자는 아무것도 못 지운다 — `purgeScenarioFiles()` 와 같은 판단이다.
성공 시에도 `증적 파일 삭제: run <id> · N개 · M bytes` 를 남긴다(운영에서 총량을 추적할 수 있게).

---

## 2. 진행 중인 것에 대한 판단

### 2.1 ★ 진행 중인 run 삭제 → **409** (거부)

`queued`/`running` 이면 거부한다. 큐에 job 이 남은 채 DB 행만 지우면 **Runner 가 없는 run 에
결과를 쓰려다 깨진다**(`step_results.run_id` 가 FK 라 INSERT 자체가 실패한다).

```
POST /api/runs → 202  (Runner 미기동이라 queued 로 머문다)
DELETE /api/runs/<id> → 409
  "진행 중인 실행은 삭제할 수 없습니다 (RUN-0282, status: queued). 먼저 실행을 취소한 뒤 삭제하세요."
  → DB 행 그대로 살아 있음 (COUNT = 1)

POST /api/runs/<id>/cancel  →  DELETE /api/runs/<id> → 204
```

안내가 "먼저 취소하세요" 인 이유: 취소 경로가 **이미** 큐 job 제거 + 상태 확정을 다 한다.
사용자가 해야 할 일이 한 번의 클릭이고, 그 클릭이 화면에 이미 있다(■ 실행 중단).

### 2.2 ★ 진행 중 실행이 있는 **시나리오** 삭제 → **409** (거부)

**판단: 거부한다.** 근거:

- `runs.scenario_id` 는 `SET NULL` 이라 "DB 는 안 깨진다"는 말 자체는 사실이다. 그래서
  정합성 논거가 아니라 **"돌고 있는 것의 발판을 빼지 않는다"** 는 규칙이다.
- Runner 는 실행 중 `scenarioId` 로 DB 를 읽는다 — `code` 는 `scenario_codes` 본문을,
  녹화는 `test_steps` 를. 읽기 전에 지워지면 실행은 **사용자가 해석할 수 없는 이유로** 실패한다
  ("코드 본문이 없습니다").
- 첨부 파일도 함께 지워진다(`purgeScenarioFiles`). 작업 디렉토리로 복사되기 전이면
  `setInputFiles` 가 깨진다.
- 끝난 뒤에는 `scenario_id` 가 NULL 이라 **재실행도 불가능**하다(#14 가 버튼을 끈다).
  사용자가 의도한 상황이 아니다.

실측:
```
DELETE /api/scenarios/<id> → 409
  "진행 중인 실행이 있어 시나리오를 삭제할 수 없습니다 (RUN-0282, status: queued). 먼저 실행을 취소한 뒤 삭제하세요."
  → 코드 본문 DB 행 COUNT = 1 (거부가 파일 삭제보다 먼저라 아무것도 지워지지 않았다)

취소 후 → 204
그 실행 이력: GET /api/runs/<id> → 200, scenarioId = null    ← ★ 이력은 남는다
```

### 2.3 ★ 시나리오를 지워도 **실행 이력은 지우지 않는다** (권고안 유지)

`runs.scenario_id` 의 `SET NULL` 을 **바꾸지 않았다.** 실행 이력은 증적이고, 시나리오가
사라졌다고 "언제 무엇이 어떤 주소로 돌았는가"가 거짓이 되지는 않는다.
`runs` 는 이미 그 목적으로 스냅샷 컬럼(`scenario_name` · `source_type` · `base_url` · `browser`)을
갖고 있다. 이력까지 지우려면 실행 목록에서 따로 지운다 — 그리고 **확인 대화상자가 그 사실을
문장으로 말한다**(§5).

### 2.4 삭제 순서 — 이 작업에서 가장 중요한 세 줄

```
① 삭제 가능 판정 (404 / 409)   →  ② 디스크 파일  →  ③ DB
```

- **①이 먼저**여야 한다(라운드 8에서 추가된 규칙): 진행 중이라 **지우지 않기로 한** 대상의
  증적·첨부를 먼저 날리면, 409 를 돌려주고도 파일은 이미 없다.
- **②가 ③보다 먼저**여야 한다(07-attachments §8 이 세운 규칙): 뒤집으면 "DB 삭제 성공 +
  파일 삭제 실패"에서 어느 run/시나리오의 파일인지 알 방법이 사라진다(행이 이미 없다).

오케스트레이션은 **컨트롤러**에 둔다(`RunsController.purgeAndRemove` ·
`ScenariosController.purgeAndRemove`). 서비스에 숨기면 순서가 읽히지 않고,
시나리오 쪽은 순환 의존까지 생긴다.

---

## 3. 다중 삭제 API 형태 결정 — `POST …/bulk-delete`

| 후보 | 부분 성공 표현 | id 길이 한계 | 프록시 호환 | 판정 |
|---|---|---|---|---|
| `DELETE /runs?ids=a,b,c` | ✗ 204 에 본문이 없다 | **URL 길이**(id 36자 × N) | ○ | ✗ |
| `DELETE /runs` + 요청 본문 | △ | 없음 | **✗ RFC 9110 이 본문 의미를 정의하지 않는다** | ✗ |
| **`POST /runs/bulk-delete`** | **✓ 200 + 결과 본문** | 없음 | ○ | **✓ 채택** |

결정적인 것은 **부분 성공**이다. 5건을 고르면 그중 1건이 진행 중(409)일 수 있고 1건은 옆 탭에서
이미 지워졌을(404) 수 있다. 이때 답은 "성공"도 "실패"도 아니라
**"3건 지웠고 2건은 이러이러해서 건너뛰었다"** 이다 — 204 로는 그 말을 할 수 없고,
전체를 409 로 되돌리면 지울 수 있었던 3건까지 사용자가 다시 골라야 한다.

표기도 어긋나지 않는다 — 이 레포는 이미 행위형 POST 를 쓴다
(`POST /runs/:id/cancel`, `POST /scenarios/:id/publish`).
**단건은 그대로 `DELETE /runs/:id` → 204** 다(단건에는 부분 성공이 없다).

실측 — 끝난 1건 + 진행 중 1건 + 없는 1건:
```json
POST /api/runs/bulk-delete  →  200
{
  "requested": 3,
  "deleted": ["c5d7808b-…"],
  "skipped": [
    { "id": "8f116d64-…", "reason": "in_progress",
      "message": "진행 중인 실행은 삭제할 수 없습니다 (RUN-0283, status: queued). 먼저 실행을 취소한 뒤 삭제하세요." },
    { "id": "00000000-0000-4000-8000-000000000000", "reason": "not_found",
      "message": "이미 삭제된 실행입니다." }
  ]
}
```

- 상한 **`BULK_DELETE_MAX = 100`** — 목록 1페이지(시나리오 20 · 실행 30)보다 넉넉하되
  한 요청이 수백 건의 디스크 삭제를 끌고 가지 않게. 빈 배열은 **400**.
- **직렬로 돈다.** 병렬이면 같은 볼륨에 `rm` 이 N개 동시에 붙고, 실패 하나가 어느 대상의
  것인지 로그에서 흐려진다.
- 분류 루프는 **시나리오와 실행이 한 벌을 같이 쓴다**(`common/utils/bulk-delete.ts`).
  두 벌이면 "건너뛴 이유를 무엇으로 분류하는가"가 조용히 갈린다.
- 그 밖의 예외(DB 장애 등)는 **그대로 던진다** — 그건 부분 성공이 아니라 고장이다.
- 라우트 선언 순서: `bulk-delete` 를 `:id` 계열보다 **앞**에 둔다(`runs/queue` 와 같은 규율).
  실측으로 `GET /api/runs/queue` 가 가로채이지 않는 것을 확인했다.

---

## 4. Redis 잔재 처리 판단

| 키 | 무엇 | TTL | 판정 |
|---|---|---|---|
| `run:<id>:events` | SSE 재전송 버퍼(List, 최대 500건) | 1시간 | **지운다** |
| `run:<id>:seq` | SSE `id:` 카운터 | 1시간 | **지운다** |
| `testflow:run:token:<id>` | 라이브 WS 토큰 해시 | 120초 | **지운다** |
| `testflow:run:token:<id>:<sha256>` | 다중 뷰어용 해시별 보조 키(라운드 4) | 120초 | **지운다** (SCAN 으로 훑는다) |
| `run:<id>:cancel` | 취소 신호 **채널** | — | **대상 아님** (pub/sub 라 저장되는 것이 없다) |

TTL 이 있으니 놔둬도 언젠가는 사라진다. 그럼에도 지우는 이유는 **양**이다 — 이력 100건을
정리하면 버퍼 100개(최대 5만 이벤트)가 한 시간 동안 Redis 에 남는다. 지워진 run 의 이벤트를
다시 받을 클라이언트는 존재하지 않는다. 라이브 토큰은 진행 중 run 삭제를 거부하므로 사실상
없지만, "끝난 run 에 토큰이 남아 있을 리 없다"는 전제에 기대지 않고 지운다(공짜다).

`KEYS` 가 아니라 **`SCAN`** 이다(health · `readRunnerCapacity` 와 같은 규율 — 운영 Redis 를
블로킹하지 않는다). 실패해도 던지지 않는다(`Logger.warn`) — DB 행은 이미 없고 남은 것은
TTL 로 사라지는 파생 데이터다.

실측: 4개 키를 일부러 심어 두고 삭제 → **0/4 존재**.

### 4.1 `scenarios.last_run_id` — FK 가 없는 비정규화 컬럼

`runs` 를 지워도 **아무도 NULL 로 만들어 주지 않는다**(FK 자체가 없다). 목록의 `LEFT JOIN` 이
NULL 을 내므로 화면은 멀쩡하지만, 끊긴 포인터를 남기지 않는다 — 나중에 INNER JOIN 으로
바꾸면 행이 통째로 사라진다. 삭제와 **같은 트랜잭션**에서 `UPDATE scenarios SET last_run_id = NULL` 한다.

---

## 5. 확인 대화상자 문구 (실제 스크린샷)

### 5.1 시나리오 다중 삭제 — `g16-scenario-delete-dialog.png`

```
시나리오 4건을 삭제할까요?
아래 4건과 각각에 딸린 것이 모두 삭제됩니다.
──────────────────────────────────────────────
삭제UX 검증 3            TC-UX-009 · 코드 시나리오
삭제UX 검증 2            TC-UX-008 · 코드 시나리오
삭제UX 검증 1            TC-UX-007 · 코드 시나리오
삭제UX 검증 2            TC-UX-006 · 코드 시나리오
──────────────────────────────────────────────
⚠ 이 작업은 되돌릴 수 없습니다
  휴지통이 없습니다. 삭제하면 DB 행과 디스크 파일이 그 자리에서 사라지고 복구할 방법이 없습니다.
  시나리오에 딸린 스텝 · 코드 본문 · 첨부파일이 함께 사라집니다. 다만 실행 이력(RUN-…)은 그대로
  남습니다 — 이력은 증적이라 지우지 않습니다. 이력까지 지우려면 실행 목록에서 따로 삭제하세요.
                                                            [취소]  [4건 삭제]
```

### 5.2 시나리오 단건 (코드 편집 화면) — `g16-code-delete-dialog.png`

```
이 시나리오를 삭제할까요?
TC-UX-007 · 삭제UX 첨부확인
──────────────────────────────────────────────
삭제UX 첨부확인     TC-UX-007 · 코드 본문 1건 · 첨부 3개     ← ★ 실제 개수
```

### 5.3 실행 이력 단건 (증적이 있는 실행) — `g16-run-delete-dialog-with-artifacts.png`

```
이 실행 이력을 삭제할까요?
RUN-0281 · G14-D 성공 5단계
──────────────────────────────────────────────
G14-D 성공 5단계        RUN-0281 · 증적 1개 · 42KB          ← ★ 실제 개수·용량
──────────────────────────────────────────────
⚠ 이 작업은 되돌릴 수 없습니다
  휴지통이 없습니다. 삭제하면 DB 행과 디스크 파일이 그 자리에서 사라지고 복구할 방법이 없습니다.
  증적(영상 · trace · 스크린샷)이 디스크에서 함께 삭제됩니다. 지금 1개 · 합계 42KB 가 있고,
  삭제 후에는 실패 원인을 다시 볼 자료가 남지 않습니다.
  시나리오와 코드는 지워지지 않습니다 — 언제든 다시 실행할 수 있습니다.
```

### 5.4 ★ **모르면 쓰지 않는다** — 개수를 지어내지 않는 규칙

확인 대화상자의 숫자가 틀리면 대화상자 자체가 거짓말이 된다. 그래서 **아는 화면만** 적는다.

| 화면 | 스텝 수 | 코드 본문 | 첨부 개수 | 증적 개수 |
|---|---|---|---|---|
| 시나리오 목록(다중) | ✓ 목록 응답에 있다 | ✗ 모른다 → `코드 시나리오` | ✗ 모른다 → 안 적는다 | — |
| 빌더(녹화) | ✓ `스텝 N개` | — | — (코드 전용) | — |
| 코드 편집 | — | ✓ `코드 본문 1건`/`없음` | ✓ `첨부 N개` | — |
| 실행 목록(다중) | — | — | — | ✓ 대화상자 열 때 조회 |
| 실행 상세 | — | — | — | ✓ 이미 읽어 놓았다 |

- **코드 시나리오에 "스텝 0개" 라고 적지 않는다.** `stepCount` 는 코드 시나리오에서 언제나 0이라
  (테이블에 행이 없다) 사실이지만 오해를 만든다. 단위 테스트로 고정했다.
- 실행 다중 삭제는 대화상자가 **열릴 때만** 증적 목록을 읽는다(`useRunArtifactsMany(ids, open)`).
  캐시 키가 `useRunArtifacts` 와 같아 상세에서 본 run 은 네트워크를 타지 않는다.
- 한 건이라도 못 읽었으면 **합계를 쓰지 않는다**(`totalArtifacts` → `null`). 일부만 더한 값을
  "합계"라고 적으면 실제보다 작은 숫자를 보여 주게 된다.

---

## 6. UI 배치 — 기존 `삭제` 버튼들과 혼동되지 않게

작업 전 이 화면들에는 이미 `삭제` 라는 버튼이 있었다 — **스텝 삭제**(빌더 인스펙터),
**첨부 삭제**(코드 화면, 파일마다 1개), **스위트 삭제**. 같은 이름을 하나 더 두면
버튼 이름만으로 무엇이 지워지는지 갈리지 않는다.

| 위치 | 라벨 | 배치 | 근거 |
|---|---|---|---|
| 시나리오 목록 선택 바 | **선택 삭제** | `선택 해제` 와 `▶ 선택 실행` **사이**(주 동작 왼쪽) | 파괴적 버튼을 주 동작 자리에 두지 않는다. "선택"이 대상이라 한 단어로 읽힌다 |
| 빌더(녹화 편집) | **시나리오 삭제** | 머리 버튼 줄 **맨 왼쪽** | 같은 화면 인스펙터의 `삭제`(= **스텝**)와 구분 |
| 코드 편집 | **시나리오 삭제** | 머리 버튼 줄 **맨 왼쪽** | 같은 화면 첨부 행의 `삭제`(= **파일**)와 구분 |
| 실행 목록 선택 바 | **선택 삭제** | `선택 해제` 오른쪽 | 시나리오 목록과 같은 자리·같은 말 |
| 실행 상세 | **이력 삭제** | `■ 실행 중단` / `↻ 재실행` **왼쪽** | `실행 중단`(진행 중지)과 구분. 지워지는 것이 **이력과 증적**이지 시나리오가 아님을 이름에 드러낸다 |

코드 화면 버튼 라벨 실측(`g16-code-page-buttons.png`):
```
["＋ 새 시나리오", "시나리오 삭제", "저장", "▶ 실행", "발행하기", "복사", "삭제", "삭제", "삭제"]
                   ↑ 페이지 머리                              ↑↑↑ 첨부 파일 3개의 행 버튼
```

### 6.1 ★ #14 의 선택 상태를 **재사용**했다 — 두 벌 만들지 않았다

시나리오 목록의 다중 선택은 #14 가 만든 것이다. 삭제도 **같은 `selection` state** 를 쓴다.
넓어진 것은 **값의 모양**뿐이다 — `Record<id, name>` → `Record<id, {id,name,code,sourceType,stepCount}>`.
이름만 들고 있으면 확인 대화상자가 코드·스텝 수를 적을 수 없어 **선택 상태를 두 벌 만들거나
개수를 지어내게** 된다. 선택은 한 벌이다.

실측: 전체 선택 → `data-selected-count=4`, `선택 실행`과 `선택 삭제`가 **함께** 보인다.

### 6.2 실행 목록의 다중 선택 — 진행 중인 행

- `RunRow` 에 **선택 props 를 주지 않으면 체크 칸 자체가 없다.** 대시보드 "최근 실행"은
  그 경로라 한 글자도 바뀌지 않는다(실측: 대시보드 체크박스 **0개**).
- 진행 중인 실행은 **고를 수 없다** — 서버가 409 로 거부하는 것을 화면도 같은 규칙으로 막는다.
  다만 체크 칸을 **비우지는 않는다**. 비우면 ① 그 행만 40px 어긋나 표가 깨져 보이고
  ② "왜 이 행만 고를 수 없나"를 추측하게 된다. **끄고 `title` 로 이유를 붙인다** —
  #14 가 재실행 버튼에서 고른 방식 그대로다.
  ```
  행 30개 · 체크박스 30개 · 그중 꺼진 것 1개
  title: "진행 중인 실행은 삭제할 수 없습니다. 먼저 실행을 중단하세요."
  ```
- 실행 상세의 `이력 삭제` 버튼도 같다 — 진행 중이면 **끄고** 같은 문장을 `title` 로.

### 6.3 새 라이브러리·새 색 0개

`DeleteDialog` 는 `ui/Modal`(Radix `Dialog`, `RunDialog` 가 이미 쓰는 것)을 그대로 쓰고,
경고 박스는 시안의 amber `NoticeBox` 다. **새 색 토큰 0개 · 새 런타임 의존성 0개 ·
인라인 CSS 0건 · HEX 0건**(신규 3개 파일 모두).

---

## 7. ★ 검증 중 발견해 고친 것 — 지운 것을 다시 읽어 404 를 내던 무효화

**증상**: 삭제 후 `invalidateQueries({queryKey: ["runs"]})` 가 접두 일치로
`["runs", <id>]`(상세)와 `["runs", <id>, "artifacts"]`(증적)까지 건드렸다. 그 쿼리들은
**방금 지운 run 의 것**이고 관찰자가 아직 붙어 있어(대화상자가 닫히기 전 · 목록으로 이동하기 전)
곧바로 다시 읽으러 갔다.

**실측 (수정 전)**:
```
404 GET /api/runs/bd4751d9-…/artifacts
404 GET /api/runs/075eb468-…/artifacts
404 GET /api/runs/1e17695e-…/artifacts      ← 3건 다중 삭제 1회
404 GET /api/runs/6d23d044-…
404 GET /api/runs/6d23d044-…/artifacts      ← 상세에서 단건 삭제 1회
→ 콘솔 에러 5건
```

**수정**: `invalidateRunLists()` 가 **목록 계열만** 무효화한다 —
`["runs", {필터}]`(목록) · `["runs","queue"]`(큐). id 로 키가 잡힌 쿼리는 건드리지 않는다.
지워진 것을 다시 읽을 이유가 없다.

**수정 후**: `4xx/5xx 응답 0건`. 남은 콘솔 에러 1건은 Runner 미기동에서 나는
`ws://127.0.0.1:4100/live/… ERR_CONNECTION_REFUSED` 로 **이번 변경 이전부터 있던 동작**이다.

같은 종류의 함정을 `queryKeys.runLive` 주석이 이미 기록해 두었다(Gen-Phase 6 에서 접두 일치
무효화가 라이브 토큰을 회전시켜 소켓을 끊은 사고). **세 번째 발생이다** — 접두 일치 무효화는
이 레포에서 반복되는 실수의 자리다.

---

## 8. 검증 결과

인프라: `docker compose`(mysql:3307 · redis:6379) → API `127.0.0.1:4000` → 웹 preview `:4173`.
Runner 는 기동하지 않았다(§10 미검증 참조). **배포 서버·운영은 건드리지 않았다.**

### 8.1 API 실측 — `g16-verify.mjs` → **32 pass / 0 fail** (`g16-verify.log.md`)

| 항목 | 결과 |
|---|---|
| ★ run 삭제 후 증적 디렉토리 디스크에서 사라짐 | ✔ 1,025,739 bytes · 3파일 → 0 |
| ★ `artifacts/runs` 총량이 정확히 그만큼 감소 | ✔ 191,110,986 → 190,085,247 |
| `artifacts` · `step_results` CASCADE 삭제 | ✔ 3행 · 21행 → 0 |
| `scenarios.last_run_id` 역참조 NULL | ✔ |
| Redis 잔재 4키 삭제 | ✔ 4/4 → 0/4 |
| ★ 진행 중 run 삭제 → 409 + DB 행 생존 | ✔ |
| 취소 후 삭제 → 204 | ✔ |
| ★ 시나리오 삭제 시 첨부 디스크 파일 삭제 | ✔ 2파일 8,192 bytes → 디렉토리 없음 |
| ★ 코드 본문(`scenario_codes`) CASCADE 삭제 | ✔ (디스크 파일 아님 — DB 컬럼이다) |
| ★ 진행 중 실행이 있는 시나리오 → 409, 파일 보존 | ✔ |
| ★ 시나리오 삭제 후 실행 이력 생존 (`scenarioId: null`) | ✔ |
| 다중 삭제 시나리오 3건 · 실행 3건 | ✔ 각 `deleted:3, skipped:0` |
| 부분 성공(끝남1 + 진행중1 + 없음1) | ✔ `deleted:1, skipped:2` · 이유 구분 |
| 없는 id → 404 (run · scenario) | ✔ |
| 빈 배열 다중 삭제 → 400 | ✔ |
| 회귀: 목록 · `runs/queue` 라우트 순서 · #14 batch 실행 | ✔ |
| 고아 검사: `scenario-attachments` 하위 | ✔ 0개 · 0 bytes |

### 8.2 화면 실측 — `g16-ui.mjs` → **37 pass / 0 fail** (`g16-ui.log.md`)

| 항목 | 결과 |
|---|---|
| #14 선택 바 + `선택 삭제` 공존 | ✔ |
| 확인 대화상자가 코드 · 딸린 것 · "되돌릴 수 없습니다" · "실행 이력은 남는다" 표기 | ✔ |
| ★ 부분 성공을 토스트가 그대로 말한다 | ✔ `3건을 삭제했습니다. 1건은 건너뛰었습니다. 진행 중인 실행이 있어…` |
| ★ 삭제 후 목록 갱신(캐시 무효화), 건너뛴 1건만 남음 | ✔ 4행 → 1행 |
| 실행 목록: 모든 행에 체크 칸, 진행 중은 꺼짐 + `title` | ✔ 30/30, 꺼짐 1 |
| 실행 다중 삭제 후 실제 404 | ✔ `[404,404,404]` |
| ★ 증적 개수 실제 표기 | ✔ `증적 1개 · 42KB` |
| 실행 상세: 진행 중이면 삭제 버튼 꺼짐 + `title` | ✔ |
| ★ 상세에서 지우면 목록으로 이동 | ✔ `/runs`, `/scenarios` (코드 · 빌더 모두) |
| 취소를 누르면 아무것도 지워지지 않음 | ✔ |
| 코드 화면 첨부 개수 실제 표기 | ✔ `코드 본문 1건 · 첨부 3개` |
| 빌더 스텝 수 표기 | ✔ `스텝 0개` |
| 반응형 1050 / 760 · 대화상자 포함 가로 스크롤 | ✔ overflow=0 (4건 모두) |
| 회귀: 첨부 삭제(기존 기능) | ✔ |
| 회귀: 대시보드 "최근 실행" 체크박스 0개 | ✔ 8행 정상 |
| ★ 삭제 경로가 만든 콘솔 에러 | ✔ **0건** (Runner 미기동 WS 1건은 기존 동작) |

스크린샷 19장: `g16-scenario-selection` · `g16-scenario-delete-dialog` · `g16-scenario-after-delete` ·
`g16-run-selection` · `g16-run-delete-dialog` · `g16-run-delete-dialog-with-artifacts` ·
`g16-run-after-delete` · `g16-run-detail-active-disabled` · `g16-run-detail-delete-dialog` ·
`g16-run-detail-after-delete` · `g16-code-page-buttons` · `g16-code-delete-dialog` ·
`g16-builder-delete-dialog` · `g16-vw1050(-dialog)` · `g16-vw760(-dialog)` ·
`g16-regress-attachment-delete` · `g16-regress-dashboard`.

### 8.3 기준선

| | before | after |
|---|---|---|
| `pnpm typecheck` | 7/7 | **7/7** |
| `pnpm lint` | 0 problems | **0 problems** |
| `pnpm test` | 717 | **751** (+34) |
| `pnpm build` | 5/5, 500KB 경고 없음 | **5/5, 경고 없음** |
| 초기 로드 JS | 305.37 + 218.82 = **524.19 KB** | 305.84 + 218.82 = **524.66 KB** (+0.47 KB) |

청크별: `scenarios` 9.59 → 10.39 KB · `code` 16.57 → 17.34 KB · `builder` 21.46 → 22.14 KB ·
`RunDetail` 39.18 → 41.52 KB. 삭제 대화상자는 **lazy 청크 쪽**에 붙었고 초기 번들은
+0.47 KB(0.09%)에 그쳤다.

추가된 테스트 **34건** (실행 로그 기준):
contracts `delete.spec.ts` **9** · api `bulk-delete.spec.ts` **8** ·
api `artifacts.purge.spec.ts` **5** · web `RunDeleteDialog.spec.ts` + `ScenarioDeleteDialog.spec.ts` **12**.

---

## 9. 생성·수정 파일

### 생성
```
packages/contracts/src/delete.ts                       다중 삭제 계약 + 형태 결정 근거
packages/contracts/src/delete.spec.ts
apps/api/src/common/utils/bulk-delete.ts               시나리오·실행이 공유하는 분류 루프
apps/api/src/common/utils/bulk-delete.spec.ts
apps/api/src/modules/artifacts/artifacts.purge.spec.ts ★ 디스크 삭제·경로 방어 테스트
apps/web/src/components/DeleteDialog/{DeleteDialog.tsx,index.ts}   "되돌릴 수 없다"를 강제
apps/web/src/pages/scenarios/ScenarioDeleteDialog.tsx  + .spec.ts
apps/web/src/pages/runs/RunDeleteDialog.tsx            + .spec.ts
.pipeline/20260917-231945/g16-verify.mjs · g16-ui.mjs · *.log.md · g16-*.png
```

### 수정
```
packages/contracts/src/index.ts                  delete.js 재노출
apps/api/src/modules/artifacts/artifacts.service.ts   ★ purgeRunFiles() + measureDir()
apps/api/src/modules/runs/runs.controller.ts          DELETE /runs/:id · POST /runs/bulk-delete
apps/api/src/modules/runs/runs.service.ts             assertDeletable · removeRow · purgeRedis
apps/api/src/modules/runs/runs.module.ts              ArtifactsModule import
apps/api/src/modules/scenarios/scenarios.controller.ts  판정→파일→DB 순서 · bulk-delete
apps/api/src/modules/scenarios/scenarios.service.ts     assertDeletable(진행 중 실행 가드)
apps/web/src/lib/queryClient.ts                  queryKeys.scenariosRoot
apps/web/src/hooks/useRuns.ts                    useDeleteRun · useBulkDeleteRuns ·
                                                 useRunArtifactsMany · invalidateRunLists(§7)
apps/web/src/hooks/useScenarios.ts               useDeleteScenario · useBulkDeleteScenarios
apps/web/src/components/RunRow/RunRow.tsx        선택 props(선택 안 주면 기존과 동일)
apps/web/src/components/index.ts                 DeleteDialog 재노출
apps/web/src/pages/scenarios/index.tsx           선택 상태 재사용 + 선택 삭제
apps/web/src/pages/scenarios/builder/index.tsx   시나리오 삭제
apps/web/src/pages/scenarios/code/index.tsx      시나리오 삭제(첨부·본문 개수 표기)
apps/web/src/pages/runs/index.tsx                실행 다중 선택 + 선택 삭제
apps/web/src/pages/runs/RunDetail.tsx            이력 삭제(진행 중이면 꺼짐)
```

**마이그레이션 0건** — 스키마를 바꾸지 않고 해결했다. 삭제에 필요한 CASCADE 는 이미
005·006·007 마이그레이션에 있었고(실측으로 확인), `last_run_id` 만 애플리케이션이 끊는다.
`features/recorder/**` · `docker-compose.yml` · `guard.ts` 등 금지 파일은 건드리지 않았다.

---

## 10. 미검증 · 남은 것

- **Runner 를 기동한 상태에서의 `running` run 삭제 시도**는 하지 못했다. 검증한 것은
  `queued` 다. 판정 코드가 `isTerminalRunStatus()` 하나로 `queued`/`running` 을 같이 막으므로
  분기가 갈리지 않지만, **"실제로 도는 실행에 대해 눌러 보지는 않았다"** 는 사실 그대로 남긴다.
- **동시성**: 두 사용자가 같은 run 을 동시에 지우면 한쪽이 404 를 받는다(다중 삭제에서는
  `skipped: not_found`). 파일 삭제는 `rm -rf` 의 `force: true` 라 경합해도 던지지 않는다.
  다만 **동시 요청을 실제로 겹쳐 보지는 않았다.**
- **대량 삭제 성능**: 상한 100건을 직렬로 도는 최악의 경우(영상 100개 × 수십 MB) 응답 시간을
  재지 않았다. 느려지면 큐로 옮겨야 한다.
- **`artifacts/runs` 에 이미 쌓인 고아**: 이번 변경은 **앞으로 지우는 것**을 보장한다.
  이전에 DB 행 없이 남은 디렉토리가 있는지는 훑지 않았다(정리 스크립트는 범위 밖).
- 실행 목록의 "전체 선택" 체크박스는 만들지 않았다(시나리오 표에만 있다). 실행 목록은
  기본 30건이 한 화면이라 개별 선택으로 충분하다고 판단했다 — 필요해지면 추가한다.
