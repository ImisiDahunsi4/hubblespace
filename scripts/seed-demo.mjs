#!/usr/bin/env node
/**
 * Seed the HubbleSpace demo: two lived-in spaces with a fictional cast and
 * ~3 days of staggered history, synchronized with demo-script-hubblespace.md.
 *
 *   node scripts/seed-demo.mjs          # wipe managed slugs + reseed
 *   node scripts/seed-demo.mjs --wipe   # wipe only
 *
 * Uses anonymous entity access (verified on this deployment). Timestamps are
 * app-level fields, so history is genuinely backdated.
 */
import { createClient } from "@base44/sdk";

const APP_ID = process.env.VITE_BASE44_APP_ID || "6ade2063a43a5acbc2adbd10";
const base44 = createClient({ appId: APP_ID });
const WIPE_ONLY = process.argv.includes("--wipe");

const HOUR = 3600_000, DAY = 24 * HOUR;
const now = Date.now();
const ago = (ms) => now - ms;
const inDays = (d) => now + d * DAY;

const MANAGED_SLUGS = /^(smoke-test|the-crew|the-build-room)/;
const RELATED = [
  "Member", "Message", "Widget", "ChoiceVote", "AiWrite", "PendingWrite",
  "Deal", "Presence", "Brief", "Recap", "EmailEvent", "AskStream", "Lease",
  "PaintMark", "Vote", "InboundMessage", "Link",
];

