import { expect, test } from "vitest";
import { isValidDomain } from "./suppliers.js";

test("isValidDomain accepts plain hostnames", () => {
  expect(isValidDomain("stagecraftrigging.com")).toBe(true);
  expect(isValidDomain("sub.example.co.uk")).toBe(true);
  expect(isValidDomain("  Example.COM  ")).toBe(true);
});

test("isValidDomain rejects URLs, paths, ports and userinfo", () => {
  expect(isValidDomain("https://example.com")).toBe(false);
  expect(isValidDomain("example.com/path")).toBe(false);
  expect(isValidDomain("example.com:8080")).toBe(false);
  expect(isValidDomain("user@example.com")).toBe(false);
  expect(isValidDomain("example")).toBe(false);
});

test("isValidDomain rejects localhost and IP literals", () => {
  expect(isValidDomain("localhost")).toBe(false);
  expect(isValidDomain("foo.localhost")).toBe(false);
  expect(isValidDomain("127.0.0.1")).toBe(false);
  expect(isValidDomain("::1")).toBe(false);
});
