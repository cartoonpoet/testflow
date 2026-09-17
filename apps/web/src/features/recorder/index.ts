/**
 * 녹화 클라이언트 barrel.
 *
 * `features/` 는 화면 조각(`components/`)도 페이지(`pages/`)도 아닌
 * **여러 화면이 쓸 수 있는 기능 묶음**이다. 지금 쓰는 곳은 빌더 하나지만,
 * 녹화는 스트리밍·입력역주입·IME 로 파일이 6개라 페이지 폴더에 섞으면 읽기 어렵다.
 */
export * from "./frame";
export * from "./StreamCanvas";
export * from "./useFrameRenderer";
export * from "./useImeBridge";
export * from "./useInputBridge";
export * from "./useRecorderSocket";
