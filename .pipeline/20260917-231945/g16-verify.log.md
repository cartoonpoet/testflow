══ 0. 사전 상태 ══
projectId = 00000000-0000-4000-8000-000000000001
ARTIFACT_ROOT = /mnt/c/Users/jhson1/Documents/GitHub/testflow/artifacts
artifacts/runs 전체 = 190036304 bytes (181.2 MB), 147 디렉토리

══ 1. ★ 실행 삭제 — 증적 파일 디스크 실측 ══
대상: RUN-0281 (206ea9ea-01b0-46fa-80cb-0c71fc337fc9) status=passed
  [before] artifacts/runs/206ea9ea-01b0-46fa-80cb-0c71fc337fc9/
           존재=true 파일=1개 크기=42932 bytes
           파일목록=["video.webm"]
  [before] DB artifacts=1행 step_results=6행
  [before] scenarios.last_run_id 역참조=0행
  [before] Redis 키 = 4/4 존재
  DELETE /api/runs/206ea9ea-01b0-46fa-80cb-0c71fc337fc9 → 204
  ✔ 204 로 삭제된다 — status=204
  [after]  artifacts/runs/206ea9ea-01b0-46fa-80cb-0c71fc337fc9/ 존재=false 파일=0개 크기=0 bytes
  ✔ ★ 증적 디렉토리가 디스크에서 사라졌다
  [after]  artifacts/runs 전체 = 189993372 bytes (줄어든 양 42932 bytes)
  ✔ ★ 줄어든 용량이 그 실행의 증적 크기와 일치한다 — 42932 >= 42932
  ✔ DB artifacts 행이 CASCADE 로 사라졌다
  ✔ DB step_results 행이 CASCADE 로 사라졌다
  ✔ DB runs 행이 사라졌다
  ✔ scenarios.last_run_id 역참조가 NULL 로 끊겼다
  [after]  Redis 키 = 0/4 존재
  ✔ Redis 잔재(SSE 버퍼·seq·라이브 토큰·해시별 보조키)가 사라졌다
  ✔ GET /api/runs/:id → 404 — status=404

══ 2. ★ 진행 중 실행 삭제 시도 → 409 ══
실행 대상 시나리오: TC-GEN-050 G11-steps-pass
POST /api/runs → 202 runId=c403cda0-f628-4387-9975-c56a2f80a540
  이 실행의 상태 = queued
DELETE /api/runs/c403cda0-f628-4387-9975-c56a2f80a540 → 409
  message: 진행 중인 실행은 삭제할 수 없습니다 (RUN-0281, status: queued). 먼저 실행을 취소한 뒤 삭제하세요.
  ✔ ★ 진행 중인 실행 삭제가 409 로 거부된다 — status=409
  ✔ 거부 문구가 '먼저 취소하세요' 를 안내한다
  ✔ DB 행이 그대로 살아 있다
취소 후 DELETE → 204
  ✔ 취소한 뒤에는 삭제된다 — status=204

══ 3. ★ 시나리오 삭제 — 코드 본문·첨부 디스크 실측 ══
생성: TC-DEL-001 (1c869ee3-9eb4-49bd-9e3a-4ec3c3fae0a0)
  코드 본문 DB 행 = 1
  첨부 업로드 데이터-1.csv → 201
  첨부 업로드 데이터-2.csv → 201
  [before] scenario-attachments/1c869ee3-9eb4-49bd-9e3a-4ec3c3fae0a0/ 존재=true 파일=2개 8192 bytes
DELETE /api/scenarios/1c869ee3-9eb4-49bd-9e3a-4ec3c3fae0a0 → 204
  ✔ 204 로 삭제된다 — status=204
  [after]  scenario-attachments/1c869ee3-9eb4-49bd-9e3a-4ec3c3fae0a0/ 존재=false
  ✔ ★ 첨부파일이 디스크에서 사라졌다
  ✔ ★ 코드 본문 DB 행이 CASCADE 로 사라졌다
  ✔ 첨부 DB 행이 CASCADE 로 사라졌다

══ 4. 진행 중 실행이 있는 시나리오 삭제 → 409 ══
  TC-DEL-001 에 대해 실행 생성 → 494422f6-98aa-4efc-9e7a-52257af1d2e0 (queued)
