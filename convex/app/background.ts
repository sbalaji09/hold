// Apify background / copycat checks (plan-agent.md Hyphenate addendum). A background check
// looks up a supplier's own domain for contact details, a suggested phone number and the
// domain's registration age. A copycat check compares a bill's sender domain against the
// supplier's known domain for the Apify "hold-supplier-verifier" actor's lookalike heuristics.
//
// runBackgroundCheck/runCopycatCheck call the Apify actor over its REST API when APIFY_TOKEN is
// set (actor id from APIFY_ACTOR_ID, default "hold-supplier-verifier"); with no token they fall
// back to the same RDAP + fetch heuristics run locally, right here, so the feature still works
// with nothing configured. Either way a "Check method" finding on the row says which path ran.
//
// The suggested phone number is only ever shown to a human (BackgroundCheckPanel); it never
// writes suppliers.trustedPhone itself — only "Use as trusted number", a locked action a human
// confirms, does that (see lib/policy.ts's "Nobody but a person moves trust" rule).
import { v } from "convex/values";
import { api } from "../_generated/api.js";
import { action, mutation, query } from "../_generated/server.js";
import type { BackgroundCheck } from "../../lib/types.js";

export type Finding = { label: string; state: "pass" | "flag" | "info"; evidence: string; sourceUrl?: string };

// ---------- pure helpers (tested directly in background.test.ts) ----------

/** US-style phone numbers found in free text, deduped, as written. */
export function extractPhones(text: string): string[] {
  const re = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
  const found = text.match(re) ?? [];
  return Array.from(new Set(found.map((s) => s.trim())));
}

/** Classic Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      // Indexes stay within the (m+1) x (n+1) table built above.
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j - 1]!, dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

/** 1 = identical, 0 = nothing in common, by edit distance normalised to the longer string. */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x && !y) return 1;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen === 0) return 1;
  return 1 - editDistance(x, y) / maxLen;
}

function siteName(title: string): string {
  return title.split(/[|\-–·:]/)[0]?.trim() ?? title.trim();
}

