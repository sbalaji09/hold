/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as app_background from "../app/background.js";
import type * as app_callOutcome from "../app/callOutcome.js";
import type * as app_checks from "../app/checks.js";
import type * as app_company from "../app/company.js";
import type * as app_improve from "../app/improve.js";
import type * as app_increase from "../app/increase.js";
import type * as app_intake from "../app/intake.js";
import type * as app_jobs_fraud from "../app/jobs/fraud.js";
import type * as app_jobs_job from "../app/jobs/job.js";
import type * as app_jobs_triage from "../app/jobs/triage.js";
import type * as app_live from "../app/live.js";
import type * as app_mutations from "../app/mutations.js";
import type * as app_onboarding from "../app/onboarding.js";
import type * as app_practice from "../app/practice.js";
import type * as app_pushback from "../app/pushback.js";
import type * as app_queries from "../app/queries.js";
import type * as app_rules from "../app/rules.js";
import type * as app_suppliers from "../app/suppliers.js";
import type * as app_techniques from "../app/techniques.js";
import type * as app_triage from "../app/triage.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as seed from "../seed.js";
import type * as voice_callScreen from "../voice/callScreen.js";
import type * as voice_dev from "../voice/dev.js";
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
  "app/background": typeof app_background;
  "app/callOutcome": typeof app_callOutcome;
  "app/checks": typeof app_checks;
  "app/company": typeof app_company;
  "app/improve": typeof app_improve;
  "app/increase": typeof app_increase;
  "app/intake": typeof app_intake;
  "app/jobs/fraud": typeof app_jobs_fraud;
  "app/jobs/job": typeof app_jobs_job;
  "app/jobs/triage": typeof app_jobs_triage;
  "app/live": typeof app_live;
  "app/mutations": typeof app_mutations;
  "app/onboarding": typeof app_onboarding;
  "app/practice": typeof app_practice;
  "app/pushback": typeof app_pushback;
  "app/queries": typeof app_queries;
  "app/rules": typeof app_rules;
  "app/suppliers": typeof app_suppliers;
  "app/techniques": typeof app_techniques;
  "app/triage": typeof app_triage;
  crons: typeof crons;
  http: typeof http;
  migrations: typeof migrations;
  seed: typeof seed;
  "voice/callScreen": typeof voice_callScreen;
  "voice/dev": typeof voice_dev;
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
