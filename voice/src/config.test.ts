import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_PHONE_NUMBER: "+14155550123",
  CARTESIA_API_KEY: "key",
  CARTESIA_VOICE_ID: "voice",
  ANTHROPIC_API_KEY: "key",
  MOSS_PROJECT_ID: "id",
  MOSS_PROJECT_KEY: "key",
  CONVEX_URL: "https://example-123.convex.cloud",
  VOICE_SERVER_SECRET: "0123456789abcdef",
  PUBLIC_BASE_URL: "https://example.ngrok-free.app",
};

describe("loadConfig", () => {
  it("strips trailing slashes from CONVEX_URL, which otherwise break every Convex request", () => {
    expect(loadConfig({ ...env, CONVEX_URL: "https://example-123.convex.cloud/" }).CONVEX_URL).toBe(
      "https://example-123.convex.cloud",
    );
  });

  it("names each missing variable", () => {
    const { CONVEX_URL: _omit, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow(/CONVEX_URL: missing/);
  });
});
