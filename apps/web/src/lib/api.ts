import type { ZodType } from "zod";

/**
 * API 베이스 경로.
 *
 * 기본값 `/api` — 사내 단일 서버 배포에서 nginx 가 같은 오리진으로 프록시한다.
 * 개발 중 별도 오리진(`http://127.0.0.1:4000/api`)을 쓰려면 `VITE_API_BASE_URL` 로 덮는다.
 * env 는 tsconfig `noPropertyAccessFromIndexSignature` 규약에 따라 bracket 접근한다.
 */
export const API_BASE_URL: string =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/+$/, "") ??
  "/api";

/** Nest 기본 예외 응답 포맷. 커스텀 filter 를 두지 않았으므로 항상 이 형태다. */
export type NestErrorBody = {
  statusCode: number;
  message: string | string[];
  error?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** ValidationPipe 가 배열로 주는 필드별 메시지. */
  readonly details: readonly string[];
  readonly body: unknown;

  constructor(status: number, message: string, options: {
    code?: string | undefined;
    details?: readonly string[];
    body?: unknown;
  } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options.code;
    this.details = options.details ?? [];
    this.body = options.body;
  }
}

export type ApiRequestOptions = Omit<RequestInit, "body" | "method"> & {
  method?: string;
  /** JSON 으로 직렬화해 보낼 body. `FormData` 가 필요하면 `rawBody` 를 쓴다. */
  json?: unknown;
  rawBody?: BodyInit | null;
  /** 쿼리스트링. `undefined`·`null` 값은 생략된다. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** 주면 응답을 이 스키마로 파싱한다. contracts 스키마를 그대로 넘기면 된다. */
  schema?: ZodType<unknown>;
};

export function buildUrl(
  path: string,
  query?: ApiRequestOptions["query"],
): string {
  const base = path.startsWith("/") ? `${API_BASE_URL}${path}` : path;
  if (query === undefined) return base;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs === "" ? base : `${base}?${qs}`;
}

function toApiError(status: number, body: unknown): ApiError {
  if (typeof body === "object" && body !== null && "message" in body) {
    const nest = body as NestErrorBody;
    const details = Array.isArray(nest.message) ? nest.message : [];
    const message =
      details.length > 0 ? details.join(", ") : String(nest.message);
    return new ApiError(status, message, {
      code: nest.error,
      details,
      body,
    });
  }
  return new ApiError(status, `요청이 실패했습니다 (HTTP ${status})`, { body });
}

/**
 * 공용 fetch 래퍼.
 *
 * - 성공: 204 는 `undefined`, 그 외는 JSON 을 반환한다.
 * - 실패: `ApiError` 를 throw 한다 (react-query 가 그대로 error 로 받는다).
 * - `schema` 를 주면 파싱까지 하고, 계약 위반이면 ApiError(0) 으로 승격한다.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { json, rawBody, query, schema, headers, method, ...rest } = options;

  const finalHeaders = new Headers(headers);
  finalHeaders.set("Accept", "application/json");
  let body: BodyInit | null | undefined = rawBody;
  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    method: method ?? (body === undefined || body === null ? "GET" : "POST"),
    headers: finalHeaders,
    ...(body === undefined ? {} : { body }),
  });

  const text = await response.text();
  const parsed: unknown = text === "" ? undefined : safeJson(text);

  if (!response.ok) throw toApiError(response.status, parsed);
  if (schema === undefined) return parsed as T;

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(0, "서버 응답이 계약과 다릅니다", {
      code: "ContractMismatch",
      details: result.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
      body: parsed,
    });
  }
  return result.data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, json?: unknown, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", json }),
  patch: <T>(path: string, json?: unknown, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", json }),
  put: <T>(path: string, json?: unknown, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PUT", json }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" }),
} as const;