async function retry(fn, label) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const wait = e?.status === 429 && i < 6 ? 15000 * (i + 1) : null;
      if (!wait) throw e;
      console.log(`  429 on ${label} — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function wipe() {
  const spaces = await retry(() => base44.entities.Space.list(), "Space.list");
  const targets = spaces.filter((s) => MANAGED_SLUGS.test(s.slug ?? ""));
  for (const space of targets) {
    for (const name of RELATED) {
      try {
        const rows = await retry(() => base44.entities[name].filter({ spaceId: space.id }, undefined, 500), `${name}.filter`);
        for (const row of rows) await retry(() => base44.entities[name].delete(row.id), `${name}.delete`);
      } catch { /* entity may not exist / no rows */ }
    }
    await retry(() => base44.entities.Space.delete(space.id), "Space.delete");
    console.log(`wiped space ${space.slug} (${space.id})`);
  }
  if (!targets.length) console.log("nothing to wipe");
}

const bulk = (name, rows) => retry(() => base44.entities[name].bulkCreate(rows), `${name}.bulkCreate`);

const member = (spaceId, { name, color }, lastSeenAgo) => ({
  spaceId, userId: `seed:${name.toLowerCase()}`, name, color,
  emoji: "", lastSeen: ago(lastSeenAgo),
});

const msg = (spaceId, m, text, agoMs, extra = {}) => ({
  spaceId, widgetId: "global", userId: `seed:${m.name.toLowerCase()}`,
  text, createdAt: ago(agoMs),
  authorName: m.name, authorColor: m.color, promotable: false, ...extra,
});

const widget = (spaceId, w) => ({
  spaceId, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, z: w.z ?? 2,
  rotate: w.rotate ?? 0, data: w.data ?? {},
  createdBy: w.by ? `seed:${w.by.toLowerCase()}` : "seed:maya",
  createdAt: ago(w.agoMs ?? 0),
});

/* ─── space 1: the crew ─────────────────────────────────────────────────── */

const CREW = [
  { name: "Maya", color: "#7c5cff" }, { name: "Jules", color: "#e63da8" },
  { name: "Sam", color: "#3d6eff" }, { name: "Rio", color: "#ff7a3d" },
  { name: "Kenji", color: "#13b8a6" }, { name: "Ash", color: "#c6f750" },
];
const [maya, jules, sam, rio, kenji, ash] = CREW;

function crewMessages(spaceId, decisionWidgetId) {
  return [
    msg(spaceId, maya, "ok I made us a space. everyone get in here", 2 * DAY + 22 * HOUR, { promotable: false }),
    msg(spaceId, jules, "wait this is actually so cute", 2 * DAY + 21 * HOUR + 40 * 60000),
    msg(spaceId, sam, "dragging the countdown up top. six days people", 2 * DAY + 21 * HOUR),
    msg(spaceId, rio, "I can finally see who's bringing what instead of scrolling 400 messages", 2 * DAY + 20 * HOUR),
    msg(spaceId, kenji, "claiming sparkling water before anyone fights me for it", 2 * DAY + 19 * HOUR),
    msg(spaceId, ash, "matcha cake or riot", 2 * DAY + 16 * HOUR),
    msg(spaceId, jules, "voted matcha. ash we're all voting matcha relax", 2 * DAY + 15 * HOUR),
    msg(spaceId, maya, "forwarded the cake receipt to the space's email and it just... made a card", 1 * DAY + 20 * HOUR, { promotable: true }),
    msg(spaceId, rio, "it wrote back $21 each??", 1 * DAY + 19 * HOUR + 50 * 60000),
    msg(spaceId, sam, "paid you just now. the IOU card already updated", 1 * DAY + 19 * HOUR),
    msg(spaceId, kenji, "we should do the japan bookings the same way, forward them to the inbox", 1 * DAY + 18 * HOUR),
    msg(spaceId, jules, "6pm at sam's place friday — locked", 1 * DAY + 9 * HOUR, { promotable: true, promotedWidgetId: decisionWidgetId }),
    msg(spaceId, maya, "pinned that. no take-backs", 1 * DAY + 8 * HOUR),
    msg(spaceId, rio, "might be late, save me cake", 22 * HOUR),
    msg(spaceId, kenji, "added portland and joshua tree to the summer shortlist note", 15 * HOUR),
    msg(spaceId, sam, "ash still hasn't voted on the cake poll", 6 * HOUR),
    msg(spaceId, maya, "he's the only holdout. classic", 5 * HOUR),
    msg(spaceId, jules, "whoever's here tomorrow bring the good speaker", 2 * HOUR),
  ];
}

function crewWidgets(spaceId) {
  return [
    widget(spaceId, { type: "frame", x: 352, y: 48, w: 688, h: 560, z: 0, agoMs: 2 * DAY + 21 * HOUR, data: { title: "Maya's bday", subtitle: "party HQ", deco: "party" } }),
    widget(spaceId, { type: "countdown", x: 372, y: 106, w: 186, h: 262, z: 2, rotate: -1.8, agoMs: 2 * DAY + 20 * HOUR, by: "Sam", data: { event: "maya's bday 🎂", targetDate: new Date(inDays(6)).toISOString().slice(0, 10), startDate: new Date(ago(5 * DAY)).toISOString().slice(0, 10), hyped: ["Maya", "Jules", "Sam", "Kenji"] } }),
    widget(spaceId, { type: "poll", x: 546, y: 122, w: 244, h: 234, z: 4, rotate: 1.3, agoMs: 2 * DAY + 18 * HOUR, by: "Maya", data: { question: "cake flavor?", options: [{ id: "a", label: "matcha", votes: 3, total: 5, voters: ["Maya", "Jules", "Sam"] }, { id: "b", label: "chocolate", votes: 1, total: 5, voters: ["Kenji"] }, { id: "c", label: "tres leches", votes: 1, total: 5, voters: ["Rio"] }], waitingOn: ["Ash"] } }),
    widget(spaceId, { type: "rsvp", x: 814, y: 90, w: 196, h: 250, z: 3, rotate: -1.2, agoMs: 2 * DAY + 17 * HOUR, by: "Jules", data: { title: "who's coming", responses: [{ name: "Maya", status: "yes" }, { name: "Jules", status: "yes" }, { name: "Sam", status: "yes" }, { name: "Kenji", status: "yes" }, { name: "Ash", status: "no" }], waitingOn: ["Rio"], waitingNote: "might be late, save me cake" } }),
    widget(spaceId, { type: "potluck", x: 378, y: 372, w: 392, h: 158, z: 2, rotate: 0.9, agoMs: 2 * DAY + 19 * HOUR, by: "Jules", data: { title: "who's bringing what", kicker: "party prep", tone: "violet", openCount: 2, items: [{ name: "balloons", by: "Jules", claimed: true }, { name: "playlist", by: null, claimed: false }, { name: "sparkling water", by: "Sam", claimed: true }, { name: "candles", by: null, claimed: false }] } }),
    widget(spaceId, { type: "messageWall", x: 806, y: 354, w: 234, h: 248, z: 2, agoMs: 1 * DAY + 22 * HOUR, by: "Jules", data: { title: "birthday messages", messages: [{ from: "Jules", text: "happy almost-bday queen 👑" }, { from: "Kenji", text: "can't wait to celebrate u" }, { from: "Ash", text: "matcha cake or riot" }] } }),
    widget(spaceId, { type: "expenseSplit", x: 1378, y: 314, w: 240, h: 200, z: 3, rotate: 1, agoMs: 1 * DAY + 20 * HOUR, by: "Maya", data: { title: "cake receipt", total: 105, splits: [{ name: "Maya", owes: 0, paid: 105 }, { name: "Jules", owes: 21, paid: 0 }, { name: "Sam", owes: 21, paid: 21 }, { name: "Rio", owes: 21, paid: 0 }, { name: "Kenji", owes: 21, paid: 0 }, { name: "Ash", owes: 21, paid: 0 }] } }),
    widget(spaceId, { type: "jokeRegistry", x: 32, y: 700, w: 300, h: 148, z: 2, agoMs: 2 * DAY + 10 * HOUR, by: "Sam", data: { title: "inside joke hall of fame", jokes: [{ text: "rio in socks incident", votes: 12 }, { text: "sam's 6pm energy", votes: 8 }, { text: "kenji's tahoe voice", votes: 6 }] } }),
    widget(spaceId, { type: "note", x: 32, y: 516, w: 280, h: 160, z: 2, rotate: -2, agoMs: 2 * DAY + 12 * HOUR, by: "Ash", data: { text: "remember when rio got locked out in socks", author: "Ash", tone: "warm" } }),
    widget(spaceId, { type: "sticker", x: 258, y: 104, w: 116, h: 156, z: 12, rotate: -5, agoMs: 2 * DAY + 22 * HOUR, by: "Jules", data: { stickerId: "glad-ur-here" } }),
    widget(spaceId, { type: "note", x: 352, y: 640, w: 260, h: 125, z: 2, agoMs: 15 * HOUR, by: "Kenji", data: { text: "summer shortlist: portland / joshua tree / nowhere", author: "Kenji", tone: "white", kicker: "summer maybe?" } }),
    widget(spaceId, { type: "frame", x: 952, y: 700, w: 430, h: 272, z: 1, agoMs: 1 * DAY + 18 * HOUR, by: "Kenji", data: { title: "japan trip", subtitle: "forward bookings here ✉" } }),
    widget(spaceId, { type: "itinerary", x: 986, y: 748, w: 300, h: 200, z: 2, rotate: 1, agoMs: 1 * DAY + 17 * HOUR, by: "Kenji", data: { title: `japan · ${new Date(inDays(32)).toLocaleDateString("en-US", { month: "short", day: "numeric" })} trip`, days: [{ day: new Date(inDays(32)).toLocaleDateString("en-US", { month: "short", day: "numeric" }), plan: "land HND · ramen night" }, { day: new Date(inDays(34)).toLocaleDateString("en-US", { month: "short", day: "numeric" }), plan: "kyoto day trip" }, { day: new Date(inDays(37)).toLocaleDateString("en-US", { month: "short", day: "numeric" }), plan: "??? — forward the booking" }] } }),
    widget(spaceId, { type: "poll", x: 1392, y: 60, w: 200, h: 170, z: 3, rotate: -1, agoMs: 2 * DAY + 6 * HOUR, by: "Rio", data: { question: "where we ate last sat?", options: [{ id: "a", label: "sam's place", votes: 4, total: 6, voters: ["Maya", "Jules", "Sam", "Kenji"] }, { id: "b", label: "tacos on 4th", votes: 2, total: 6, voters: ["Rio", "Ash"] }] } }),
    widget(spaceId, { type: "poll", x: 1392, y: 290, w: 200, h: 170, z: 3, rotate: 1, agoMs: 2 * DAY + 2 * HOUR, by: "Kenji", data: { question: "friday dinner?", options: [{ id: "a", label: "ramen on 3rd", votes: 3, total: 5, voters: ["Maya", "Rio", "Kenji"] }, { id: "b", label: "sam's place", votes: 2, total: 5, voters: ["Jules", "Sam"] }] } }),
    widget(spaceId, { type: "linkShelf", x: 1064, y: 344, w: 290, h: 145, z: 3, agoMs: 1 * DAY + 12 * HOUR, by: "Maya", data: { title: "saved links", tone: "violet", links: [{ label: "matcha cake recipe", url: "bonappetit.com", by: "Maya" }, { label: "sam's place (maps)", url: "maps.google.com", by: "Sam" }, { label: "party playlist", url: "open.spotify.com", by: "Jules" }] } }),
  ];
}

const DECISION_WIDGET = {
  type: "decision", x: 1064, y: 620, w: 290, h: 155, z: 25, agoMs: 1 * DAY + 8 * HOUR, by: "Sam",
  data: { title: "decision made", detail: "6pm · Sam's place", author: "Sam", source: "promoted from chat", tone: "lime" },
};

/* ─── space 2: the build room ───────────────────────────────────────────── */

const BUILDERS = [
  { name: "Maya", color: "#7c5cff" }, { name: "Sam", color: "#3d6eff" },
  { name: "Alex", color: "#ff7c42" }, { name: "Jordan", color: "#13b8a6" },
  { name: "Priya", color: "#e9369d" }, { name: "Marco", color: "#ffb02e" },
  { name: "Riley", color: "#c9ff3d" },
];
const [bMaya, bSam, bAlex, bJordan, bPriya, bMarco, bRiley] = BUILDERS;

const DROP_1 = "drop-inside-sqlite";
const DROP_2 = "drop-ascii-effectiveness";
const DROP_3 = "drop-local-first";

const DROPPED_LINKS = [
  {
    id: DROP_1, url: "https://sqlite.org/queryplanner.html", domain: "sqlite.org",
    title: "Inside the SQLite query planner",
    description: "How the world's most-deployed database picks a join order — and why the answer is usually 'the obvious one, measured.'",
    imageUrl: "", kind: "article",
    whyItMatters: "We keep reaching for postgres. This is the case for staying embedded until the network forces the issue.",
    questions: [
      { id: "q1", text: "Where does 'just use sqlite' actually break down for us?" },
      { id: "q2", text: "What would make you trust an in-process db in prod?" },
    ],
    status: "ready", batchKey: "demo", droppedBy: "seed:maya", droppedByName: "Maya",
    droppedAt: ago(2 * DAY + 5 * HOUR), voters: ["seed:sam", "seed:alex", "seed:jordan", "seed:priya"], pinned: true,
  },
  {
    id: DROP_2, url: "https://gist.github.com/hubble/ascii", domain: "github.com",
    title: "The unreasonable effectiveness of plain text",
    description: "Thirty years of dotfiles, ledgers and logs argue that boring formats outlive clever ones.",
    imageUrl: "", kind: "article",
    whyItMatters: "Half our tooling is a wrapper around a text file. Worth knowing why that keeps working.",
    questions: [
      { id: "q1", text: "What's the oldest text file you still depend on?" },
      { id: "q2", text: "Where does plain text genuinely lose?" },
    ],
    status: "ready", batchKey: "demo", droppedBy: "seed:alex", droppedByName: "Alex",
    droppedAt: ago(1 * DAY + 10 * HOUR), voters: ["seed:maya", "seed:riley"],
  },
  {
    id: DROP_3, url: "https://localfirst.dev/sync", domain: "localfirst.dev",
    title: "Local-first sync engines, explained",
    description: "CRDTs without the PhD: what 'merge anything, converge anyway' buys you and what it quietly costs.",
    imageUrl: "", kind: "article",
    whyItMatters: "Directly relevant to how this very room stays in sync. Read before Thursday's roundtable.",
    questions: [
      { id: "q1", text: "Which of our side projects secretly wants local-first?" },
      { id: "q2", text: "What's the real failure mode the paper glosses over?" },
    ],
    status: "ready", batchKey: "demo", droppedBy: "seed:priya", droppedByName: "Priya",
    droppedAt: ago(8 * HOUR), voters: ["seed:marco"],
  },
];

function buildRoomMessages(spaceId) {
  const link = (linkId, qid) => `br-pile::link:${linkId}${qid ? `::q:${qid}` : ""}`;
  return [
    msg(spaceId, bMaya, "new space is up. links go in the pile, takes go in the thread", 2 * DAY + 23 * HOUR),
    msg(spaceId, bSam, "finally. my reading backlog has a home that isn't 47 tabs", 2 * DAY + 22 * HOUR),
    msg(spaceId, bAlex, "dropped one already. it summarized itself and left two questions. rude but fair", 2 * DAY + 21 * HOUR),
    msg(spaceId, bJordan, "the sqlite one is genuinely good. planner section especially", 2 * DAY + 20 * HOUR),
    msg(spaceId, bPriya, "ship wall is live. post your thing, even the ugly version", 1 * DAY + 22 * HOUR),
    msg(spaceId, bMarco, "priya shipped before all of us. this is a callout", 1 * DAY + 21 * HOUR),
    msg(spaceId, bRiley, "roundtable question for thursday: how did you break into tech? go answer it", 1 * DAY + 16 * HOUR),
    msg(spaceId, bSam, "keeper note is up — dual-write before you backfill. learned that one the hard way", 1 * DAY + 12 * HOUR),
    msg(spaceId, bMaya, "three days in and the pile already feels like a library we built", 9 * HOUR),
    msg(spaceId, bPriya, "local-first sync post just landed in the pile. required reading for thursday", 8 * HOUR),
    // discussion under the pinned link
    msg(spaceId, bSam, "the join-order section alone is worth the read", 2 * DAY + 18 * HOUR, { widgetId: link(DROP_1) }),
    msg(spaceId, bJordan, "measured > clever. it keeps choosing the boring plan and being right", 2 * DAY + 17 * HOUR, { widgetId: link(DROP_1) }),
    msg(spaceId, bPriya, "this changed my mind about our read path honestly", 1 * DAY + 14 * HOUR, { widgetId: link(DROP_1) }),
    msg(spaceId, bMaya, "breaks down the second you need multi-writer. which is... us, eventually", 1 * DAY + 13 * HOUR, { widgetId: link(DROP_1, "q1") }),
    msg(spaceId, bAlex, "that's exactly where I'd still trust it. single writer, many readers", 1 * DAY + 12 * HOUR, { widgetId: link(DROP_1, "q1") }),
    // roundtable replies
    msg(spaceId, bMarco, "got in through it support, wrote scripts to make the tickets stop", 20 * HOUR, { widgetId: "br-table" }),
    msg(spaceId, bRiley, "neovim config got so elaborate it became a portfolio", 19 * HOUR, { widgetId: "br-table" }),
  ];
}

function buildRoomWidgets(spaceId) {
  return [
    widget(spaceId, { type: "frame", x: 48, y: 64, w: 760, h: 420, z: 0, agoMs: 2 * DAY + 23 * HOUR, by: "Maya", data: { title: "the pile", subtitle: "everything anyone dropped", deco: "outline" } }),
    widget(spaceId, { type: "linkPile", x: 88, y: 148, w: 680, h: 300, z: 8, agoMs: 2 * DAY + 23 * HOUR, by: "Maya", data: { title: "the pile", cta: "open reading room", dropped: DROPPED_LINKS } }),
    widget(spaceId, { type: "frame", x: 850, y: 48, w: 700, h: 400, z: 0, agoMs: 2 * DAY + 22 * HOUR, by: "Sam", data: { title: "hot now", subtitle: "what the room is actually reading", deco: "outline" } }),
    widget(spaceId, { type: "hotLinks", x: 886, y: 112, w: 628, h: 300, z: 8, agoMs: 2 * DAY + 22 * HOUR, by: "Sam", data: { title: "hot now", limit: 3 } }),
    widget(spaceId, { type: "frame", x: 850, y: 470, w: 700, h: 210, z: 0, agoMs: 1 * DAY + 13 * HOUR, by: "Sam", data: { title: "keepers", subtitle: "what we actually learned", deco: "outline" } }),
    widget(spaceId, { type: "note", x: 886, y: 512, w: 320, h: 150, z: 8, rotate: -1.2, agoMs: 1 * DAY + 12 * HOUR, by: "Sam", data: { kicker: "rule of thumb", title: "dual-write before you backfill", text: "four phases, never a big-bang cutover: dual write, backfill, dual read, drop.", author: "Sam", tone: "white", pin: true } }),
    widget(spaceId, { type: "note", x: 1222, y: 512, w: 320, h: 150, z: 8, rotate: 1.4, agoMs: 2 * DAY + 17 * HOUR, by: "Sam", data: { kicker: "mental model", title: "sqlite until the network says no", text: "postgres is usually a network decision, not a data one.", author: "Maya", tone: "white", pin: true } }),
    widget(spaceId, { type: "frame", x: 48, y: 570, w: 760, h: 380, z: 0, agoMs: 1 * DAY + 22 * HOUR, by: "Priya", data: { title: "shipping wall", subtitle: "show the thing", deco: "outline" } }),
    widget(spaceId, { type: "shipPost", x: 84, y: 632, w: 222, h: 282, z: 8, rotate: -1.4, agoMs: 1 * DAY + 21 * HOUR, by: "Priya", data: { title: "perf dashboard v2", by: "priya", date: new Date(ago(1 * DAY + 21 * HOUR)).toLocaleDateString("en-US", { month: "short", day: "numeric" }), body: "Rebuilt the latency panel on the new rollup table. p95 query went 1.4s → 90ms.\n\nStill rough: the date picker resets on refresh." } }),
    widget(spaceId, { type: "shipPost", x: 328, y: 626, w: 222, h: 282, z: 8, rotate: 0.9, agoMs: 1 * DAY + 9 * HOUR, by: "Jordan", data: { title: "search revamp", by: "jordan", date: new Date(ago(1 * DAY + 9 * HOUR)).toLocaleDateString("en-US", { month: "short", day: "numeric" }), feedbackWanted: true, body: "Ripped out the LIKE query and put a real index behind it.\n\nWant a second opinion on whether recency should outrank relevance." } }),
    widget(spaceId, { type: "frame", x: 850, y: 705, w: 700, h: 310, z: 0, agoMs: 1 * DAY + 16 * HOUR, by: "Riley", data: { title: "roundtable", subtitle: "the long threads", deco: "outline" } }),
    widget(spaceId, { type: "roundtable", x: 886, y: 752, w: 628, h: 250, z: 8, agoMs: 1 * DAY + 16 * HOUR, by: "Riley", data: { category: "career", title: "how did you break into tech?", body: "two answers in. keep them coming." } }),
  ];
}

/* ─── run ───────────────────────────────────────────────────────────────── */

async function seed() {
  const crewId = (await retry(() => base44.entities.Space.create({
    name: "the crew", type: "ongoing", icon: "✦", color: "#e9369d",
    slug: "the-crew", tagline: "your people, in one place",
    createdAt: ago(3 * DAY), lastActivityAt: ago(2 * HOUR),
  }), "Space.create")).id;

  const decision = (await bulk("Widget", [widget(crewId, DECISION_WIDGET)]))[0];
  await bulk("Member", CREW.map((m, i) => member(crewId, m, [2 * HOUR, 1 * HOUR, 40 * 60000, 9 * HOUR, 3 * HOUR, 20 * HOUR][i])));
  await bulk("Widget", crewWidgets(crewId));
  await bulk("Message", crewMessages(crewId, decision.id));
  console.log(`seeded "the crew" → ${crewId} (#/space/the-crew)`);

  const roomId = (await retry(() => base44.entities.Space.create({
    name: "the build room", type: "ongoing", icon: "</>", color: "#ff7c42",
    slug: "the-build-room", tagline: "seven engineers, one reading list",
    createdAt: ago(3 * DAY), lastActivityAt: ago(8 * HOUR),
  }), "Space.create")).id;

  await bulk("Member", BUILDERS.map((m, i) => member(roomId, m, [1 * HOUR, 3 * HOUR, 30 * 60000, 5 * HOUR, 8 * HOUR, 2 * HOUR, 26 * HOUR][i])));
  await bulk("Widget", buildRoomWidgets(roomId));
  await bulk("Message", buildRoomMessages(roomId));
  console.log(`seeded "the build room" → ${roomId} (#/space/the-build-room)`);
}

await wipe();
if (!WIPE_ONLY) await seed();
console.log(WIPE_ONLY ? "wipe complete" : "demo seed complete — run again anytime to reset");
