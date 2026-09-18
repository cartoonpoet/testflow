import { Fragment } from "react";
import type * as React from "react";

/**
 * 원본 md 문장의 **인라인 서식만** 해석해 그린다.
 *
 * 규칙은 3개뿐이다 — `` `코드` `` · `**굵게**` · `*기울임*`.
 * 원본 `docs/AI로-테스트코드-만들기.md` 본문에 실제로 쓰인 인라인 문법이 이 3개가 전부다
 * (`content.spec.ts` 가 md 를 훑어 다른 문법이 새로 들어오면 알려준다).
 *
 * ★ 마크다운 라이브러리를 넣지 않는 이유는 `content.ts` 머리말 참고 — 초기 로드 번들.
 *   여기서도 링크·이미지·리스트 같은 블록 문법은 **일부러** 다루지 않는다.
 *   블록 구조는 `GuidePage` 의 TSX 가 그린다.
 */

/** 교대 순서가 곧 우선순위다. `**` 를 `*` 보다 먼저 시도해야 굵게가 기울임으로 쪼개지지 않는다. */
const INLINE_PATTERN = /`([^`]+)`|\*\*([\s\S]+?)\*\*|\*([^*\n]+?)\*/g;

export type InlineMdProps = {
  /** 원본 md 문장 그대로. */
  text: string;
};

export function InlineMd({ text }: InlineMdProps) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index;
    if (start > last) nodes.push(<Fragment key={key++}>{text.slice(last, start)}</Fragment>);

    const [, code, bold, em] = match;
    if (code !== undefined) {
      nodes.push(<InlineCode key={key++}>{code}</InlineCode>);
    } else if (bold !== undefined) {
      nodes.push(<strong key={key++}>{bold}</strong>);
    } else {
      nodes.push(<em key={key++}>{em}</em>);
    }
    last = start + match[0].length;
  }

  // 마지막 조각은 형제 중 유일하므로 고정 key 로 충분하다(숫자 key 와 겹치지 않는다).
  if (last < text.length) nodes.push(<Fragment key="tail">{text.slice(last)}</Fragment>);
  return <>{nodes}</>;
}

/**
 * 문장 안의 `` `코드` ``.
 *
 * 색은 구문 강조 팔레트의 `--color-code-punct`(=`--tag-ink` 와 같은 값)를 쓰지 않고
 * 본문 잉크를 그대로 둔다 — 인라인 코드는 "강조"가 아니라 "글자 종류" 표시라
 * 배경(`--tag`)만으로 충분하고, 색까지 바꾸면 문장이 알록달록해진다.
 */
function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded-tag bg-tag px-[5px] py-[1px] font-mono text-[0.92em] text-ink">
      {children}
    </code>
  );
}
