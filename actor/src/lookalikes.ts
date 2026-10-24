// Look-alike domains a scammer would register to imitate a supplier, and a DNS check for which of
// them exist. Pure generation is tested in lookalikes.test.ts.

const HOMOGLYPHS: Record<string, string[]> = { o: ["0"], l: ["1", "i"], i: ["l", "1"], m: ["rn"], w: ["vv"], e: ["3"], a: ["4"] };
const TLDS = ["com", "net", "org", "co", "io", "us", "biz", "info"];
const ADDONS = ["-billing", "-payments", "-invoices", "-accounts", "-inc", "billing", "pay"];

/** Every look-alike of `domain`, tagged with how it was made. Never includes `domain` itself. */
export function permutations(domain: string): Array<{ domain: string; technique: string }> {
  const lower = domain.toLowerCase().trim();
  const dot = lower.indexOf(".");
  if (dot <= 0) return [];
  const name = lower.slice(0, dot);
  const tld = lower.slice(dot + 1);
  const out = new Map<string, string>();
  const add = (n: string, t: string, technique: string) => {
    const d = `${n}.${t}`;
    if (d !== lower && n.length > 1 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(n) && !out.has(d)) out.set(d, technique);
  };

  for (let i = 0; i < name.length; i++) {
    add(name.slice(0, i) + name.slice(i + 1), tld, "missing letter");
    add(name.slice(0, i) + name[i] + name.slice(i), tld, "doubled letter");
    if (i < name.length - 1) add(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2), tld, "swapped letters");
    if (i > 0) add(name.slice(0, i) + "-" + name.slice(i), tld, "added hyphen");
    for (const g of HOMOGLYPHS[name[i]] ?? []) add(name.slice(0, i) + g + name.slice(i + 1), tld, "look-alike letter");
  }
  if (name.includes("-")) add(name.replaceAll("-", ""), tld, "dropped hyphen");
  if (name.includes("rn")) add(name.replace("rn", "m"), tld, "look-alike letter");
  for (const t of TLDS) add(name, t, "different ending");
  for (const a of ADDONS) add(name + a, tld, "added word");
  return [...out].map(([d, technique]) => ({ domain: d, technique }));
}

/** True if the domain has name servers, i.e. someone registered it. Null if DNS didn't answer. */
export async function isRegistered(domain: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { Status: number; Answer?: unknown[] };
    if (body.Status === 3) return false; // NXDOMAIN
    return body.Status === 0 ? (body.Answer?.length ?? 0) > 0 : null;
  } catch {
    return null;
  }
}

/** Maps `items` through `fn`, at most `limit` at a time, keeping order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}
