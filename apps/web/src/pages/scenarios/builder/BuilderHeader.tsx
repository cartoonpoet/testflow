import { useState } from "react";
import type * as React from "react";
import { RecordBadge, type RecordBadgeState } from "@/components";

/**
 * 시안 `.builder-title` 1:1 (Task 10.4).
 *
 * ```
 * padding 18px 20px · 하단 1px 라인 · flex space-between
 * input : font-size 18px / font-weight 800 / border 0 / width 60% (모바일 70%)
 * ```
 *
 * ★ 제목은 **편집 중에만 로컬 상태**다. 확정(blur·Enter)되면 곧바로
 *   `PATCH /api/scenarios/:id` 로 올라가고 서버 상태가 단일 진실로 돌아온다.
 *   Esc 로 되돌릴 수 있다.
 */
export type BuilderHeaderProps = {
  name: string;
  onRename: (name: string) => void;
  recordState: RecordBadgeState;
  disabled?: boolean;
};

export function BuilderHeader({ name, onRename, recordState, disabled = false }: BuilderHeaderProps) {
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const value = editing ? draft : name;

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === "" || next === name) {
      setDraft(name);
      return;
    }
    onRename(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraft(name);
      setEditing(false);
      event.currentTarget.blur();
    }
  };

  return (
    <div
      data-slot="builder-title"
      className="flex items-center justify-between gap-[12px] border-b border-line px-[20px] py-[18px]"
    >
      <input
        aria-label="시나리오 이름"
        data-testid="scenario-name"
        className="w-[60%] max-mobile:w-[70%] border-0 bg-transparent text-[18px] font-extrabold text-ink outline-none"
        value={value}
        disabled={disabled}
        onFocus={() => {
          setDraft(name);
          setEditing(true);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <RecordBadge state={recordState} />
    </div>
  );
}
