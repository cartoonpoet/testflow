import { describe, expect, it } from "vitest";
import { resolveWebSocketUrlForPage } from "./websocket-url";

describe("resolveWebSocketUrlForPage", () => {
  it("uses the LAN page origin while preserving the live path and token", () => {
    expect(
      resolveWebSocketUrlForPage(
        "ws://61.98.69.147/live/run-1?token=secret",
        "http://192.168.45.90:4174/runs/run-1",
      ),
    ).toBe("ws://192.168.45.90:4174/live/run-1?token=secret");
  });

  it("uses the public page origin for an external connection", () => {
    expect(
      resolveWebSocketUrlForPage(
        "ws://61.98.69.147/live/run-1?token=secret",
        "http://61.98.69.147/runs/run-1",
      ),
    ).toBe("ws://61.98.69.147/live/run-1?token=secret");
  });

  it("upgrades to wss when the page uses https", () => {
    expect(
      resolveWebSocketUrlForPage(
        "ws://runner.internal/rec/session-1?token=secret",
        "https://testflow.example.com/scenarios/1",
      ),
    ).toBe("wss://testflow.example.com/rec/session-1?token=secret");
  });
});
