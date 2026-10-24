# Supplier Verifier: look-alike domains and payee checks

Stop paying scammers who pretend to be your suppliers.

The most expensive email scam in business is simple: someone registers `acme-billing.com`, emails your
finance team as Acme, and says "we changed banks, pay us here now." This actor gives you three checks
against it:

- **Watch**: give it your suppliers' real domains. It generates about 80 look-alikes of each one
  (typos, swapped letters, hyphens, `l`→`1`, `.co` instead of `.com`, added words like `-billing`) and
  returns every one that someone has registered: how old it is, and whether it's set up to send email.
  Run it on a schedule and you know about `acme-billing.com` before the first email from it arrives.
- **Copycat**: an email came from a domain that isn't the supplier's. Compare the two: how close the
  names are, how new the sender's domain is, and whether its website copies the real one's title or text.
- **Background**: vet a new supplier before you pay them. Does the site load, what phone number does its
  contact page list (to call back on, never the one in the email), how old is the domain, does its name
  match, does it publish SPF and DMARC, and (optionally) is there a Google Maps listing.

Built for hold, an accounts-payable agent that calls suppliers back before it
pays a changed bank account. It runs Watch nightly and Copycat on every suspicious bill.

## Input

```json
{ "mode": "watch", "domains": ["stagecraftrigging.com", "soundwaveaudio.com"] }
```

```json
{ "mode": "copycat", "domain": "stagecraft-rigging.com", "knownDomain": "stagecraftrigging.com" }
```

```json
{ "mode": "background", "domain": "stagecraftrigging.com", "businessName": "Stagecraft Rigging Co." }
```

| Field | Mode | What it is |
|---|---|---|
| `mode` | all | `watch`, `copycat` or `background` |
| `domains` | watch | Your suppliers' real domains |
| `domain` | copycat, background | The sender's domain (copycat) or the supplier's domain (background). No `https://`. |
| `knownDomain` | copycat | The supplier's real domain to compare against |
| `businessName` | background | The supplier's name on file. Compared with the site's title, and used for the Maps lookup. |

## Output

**Watch** returns one item per registered look-alike (the "Look-alike domains" view):

```json
{
  "domain": "soundwave-audio.com",
  "imitates": "soundwaveaudio.com",
  "technique": "added hyphen",
  "registeredDaysAgo": 719,
  "receivesEmail": true,
  "rdapUrl": "https://rdap.org/domain/soundwave-audio.com"
}
```

A look-alike that's days old and set up for email is the one to block.

**Copycat** and **Background** return one item with a list of findings, each `pass`, `flag` or `info`
with the evidence behind it:

```json
{
  "findings": [
    { "label": "Domain edit distance", "state": "flag", "evidence": "\"stagecraft-rigging.com\" is 95% similar to the known domain \"stagecraftrigging.com\" by edit distance." },
    { "label": "Sender domain age", "state": "flag", "evidence": "stagecraft-rigging.com was registered only 4 days ago.", "sourceUrl": "https://rdap.org/domain/stagecraft-rigging.com" }
  ],
  "suggestedPhone": "(415) 555-0100"
}
```

`suggestedPhone` (background only) is a number found on the supplier's own site. Have a person confirm it
before you trust it.

## How it works and what it costs

Plain HTTP only, no browser: DNS lookups through Cloudflare's DNS-over-HTTPS, registration dates from
RDAP, and the site's own pages. A watch over 25 domains (about 1,900 look-alikes) finishes in seconds on
the smallest memory setting, so it costs a fraction of a cent. The Google Maps lookup in background mode
calls `compass/google-maps-extractor`, which bills per place; it only runs when you give a `businessName`.

## Limits

- Watch only finds look-alikes it can think of. A scammer using an unrelated domain is caught by
  Copycat or by calling the supplier back, not by Watch.
- Some country-code domains (`.co`, `.us`) don't publish RDAP dates, so their age comes back `null`.
- Phone extraction reads US-style numbers.

## Running it yourself

```sh
npm install
apify run -p   # input from storage/key_value_stores/default/INPUT.json
apify push     # deploy to your Apify account
```