DELETE /api/scenarios/2cbb4c07-2ac1-4a48-84d8-ac2685a8187c → 409
  message: 진행 중인 실행이 있어 시나리오를 삭제할 수 없습니다 (RUN-0281, status: queued). 먼저 실행을 취소한 뒤 삭제하세요.
  ✔ ★ 진행 중 실행이 있으면 409 로 거부된다 — status=409
  ✔ 첨부·코드 본문이 지워지지 않았다(거부는 파일 삭제보다 먼저다)
취소 후 DELETE → 204
  ✔ 취소한 뒤에는 삭제된다 — status=204
  시나리오를 지운 뒤 그 실행 이력: status=200 scenarioId=null
  ✔ ★ 실행 이력은 남는다(scenario_id 만 NULL)

══ 5. 다중 삭제 — 시나리오 3건 · 실행 3건 ══
  시나리오 3건 생성: 70558fed-9cb5-43bb-905e-ef74111fa375, 47e79753-a277-42e7-8a3f-8ab595ca6b3a, 8fd720ec-8c75-4bbb-8737-263db9111875
POST /api/scenarios/bulk-delete → 200 {"requested":3,"deleted":["70558fed-9cb5-43bb-905e-ef74111fa375","47e79753-a277-42e7-8a3f-8ab595ca6b3a","8fd720ec-8c75-4bbb-8737-263db9111875"],"skipped":[]}
  ✔ ★ 시나리오 3건이 한 번에 삭제된다
  실행 3건 생성·취소: 6e12b458-915c-4c33-84a3-58bbde8340bb, c953aaeb-8292-48ac-8b2f-087756ead133, 2b28c6f8-ada3-4f75-95c8-fb225cdf9dad
POST /api/runs/bulk-delete → 200 {"requested":3,"deleted":["6e12b458-915c-4c33-84a3-58bbde8340bb","c953aaeb-8292-48ac-8b2f-087756ead133","2b28c6f8-ada3-4f75-95c8-fb225cdf9dad"],"skipped":[]}
  ✔ ★ 실행 3건이 한 번에 삭제된다

══ 6. 다중 삭제 부분 성공 — 진행 중 1건 + 끝난 1건 + 없는 1건 ══
POST /api/runs/bulk-delete (3건 혼합) → 200
  {
  "requested": 3,
  "deleted": [
    "8e00c25e-ad02-4074-b6d0-d1541c96be59"
  ],
  "skipped": [
    {
      "id": "f0e2e773-9bd4-4dbd-a2d6-31c47af5d8ec",
      "reason": "in_progress",
      "message": "진행 중인 실행은 삭제할 수 없습니다 (RUN-0282, status: queued). 먼저 실행을 취소한 뒤 삭제하세요."
    },
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "reason": "not_found",
      "message": "이미 삭제된 실행입니다."
    }
  ]
}
  ✔ ★ 끝난 1건은 지워지고 나머지는 건너뛴다(부분 성공)
  ✔ 건너뛴 이유가 in_progress / not_found 로 구분된다

══ 7. 존재하지 않는 id ══
  ✔ DELETE /api/runs/<없는 id> → 404 — status=404
  ✔ DELETE /api/scenarios/<없는 id> → 404 — status=404
  ✔ 빈 배열 다중 삭제 → 400 — status=400

══ 8. 회귀 — 기존 경로가 그대로인가 ══
  ✔ GET /api/runs 목록 — 5건
  ✔ GET /projects/:id/scenarios 목록 — 317건
  ✔ GET /api/runs/queue (라우트 순서 — bulk-delete 가 가로채지 않는다) — {"waiting":0,"active":0,"concurrency":null,"runners":0,"waitingRunIds":[]}
  POST /api/runs (scenarioIds 2건) → 202 {"runId":"31fc147f-306b-4e8e-a758-6fe255b88992","runIds":["31fc147f-306b-4e8e-a758-6fe255b88992","4b11f936-97d3-46b5-b2aa-effa430ea710"],"batchId":"91b37ec2-4652-423d-abe6-6ebb3713d660","status":"queued","position":2}
  ✔ #14 다중 선택 실행(batch)이 그대로 동작한다

artifacts/runs 최종 = 189993372 bytes · scenario-attachments 최종 = 0 bytes
고아 검사: scenario-attachments 하위 디렉토리 = 0개

결과: 32 pass / 0 fail