function extractTitle(html: string): string {
  return (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findContactUrl(html: string, baseUrl: string): string | undefined {
  const match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*contact[^<]*<\/a>/i);
  if (!match?.[1]) return undefined;
  try {
    return new URL(match[1], baseUrl).toString();
  } catch {
    return undefined;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Days since the domain's RDAP registration event, or null if rdap.org has nothing on it. */
export async function domainAgeDays(domain: string): Promise<number | null> {
  const body = await fetchText(`https://rdap.org/domain/${domain}`);
  if (!body) return null;
  try {
    const data = JSON.parse(body);
    const registered = (data.events ?? []).find((e: { eventAction?: string }) => e.eventAction === "registration")?.eventDate;
    if (!registered) return null;
    const days = Math.floor((Date.now() - new Date(registered).getTime()) / 86_400_000);
    return days >= 0 ? days : null;
  } catch {
    return null;
  }
}

// ---------- local heuristics (no APIFY_TOKEN) ----------

export async function backgroundLocal(domain: string, businessName?: string): Promise<{ findings: Finding[]; suggestedPhone?: string }> {
  const findings: Finding[] = [];
  let suggestedPhone: string | undefined;

  const homepageUrl = `https://${domain}`;
  const html = await fetchText(homepageUrl);
  if (html) {
    const title = extractTitle(html);
    findings.push({
      label: "Site reachable",
      state: "pass",
      evidence: title ? `${domain} resolves; page titled "${title}".` : `${domain} resolves.`,
      sourceUrl: homepageUrl,
    });
    const homePhones = extractPhones(stripTags(html));
    const contactUrl = findContactUrl(html, homepageUrl);
    let contactPhones: string[] = [];
    if (contactUrl) {
      const contactHtml = await fetchText(contactUrl);
      if (contactHtml) contactPhones = extractPhones(stripTags(contactHtml));
    }
    const phones = Array.from(new Set([...contactPhones, ...homePhones]));
    if (phones.length > 0) {
      suggestedPhone = phones[0];
      findings.push({
        label: "Phone number found",
        state: "info",
        evidence: `Found ${phones.join(", ")} on ${contactUrl ? "the contact page" : "the homepage"}.`,
        sourceUrl: contactUrl ?? homepageUrl,
      });
    } else {
      findings.push({ label: "Phone number found", state: "flag", evidence: "No phone number found on the site.", sourceUrl: homepageUrl });
    }
    if (businessName) {
      const name = siteName(title);
      const match = similarity(name, businessName) > 0.5;
      findings.push({
        label: "Business name matches",
        state: match ? "pass" : "info",
        evidence: `Page title reads "${title || "(no title)"}" against the name on file "${businessName}".`,
        sourceUrl: homepageUrl,
      });
    }
  } else {
    findings.push({ label: "Site reachable", state: "flag", evidence: `${domain} didn't respond to a fetch.`, sourceUrl: homepageUrl });
  }

  const ageDays = await domainAgeDays(domain);
  if (ageDays != null) {
    findings.push({
      label: "Domain age",
      state: ageDays < 90 ? "flag" : "pass",
      evidence: ageDays < 90 ? `Registered only ${ageDays} days ago.` : `Registered ${ageDays} days ago.`,
      sourceUrl: `https://rdap.org/domain/${domain}`,
    });
  } else {
    findings.push({ label: "Domain age", state: "info", evidence: "RDAP had no registration record for this domain.", sourceUrl: `https://rdap.org/domain/${domain}` });
  }

  return { findings, suggestedPhone };
}

export async function copycatLocal(domain: string, knownDomain: string): Promise<{ findings: Finding[] }> {
  const findings: Finding[] = [];
  const domainSim = similarity(domain, knownDomain);
  findings.push({
    label: "Domain edit distance",
    state: domainSim > 0.7 ? "flag" : "pass",
    evidence: `"${domain}" is ${(domainSim * 100).toFixed(0)}% similar to the known domain "${knownDomain}" by edit distance.`,
  });

  const [htmlA, htmlB] = await Promise.all([fetchText(`https://${domain}`), fetchText(`https://${knownDomain}`)]);
  if (htmlA && htmlB) {
    const titleA = extractTitle(htmlA);
    const titleB = extractTitle(htmlB);
    const nameSim = similarity(siteName(titleA), siteName(titleB));
    findings.push({
      label: "Site name matches",
      state: nameSim > 0.8 && domainSim < 1 ? "flag" : "pass",
      evidence: `"${titleA || domain}" vs. "${titleB || knownDomain}" (${(nameSim * 100).toFixed(0)}% similar).`,
      sourceUrl: `https://${domain}`,
    });
    const textSim = similarity(stripTags(htmlA).slice(0, 2000), stripTags(htmlB).slice(0, 2000));
    findings.push({
      label: "Page text matches",
      state: textSim > 0.8 ? "flag" : "pass",
      evidence: `Homepage text is ${(textSim * 100).toFixed(0)}% similar.`,
      sourceUrl: `https://${domain}`,
    });
  } else {
    findings.push({
      label: "Site comparison",
      state: "info",
      evidence: `Couldn't fetch ${!htmlA ? domain : knownDomain} to compare pages.`,
    });
  }

  return { findings };
}

// ---------- Apify actor (REST) ----------

const APIFY_BASE = "https://api.apify.com/v2";

async function runApifyActor(
  mode: "background" | "copycat",
  input: { domain: string; businessName?: string; knownDomain?: string },
  token: string,
): Promise<{ findings: Finding[]; suggestedPhone?: string }> {
  const actorId = process.env.APIFY_ACTOR_ID ?? "hold-supplier-verifier";
  const res = await fetch(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, ...input }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Apify run failed (${res.status}): ${await res.text()}`);
  const items = (await res.json()) as Array<{ findings?: Finding[]; suggestedPhone?: string }>;
  const item = items[0];
  if (!item) throw new Error("Apify run returned no dataset items.");
  return { findings: item.findings ?? [], suggestedPhone: item.suggestedPhone };
}

// ---------- mutations (write the row + activity) ----------

export const recordCheck = mutation({
  args: {
    kind: v.union(v.literal("background"), v.literal("copycat")),
    supplierKey: v.optional(v.string()),
    billKey: v.optional(v.string()),
    domain: v.string(),
    findings: v.array(
      v.object({
        label: v.string(),
        state: v.union(v.literal("pass"), v.literal("flag"), v.literal("info")),
        evidence: v.string(),
        sourceUrl: v.optional(v.string()),
      }),
    ),
    suggestedPhone: v.optional(v.string()),
  },
  handler: async (ctx, { kind, supplierKey, billKey, domain, findings, suggestedPhone }) => {
    const key = `bgc_${crypto.randomUUID()}`;
    const ranAt = new Date().toISOString();
    await ctx.db.insert("backgroundChecks", { key, kind, supplierKey, billKey, domain, ranAt, findings, suggestedPhone });
    const flagCount = findings.filter((f) => f.state === "flag").length;
    await ctx.db.insert("activity", {
      key: `act_${key}`,
      actor: "callback",
      what: kind === "background" ? `ran a background check on ${domain}.` : `ran a copycat check on ${domain}.`,
      why: flagCount > 0 ? `${flagCount} finding${flagCount === 1 ? "" : "s"} flagged.` : "Nothing flagged.",
      refKind: supplierKey ? "supplier" : "bill",
      refKey: supplierKey ?? billKey ?? domain,
      at: ranAt,
    });
    return { key };
  },
});

// ---------- actions (entry points the UI calls) ----------

export const runBackgroundCheck = action({
  args: { supplierKey: v.string() },
  handler: async (ctx, { supplierKey }): Promise<{ key: string; via: string; findings: Finding[]; suggestedPhone?: string }> => {
    const supplier = await ctx.runQuery(api.app.queries.getSupplier, { key: supplierKey });
    if (!supplier) throw new Error(`Unknown supplier ${supplierKey}`);
    const token = process.env.APIFY_TOKEN;
    let result: { findings: Finding[]; suggestedPhone?: string };
    let via: string;
    if (token) {
      try {
        result = await runApifyActor("background", { domain: supplier.domain, businessName: supplier.name }, token);
        via = "the Apify actor";
      } catch (err) {
        result = await backgroundLocal(supplier.domain, supplier.name);
        via = `local heuristics (Apify run failed: ${err instanceof Error ? err.message : String(err)})`;
      }
    } else {
      result = await backgroundLocal(supplier.domain, supplier.name);
      via = "local heuristics (APIFY_TOKEN isn't set)";
    }
    const findings = [...result.findings, { label: "Check method", state: "info" as const, evidence: `Ran via ${via}.` }];
    const { key } = await ctx.runMutation(api.app.background.recordCheck, {
      kind: "background",
      supplierKey,
      domain: supplier.domain,
      findings,
      suggestedPhone: result.suggestedPhone,
    });
    return { key, via, findings, suggestedPhone: result.suggestedPhone };
  },
});

export const runCopycatCheck = action({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }): Promise<{ key: string; via: string; findings: Finding[] }> => {
    const bill = await ctx.runQuery(api.app.queries.getBill, { key: billKey });
    if (!bill) throw new Error(`Unknown bill ${billKey}`);
    const domain = bill.email.fromDomain;
    const knownDomain = bill.supplier.domain;
    const token = process.env.APIFY_TOKEN;
    let result: { findings: Finding[] };
    let via: string;
    if (token) {
      try {
        result = await runApifyActor("copycat", { domain, knownDomain }, token);
        via = "the Apify actor";
      } catch (err) {
        result = await copycatLocal(domain, knownDomain);
        via = `local heuristics (Apify run failed: ${err instanceof Error ? err.message : String(err)})`;
      }
    } else {
      result = await copycatLocal(domain, knownDomain);
      via = "local heuristics (APIFY_TOKEN isn't set)";
    }
    const findings = [...result.findings, { label: "Check method", state: "info" as const, evidence: `Ran via ${via}.` }];
    const { key } = await ctx.runMutation(api.app.background.recordCheck, {
      kind: "copycat",
      billKey,
      domain,
      findings,
    });
    return { key, via, findings };
  },
});

// ---------- queries (UI history) ----------

export const listChecksForSupplier = query({
  args: { supplierKey: v.string() },
  handler: async (ctx, { supplierKey }): Promise<BackgroundCheck[]> => {
    const rows = await ctx.db
      .query("backgroundChecks")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplierKey))
      .collect();
    return rows.sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1));
  },
});

export const listChecksForBill = query({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }): Promise<BackgroundCheck[]> => {
    const rows = await ctx.db
      .query("backgroundChecks")
      .withIndex("by_bill", (q) => q.eq("billKey", billKey))
      .collect();
    return rows.sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1));
  },
});
