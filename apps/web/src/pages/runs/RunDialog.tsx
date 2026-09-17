import type * as React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BROWSERS,
  CreateRunRequestSchema,
  type CreateRunResponse,
} from "@testflow/contracts";
import { NoticeBox, NoticeLine } from "@/components";
import { Button, Input, Modal, Select } from "@/components/ui";
import { browserLabel, maskRecord } from "@/lib";
import { useCreateRun } from "@/hooks/useRuns";
import { useHealth } from "@/hooks/useHealth";
import { useCurrentProject } from "@/hooks/useProject";
import { toast } from "@/hooks/useToast";

/**
 * 실행 요청 다이얼로그 — ★ 이 MVP 의 **핵심 경로**.
 *
 * ## 왜 여기서 값을 직접 받나 (02-context "★ 사용자 최종 결정" (a)(c))
 * 실행 환경 관리 화면과 테스트 데이터 관리 화면이 MVP 에서 빠졌다. 그래서
 *  - **`baseUrl` 은 이 폼이 주 경로다.** `projects.base_url` 은 **기본값**으로 채워 두되
 *    그대로 고칠 수 있다(스테이징·개발 주소를 매번 바꿔 가며 돌리는 것이 실제 사용 방식이다).
 *  - **계정·비밀번호도 이 폼에서 직접 받는다.** DB 에는 저장할 컬럼 자체가 없고
 *    (`project_variables` 테이블을 만들지 않았다), 값은 `POST /api/runs` 의 `variables` 로만
 *    전달돼 BullMQ 큐 페이로드에 머물다 job 과 함께 만료된다.
 *
 * ## 비밀번호를 어떻게 다루나
 *  - `type="password"` · `autoComplete="new-password"` — 브라우저 자동완성 저장을 유도하지 않는다.
 *  - **전송 후 폼에서 즉시 지운다**(성공·실패 모두). 실패했다고 평문을 남겨 두면
 *    다이얼로그를 닫을 때까지 DOM 에 살아 있다.
 *  - localStorage · sessionStorage · react-query 캐시 어디에도 넣지 않는다.
 *    실행 화면으로 넘길 때도 **`maskRecord()` 를 통과한 사본**만 라우터 state 로 넘긴다.
 *
 * ## 폼 검증
 * react-hook-form 을 새로 넣지 않았다(Gen-Phase 10 과 같은 판단). 전송 직전에
 * **계약 스키마(`CreateRunRequestSchema`)로 `safeParse`** 한다 — 서버가 실제로 검증하는 그 규칙이다.
 */
export type RunTarget = { scenarioId: string } | { suiteId: string };

export type RunDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: RunTarget;
  /** 다이얼로그 제목 아래에 보여 줄 대상 이름. */
  targetName: string;
  /** 스위트 실행이면 몇 건이 생기는지 미리 알려 준다. */
  scenarioCount?: number;
};

