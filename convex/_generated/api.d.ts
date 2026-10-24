/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as app_checks from "../app/checks.js";
import type * as app_increase from "../app/increase.js";
import type * as app_intake from "../app/intake.js";
import type * as app_mutations from "../app/mutations.js";
import type * as app_practice from "../app/practice.js";
import type * as app_pushback from "../app/pushback.js";
import type * as app_queries from "../app/queries.js";
import type * as app_suppliers from "../app/suppliers.js";
import type * as http from "../http.js";
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
  "app/checks": typeof app_checks;
  "app/increase": typeof app_increase;
  "app/intake": typeof app_intake;
  "app/mutations": typeof app_mutations;
  "app/practice": typeof app_practice;
  "app/pushback": typeof app_pushback;
  "app/queries": typeof app_queries;
  "app/suppliers": typeof app_suppliers;
  http: typeof http;
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
