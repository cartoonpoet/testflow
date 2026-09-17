---
# 성능 목표 측정 결과
pipeline_id: 20260917-114450
task: 12.5
---

# 성능 목표 측정 (01-clarify 비기능 요구사항)

측정일 2026-09-17 · WSL2 / Node 22.22.2 · MySQL 8.4(도커, 3307) · Redis 7 · loopback
측정 스크립트 `/tmp/tf12/perf.mjs` · 데이터 생성기 `/tmp/tf12/bulk-seed.mjs`
각 엔드포인트 **워밍업 5회 후 100회 호출**.

## 데이터 규모

**"데이터가 적으면 무의미하다"** 는 지시에 따라 직접 INSERT 로 대량 데이터를 만들고,
1.2k → 13k 로 **10배 늘려 스케일 특성까지** 봤다.

| 테이블 | 초기(실측정 전) | 규모 ① | **규모 ②** |
|---|---|---|---|
| `scenarios` | 29 | 89 | **249** |
| `test_steps` | 191 | 551 | **1,751** |
| `runs` | 41 | 1,241 | **13,241** |
| `step_results` | 228 | 7,428 | **79,428** |
| `artifacts` | 54 | 1,764 | **18,904** |

시각 컬럼은 전부 `UTC_TIMESTAMP(3)` 기준으로 넣었다 — 앱 규약(`default-time-zone=+00:00`,
드라이버 `timezone:"Z"`)과 같은 UTC 다. 그렇지 않으면 대시보드의 "오늘" 집계가 틀어진다.

---

## ① 일반 API p95 500ms 이내

### 규모 ② (runs 13,241 / step_results 79,428) — **인덱스 추가 후**

| 엔드포인트 | p50 | **p95** | max | 목표 | 판정 |
|---|---|---|---|---|---|
| `GET /api/health` | 1.5ms | **2.1ms** | 2.9ms | 500ms | ✅ |
| `GET /api/dashboard/summary?range=today` | 4.2ms | **5.3ms** | 6.9ms | 500ms | ✅ |
| `GET /api/dashboard/summary?range=30d` | 9.8ms | **11.3ms** | 13.3ms | 500ms | ✅ |
| `GET /api/dashboard/readiness` | 3.5ms | **5.8ms** | 8.3ms | 500ms | ✅ |
| `GET /api/projects/:id/scenarios` (page1 size20) | 4.1ms | **6.3ms** | 10.7ms | 500ms | ✅ |
| `GET /api/projects/:id/scenarios?q&status` | 3.3ms | **5.3ms** | 5.6ms | 500ms | ✅ |
| `GET /api/runs?projectId&limit=20` | 2.3ms | **3.4ms** | 5.3ms | 500ms | ✅ |
| `GET /api/runs?status=failed&limit=20` | 2.1ms | **3.2ms** | 4.6ms | 500ms | ✅ |
| `GET /api/runs` (필터 없음, limit=20) | 2.3ms | **4.2ms** | — | 500ms | ✅ |
| `GET /api/runs/:id` (상세 + 스텝 6건) | 2.5ms | **3.4ms** | 5.9ms | 500ms | ✅ |
| `GET /api/runs/:id/artifacts` | 2.2ms | **3.5ms** | 6.7ms | 500ms | ✅ |
| `GET /api/scenarios/:id` (스텝 포함) | 2.5ms | **3.4ms** | 4.5ms | 500ms | ✅ |

**판정: PASS. 최악 p95 가 11.3ms 로 목표의 2.3% 다.**

### 스케일 특성 — 어디가 늘어나는가

| 엔드포인트 | 1.2k runs p95 | 13k runs p95 | 배율 |
|---|---|---|---|
| `dashboard/summary?range=today` | 2.5ms | 4.5ms | 1.8× |
| **`dashboard/summary?range=30d`** | 2.4ms | **8.9ms** | **3.7×** |
| `dashboard/readiness` | 2.1ms | 3.6ms | 1.7× |
| **`/runs?status=failed`** (인덱스 전) | 3.9ms | **9.9ms** | **2.5×** |
| **`/runs`** 필터 없음 (인덱스 전) | — | **12.6ms** | — |
| `scenarios` 목록 | 5.4ms | 4.5ms | ≈1× |

04-gen-5 가 축소 후보로 지목한 **대시보드 집계는 무겁지 않았다.**
`readiness` 는 `scenarios LEFT JOIN runs ON r.id = s.last_run_id` 로 비정규화 컬럼을 타므로
실행 이력 전체를 훑지 않는다 — 13k 행에서도 3.6ms 다. **축소할 이유가 없다.**

---

## ★ 인덱스 추가 — `010-add-run-list-indexes.ts` (신규)

측정 중 `EXPLAIN` 으로 **full scan + filesort 3건**을 찾았다.

### before