export function RunDialog(props: RunDialogProps) {
  const { open, onOpenChange, target, targetName, scenarioCount } = props;
  const { project } = useCurrentProject();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="실행 요청"
      description={
        scenarioCount === undefined
          ? targetName
          : `${targetName} · 시나리오 ${String(scenarioCount)}건이 한 묶음으로 실행됩니다`
      }
    >
      {/*
       * ★ `key` 로 초기화한다 — `useEffect` 로 "열릴 때 기본값 채우기" 를 하지 않는다.
       *   프로젝트 조회가 늦게 끝나도 값이 도착하는 순간 폼이 새 기본값으로 다시 마운트된다.
       */}
      {open ? (
        <RunDialogForm
          key={`${project?.id ?? "no-project"}:${project?.baseUrl ?? ""}`}
          target={target}
          defaultBaseUrl={project?.baseUrl ?? ""}
          defaultEnvLabel={project?.defaultEnvLabel ?? "스테이징"}
          onClose={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Modal>
  );
}

/** 계정·비밀번호가 들어가는 변수 이름. 녹화가 만드는 `{{password}}` 와 같아야 한다. */
export const ACCOUNT_VARIABLE = "username";
export const PASSWORD_VARIABLE = "password";

function RunDialogForm({
  target,
  defaultBaseUrl,
  defaultEnvLabel,
  onClose,
}: {
  target: RunTarget;
  defaultBaseUrl: string;
  defaultEnvLabel: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const health = useHealth();
  const createRun = useCreateRun();

  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [envLabel, setEnvLabel] = useState(defaultEnvLabel);
  const [browser, setBrowser] = useState<(typeof BROWSERS)[number]>("chromium");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<readonly string[]>([]);

  const runnerDown = health.data?.runner === "down";

  const submit = () => {
    const variables: Record<string, string> = {};
    if (account !== "") variables[ACCOUNT_VARIABLE] = account;
    if (password !== "") variables[PASSWORD_VARIABLE] = password;

    const candidate = {
      ...target,
      baseUrl: baseUrl.trim(),
      envLabel: envLabel.trim(),
      browser,
      variables,
      secretKeys: [],
    };

    const parsed = CreateRunRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
      return;
    }
    setFormError([]);

    // 화면으로 넘어가는 것은 **마스킹된 사본**뿐이다. 평문은 이 함수 밖으로 나가지 않는다.
    const maskedVariables = maskRecord(variables);

    createRun.mutate(parsed.data, {
      onSuccess: (response) => {
        toast("실행을 요청했습니다", { label: "실행" });
        onClose();
        goToResult(response, maskedVariables);
      },
      onSettled: () => {
        // ★ 성공·실패 무관하게 비밀번호를 폼에서 지운다.
        setPassword("");
      },
    });
  };

  const goToResult = (
    response: CreateRunResponse,
    maskedVariables: Record<string, string>,
  ) => {
    if (response.runIds.length > 1 && response.batchId !== null) {
      /*
       * 스위트 실행은 run 이 N 건 생긴다(같은 `batch_id`). 목록 응답(`RunListItem`)에는
       * `batchId` 가 없어 서버에 "이 묶음만" 을 물어볼 수 없으므로, 방금 받은 id 들을
       * 쿼리로 들고 간다. 묶음 화면이 그 id 로 각각 상세를 읽는다.
       */
      void navigate(
        `/runs?batch=${response.batchId}&ids=${response.runIds.join(",")}`,
        { state: { maskedVariables } },
      );
      return;
    }
    void navigate(`/runs/${response.runId}`, { state: { maskedVariables } });
  };

  const errors = formError.length > 0 ? formError : apiErrorLines(createRun.error);

  return (
    <form
      data-slot="run-dialog-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="대상 주소 (baseUrl)"
        hint="스텝의 {{baseUrl}} 자리에 들어갑니다. 프로젝트 기본값을 그대로 고칠 수 있습니다."
      >
        <Input
          name="baseUrl"
          data-slot="field-base-url"
          value={baseUrl}
          placeholder={defaultBaseUrl === "" ? "https://staging.example.com" : defaultBaseUrl}
          inputMode="url"
          onChange={(event) => {
            setBaseUrl(event.target.value);
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-[12px] max-mobile:grid-cols-1">
        <Field label="환경 라벨">
          <Input
            name="envLabel"
            data-slot="field-env-label"
            value={envLabel}
            placeholder="스테이징"
            onChange={(event) => {
              setEnvLabel(event.target.value);
            }}
          />
        </Field>

        <Field label="브라우저">
          <Select
            name="browser"
            data-slot="field-browser"
            value={browser}
            onChange={(event) => {
              setBrowser(event.target.value as (typeof BROWSERS)[number]);
            }}
          >
            {BROWSERS.map((value) => (
              <option key={value} value={value}>
                {browserLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-[6px] mb-[10px] border-t border-line pt-[14px]">
        <strong className="text-[12px]">테스트 데이터</strong>
        <p className="m-0 mt-[4px] text-[10px] leading-[1.6] text-muted">
          입력한 값은 이번 실행에만 쓰이고 <strong>서버에 저장되지 않습니다.</strong>
          {" 스텝의 "}
          {`{{${ACCOUNT_VARIABLE}}}`} · {`{{${PASSWORD_VARIABLE}}}`} 자리에 들어갑니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-[12px] max-mobile:grid-cols-1">
        <Field label="계정">
          <Input
            name={ACCOUNT_VARIABLE}
            data-slot="field-account"
            value={account}
            autoComplete="off"
            placeholder="qa-tester"
            onChange={(event) => {
              setAccount(event.target.value);
            }}
          />
        </Field>

        <Field label="비밀번호">
          <Input
            name={PASSWORD_VARIABLE}
            data-slot="field-password"
            type="password"
            value={password}
            autoComplete="new-password"
            spellCheck={false}
            placeholder="••••••••"
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
      </div>

      {runnerDown ? (
        <NoticeBox title="Runner 가 실행 중이 아닙니다">
          <NoticeLine>
            실행 요청은 접수되지만 <strong>큐에 쌓인 채 진행되지 않습니다.</strong> 서버에서
            Runner 를 기동한 뒤 요청하면 대기 중인 실행부터 순서대로 처리됩니다.
          </NoticeLine>
        </NoticeBox>
      ) : null}

      {errors.length === 0 ? null : (
        <div
          role="alert"
          data-slot="run-dialog-error"
          className="mt-[14px] rounded-metric border border-danger bg-danger-soft px-[14px] py-[12px] text-[11px] leading-[1.6] text-danger"
        >
          {errors.map((line) => (
            <p key={line} className="m-0">
              {line}
            </p>
          ))}
        </div>
      )}

      <div className="mt-[18px] flex items-center justify-end gap-[9px]">
        <Button onClick={onClose}>취소</Button>
        <Button
          type="submit"
          variant="primary"
          data-slot="run-dialog-submit"
          disabled={createRun.isPending}
        >
          {createRun.isPending ? "요청 중…" : "▶ 실행 시작"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-[12px] block">
      <span className="mb-[6px] block text-label text-muted">{label}</span>
      {children}
      {hint === undefined ? null : (
        <span className="mt-[5px] block text-[10px] leading-[1.5] text-muted">{hint}</span>
      )}
    </label>
  );
}

function apiErrorLines(error: unknown): readonly string[] {
  if (error === null || error === undefined) return [];
  if (error instanceof Error) {
    const details = (error as { details?: readonly string[] }).details;
    return details !== undefined && details.length > 0 ? details : [error.message];
  }
  return ["실행 요청에 실패했습니다"];
}
