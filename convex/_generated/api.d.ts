/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as seed from "../seed.js";
import type * as voice_records from "../voice/records.js";
import type * as voice_rules from "../voice/rules.js";
import type * as voice_server from "../voice/server.js";
import type * as voice_styleMatch from "../voice/styleMatch.js";
import type * as voice_ui from "../voice/ui.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  seed: typeof seed;
  "voice/records": typeof voice_records;
  "voice/rules": typeof voice_rules;
  "voice/server": typeof voice_server;
  "voice/styleMatch": typeof voice_styleMatch;
  "voice/ui": typeof voice_ui;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
