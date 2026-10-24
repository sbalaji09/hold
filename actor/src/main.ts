// hold-supplier-verifier: checks a supplier's domain (mode "background"), or compares an
// unfamiliar sender domain against a supplier's known one (mode "copycat"). Plain fetch + regex
// parsing only, no HTML-parsing dependency. Output shape matches lib/types.ts's BackgroundCheck
// ("findings" + optional "suggestedPhone") so convex/app/background.ts can drop the dataset item
// straight into a backgroundChecks row.
import { Actor, log } from "apify";

interface Input {
  mode: "background" | "copycat";
  domain: string;
  businessName?: string;
  knownDomain?: string;
}

interface Finding {
  label: string;
  state: "pass" | "flag" | "info";
  evidence: string;
  sourceUrl?: string;
}

// ---------- pure helpers ----------

function extractPhones(text: string): string[] {
  const re = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
  const found = text.match(re) ?? [];
  return Array.from(new Set(found.map((s) => s.trim())));
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
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
  if (!match) return undefined;
  try {
    return new URL(match[1], baseUrl).toString();
  } catch {
    return undefined;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "hold-supplier-verifier/0.1" } }); // rdap.org 403s without a User-Agent
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function domainAgeDays(domain: string): Promise<number | null> {
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

/** Optional enrichment: a Google Maps listing for the business, via Apify's Google Maps
 * extractor actor, only attempted when the run has an Apify token to call another actor with. */
async function mapsListingFinding(businessName: string, domain: string): Promise<Finding | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;
  try {
    const client = Actor.newClient();
    const run = await client.actor("compass/google-maps-extractor").call(
      { searchStringsArray: [`${businessName} ${domain}`], maxCrawledPlaces: 1 },
      { waitSecs: 45 },
    );
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const place = items[0] as { title?: string; phone?: string; website?: string; address?: string } | undefined;
    if (!place) {
      return { label: "Business registry / Maps listing", state: "info", evidence: "No matching Google Maps listing found." };
    }
    return {
      label: "Business registry / Maps listing",
      state: "pass",
      evidence: `Found "${place.title ?? businessName}"${place.address ? ` at ${place.address}` : ""}${place.phone ? `, phone ${place.phone}` : ""}.`,
      sourceUrl: place.website,
    };
  } catch (err) {
    log.warning(`Google Maps lookup skipped: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------- modes ----------

async function runBackground(domain: string, businessName?: string): Promise<{ findings: Finding[]; suggestedPhone?: string }> {
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
    const contactHtml = contactUrl ? await fetchText(contactUrl) : null;
    const contactPhones = contactHtml ? extractPhones(stripTags(contactHtml)) : [];
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
      const match = similarity(siteName(title), businessName) > 0.5;
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
  findings.push(
    ageDays != null
      ? {
          label: "Domain age",
          state: ageDays < 90 ? "flag" : "pass",
          evidence: ageDays < 90 ? `Registered only ${ageDays} days ago.` : `Registered ${ageDays} days ago.`,
          sourceUrl: `https://rdap.org/domain/${domain}`,
        }
      : { label: "Domain age", state: "info", evidence: "RDAP had no registration record for this domain.", sourceUrl: `https://rdap.org/domain/${domain}` },
  );

  if (businessName) {
    const maps = await mapsListingFinding(businessName, domain);
    if (maps) findings.push(maps);
  }

  return { findings, suggestedPhone };
}

async function runCopycat(domain: string, knownDomain: string): Promise<{ findings: Finding[] }> {
  const findings: Finding[] = [];
  const domainSim = similarity(domain, knownDomain);
  findings.push({
    label: "Domain edit distance",
    state: domainSim > 0.7 ? "flag" : "pass",
    evidence: `"${domain}" is ${(domainSim * 100).toFixed(0)}% similar to the known domain "${knownDomain}" by edit distance.`,
  });
  const ageDays = await domainAgeDays(domain);
  const rdapUrl = `https://rdap.org/domain/${domain}`;
  findings.push(
    ageDays == null
      ? { label: "Sender domain age", state: "info", evidence: `RDAP had no registration record for ${domain}.`, sourceUrl: rdapUrl }
      : {
          label: "Sender domain age",
          state: ageDays < 90 ? "flag" : "pass",
          evidence: ageDays < 90 ? `${domain} was registered only ${ageDays} days ago.` : `${domain} was registered ${ageDays} days ago.`,
          sourceUrl: rdapUrl,
        },
  );

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
    findings.push({ label: "Site comparison", state: "info", evidence: `Couldn't fetch ${!htmlA ? domain : knownDomain} to compare pages.` });
  }

  return { findings };
}

// ---------- entry point ----------

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? ({} as Input);
if (!input.mode || !input.domain) {
  throw new Error('Input needs at least "mode" ("background" or "copycat") and "domain".');
}

const output =
  input.mode === "background"
    ? await runBackground(input.domain, input.businessName)
    : await (async () => {
        if (!input.knownDomain) throw new Error('Copycat mode needs "knownDomain" to compare against.');
        return runCopycat(input.domain, input.knownDomain);
      })();

await Actor.pushData(output);
await Actor.exit();
