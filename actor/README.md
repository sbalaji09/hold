# hold-supplier-verifier

Apify actor backing hold's supplier background checks and copycat-domain checks
(see `convex/app/background.ts`).

## Input

```json
{
  "mode": "background",
  "domain": "stagecraftrigging.com",
  "businessName": "Stagecraft Rigging Co."
}
```

or

```json
{
  "mode": "copycat",
  "domain": "stagecraft-rigging.com",
  "knownDomain": "stagecraftrigging.com"
}
```

| field | required | used by |
|---|---|---|
| `mode` | yes | both — `"background"` or `"copycat"` |
| `domain` | yes | both — the domain to check, or the unfamiliar sender domain in copycat mode |
| `businessName` | no | background — compared against the site's `<title>`; also used to look up a Google Maps listing if `APIFY_TOKEN` is set |
| `knownDomain` | copycat only | compared against `domain` (edit distance, title and homepage text similarity) |

## Output (one dataset item)

```ts
{
  findings: Array<{ label: string; state: "pass" | "flag" | "info"; evidence: string; sourceUrl?: string }>;
  suggestedPhone?: string; // background mode only, a number found on the site — never auto-trusted
}
```

This matches `BackgroundCheck["findings"]`/`suggestedPhone"` in `lib/types.ts`, so the caller can
drop the item straight into a `backgroundChecks` row.

## What it checks

- **background**: fetches the homepage, follows a "contact" link if found, pulls phone numbers
  by regex, looks up the domain's registration age via RDAP (`https://rdap.org/domain/<domain>`),
  and — only if the run has `APIFY_TOKEN` set — calls Apify's `compass/google-maps-extractor`
  actor to look for a matching business listing.
- **copycat**: fetches both `domain` and `knownDomain`'s homepages and flags a likely lookalike
  when the domain's edit-distance similarity, page title or homepage text are suspiciously close
  while the domains themselves differ.

- **watch**: `{ "mode": "watch", "domains": ["stagecraftrigging.com", ...] }`. Generates about 80
  look-alikes per domain (`src/lookalikes.ts`: missing, doubled and swapped letters, hyphens,
  look-alike letters like `l`→`1`, other endings, added words like `-billing`), keeps the ones with
  name servers (Cloudflare DNS-over-HTTPS) and looks up each one's age. One dataset item per hit:
  `{ domain, imitates, technique, registeredDaysAgo, rdapUrl }`. hold runs it nightly
  (`convex/app/watch.ts`); 25 domains take a few seconds.

No HTML-parsing dependency: plain `fetch` plus regexes (see `src/main.ts`).

## Running it

Locally, without Docker:

```sh
cd actor
npm install
APIFY_TOKEN=... npm start   # reads input from .actor/input.json via apify-cli, or set INPUT below
```

Or with the Apify CLI (`npm i -g apify-cli`):

```sh
cd actor
apify run                   # runs locally, input from storage/key_value_stores/default/INPUT.json
```

## Deploying

```sh
cd actor
apify login                 # once, with your Apify account token
apify push                  # builds the Dockerfile and pushes a new actor version
```

After the first push, note the actor's id (or rename it to `hold-supplier-verifier`) and set
`APIFY_ACTOR_ID` (if different from the default) and `APIFY_TOKEN` in hold's Convex deployment so
`convex/app/background.ts` calls it instead of running its local RDAP + fetch fallback.
