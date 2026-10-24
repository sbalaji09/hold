(function () {
  var React = window.React, h = React.createElement, C = window.Callback;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }
  function money(c) { return "$" + Math.floor(c / 100).toLocaleString("en-US") + "." + String(c % 100).padStart(2, "0"); }
  function txid() { var s = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", o = "tr_"; for (var i = 0; i < 6; i++) o += s[Math.floor(Math.random() * s.length)]; return o; }
  var clockMin = 10 * 60 + 58;
  function now() { clockMin += 1; var hh = Math.floor(clockMin / 60), mm = clockMin % 60; return (hh > 12 ? hh - 12 : hh) + ":" + String(mm).padStart(2, "0") + (hh >= 12 ? " PM" : " AM"); }
  function hhmm(t) { return t.replace(/ (AM|PM)$/, ""); }

  /* ───────────── Fogline's workspace (example data) ───────────── */
  var SUPPLIERS = {
    stagecraft: { name: "Stagecraft Rigging Co.", short: "Stagecraft", kind: "Stage and truss", contact: "Rosa Quintero", phone: "(415) 555-0142", phoneSrc: "on file since Apr 2", bank: "Chase", routing: "021000021", last4: "2210", verified: "Verified by call · Mar 4", domain: "stagecraftrigging.com", since: 2014, paid: 11, checked: "Oct 21" },
    bayline: { name: "Bayline Sound Rental", short: "Bayline", kind: "Audio rental", contact: "Marcus Lee", phone: "(510) 555-0199", phoneSrc: "on file since Jan 9", bank: "Wells Fargo", routing: "121000248", last4: "6631", verified: "Verified by call · Jan 9", domain: "baylinesound.com", since: 2009, paid: 7, checked: "Oct 21" },
    northpaw: { name: "Northpaw Talent", short: "Northpaw", kind: "Artist agency", contact: "Jules Arroyo", phone: "(323) 555-0177", phoneSrc: "on file since Feb 14", bank: "City National", routing: "122016066", last4: "4410", verified: "Verified by call · Feb 14", domain: "northpaw.co", since: 2016, paid: 4, checked: "Oct 14" },
    fogice: { name: "Fog City Ice Co.", short: "Fog City Ice", kind: "Ice and cold storage", contact: "Dana Kim", phone: "(415) 555-0123", phoneSrc: "on file since Jun 3", bank: "Bank of America", routing: "026009593", last4: "9077", verified: "Verified by call · Jun 3", domain: "fogcityice.com", since: 1998, paid: 9, checked: "Oct 2" },
    tacos: { name: "Mission Street Tacos", short: "Mission St Tacos", kind: "Crew catering", contact: "Luis Ortega", phone: "(415) 555-0168", phoneSrc: "on file since May 20", bank: "First Republic", routing: "321081669", last4: "1185", verified: "Verified by call · May 20", domain: "missionsttacos.com", since: 2012, paid: 6, checked: "Sep 30" },
    ironside: { name: "Ironside Event Security", short: "Ironside", kind: "Security", contact: "Pat Brennan", phone: "(415) 555-0131", phoneSrc: "on file since Apr 11", bank: "Chase", routing: "021000021", last4: "7302", verified: "Verified by call · Apr 11", domain: "ironsidesecurity.com", since: 2005, paid: 6, checked: "Oct 7" },
    golden: { name: "Golden Hour Lighting", short: "Golden Hour", kind: "Lighting rig", contact: "Sam Ito", phone: "(408) 555-0150", phoneSrc: "on file since Mar 1", bank: "SVB", routing: "121140399", last4: "5521", verified: "Verified by call · Mar 1", domain: "goldenhourlx.com", since: 2011, paid: 8, checked: "Oct 9" },
    presidio: { name: "Presidio Portables", short: "Presidio", kind: "Restrooms", contact: "Anne Fox", phone: "(415) 555-0186", phoneSrc: "on file since May 2", bank: "US Bank", routing: "091000022", last4: "3048", verified: "Verified by call · May 2", domain: "presidioportables.com", since: 2003, paid: 5, checked: "Oct 1" },
    coastline: { name: "Coastline Generators", short: "Coastline", kind: "Power", contact: "Rick Navarro", phone: "(650) 555-0109", phoneSrc: "on file since Apr 18", bank: "Chase", routing: "021000021", last4: "8840", verified: "Verified by call · Apr 18", domain: "coastlinepower.com", since: 2008, paid: 6, checked: "Oct 4" },
    fencing: { name: "Bay Bridge Fencing", short: "Bay Bridge", kind: "Perimeter fencing", contact: "Tom Reyes", phone: "(510) 555-0112", phoneSrc: "on file since Jun 22", bank: "Wells Fargo", routing: "121000248", last4: "2297", verified: "Verified by call · Jun 22", domain: "baybridgefence.com", since: 2010, paid: 3, checked: "Sep 28" }
  };
  var ORDER = ["stagecraft", "bayline", "northpaw", "fogice", "tacos", "ironside", "golden", "presidio", "coastline", "fencing"];

  var STAGECRAFT_CALL = [
    { speaker: "callback", time: "00:04", text: "Hi Rosa, this is the accounts desk at Fogline. I'm calling about an email we got this morning from your accounts address." },
    { speaker: "supplier", time: "00:12", text: "Sure, go ahead." },
    { speaker: "callback", time: "00:21", cite: "INV-4471", text: "Before I update anything: your September invoice for the main-stage truss. What was the invoice number?" },
    { speaker: "supplier", time: "00:34", text: "Forty-four seventy-one. Why, is something wrong?", aside: "Answer matches INV-4471." },
    { speaker: "callback", time: "00:39", text: "We got an email today saying you moved banks to Mercury, account ending 8817." },
    { speaker: "supplier", time: "00:44", text: "We never changed our bank. Who sent that?" },
    { speaker: "callback", time: "00:51", cite: "Chase ··2210", text: "Understood. We'll keep paying Chase ending 2210 and hold this one. Thanks, Rosa." }
  ];
  var BAYLINE_CALL = [
    { speaker: "callback", time: "00:03", text: "Hi Marcus, Fogline accounts desk. Quick check on invoice BSR-2291 before we pay it." },
    { speaker: "supplier", time: "00:10", text: "Hey. Sure." },
    { speaker: "callback", time: "00:16", cite: "BSR-2187", text: "It's about 31% higher than your August invoice. What changed?" },
    { speaker: "supplier", time: "00:26", text: "Dev asked for two extra subs and a delay tower for the second stage. It's on the rider.", aside: "Matches the rider change Dev sent on Oct 14." },
    { speaker: "callback", time: "00:37", cite: "Wells Fargo ··6631", text: "Got it. And payment still goes to Wells Fargo ending 6631?" },
    { speaker: "supplier", time: "00:42", text: "Yep, same account." },
    { speaker: "callback", time: "00:46", text: "Thanks. It goes out in Friday's run." }
  ];

  function stagecraftChecks() {
    return [
      { result: "fail", title: "Bank account never used before", evidence: "Fogline has paid Stagecraft 11 times since April, always to Chase ··2210. This bill asks for Mercury ··8817.", sources: ["11 payments", "INV-4471 · Sep 12"] },
      { result: "fail", title: "Doesn’t write like Stagecraft", evidence: "Their last 14 emails were signed “— Rosa”.", quote: "Kind regards, Accounts Team", flag: "Accounts Team", sources: ["14 emails · Apr–Oct"] },
      { result: "warn", title: "Rush language", quote: "This needs to go out today or the build slips.", flag: "go out today" },
      { result: "pass", title: "Sent from the real domain", evidence: "stagecraftrigging.com · registered 2014" },
      { result: "pass", title: "Not on the shared blocklist", evidence: "Mercury ··8817 hasn’t been reported" },
      { result: "pass", title: "Amount looks normal", evidence: "Within 6% of their September bill" }
    ];
  }
  function cleanChecks(s, note) {
    return [
      { result: "pass", title: "Known bank account", evidence: s.bank + " ··" + s.last4 + " · paid " + s.paid + " times" },
      { result: "pass", title: "Sent from the real domain", evidence: s.domain + " · registered " + s.since },
      { result: "pass", title: "Writes like " + s.short, evidence: "Matches their recent emails" },
      { result: note ? "warn" : "pass", title: note ? "Amount higher than usual" : "Amount looks normal", evidence: note || "In line with past bills" }
    ];
  }

  function seedBills() {
    return [
      { id: "b4502", sup: "stagecraft", inv: "INV-4502", subject: "Updated remittance details", preview: "Please use our new account", cents: 1840000, status: "held", time: "10:43", unread: true, from: "accounts@stagecraftrigging.com", received: "Oct 21, 9:58 AM",
        body: ["Hi Fogline team,", "Please note we have moved banks. Use the details below for INV-4502 (main stage truss, final). This needs to go out today or the build slips.", "Kind regards, Accounts Team"],
        payTo: { bank: "Mercury", routing: "084106768", last4: "8817", state: "new" }, checks: stagecraftChecks(),
        call: { state: "not-confirmed", elapsed: "00:58", note: "“We never changed our bank.”", lines: STAGECRAFT_CALL, at: "10:41 AM" },
        approval: { kind: "bank", reason: "Held after a failed call", state: "open" } },
      { id: "b2291", sup: "bayline", inv: "BSR-2291", subject: "Invoice BSR-2291", preview: "Line array + subs, Oct 30–Nov 1", cents: 965000, status: "calling", time: "10:12", unread: true, from: "billing@baylinesound.com", received: "Oct 21, 10:02 AM",
        body: ["Hi Maya,", "Attached is BSR-2291 for the line array, subs and delay tower, Oct 30 – Nov 1. Same account as always.", "Thanks,", "Marcus"],
        payTo: { bank: "Wells Fargo", routing: "121000248", last4: "6631", state: "verified", note: "Verified by call · Jan 9" }, checks: cleanChecks(SUPPLIERS.bayline, "31% above their August bill (BSR-2187)"),
        call: { state: "connected", elapsed: "00:00", lines: BAYLINE_CALL, live: true, at: "10:12 AM" } },
      { id: "b0611", sup: "northpaw", inv: "NP-0611", subject: "Deposit — Sunday headliner", preview: "50% on signing", cents: 2500000, status: "needs-you", time: "09:30", unread: true, from: "jules@northpaw.co", received: "Oct 21, 9:30 AM",
        body: ["Hi Fogline,", "Per the signed offer, here's the 50% deposit invoice for Sunday's headliner. Wire details unchanged.", "Best,", "Jules"],
        payTo: { bank: "City National", routing: "122016066", last4: "4410", state: "verified", note: "Verified by call · Feb 14" }, checks: cleanChecks(SUPPLIERS.northpaw),
        approval: { kind: "limit", reason: "Over $10,000", state: "open" } },
      { id: "b0093", sup: "fogice", inv: "0093", subject: "Invoice 0093", preview: "40 bags, daily", cents: 64000, status: "checking", time: "09:02", unread: false, from: "dana@fogcityice.com", received: "Oct 21, 9:02 AM",
        body: ["Invoice 0093 attached: 40 bags daily, Oct 30 – Nov 1.", "Dana"], payTo: { bank: "Bank of America", routing: "026009593", last4: "9077", state: "verified", note: "Verified by call · Jun 3" }, checks: cleanChecks(SUPPLIERS.fogice) },
      { id: "b0318", sup: "tacos", inv: "#318", subject: "Invoice #318", preview: "Crew catering, week 1", cents: 186000, status: "scheduled", time: "Tue", from: "luis@missionsttacos.com", received: "Oct 20, 4:12 PM",
        body: ["Crew catering for build week 1. Thanks!", "Luis"], payTo: { bank: "First Republic", routing: "321081669", last4: "1185", state: "verified", note: "Verified by call · May 20" }, checks: cleanChecks(SUPPLIERS.tacos) },
      { id: "b1010", sup: "ironside", inv: "IES-1010", subject: "October retainer", cents: 425000, status: "paid", time: "Mon", tx: "tr_8fK2xQ", from: "ar@ironsidesecurity.com", received: "Oct 19, 8:00 AM",
        body: ["October retainer, 12 guards on site from Oct 28."], payTo: { bank: "Chase", routing: "021000021", last4: "7302", state: "verified", note: "Verified by call · Apr 11" }, checks: cleanChecks(SUPPLIERS.ironside) },
      { id: "b0772", sup: "golden", inv: "GH-772", subject: "Lighting rig, deposit 2 of 2", cents: 730000, status: "paid", time: "Mon", tx: "tr_Wq7nPa", from: "sam@goldenhourlx.com", received: "Oct 19, 7:40 AM",
        body: ["Second deposit for the main and second stage rigs."], payTo: { bank: "SVB", routing: "121140399", last4: "5521", state: "verified", note: "Verified by call · Mar 1" }, checks: cleanChecks(SUPPLIERS.golden) },
      { id: "b2207", sup: "presidio", inv: "PP-2207", subject: "Unit order — 48 standard, 6 ADA", cents: 248000, status: "paid", time: "Oct 18", tx: "tr_Hd3mVt", from: "anne@presidioportables.com", received: "Oct 18, 2:15 PM",
        body: ["Confirming 48 standard and 6 ADA units."], payTo: { bank: "US Bank", routing: "091000022", last4: "3048", state: "verified", note: "Verified by call · May 2" }, checks: cleanChecks(SUPPLIERS.presidio) },
      { id: "b0915", sup: "coastline", inv: "CG-915", subject: "Generator hire, 3 days", cents: 620000, status: "paid", time: "Oct 17", tx: "tr_Lm9cRe", from: "rick@coastlinepower.com", received: "Oct 17, 11:30 AM",
        body: ["Two 200kVA units with fuel service."], payTo: { bank: "Chase", routing: "021000021", last4: "8840", state: "verified", note: "Verified by call · Apr 18" }, checks: cleanChecks(SUPPLIERS.coastline) },
      { id: "b0388", sup: "fencing", inv: "BBF-388", subject: "Perimeter fencing, 1.2 mi", cents: 312000, status: "paid", time: "Oct 16", tx: "tr_Ux2bNs", from: "tom@baybridgefence.com", received: "Oct 16, 9:05 AM",
        body: ["1.2 miles of perimeter fence, install Oct 26."], payTo: { bank: "Wells Fargo", routing: "121000248", last4: "2297", state: "verified", note: "Verified by call · Jun 22" }, checks: cleanChecks(SUPPLIERS.fencing) },
      { id: "b0302", sup: "tacos", inv: "#302", subject: "Invoice #302", preview: "Production office lunches", cents: 94000, status: "paid", time: "Oct 14", tx: "tr_Qe4hJz", from: "luis@missionsttacos.com", received: "Oct 14, 1:10 PM",
        body: ["Production office lunches, two weeks."], payTo: { bank: "First Republic", routing: "321081669", last4: "1185", state: "verified", note: "Verified by call · May 20" }, checks: cleanChecks(SUPPLIERS.tacos) },
      { id: "b0081", sup: "fogice", inv: "0081", subject: "Invoice 0081", preview: "Walk-in freezer rental", cents: 158000, status: "paid", time: "Oct 12", tx: "tr_Ab6tGy", from: "dana@fogcityice.com", received: "Oct 12, 10:00 AM",
        body: ["Walk-in freezer rental, deposit."], payTo: { bank: "Bank of America", routing: "026009593", last4: "9077", state: "verified", note: "Verified by call · Jun 3" }, checks: cleanChecks(SUPPLIERS.fogice) }
    ];
  }
  function seedLog() {
    return [
      { actor: "Callback", time: "10:43 AM", what: "held $18,400.00 to Mercury ··8817", why: "Rosa said they never changed banks.", bill: "b4502" },
      { actor: "Callback", time: "10:41 AM", what: "called Stagecraft on (415) 555-0142", why: "New bank account; writing doesn’t match the last 14 emails.", bill: "b4502" },
      { actor: "Callback", time: "10:12 AM", what: "called Bayline on (510) 555-0199", why: "Invoice is 31% above their August bill.", bill: "b2291" },
      { actor: "Callback", time: "9:31 AM", what: "asked Dev to approve $25,000.00 to Northpaw Talent", why: "Over the $10,000 limit. All checks passed.", bill: "b0611" },
      { actor: "Maya Lin", time: "9:15 AM", what: "added Golden Hour Lighting’s second contact", why: "Sam is out until Nov 3." },
      { actor: "Callback", time: "Mon 8:02 AM", what: "paid $4,250.00 to Chase ··7302 (Ironside)", why: "All checks passed. tr_8fK2xQ", bill: "b1010" },
      { actor: "Callback", time: "Mon 7:44 AM", what: "paid $7,300.00 to SVB ··5521 (Golden Hour)", why: "All checks passed. tr_Wq7nPa", bill: "b0772" }
    ];
  }
  var PRACTICE = [
    { id: "p1", name: "Bank change from a hacked supplier inbox", channel: "Email", by: "Writing style + new account" },
    { id: "p2", name: "Look-alike domain: stagecraft-rigging.co", channel: "Email", by: "Domain age (4 days)" },
    { id: "p3", name: "CEO asks for an urgent wire", channel: "Email", by: "Unknown payee + rush language" },
    { id: "p4", name: "Invoice for an agency Fogline never booked", channel: "Email", by: "No supplier record" },
    { id: "p5", name: "Caller claiming to be Bayline, new account", channel: "Phone", by: "Never changes details on inbound calls" },
    { id: "p6", name: "Amount nudged 3× on a real invoice", channel: "Email", by: "Amount vs. history" },
    { id: "p7", name: "Account on the shared blocklist", channel: "Email", by: "Shared blocklist" },
    { id: "p8", name: "Cloned voice of Rosa on a check call", channel: "Phone", by: "Not covered yet: voice-clone check" }
  ];

  /* ───────────── small pieces ───────────── */
  function Toast(p) { return p.msg ? h("div", { className: "pt-toast", role: "status" }, p.msg) : null; }
  function PageHead(p) {
    return h("header", { className: "pt-head" },
      h("div", { className: "pt-head-text" },
        p.crumb ? h("div", { className: "cb-caps pt-crumb" }, p.crumb) : null,
        h(p.small ? "h1" : "h1", { className: p.small ? "cb-subject" : "cb-display" }, p.title),
        p.sub ? h("p", { className: "pt-sub" }, p.sub) : null),
      p.actions ? h("div", { className: "pt-actions" }, p.actions) : null);
  }
  function Back(p) { return h("button", { className: "pt-back", onClick: p.onClick }, "← ", p.children); }

  /* ───────────── Inbox ───────────── */
  var FILTERS = [["all", "All"], ["needs-you", "Needs you"], ["held", "Held"], ["calling", "Calling"], ["checking", "Checking"], ["scheduled", "Scheduled"], ["paid", "Paid"]];
  function Inbox(p) {
    var f = useState("all"), filter = f[0], setFilter = f[1];
    var rows = p.bills.filter(function (b) { return filter === "all" || b.status === filter; });
    var count = function (k) { return p.bills.filter(function (b) { return k === "all" || b.status === k; }).length; };
    return h("div", null,
      h(PageHead, { title: "Inbox", sub: "bills@fogline.fm · newest first", actions: [h(C.Button, { key: 1, variant: "secondary", onClick: function () { p.go("practice"); } }, "Try a scam")] }),
      h("div", { className: "pt-filters", role: "tablist" }, FILTERS.map(function (x) {
        return h("button", { key: x[0], role: "tab", "aria-selected": filter === x[0], className: cx("pt-filter", filter === x[0] && "on"), onClick: function () { setFilter(x[0]); } }, x[1], h("span", { className: "pt-count" }, count(x[0])));
      })),
      h("div", { className: "pt-scroll" }, h("div", { className: "cb-ledger pt-ledger" },
        h("div", { className: "cb-ledger-head" }, h("span"), h("span", null, "Supplier"), h("span", null, "Subject"), h("span", { className: "cb-r" }, "Amount"), h("span", null, "Status"), h("span", { className: "cb-r" }, "In")),
        rows.length ? rows.map(function (b) {
          return h(C.InboxRow, { key: b.id, from: SUPPLIERS[b.sup].name, subject: b.subject, preview: b.preview, cents: b.cents, status: b.status, time: b.time, unread: b.unread, onClick: function () { p.open(b.id); } });
        }) : h("div", { className: "pt-empty" }, "Nothing here. Callback has no bills in this state."))));
  }

  /* ───────────── Bill page ───────────── */
  function Why(p) {
    var b = p.bill, s = SUPPLIERS[b.sup];
    var text = b.status === "held" || (b.approval && b.approval.kind === "bank")
      ? "I held this because the bank account is new and the email doesn’t read like Stagecraft. I called Rosa on the number we’ve had since April. She said they never changed banks, so the money stays put until Dev decides."
      : b.status === "needs-you" ? "Every check passed, but " + money(b.cents) + " is over the $10,000 limit, so Dev has to approve it."
      : b.status === "calling" ? "The amount is 31% higher than their August bill, so I’m confirming the change with " + s.contact + " before paying."
      : b.status === "checking" ? "I’m comparing this bill against " + s.short + "’s history. Nothing is decided yet."
      : "Known account, real domain, normal amount, and it reads like " + s.short + ". Bills like this under $10,000 are paid on the next run.";
    return h("div", { className: "pt-why", role: "dialog", "aria-label": "Why Callback did this" },
      h("div", { className: "cb-caps" }, "Why?"),
      h("p", { className: "pt-statement" }, text),
      h("div", { className: "pt-why-cites" }, b.checks.filter(function (c) { return c.sources; }).slice(0, 3).map(function (c, i) { return c.sources.map(function (sct, j) { return h(C.Cite, { key: i + "-" + j }, sct); }); })),
      h("button", { className: "cb-ask", onClick: p.onClose }, "Close"));
  }

  function BillPage(p) {
    var b = p.bill, s = SUPPLIERS[b.sup];
    var w = useState(false), why = w[0], setWhy = w[1];
    var dev = p.persona === "dev";
    var fails = b.checks.filter(function (c) { return c.result === "fail"; }).length;
    var order = { fail: 0, warn: 1, pass: 2 };
    var checks = b.checks.slice().sort(function (a, c) { return order[a.result] - order[c.result]; });
    var payBtn;
    if (b.status === "paid") payBtn = h(C.Button, { variant: "secondary", disabled: true }, "Paid · " + b.tx);
    else if (b.status === "held") payBtn = h(C.Button, { variant: "primary", locked: "Held after a failed call. Callback can’t release it; Dev has to approve." }, "Pay " + money(b.cents));
    else if (b.status === "needs-you") payBtn = dev ? h(C.Button, { variant: "primary", onClick: function () { p.go("approval", b.id); } }, "Review and approve") : h(C.Button, { variant: "primary", locked: "Over $10,000. Only Dev can approve." }, "Pay " + money(b.cents));
    else if (b.status === "calling" || b.status === "checking") payBtn = h(C.Button, { variant: "primary", locked: "Callback is still " + (b.status === "calling" ? "on the phone with " + s.contact : "checking") + "." }, "Pay " + money(b.cents));
    else payBtn = h(C.Button, { variant: "primary", onClick: function () { p.payNow(b.id); } }, "Pay " + money(b.cents) + " now");
    var actions = [
      h("span", { key: "w", className: "pt-whywrap" }, h(C.Button, { variant: "ask", onClick: function () { setWhy(!why); } }, "Why?"), why ? h(Why, { bill: b, onClose: function () { setWhy(false); } }) : null),
      b.status !== "paid" && b.status !== "held" ? h(C.Button, { key: "h", variant: "hold", icon: "hold", onClick: function () { p.hold(b.id); } }, "Hold") : null,
      b.call ? h(C.Button, { key: "c", variant: "secondary", icon: "phone", onClick: function () { p.go("call", b.id); } }, b.call.live ? "Listen in" : "Call recording") :
        (b.status !== "paid" ? h(C.Button, { key: "c", variant: "secondary", icon: "phone", onClick: function () { p.callNow(b.id); } }, "Call supplier") : null),
      h("span", { key: "p" }, payBtn)
    ];
    var endorse = b.status === "held" ? h(C.Endorsement, { kind: "held", meta: "Oct 21 · 10:43 AM · Callback", animate: false })
      : b.status === "paid" ? h(C.Endorsement, { kind: "paid", meta: (b.tx || "") + " · " + (b.paidTo || (b.payTo.bank + " ··" + b.payTo.last4)), animate: !!b.justPaid })
      : null;
    var timeline = p.log.filter(function (l) { return l.bill === b.id; });
    return h("div", null,
      h(Back, { onClick: function () { p.go("inbox"); } }, "Inbox"),
      h(PageHead, { small: true, crumb: s.name + " / " + b.inv, title: b.subject, actions: actions }),
      h("div", { className: "pt-bill" },
        h("article", { className: "cb-doc pt-email" },
          h("div", { className: "pt-meta" }, h("span", null, "From"), h("b", null, b.from), h("span", null, "To"), h("b", null, "bills@fogline.fm"), h("span", null, "Received"), h("b", null, b.received)),
          h("div", { className: "pt-body" }, b.body.map(function (t, i) { return h("p", { key: i }, t); })),
          h("div", { className: "pt-pay" },
            h("div", { className: "cb-caps" }, "Pay to"),
            h(C.Amount, { cents: b.cents, size: "lg" }),
            h(C.AccountLine, b.payTo)),
          endorse ? h("div", { className: "pt-endorse" }, endorse) : null),
        h("aside", { className: "pt-side" },
          h("section", { className: "cb-doc" },
            h("div", { className: "cb-doc-head" }, "Callback’s checks", h("small", null, b.status === "checking" ? "Running" : fails ? fails + " failed" : "All passed")),
            h("div", { role: "list" }, checks.map(function (c, i) { return h(C.CheckRow, Object.assign({ key: i, n: i + 1 }, c)); }))),
          b.call ? h("div", { className: "pt-click", onClick: function () { p.go("call", b.id); } }, h(C.Line, { state: b.call.state, supplier: s.contact + " · " + s.short, number: s.phone, source: s.phoneSrc, elapsed: b.call.elapsed, note: b.call.note })) : null,
          b.approval ? h("section", { className: "cb-doc pt-pad" },
            h(C.SignOff, b.approval.state === "signed" ? { state: "signed", name: "Dev Okafor", role: "Controller", time: b.approval.at, verb: b.approval.verb } : { state: "awaiting", name: "Dev Okafor", role: b.approval.reason, time: "Sent 10:43 AM" }),
            b.approval.state === "open" ? h("div", { className: "pt-mt" }, h(C.Button, { variant: dev ? "primary" : "secondary", size: "sm", onClick: function () { p.go("approval", b.id); } }, dev ? "Open in Approvals" : "View request")) : null) : null,
          timeline.length ? h("section", { className: "cb-doc" }, h("div", { className: "cb-doc-head" }, "Timeline", h("small", null, timeline.length + " events")),
            h("div", { role: "list" }, timeline.map(function (l, i) { return h(C.LogEntry, { key: i, actor: l.actor, time: l.time, why: l.why }, l.what); }))) : null)));
  }

  /* ───────────── Live call ───────────── */
  function CallScreen(p) {
    var b = p.bill, s = SUPPLIERS[b.sup], call = b.call;
    var shown = call.live ? (call.shown || 0) : call.lines.length;
    var lines = call.lines.slice(0, shown);
    var box = useRef(null);
    useEffect(function () { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown]);
    return h("div", null,
      h(Back, { onClick: function () { p.open(b.id); } }, s.short + " / " + b.inv),
      h(PageHead, { small: true, crumb: "Live call · outgoing check", title: s.name, actions: call.live ? [h(C.Button, { key: "t", variant: "secondary", onClick: function () { p.takeOver(b.id); } }, "End and take over")] : null }),
      h("div", { className: "pt-call" },
        h("div", { className: "pt-call-main" },
          h(C.Line, { state: call.state, supplier: s.contact + " · " + s.short, number: s.phone, source: s.phoneSrc, elapsed: call.elapsed, note: call.note }),
          h("div", { className: "cb-doc pt-transcript", ref: box },
            lines.length ? lines.map(function (l, i) {
              return h(C.TranscriptLine, { key: i, speaker: l.speaker, name: l.speaker === "callback" ? "Callback" : s.contact.split(" ")[0] + " (" + s.short + ")", time: l.time, cite: l.cite, aside: l.aside, speaking: call.live && i === lines.length - 1 }, l.text);
            }) : h("div", { className: "pt-empty" }, "Ringing " + s.phone + "…"))),
        h("aside", { className: "pt-side" },
          h("section", { className: "cb-doc pt-pad" },
            h("div", { className: "cb-caps" }, "Why this number"),
            h("p", { className: "pt-small" }, s.phone + " came from " + s.short + "’s website and business registry when they were added, " + s.phoneSrc + ". Callback never dials a number from the email."),
            h("div", { className: "cb-caps pt-mt" }, "Questions come from"),
            h("div", { className: "pt-cites" }, (b.sup === "stagecraft" ? ["INV-4471 · Sep 12", "11 payments", "Chase ··2210"] : ["BSR-2187 · Aug 28", "Rider change · Oct 14", "Wells Fargo ··6631"]).map(function (c) { return h(C.Cite, { key: c }, c); }))),
          !call.live ? h("section", { className: "cb-doc pt-pad" }, h("div", { className: "cb-caps" }, "Result"),
            h("div", { className: "pt-mt" }, h(C.Endorsement, { kind: call.state === "confirmed" ? "confirmed" : "held", meta: call.state === "confirmed" ? s.phone + " · " + call.at : "Oct 21 · " + call.at + " · Callback", animate: false }))) : null)));
  }

  /* ───────────── Approvals ───────────── */
  function Approvals(p) {
    var open = p.bills.filter(function (b) { return b.approval && b.approval.state === "open"; });
    var done = p.bills.filter(function (b) { return b.approval && b.approval.state !== "open"; });
    function row(b) {
      var s = SUPPLIERS[b.sup];
      return h("button", { key: b.id, className: "pt-apprrow", onClick: function () { p.go("approval", b.id); } },
        h("div", null, h("div", { className: "pt-strong" }, s.name), h("div", { className: "pt-small" }, b.approval.reason + " · " + b.inv)),
        h(C.Amount, { cents: b.cents }),
        h(C.StatusMark, { status: b.approval.state === "open" ? (b.status === "held" ? "held" : "needs-you") : "paid" }, b.approval.state === "open" ? null : "Signed"));
    }
    return h("div", null,
      h(PageHead, { title: "Approvals", sub: p.persona === "dev" ? "Signed in as Dev Okafor, controller. Only you can sign these." : "Signed in as Maya. Dev signs these; you can read them." }),
      h("div", { className: "cb-doc pt-list" }, h("div", { className: "cb-doc-head" }, "Waiting for Dev", h("small", null, open.length + " open")), open.length ? open.map(row) : h("div", { className: "pt-empty" }, "Nothing waiting. Callback will ask when a payment is over $10,000 or held.")),
      done.length ? h("div", { className: "cb-doc pt-list pt-mt2" }, h("div", { className: "cb-doc-head" }, "Signed today", h("small", null, done.length)), done.map(row)) : null);
  }

  function ApprovalDetail(p) {
    var b = p.bill, s = SUPPLIERS[b.sup], dev = p.persona === "dev", a = b.approval;
    var d = useState(a.kind === "bank" ? "Release it, we’ll miss the stage build." : ""), draft = d[0], setDraft = d[1];
    var cf = useState(""), confirm = cf[0], setConfirm = cf[1];
    var sr = useState(false), showRelease = sr[0], setShowRelease = sr[1];
    var thread = a.thread || [];
    var lock = dev ? null : "Signed in as Maya. Only Dev can sign.";
    var offered = thread.some(function (m) { return m.offer; });
    function send() { if (!draft.trim()) return; p.reply(b.id, draft.trim()); setDraft(""); }
    var request = a.kind === "bank"
      ? "Holding " + money(b.cents) + " to " + s.short + ". The email asks for a new account (Mercury ··8817). I called Rosa on " + s.phone + " and she said they never changed banks. I recommend rejecting this bank change and paying the verified Chase ··2210 account."
      : "All checks passed on " + b.inv + ". It’s " + money(b.cents) + " to " + s.bank + " ··" + s.last4 + ", the account verified by call on Feb 14. It’s over the $10,000 limit, so I need your approval.";
    return h("div", null,
      h(Back, { onClick: function () { p.go("approvals"); } }, "Approvals"),
      h(PageHead, { small: true, crumb: a.reason + " · " + b.inv, title: s.name, actions: [h(C.Button, { key: "b", variant: "secondary", onClick: function () { p.open(b.id); } }, "Open bill")] }),
      h("div", { className: "pt-bill" },
        h("div", { className: "pt-thread" },
          h("div", { className: "cb-doc pt-msg" },
            h("div", { className: "pt-msg-who" }, h("span", { className: "cb-who cb-who-agent" }, "CB"), h("b", null, "Callback"), h("span", { className: "pt-small" }, "10:43 AM")),
            h("p", { className: "pt-statement" }, request),
            h("div", { className: "pt-cites" }, (a.kind === "bank" ? ["Call · 00:44", "11 payments", "14 emails"] : ["4 checks", "Verified Feb 14"]).map(function (c) { return h(C.Cite, { key: c }, c); }))),
          thread.map(function (m, i) {
            return m.from === "dev"
              ? h("div", { key: i, className: "cb-doc pt-msg pt-msg-person" }, h("div", { className: "pt-msg-who" }, h("span", { className: "cb-who cb-who-person" }, "DO"), h("b", null, "Dev Okafor"), h("span", { className: "pt-small" }, m.time)), h("p", { className: "pt-quote" }, "“" + m.text + "”"))
              : h("div", { key: i, className: "cb-doc pt-msg" }, h("div", { className: "pt-msg-who" }, h("span", { className: "cb-who cb-who-agent" }, "CB"), h("b", null, "Callback"), h("span", { className: "pt-small" }, m.time)), h("p", { className: "pt-statement" }, m.text), m.cites ? h("div", { className: "pt-cites" }, m.cites.map(function (c) { return h(C.Cite, { key: c }, c); })) : null);
          }),
          a.state === "open" ? h("form", { className: "cb-doc pt-compose", onSubmit: function (e) { e.preventDefault(); send(); } },
            h("label", { htmlFor: "reply", className: "cb-caps" }, dev ? "Reply to Callback" : "Only Dev can reply"),
            h("textarea", { id: "reply", rows: 2, value: draft, disabled: !dev, onChange: function (e) { setDraft(e.target.value); }, placeholder: "Ask a question or push back" }),
            h("div", { className: "pt-row" }, dev ? h(C.Button, { variant: "secondary", size: "sm", type: "submit" }, "Send") : h(C.Button, { variant: "secondary", size: "sm", locked: lock }, "Send"))) : null),
        h("aside", { className: "pt-side" },
          h("section", { className: "cb-doc pt-pad" },
            h("div", { className: "cb-caps" }, "Decision"),
            h("div", { className: "pt-mt" }, h(C.Amount, { cents: b.cents, size: "lg" })),
            h("div", { className: "pt-mt" }, a.kind === "bank" ? h(C.AccountLine, b.payTo) : h(C.AccountLine, b.payTo)),
            a.kind === "bank" && a.state === "open" ? h("div", { className: "pt-mt" }, h("div", { className: "pt-small" }, "Verified alternative"), h(C.AccountLine, { bank: s.bank, routing: s.routing, last4: s.last4, state: "verified", note: s.verified })) : null,
            a.state === "open" ? h("div", { className: "pt-decide" },
              a.kind === "bank"
                ? [h(C.Button, { key: 1, variant: "primary", locked: lock || undefined, onClick: function () { p.payVerified(b.id); } }, (offered ? "Pay verified " : "Pay ") + s.bank + " ··" + s.last4),
                   h(C.Button, { key: 2, variant: "secondary", locked: lock || undefined, onClick: function () { p.reject(b.id); } }, "Reject bank change"),
                   dev ? h(C.Button, { key: 3, variant: "ask", onClick: function () { setShowRelease(!showRelease); } }, "Release to Mercury anyway") : null]
                : [h(C.Button, { key: 1, variant: "primary", locked: lock || undefined, onClick: function () { p.approve(b.id); } }, "Approve " + money(b.cents)),
                   h(C.Button, { key: 2, variant: "secondary", locked: lock || undefined, onClick: function () { p.reject(b.id); } }, "Reject")]) : null,
            showRelease && a.state === "open" ? h("div", { className: "pt-danger" },
              h("p", { className: "pt-small" }, "This sends " + money(b.cents) + " to an account Rosa says isn’t theirs. Type the last four digits, 8817, to release it."),
              h("input", { id: "confirm8817", className: "pt-input", value: confirm, inputMode: "numeric", onChange: function (e) { setConfirm(e.target.value); }, "aria-label": "Last four digits" }),
              h(C.Button, { variant: "hold", disabled: confirm !== "8817", onClick: function () { p.releaseAnyway(b.id); } }, "Release " + money(b.cents))) : null),
          h("section", { className: "cb-doc pt-pad" },
            a.state === "signed" ? h(C.SignOff, { state: "signed", name: "Dev Okafor", role: "Controller", time: a.at, verb: a.verb })
              : dev ? h(C.SignOff, { state: "awaiting", name: "Dev Okafor", role: "Your sign-off", time: "Sent 10:43 AM" })
              : h(C.SignOff, { state: "locked", reason: "Only Dev can sign this" })),
          h("section", { className: "cb-doc pt-pad" }, h(C.SignOff, { state: "locked" })))));
  }

  /* ───────────── Payments ───────────── */
  function Payments(p) {
    var run = p.bills.filter(function (b) { return b.status === "scheduled" || (b.status === "paid" && b.tx); });
    var due = run.filter(function (b) { return b.status === "scheduled"; });
    var total = due.reduce(function (a, b) { return a + b.cents; }, 0);
    return h("div", null,
      h(PageHead, { title: "Payments", sub: "This week’s run · Increase sandbox (test bank)", actions: [h(C.Button, { key: 1, variant: "primary", disabled: !due.length, onClick: p.runPayments }, due.length ? "Run payments · " + money(total) : "Nothing to run")] }),
      h("div", { className: "pt-scroll" }, h("div", { className: "cb-ledger pt-ledger pt-pay-ledger" },
        h("div", { className: "cb-ledger-head pt-pay-row" }, h("span", null, "Supplier"), h("span", null, "To account"), h("span", { className: "cb-r" }, "Amount"), h("span", null, "Status"), h("span", { className: "cb-r" }, "Transfer")),
        run.map(function (b) {
          var s = SUPPLIERS[b.sup];
          return h("a", { key: b.id, href: "#", className: "cb-ledger-row pt-pay-row", onClick: function () { p.open(b.id); } },
            h("span", { className: "cb-from" }, s.name),
            h("span", { className: "cb-when" }, b.paidTo || (b.payTo.bank + " ··" + b.payTo.last4)),
            h("span", { className: "cb-r" }, h(C.Amount, { cents: b.cents })),
            h("span", null, h(C.StatusMark, { status: b.status })),
            h("span", { className: "cb-when cb-r" }, b.tx || "—"));
        }))));
  }

  /* ───────────── Suppliers ───────────── */
  function Suppliers(p) {
    var a = useState(false), adding = a[0], setAdding = a[1];
    var st = useState(0), step = st[0], setStep = st[1];
    var nm = useState("Twin Peaks Staging"), name = nm[0], setName = nm[1];
    var site = useState("twinpeaksstaging.com"), url = site[0], setUrl = site[1];
    useEffect(function () { if (!adding || step === 0 || step >= 5) return; var t = setTimeout(function () { setStep(step + 1); }, 650); return function () { clearTimeout(t); }; }, [adding, step]);
    var STEPS = [["Website", url + " · live, lists (415) 555-0190"], ["Business registry", "CA Secretary of State · active since 2017"], ["Google Maps", "Listing at 1550 Evans Ave · same phone"], ["Domain age", "Registered 2016 · 10 years"]];
    return h("div", null,
      h(PageHead, { title: "Suppliers", sub: ORDER.length + " suppliers · the trusted number is the only one Callback dials", actions: [h(C.Button, { key: 1, variant: "secondary", onClick: function () { setAdding(!adding); setStep(0); } }, adding ? "Close" : "Add supplier")] }),
      adding ? h("form", { className: "cb-doc pt-pad pt-add", onSubmit: function (e) { e.preventDefault(); setStep(1); } },
        h("div", { className: "pt-add-fields" },
          h("label", { className: "pt-field" }, h("span", { className: "cb-caps" }, "Name"), h("input", { id: "supname", className: "pt-input", value: name, onChange: function (e) { setName(e.target.value); } })),
          h("label", { className: "pt-field" }, h("span", { className: "cb-caps" }, "Website"), h("input", { id: "supsite", className: "pt-input", value: url, onChange: function (e) { setUrl(e.target.value); } })),
          h(C.Button, { variant: "primary", type: "submit", disabled: step > 0 }, step ? "Checking…" : "Run background check")),
        step ? h("div", { className: "pt-steps" }, STEPS.map(function (x, i) {
          var done = step > i + 1;
          return h("div", { key: i, className: "pt-step" }, h(C.StatusMark, { status: done ? "paid" : step === i + 1 ? "checking" : "scheduled" }, done ? "Done" : step === i + 1 ? "Checking" : "Queued"), h("b", null, x[0]), h("span", { className: "pt-small" }, done ? x[1] : ""));
        }), step >= 5 ? h("div", { className: "pt-small pt-mt" }, "Trusted number set to (415) 555-0190 from the website and Maps listing. Callback will call it to verify bank details before the first payment.") : null) : null) : null,
      h("div", { className: "pt-scroll" }, h("div", { className: "cb-ledger pt-ledger" },
        h("div", { className: "cb-ledger-head pt-sup-row" }, h("span", null, "Supplier"), h("span", null, "Kind"), h("span", null, "Trusted number"), h("span", null, "Bank"), h("span", { className: "cb-r" }, "Checked")),
        ORDER.map(function (k) {
          var s = SUPPLIERS[k];
          return h("a", { key: k, href: "#", className: "cb-ledger-row pt-sup-row", onClick: function () { p.go("supplier", k); } },
            h("span", { className: "cb-from" }, s.name), h("span", { className: "cb-subj" }, s.kind), h("span", { className: "cb-when" }, s.phone), h("span", { className: "cb-when" }, s.bank + " ··" + s.last4), h("span", { className: "cb-when cb-r" }, s.checked));
        }))));
  }
  function SupplierPage(p) {
    var s = SUPPLIERS[p.id], bills = p.bills.filter(function (b) { return b.sup === p.id; });
    return h("div", null,
      h(Back, { onClick: function () { p.go("suppliers"); } }, "Suppliers"),
      h(PageHead, { small: true, crumb: s.kind + " · since " + s.since, title: s.name }),
      h("div", { className: "pt-bill" },
        h("div", { className: "pt-side" },
          h("section", { className: "cb-doc" }, h("div", { className: "cb-doc-head" }, "Bank details", h("small", null, "Changes need a passed call and Dev")),
            h("div", { className: "pt-pad" }, h(C.AccountLine, { bank: s.bank, routing: s.routing, last4: s.last4, state: "verified", note: s.verified })),
            p.id === "stagecraft" ? h("div", { className: "pt-pad pt-topline" }, h("div", { className: "pt-small" }, "Attempted change · Oct 21 · rejected by call"), h(C.AccountLine, { bank: "Mercury", routing: "084106768", last4: "8817", state: "new" })) : null),
          h("section", { className: "cb-doc" }, h("div", { className: "cb-doc-head" }, "Bills", h("small", null, bills.length)),
            bills.map(function (b) { return h("a", { key: b.id, href: "#", className: "pt-mini", onClick: function () { p.open(b.id); } }, h("span", null, b.inv + " · " + b.subject), h(C.Amount, { cents: b.cents }), h(C.StatusMark, { status: b.status })); }))),
        h("aside", { className: "pt-side" },
          h("section", { className: "cb-doc pt-pad" }, h("div", { className: "cb-caps" }, "Trusted contact"),
            h("div", { className: "pt-strong pt-mt" }, s.contact), h("div", { className: "cb-when" }, s.phone + " · " + s.phoneSrc), h("div", { className: "pt-small pt-mt" }, "From the background check: " + s.domain + ", business registry, Google Maps.")),
          h("section", { className: "cb-doc pt-pad" }, h("div", { className: "cb-caps" }, "Background check"),
            [["Website", s.domain], ["Business registry", "Active"], ["Google Maps", "Listing matches"], ["Domain age", "Registered " + s.since]].map(function (x) { return h("div", { key: x[0], className: "pt-kv" }, h("span", { className: "pt-small" }, x[0]), h("span", { className: "cb-when" }, x[1])); })))));
  }

  /* ───────────── Phone line ───────────── */
  function PhoneLine(p) {
    var o = useState(0), open = o[0], setOpen = o[1];
    var CALLS = [
      { who: "Unknown caller · says Bayline", from: "(628) 555-0143", time: "Today 9:47 AM", result: "Called back on file", lines: [
        { speaker: "caller", time: "00:03", text: "Hi, this is Marcus from Bayline. We switched banks, I need to give you the new account for Friday." },
        { speaker: "callback", time: "00:11", text: "Thanks for calling. I can’t change bank details on an incoming call. I’ll call you back on the number we have for Bayline." },
        { speaker: "caller", time: "00:18", text: "It’s urgent, can’t you just take it down?" },
        { speaker: "callback", time: "00:22", cite: "(510) 555-0199", text: "I’ll call Bayline now on (510) 555-0199. If it’s you, we’ll sort it in two minutes." }] },
      { who: "Northpaw Talent", from: "(323) 555-0177", time: "Yesterday 4:05 PM", result: "Question answered", lines: [
        { speaker: "caller", time: "00:02", text: "Hey, Jules from Northpaw. Did the deposit invoice come through?" },
        { speaker: "callback", time: "00:07", text: "It did, NP-0611 for $25,000.00. It’s waiting on Dev’s approval because it’s over our limit." }] }
    ];
    var c = CALLS[open];
    return h("div", null,
      h(PageHead, { title: "Phone line", sub: "Fogline · (415) 555-0100 · Callback answers every call" }),
      h("div", { className: "pt-bill" },
        h("div", { className: "pt-side" },
          h("div", { className: "cb-doc pt-list" }, h("div", { className: "cb-doc-head" }, "Incoming calls", h("small", null, CALLS.length)),
            CALLS.map(function (x, i) { return h("button", { key: i, className: cx("pt-apprrow", open === i && "on"), onClick: function () { setOpen(i); } }, h("div", null, h("div", { className: "pt-strong" }, x.who), h("div", { className: "cb-when" }, x.from + " · " + x.time)), h(C.StatusMark, { status: i === 0 ? "held" : "paid" }, x.result)); })),
          h("div", { className: "cb-doc pt-pad" }, h("div", { className: "cb-caps" }, "Rule"), h("p", { className: "pt-statement" }, "Callback never changes bank details from an incoming call. It says “we’ll call you back on the number we have” and starts an outgoing check call."))),
        h("div", { className: "cb-doc pt-transcript" }, c.lines.map(function (l, i) { return h(C.TranscriptLine, { key: open + "-" + i, speaker: l.speaker === "callback" ? "callback" : "caller", name: l.speaker === "callback" ? "Callback" : "Caller", time: l.time, cite: l.cite }, l.text); }))));
  }

  /* ───────────── Practice ───────────── */
  function Practice(p) {
    var r = useState(null), running = r[0], setRunning = r[1];
    var res = useState({ p1: "caught", p2: "caught", p3: "caught", p4: "caught", p5: "caught", p6: "caught", p7: "caught", p8: "missed" }), results = res[0], setResults = res[1];
    var f = useState({ sup: "bayline", subject: "New remittance account", bank: "Chime ··5520" }), form = f[0], setForm = f[1];
    useEffect(function () {
      if (running == null) return;
      if (running >= PRACTICE.length) { setRunning(null); p.toast("Practice run finished: 7 of 8 caught."); return; }
      var t = setTimeout(function () { var id = PRACTICE[running].id, n = Object.assign({}, results); n[id] = id === "p8" ? "missed" : "caught"; setResults(n); setRunning(running + 1); }, 520);
      return function () { clearTimeout(t); };
    }, [running]);
    var caught = Object.keys(results).filter(function (k) { return results[k] === "caught"; }).length;
    return h("div", null,
      h(PageHead, { title: "Practice", sub: "Scams written by Grok, run against a copy of the workspace. Run it after any change, like tests.", actions: [h(C.Button, { key: 1, variant: "primary", disabled: running != null, onClick: function () { var n = {}; PRACTICE.forEach(function (x) { n[x.id] = "pending"; }); setResults(n); setRunning(0); } }, running != null ? "Running…" : "Run all 8")] }),
      h("div", { className: "pt-bill" },
        h("div", { className: "cb-doc pt-list" }, h("div", { className: "cb-doc-head" }, "Scam set", h("small", null, running != null ? "Running " + (running + 1) + " of 8" : caught + " of 8 caught")),
          PRACTICE.map(function (x, i) {
            var st = results[x.id];
            return h("div", { key: x.id, className: "pt-apprrow pt-static" },
              h("div", null, h("div", { className: "pt-strong" }, x.name), h("div", { className: "pt-small" }, x.channel + " · " + (st === "missed" ? x.by : "Caught by: " + x.by))),
              h(C.StatusMark, { status: running === i ? "checking" : st === "caught" ? "paid" : st === "missed" ? "held" : "scheduled" }, running === i ? "Running" : st === "caught" ? "Caught" : st === "missed" ? "Missed" : "Queued"));
          })),
        h("form", { className: "cb-doc pt-pad pt-try", onSubmit: function (e) { e.preventDefault(); p.tryScam(form); } },
          h("div", { className: "cb-caps" }, "Try a scam"),
          h("p", { className: "pt-small" }, "Write your own. It lands in the real Inbox and Callback handles it like any other bill."),
          h("label", { className: "pt-field" }, h("span", { className: "cb-caps" }, "Pretend to be"),
            h("select", { id: "scamsup", className: "pt-input", value: form.sup, onChange: function (e) { setForm(Object.assign({}, form, { sup: e.target.value })); } }, ORDER.filter(function (k) { return k !== "stagecraft"; }).map(function (k) { return h("option", { key: k, value: k }, SUPPLIERS[k].name); }))),
          h("label", { className: "pt-field" }, h("span", { className: "cb-caps" }, "Subject"), h("input", { id: "scamsubj", className: "pt-input", value: form.subject, onChange: function (e) { setForm(Object.assign({}, form, { subject: e.target.value })); } })),
          h("label", { className: "pt-field" }, h("span", { className: "cb-caps" }, "New bank account"), h("input", { id: "scambank", className: "pt-input", value: form.bank, onChange: function (e) { setForm(Object.assign({}, form, { bank: e.target.value })); } })),
          h("div", { className: "pt-mt" }, h(C.Button, { variant: "primary", type: "submit" }, "Send to Inbox")))));
  }

  /* ───────────── Activity log ───────────── */
  function Activity(p) {
    var q = useState(""), query = q[0], setQuery = q[1];
    var who = useState("all"), actor = who[0], setActor = who[1];
    var rows = p.log.filter(function (l) {
      return (actor === "all" || (actor === "cb" ? l.actor === "Callback" : l.actor !== "Callback")) && (!query || (l.actor + " " + l.what + " " + (l.why || "")).toLowerCase().indexOf(query.toLowerCase()) >= 0);
    });
    return h("div", null,
      h(PageHead, { title: "Activity log", sub: "Every action by Callback, Maya and Dev: who, when, what, why" }),
      h("div", { className: "pt-tools" },
        h("input", { id: "logsearch", className: "pt-input pt-search", placeholder: "Search the log", value: query, onChange: function (e) { setQuery(e.target.value); }, "aria-label": "Search the log" }),
        h("div", { className: "pt-filters" }, [["all", "Everyone"], ["cb", "Callback"], ["people", "People"]].map(function (x) { return h("button", { key: x[0], className: cx("pt-filter", actor === x[0] && "on"), onClick: function () { setActor(x[0]); } }, x[1]); }))),
      h("div", { className: "cb-doc", role: "list" }, rows.length ? rows.map(function (l, i) {
        return h("div", { key: i, className: cx(l.bill && "pt-click"), onClick: l.bill ? function () { p.open(l.bill); } : null }, h(C.LogEntry, { actor: l.actor, time: l.time, why: l.why }, l.what));
      }) : h("div", { className: "pt-empty" }, "No entries match “" + query + "”.")));
  }

  /* ───────────── App shell ───────────── */
  var NAV = [["inbox", "Inbox"], ["approvals", "Approvals"], ["payments", "Payments"], ["suppliers", "Suppliers"], ["phone", "Phone line"], ["practice", "Practice"], ["log", "Activity log"]];
  var ROUTE_NAV = { bill: "inbox", call: "inbox", approval: "approvals", supplier: "suppliers" };

  function App() {
    var r = useState({ name: "inbox" }), route = r[0], setRoute = r[1];
    var bs = useState(seedBills), bills = bs[0], setBills = bs[1];
    var ls = useState(seedLog), log = ls[0], setLog = ls[1];
    var ps = useState("maya"), persona = ps[0], setPersona = ps[1];
    var ts = useState(""), toastMsg = ts[0], setToast = ts[1];
    var main = useRef(null);
    var billsRef = useRef(bills); billsRef.current = bills;

    function toast(m) { setToast(m); clearTimeout(toast.t); toast.t = setTimeout(function () { setToast(""); }, 3200); }
    function go(name, param) { setRoute({ name: name, param: param }); if (main.current) main.current.scrollTop = 0; window.scrollTo(0, 0); }
    function patch(id, fn) { setBills(function (all) { return all.map(function (b) { return b.id === id ? fn(Object.assign({}, b)) : b; }); }); }
    function addLog(e) { setLog(function (l) { return [e].concat(l); }); }
    function open(id) { patch(id, function (b) { b.unread = false; return b; }); go("bill", id); }

    /* Bayline live call plays out; Fog City Ice finishes checking */
    useEffect(function () {
      var t1 = setTimeout(function () {
        patch("b0093", function (b) { b.status = "scheduled"; return b; });
        addLog({ actor: "Callback", time: now(), what: "scheduled $640.00 to Bank of America ··9077 (Fog City Ice)", why: "All checks passed. Goes out in Friday’s run.", bill: "b0093" });
      }, 6000);
      var i = 0;
      var iv = setInterval(function () {
        var b = billsRef.current.find(function (x) { return x.id === "b2291"; });
        if (!b || !b.call.live) { clearInterval(iv); return; }
        i += 1;
        if (i <= BAYLINE_CALL.length) {
          patch("b2291", function (x) { x.call = Object.assign({}, x.call, { shown: i, elapsed: BAYLINE_CALL[i - 1].time }); return x; });
        } else {
          clearInterval(iv);
          patch("b2291", function (x) { x.call = Object.assign({}, x.call, { live: false, state: "confirmed", elapsed: "00:49", note: "Marcus confirmed the extra subs and the same account." }); x.status = "scheduled"; x.checks = x.checks.map(function (c) { return c.result === "warn" ? Object.assign({}, c, { result: "pass", title: "Amount confirmed by call", evidence: "Extra subs and delay tower, per Dev’s Oct 14 rider change" }) : c; }); return x; });
          addLog({ actor: "Callback", time: now(), what: "scheduled $9,650.00 to Wells Fargo ··6631 (Bayline)", why: "Marcus confirmed the extra subs on the call.", bill: "b2291" });
          toast("Bayline confirmed on the call. Scheduled for Friday’s run.");
        }
      }, 2600);
      return function () { clearTimeout(t1); clearInterval(iv); };
    }, []);

    var actions = {
      hold: function (id) { var b = billsRef.current.find(function (x) { return x.id === id; }); patch(id, function (x) { x.status = "held"; return x; }); addLog({ actor: persona === "dev" ? "Dev Okafor" : "Maya Lin", time: now(), what: "held " + money(b.cents) + " to " + SUPPLIERS[b.sup].short, why: "Held by hand.", bill: id }); toast("Held. It won’t go out until someone releases it."); },
      payNow: function (id) { var b = billsRef.current.find(function (x) { return x.id === id; }), tx = txid(); patch(id, function (x) { x.status = "paid"; x.tx = tx; x.justPaid = true; return x; }); addLog({ actor: "Callback", time: now(), what: "paid " + money(b.cents) + " to " + b.payTo.bank + " ··" + b.payTo.last4, why: "Sent early at Maya’s request. " + tx, bill: id }); toast("Sent " + money(b.cents) + " · " + tx); },
      callNow: function (id) { toast("Callback is calling " + SUPPLIERS[billsRef.current.find(function (x) { return x.id === id; }).sup].phone + ", the number on file."); },
      takeOver: function (id) { patch(id, function (x) { x.call = Object.assign({}, x.call, { live: false, state: "dropped", note: "Maya took over the call." }); return x; }); addLog({ actor: "Maya Lin", time: now(), what: "took over the call with Bayline", why: "Ended Callback’s check call.", bill: id }); toast("You’re on the line. Callback stopped talking."); },
      reply: function (id, text) {
        var t = now();
        patch(id, function (x) { x.approval = Object.assign({}, x.approval, { thread: (x.approval.thread || []).concat([{ from: "dev", text: text, time: t }]) }); return x; });
        addLog({ actor: "Dev Okafor", time: t, what: "replied on " + SUPPLIERS[billsRef.current.find(function (x) { return x.id === id; }).sup].short, why: text, bill: id });
        setTimeout(function () {
          var b = billsRef.current.find(function (x) { return x.id === id; }), s = SUPPLIERS[b.sup], tt = now();
          var msg = b.approval.kind === "bank"
            ? { from: "cb", time: tt, offer: true, text: "Rosa confirmed on the call that Stagecraft never changed banks, so the Mercury account isn’t theirs. The build doesn’t have to slip: I can pay the verified Chase ··2210 account today. Stagecraft has been paid there 11 times.", cites: ["Call · 00:44", "Chase ··2210", "11 payments"] }
            : { from: "cb", time: tt, text: "Every check passed and the account was verified by call on Feb 14. Approving sends it in today’s run.", cites: ["Verified Feb 14"] };
          patch(id, function (x) { x.approval = Object.assign({}, x.approval, { thread: (x.approval.thread || []).concat([msg]) }); return x; });
        }, 1100);
      },
      payVerified: function (id) {
        var b = billsRef.current.find(function (x) { return x.id === id; }), s = SUPPLIERS[b.sup], tx = txid(), t = now();
        patch(id, function (x) { x.status = "paid"; x.tx = tx; x.justPaid = true; x.paidTo = s.bank + " ··" + s.last4; x.payTo = { bank: s.bank, routing: s.routing, last4: s.last4, state: "verified", note: s.verified }; x.approval = Object.assign({}, x.approval, { state: "signed", at: "Oct 21 · " + t, verb: "Approved" }); return x; });
        addLog({ actor: "Dev Okafor", time: t, what: "approved " + money(b.cents) + " to " + s.bank + " ··" + s.last4, why: "Pay the old, verified account.", bill: id });
        addLog({ actor: "Callback", time: t, what: "paid " + money(b.cents) + " to " + s.bank + " ··" + s.last4, why: "Increase sandbox transfer " + tx + ". Bank change to Mercury ··8817 rejected.", bill: id });
        toast("Signed. " + money(b.cents) + " sent to " + s.bank + " ··" + s.last4 + " · " + tx);
      },
      approve: function (id) {
        var b = billsRef.current.find(function (x) { return x.id === id; }), s = SUPPLIERS[b.sup], tx = txid(), t = now();
        patch(id, function (x) { x.status = "paid"; x.tx = tx; x.justPaid = true; x.approval = Object.assign({}, x.approval, { state: "signed", at: "Oct 21 · " + t, verb: "Approved" }); return x; });
        addLog({ actor: "Dev Okafor", time: t, what: "approved " + money(b.cents) + " to " + s.short, why: "Deposit per signed offer.", bill: id });
        addLog({ actor: "Callback", time: t, what: "paid " + money(b.cents) + " to " + s.bank + " ··" + s.last4, why: "Increase sandbox transfer " + tx + ".", bill: id });
        toast("Signed. " + money(b.cents) + " sent · " + tx);
      },
      reject: function (id) {
        var b = billsRef.current.find(function (x) { return x.id === id; }), t = now();
        patch(id, function (x) { x.approval = Object.assign({}, x.approval, { state: "signed", at: "Oct 21 · " + t, verb: "Rejected" }); x.status = "held"; return x; });
        addLog({ actor: "Dev Okafor", time: t, what: "rejected " + b.inv + " from " + SUPPLIERS[b.sup].short, why: "Rejected in Approvals.", bill: id });
        toast("Rejected. Nothing was paid.");
      },
      releaseAnyway: function (id) {
        var b = billsRef.current.find(function (x) { return x.id === id; }), tx = txid(), t = now();
        patch(id, function (x) { x.status = "paid"; x.tx = tx; x.justPaid = true; x.paidTo = "Mercury ··8817"; x.approval = Object.assign({}, x.approval, { state: "signed", at: "Oct 21 · " + t, verb: "Released" }); return x; });
        addLog({ actor: "Dev Okafor", time: t, what: "released " + money(b.cents) + " to Mercury ··8817", why: "Overrode Callback’s hold after typing the account digits.", bill: id });
        toast("Released to Mercury ··8817 · " + tx + ". Logged as Dev’s override.");
      },
      runPayments: function () {
        var t = now(), due = billsRef.current.filter(function (b) { return b.status === "scheduled"; });
        var sent = due.reduce(function (a, b) { return a + b.cents; }, 0), ids = due.map(function (b) { return b.id; });
        setBills(function (all) { return all.map(function (b) { return ids.indexOf(b.id) >= 0 ? Object.assign({}, b, { status: "paid", tx: txid() }) : b; }); });
        addLog({ actor: "Callback", time: t, what: "ran this week’s payments", why: due.length + " transfers, " + money(sent) + ", through the Increase sandbox." });
        toast("Payment run sent · " + money(sent));
      },
      tryScam: function (form) {
        var s = SUPPLIERS[form.sup], id = "bx" + Date.now(), cents = 812000, t = now(), parts = form.bank.split(/\s*··\s*/);
        var bill = { id: id, sup: form.sup, inv: "TRY-" + String(Date.now()).slice(-4), subject: form.subject || "New remittance account", preview: "Sent from Practice", cents: cents, status: "checking", time: hhmm(t), unread: true, from: "accounts@" + s.domain.replace(".com", "-billing.com"), received: "Oct 21, " + t,
          body: ["Hello,", "Our bank has changed. Please send this and future payments to " + form.bank + ". Payment is due today.", "Regards, Accounts"],
          payTo: { bank: parts[0] || "Unknown bank", last4: (parts[1] || "0000").slice(-4), state: "new" },
          checks: [
            { result: "fail", title: "Bank account never used before", evidence: "Fogline has always paid " + s.short + " at " + s.bank + " ··" + s.last4 + ".", sources: [s.paid + " payments"] },
            { result: "fail", title: "Look-alike domain", evidence: "Sent from " + s.domain.replace(".com", "-billing.com") + ", registered 3 days ago. Their real domain is " + s.domain + ".", sources: ["WHOIS"] },
            { result: "warn", title: "Rush language", quote: "Payment is due today.", flag: "due today" },
            { result: "pass", title: "Amount looks normal", evidence: "Within range of past bills" }] };
        setBills(function (all) { return [bill].concat(all); });
        addLog({ actor: "Maya Lin", time: t, what: "sent a practice scam as " + s.short, why: form.subject, bill: id });
        toast("Landed in the Inbox. Watch Callback handle it.");
        go("inbox");
        setTimeout(function () { patch(id, function (x) { x.status = "calling"; return x; }); addLog({ actor: "Callback", time: now(), what: "called " + s.short + " on " + s.phone, why: "New account and a look-alike domain.", bill: id }); }, 2600);
        setTimeout(function () {
          patch(id, function (x) { x.status = "held"; x.call = { state: "not-confirmed", elapsed: "00:41", note: "“That’s not us. Our account hasn’t changed.”", lines: [{ speaker: "callback", time: "00:05", text: "Hi " + s.contact.split(" ")[0] + ", Fogline accounts. Did " + s.short + " change bank accounts this week?" }, { speaker: "supplier", time: "00:12", text: "No. That’s not us. Our account hasn’t changed." }], at: now() }; return x; });
          addLog({ actor: "Callback", time: now(), what: "held " + money(cents) + " to " + form.bank, why: s.contact.split(" ")[0] + " said the account hasn’t changed.", bill: id });
          toast("Held. " + s.short + " said it wasn’t them.");
        }, 6200);
      }
    };

    var bill = route.param && bills.find(function (b) { return b.id === route.param; });
    var openApprovals = bills.filter(function (b) { return b.approval && b.approval.state === "open"; }).length;
    var counts = { inbox: bills.filter(function (b) { return b.unread; }).length, approvals: openApprovals };
    var P = { bills: bills, log: log, persona: persona, go: go, open: open, toast: toast };
    var view;
    switch (route.name) {
      case "bill": view = h(BillPage, Object.assign({ key: route.param, bill: bill }, P, actions)); break;
      case "call": view = h(CallScreen, Object.assign({ bill: bill }, P, actions)); break;
      case "approvals": view = h(Approvals, P); break;
      case "approval": view = h(ApprovalDetail, Object.assign({ key: route.param + persona, bill: bill }, P, actions)); break;
      case "payments": view = h(Payments, Object.assign({}, P, actions)); break;
      case "suppliers": view = h(Suppliers, P); break;
      case "supplier": view = h(SupplierPage, Object.assign({ id: route.param }, P)); break;
      case "phone": view = h(PhoneLine, P); break;
      case "practice": view = h(Practice, Object.assign({}, P, actions)); break;
      case "log": view = h(Activity, P); break;
      default: view = h(Inbox, P);
    }
    var active = ROUTE_NAV[route.name] || route.name;
    return h("div", { className: "pt-app" },
      h("nav", { className: "pt-nav", "aria-label": "Callback" },
        h("div", { className: "pt-brand" }, h(C.Guilloche, { size: 26, lobes: 9, strands: 6, className: "pt-brand-seal" }), h("div", null, h("div", { className: "pt-word" }, "Callback"), h("div", { className: "cb-caps" }, "Fogline · AP"))),
        h("div", { className: "pt-navlist" }, NAV.map(function (n) {
          var c = counts[n[0]];
          return h("button", { key: n[0], className: cx("pt-navitem", active === n[0] && "on"), "aria-current": active === n[0] ? "page" : undefined, onClick: function () { go(n[0]); } },
            h("span", null, n[1]), c ? h("span", { className: cx("pt-badge", n[0] === "approvals" && "pt-badge-you") }, c) : null);
        })),
        h("div", { className: "pt-persona" },
          h("div", { className: "cb-caps" }, "Signed in as"),
          h("div", { className: "pt-seg", role: "radiogroup" },
            [["maya", "Maya", "Bookkeeper"], ["dev", "Dev", "Controller"]].map(function (x) {
              return h("button", { key: x[0], role: "radio", "aria-checked": persona === x[0], className: cx(persona === x[0] && "on"), onClick: function () { setPersona(x[0]); toast("Signed in as " + (x[0] === "dev" ? "Dev Okafor, controller" : "Maya Lin, bookkeeper") + "."); } }, h("b", null, x[1]), h("span", null, x[2]));
            })),
          h("div", { className: "pt-line cb-when" }, h("span", { className: "cb-ind" }), "(415) 555-0100"))),
      h("main", { className: "pt-main", ref: main }, view, h(Toast, { msg: toastMsg })));
  }

  document.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest('a[href="#"]'); if (a) e.preventDefault(); });
  ReactDOM.createRoot(document.getElementById("app")).render(h(App));
})();