```
SELECT … FROM runs WHERE status='failed' ORDER BY queued_at DESC LIMIT 20
  → key=NULL   rows=12987   Extra="Using where; Using filesort"
SELECT … FROM runs                       ORDER BY queued_at DESC LIMIT 20
  → key=NULL   rows=12987   Extra="Using filesort"
```

원인: 기존 `ix_runs_project_queued (project_id, queued_at)` 는 **`project_id` 가 선행 컬럼**이라
`projectId` 를 넘기지 않는 `/runs` 화면 경로에서는 쓸 수 없다.

### after — 인덱스 2개 추가

```sql
CREATE INDEX ix_runs_status_queued ON runs (status, queued_at);
CREATE INDEX ix_runs_queued        ON runs (queued_at);
```

```
WHERE status='failed' ORDER BY queued_at DESC LIMIT 20
  → key=ix_runs_status_queued  rows=1894  Extra="Using where; Backward index scan"
ORDER BY queued_at DESC LIMIT 20
  → key=ix_runs_queued         rows=20    Extra="Backward index scan"
```

| 엔드포인트 | **before p95** | **after p95** | 검사 행수 |
|---|---|---|---|
| `GET /api/runs?status=failed&limit=20` | 9.9ms | **3.2ms** | 12,987 → **1,894** |
| `GET /api/runs?limit=20` (필터 없음) | 12.6ms | **4.2ms** | 12,987 → **20** |

**인덱스가 2개인 이유**: `(status, queued_at)` 하나로는 **필터 없는** `ORDER BY queued_at DESC` 를
탈 수 없다(선행 컬럼이 상수로 고정되지 않으면 정렬에 못 쓴다). 두 경로는 서로 다른 인덱스가 필요하다.

> 솔직히 말하면 **지금 당장 느려서 넣은 게 아니다.** 13k 행에서 9.9ms 는 목표를 한참 밑돈다.
> 다만 두 쿼리가 **행 수에 선형으로** 늘어나는 모양이고, 10만~100만 행에서 목표를 넘는다.
> 지금 넣는 비용이 나중에 넣는 비용보다 싸서 넣었다.

---

## ② 실행 요청 후 1초 이내 큐 등록

`POST /api/runs` 20회 (runs 13,241행 상태에서).

| n | p50 | **p95** | max | 응답 코드 | 목표 | 판정 |
|---|---|---|---|---|---|---|
| 20 | 27.0ms | **45.0ms** | 82.8ms | **202** | 1,000ms | ✅ **PASS** |

(04-gen-5 가 데이터 없는 상태에서 잰 값은 0.019~0.047s 였다. 13k 행에서도 같은 자리다 —
INSERT + 큐 등록이라 조회 규모와 무관하다.)

## ③ 상태 이벤트 지연 2초 이내

실제 실행 1건(3스텝, 실패 시나리오)에 SSE 를 붙여 측정.

```
수신 이벤트 13건: run.status, step.started×3, step.finished×3, artifact.ready×5, run.finished
서버 runs.finished_at → 클라이언트 run.finished 수신  =  29ms
```

| 측정 | 값 | 목표 | 판정 |
|---|---|---|---|
| 서버 확정 → SSE 수신 (이번 측정, `fetch` 스트림) | **29ms** | 2,000ms | ✅ **PASS** |
| 서버 확정 → **브라우저 화면 반영** (04-gen-11 실측) | **246ms** | 2,000ms | ✅ **PASS** |

---

## 종합 판정

| 목표 (01-clarify) | 실측 | 판정 |
|---|---|---|
| 일반 API p95 **500ms** 이내 | 최악 **11.3ms** (12개 엔드포인트 / 13k runs) | ✅ **PASS** |
| 실행 요청 후 **1초** 이내 큐 등록 | p95 **45ms** | ✅ **PASS** |
| 상태 이벤트 지연 **2초** 이내 | **29ms**(서버→클라) / **246ms**(→화면) | ✅ **PASS** |

## 측정의 한계 (사실대로)

- **전부 loopback 단일 머신·직렬 호출이다.** 동시 사용자 부하(k6/autocannon 류)는 측정하지 않았다.
  "p95" 는 `동시성 1` 에서의 p95 다.
- 대량 데이터는 **직접 INSERT** 로 만들었다. 실제 실행이 만드는 데이터보다 값 분포가 균일하다
  (`status` 7종을 라운드로빈으로 넣었다 — 실제로는 `passed` 가 훨씬 많을 것이다).
- 인덱스 효과는 **13k 행에서만** 확인했다. 10만 행 이상에서의 거동은 추정이다.
- 측정 데이터는 DB 에 남아 있다. 정리하려면
  `DELETE FROM runs WHERE run_code LIKE 'RUN-P%'; DELETE FROM scenarios WHERE code LIKE 'TC-PERF%';`
  (FK `ON DELETE CASCADE` 로 `step_results`·`artifacts`·`test_steps` 가 함께 지워진다.)
