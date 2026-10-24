/* @ds-bundle: {"format":4,"namespace":"Callback","components":[{"name":"Button"},{"name":"StatusMark"},{"name":"Endorsement"},{"name":"SignOff"},{"name":"Guilloche"},{"name":"Amount"},{"name":"AccountLine"},{"name":"Cite"},{"name":"CheckRow"},{"name":"Line"},{"name":"TranscriptLine"},{"name":"LogEntry"},{"name":"InboxRow"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }
  function omit(o, keys) { var r = {}; for (var k in o) if (keys.indexOf(k) < 0) r[k] = o[k]; return r; }

  /* Glyphs — 16 grid, 1.5 stroke, currentColor. */
  function svg(kids) { return h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, kids); }
  var G = {
    tick: function () { return svg(h("path", { d: "M3.5 8.5l3 3 6-7" })); },
    x: function () { return svg(h("path", { d: "M4.5 4.5l7 7M11.5 4.5l-7 7", strokeWidth: 1.8 })); },
    q: function () { return svg([h("path", { key: 1, d: "M6 6a2 2 0 113 1.7c-.7.4-1 .8-1 1.5" }), h("circle", { key: 2, cx: 8, cy: 11.6, r: .6, fill: "currentColor" })]); },
    clock: function () { return svg([h("circle", { key: 1, cx: 8, cy: 8, r: 5.8 }), h("path", { key: 2, d: "M8 4.8V8l2.2 1.4" })]); },
    person: function () { return svg([h("circle", { key: 1, cx: 8, cy: 5.5, r: 2.5 }), h("path", { key: 2, d: "M3.5 13.5c.6-2.5 2.4-3.7 4.5-3.7s3.9 1.2 4.5 3.7" })]); },
    hold: function () { return svg(h("path", { d: "M6 4v8M10 4v8", strokeWidth: 2 })); },
    lock: function () { return svg([h("rect", { key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1 }), h("path", { key: 2, d: "M5.5 7V5.2a2.5 2.5 0 015 0V7" })]); },
    phone: function () { return svg(h("path", { d: "M5.2 2.5H3.4a1 1 0 00-1 1.1 10.5 10.5 0 009.8 9.8 1 1 0 001.1-1v-1.8a1 1 0 00-.8-1l-2-.5a1 1 0 00-1 .3l-.7.8a7.5 7.5 0 01-3.3-3.3l.8-.7a1 1 0 00.3-1l-.5-2a1 1 0 00-1-.7z" })); },
    transit: function () { return h("svg", { viewBox: "0 0 8 11", "aria-hidden": "true" }, [h("rect", { key: 1, x: 0, y: 0, width: 2, height: 11 }), h("rect", { key: 2, x: 4.4, y: 0, width: 3.6, height: 3.4 }), h("rect", { key: 3, x: 4.4, y: 7.6, width: 3.6, height: 3.4 })]); },
    onus: function () { return h("svg", { viewBox: "0 0 8 11", "aria-hidden": "true" }, [h("rect", { key: 1, x: 0, y: 0, width: 2.4, height: 6.5 }), h("rect", { key: 2, x: 5.6, y: 0, width: 2.4, height: 6.5 }), h("rect", { key: 3, x: 0, y: 8.2, width: 8, height: 2.8 })]); }
  };

  /* Guilloche — security-print rosette: interleaved sine rings, like the seal on a banknote. */
  function rosettePaths(size, opt) {
    opt = opt || {};
    var c = size / 2, k = opt.lobes || 18, n = opt.strands || 16, out = [];
    var rings = [[0.36, opt.amp ? opt.amp / size : 0.07, k, n], [0.21, 0.05, Math.max(5, Math.round(k * 0.6)), Math.max(5, Math.round(n * 0.6))]];
    rings.forEach(function (g) {
      var R = g[0] * size, A = g[1] * size;
      for (var s = 0; s < g[3]; s++) {
        var ph = s * Math.PI * 2 / g[3], d = "";
        for (var i = 0; i <= 360; i++) {
          var t = i / 360 * Math.PI * 2, r = R + A * Math.sin(g[2] * t + ph);
          d += (i ? "L" : "M") + (c + r * Math.cos(t)).toFixed(2) + " " + (c + r * Math.sin(t)).toFixed(2);
        }
        out.push(d + "Z");
      }
    });
    return out;
  }
  function Guilloche(p) {
    var size = p.size || 64;
    return h("svg", { className: cx("cb-guilloche", p.className), viewBox: "0 0 " + size + " " + size, width: size, height: size, "aria-hidden": "true", style: p.style },
      rosettePaths(size, p).map(function (d, i) { return h("path", { key: i, d: d }); }));
  }

  /* Button — primary | secondary | hold | ask. `locked` = why it can't be pressed. */
  function Button(p) {
    var v = p.variant || "secondary";
    var rest = omit(p, ["variant", "size", "locked", "icon", "className", "children"]);
    var cls = v === "ask" ? cx("cb-ask", p.className) : cx("cb-btn", "cb-btn-" + v, p.size === "sm" && "cb-btn-sm", p.className);
    var icon = p.icon && G[p.icon] ? G[p.icon]() : null;
    if (p.locked) {
      return h("span", { className: "cb-locked" },
        h("button", Object.assign(rest, { type: "button", disabled: true, className: cx("cb-btn", "cb-btn-" + v, p.size === "sm" && "cb-btn-sm") }), G.lock(), p.children),
        h("span", { className: "cb-locked-why" }, p.locked));
    }
    return h("button", Object.assign({ type: "button" }, rest, { className: cls }), icon, p.children);
  }

  /* StatusMark — six states. Glyph + word, always. */
  var MARK = { "paid": "Paid", "scheduled": "Scheduled", "checking": "Checking", "calling": "Calling", "held": "Held", "needs-you": "Needs you" };
  function StatusMark(p) {
    var s = MARK[p.status] ? p.status : "paid";
    var glyph = s === "paid" ? G.tick() : s === "scheduled" ? G.clock() : s === "calling" ? h("span", { className: "cb-ind" }) : s === "held" ? G.hold() : s === "needs-you" ? G.person() : null;
    var label = p.children || MARK[s];
    return h("span", { className: cx("cb-mark", "cb-mark-" + s), role: "status" }, glyph, s === "checking" ? h("span", { className: "cb-dots" }, label) : label);
  }

  /* Endorsement — the formal mark placed on a document when Callback decides. */
  var END = { held: "Payment held", void: "Void", paid: "Paid", confirmed: "Confirmed by call" };
  function Endorsement(p) {
    var k = END[p.kind] ? p.kind : "held";
    return h("div", { className: cx("cb-endorse", "cb-endorse-" + (k === "void" ? "held" : k), p.animate !== false && "cb-endorse-in"), role: "img", "aria-label": END[k] + (p.meta ? ", " + p.meta : "") },
      h(Guilloche, { size: 44, className: "cb-endorse-seal", lobes: 7, strands: 5 }),
      h("div", null,
        h("div", { className: "cb-endorse-word" }, p.children || END[k]),
        p.meta ? h("div", { className: "cb-endorse-meta" }, p.meta) : null));
  }

  /* SignOff — a person's approval on a signature line, with a guilloche seal. Callback can't sign. */
  function SignOff(p) {
    var st = p.state || "signed";
    return h("div", { className: cx("cb-sign", "cb-sign-" + st) },
      h("div", { className: "cb-sign-line" },
        h("span", { className: "cb-sign-by" }, st === "signed" ? (p.verb || "Approved") : "Sign-off"),
        st === "signed" ? h("span", { className: "cb-sign-name" }, p.name) :
        st === "awaiting" ? h("span", { className: "cb-sign-ghost" }, "Waiting for " + (p.name || "a person")) :
        h("span", { className: "cb-sign-ghost" }, p.reason || "Callback can’t approve its own requests")),
      h(Guilloche, { size: 52, className: "cb-sign-seal", lobes: 8, strands: 6 }),
      h("div", { className: "cb-sign-cap" }, h("span", null, p.role || (st === "locked" ? "Requires controller" : "")), p.time ? h("span", null, p.time) : null));
  }

  /* Amount — integer cents. size "lg" = the courtesy box, padded with protective asterisks. */
  function Amount(p) {
    var c = Math.round(Number(p.cents || 0)), neg = c < 0; c = Math.abs(c);
    var s = Math.floor(c / 100).toLocaleString("en-US") + "." + String(c % 100).padStart(2, "0");
    if (p.size === "lg") {
      var fill = Math.max(2, 12 - s.length);
      return h("span", { className: "cb-courtesy cb-micro", "aria-label": (neg ? "minus " : "") + "$" + s }, h("span", { className: "cb-cur" }, "$"), h("span", { className: "cb-fill", "aria-hidden": "true" }, new Array(fill + 1).join("*")), (neg ? "−" : "") + s);
    }
    return h("span", { className: "cb-amount" }, (neg ? "−" : "") + "$" + s);
  }

  /* AccountLine — a bank account set like a cheque's MICR line. */
  function AccountLine(p) {
    var st = p.state || "verified";
    return h("span", { className: cx("cb-acct", "cb-acct-" + st) },
      h("span", { className: "cb-micr" },
        p.bank ? h("span", { className: "cb-micr-bank" }, p.bank) : null,
        p.routing ? h(React.Fragment, null, G.transit(), h("span", null, p.routing), G.transit()) : null,
        h("span", { className: "cb-micr-digits" }, "··" + (p.last4 || "0000")),
        G.onus()),
      h("span", { className: "cb-acct-note" }, st === "new" ? "Never paid before" : h(React.Fragment, null, G.tick(), p.note || "Verified")));
  }

  /* Cite — a reference to the record a claim came from. */
  function Cite(p) { return h("a", { className: "cb-cite", href: p.href || "#", onClick: p.onClick }, p.children); }

  /* CheckRow — one numbered check. The words that gave it away are marked, not scored. */
  function quoteWith(q, flag) {
    if (!flag || q.indexOf(flag) < 0) return q;
    var i = q.indexOf(flag);
    return [q.slice(0, i), h("span", { key: "f", className: "cb-flag" }, flag), q.slice(i + flag.length)];
  }
  function CheckRow(p) {
    var r = p.result || "pass";
    return h("div", { className: cx("cb-check", "cb-check-" + r), role: "listitem" },
      h("span", { className: "cb-check-n" }, p.n != null ? String(p.n).padStart(2, "0") : ""),
      h("span", { className: "cb-check-glyph", "aria-label": r === "fail" ? "Failed" : r === "warn" ? "Look closer" : "Passed" }, r === "fail" ? G.x() : r === "warn" ? G.q() : G.tick()),
      h("div", { className: "cb-check-body" },
        h("div", { className: "cb-check-title" }, p.title),
        p.evidence ? h("div", { className: "cb-check-ev" }, p.evidence) : null,
        p.quote && r !== "pass" ? h("div", { className: "cb-quote cb-micro" }, "“", quoteWith(p.quote, p.flag), "”") : null,
        r !== "pass" && p.sources && p.sources.length ? h("div", { className: "cb-check-src" }, p.sources.map(function (s, i) { return h(Cite, { key: i }, s); })) : null));
  }

  /* Line — one phone call. The indicator is lit only while the line is open. */
  var LINE = { "ringing": "Ringing", "connected": "On the line", "no-answer": "No answer", "dropped": "Line dropped", "confirmed": "Confirmed", "not-confirmed": "Not confirmed" };
  function Line(p) {
    var st = LINE[p.state] ? p.state : "ringing", live = st === "ringing" || st === "connected";
    var bars = p.bars || [3, 6, 11, 16, 9, 5, 13, 20, 12, 7, 15, 9, 4, 11, 18, 8, 5, 10, 14, 7, 4, 9, 12, 6, 3, 8, 13, 17, 9, 5, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
    return h("div", { className: cx("cb-line", "cb-line-" + st, live && "cb-line-live"), role: "status" },
      h("span", { className: "cb-lamp", "aria-hidden": "true" }),
      h("div", { className: "cb-line-who" }, p.supplier),
      h("div", { className: "cb-line-right" },
        h("div", { className: "cb-line-clock" }, p.elapsed || "––:––"),
        h("div", { className: "cb-line-state" }, p.label || LINE[st])),
      h("div", { className: "cb-line-dial" }, p.number + (p.source ? "  ·  " + p.source : "")),
      p.note ? h("div", { className: "cb-line-note" }, p.note) : null,
      st === "connected" ? h("div", { className: "cb-wave", "aria-hidden": "true" }, bars.map(function (b, i) { return h("i", { key: i, className: b <= 2 ? "cb-quiet" : null, style: { height: Math.max(2, b) + "px" } }); })) : null);
  }

  /* TranscriptLine — one turn of a call. Timecode and source sit in the margin. */
  function TranscriptLine(p) {
    var cb = p.speaker === "callback";
    return h("div", { className: cx("cb-script", cb ? "cb-script-callback" : "cb-script-other") },
      h("div", { className: "cb-margin" }, h("span", { className: "cb-tc" }, p.time), p.cite ? h(Cite, null, p.cite) : null),
      h("div", null,
        h("div", { className: "cb-cue" }, p.name || (cb ? "Callback" : "Supplier"), !cb && p.speaking ? h("span", { className: "cb-ind" }) : null),
        h("div", { className: "cb-dialogue" }, p.children, cb && p.speaking ? h("span", { className: "cb-caret", "aria-hidden": "true" }) : null),
        p.aside ? h("div", { className: "cb-aside" }, p.aside) : null));
  }

  /* LogEntry — a ledger line. Callback's entries are set in mono; people's words in signatory blue. */
  function LogEntry(p) {
    var agent = p.agent || p.actor === "Callback";
    var initials = String(p.actor || "?").split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2);
    return h("div", { className: cx("cb-log", agent ? "cb-log-agent" : "cb-log-person"), role: "listitem" },
      h("span", { className: "cb-log-time" }, p.time),
      h("span", { className: cx("cb-who", agent ? "cb-who-agent" : "cb-who-person"), title: p.actor }, agent ? "CB" : initials),
      h("div", null,
        h("span", { className: "cb-log-what" }, h("b", null, p.actor), " ", p.children),
        p.why ? h("span", { className: "cb-log-why" }, agent ? p.why : "“" + p.why + "”") : null));
  }

  /* InboxRow — one ledger row of the Inbox. */
  function InboxRow(p) {
    return h("a", { href: p.href || "#", onClick: p.onClick, className: cx("cb-ledger-row", p.unread && "cb-ledger-unread", p.status === "calling" && "cb-ledger-live"), "aria-selected": p.selected ? "true" : undefined },
      h("span", { className: "cb-dot", "aria-label": p.unread ? "Unread" : undefined }),
      h("span", { className: "cb-from" }, p.from),
      h("span", { className: "cb-subj" }, h("b", null, p.subject), p.preview ? " — " + p.preview : ""),
      h("span", { className: "cb-r" }, p.cents != null ? h(Amount, { cents: p.cents }) : ""),
      h("span", null, h(StatusMark, { status: p.status })),
      h("span", { className: "cb-when cb-r" }, p.time));
  }

  window.Callback = Object.assign(window.Callback || {}, {
    Button: Button, StatusMark: StatusMark, Endorsement: Endorsement, SignOff: SignOff, Guilloche: Guilloche, Amount: Amount,
    AccountLine: AccountLine, Cite: Cite, CheckRow: CheckRow, Line: Line, TranscriptLine: TranscriptLine, LogEntry: LogEntry, InboxRow: InboxRow
  });
})();
