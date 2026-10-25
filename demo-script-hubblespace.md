# HubbleSpace — demo video script (~2:40)

Adapted from `demo-script`. Every beat lists **what's on screen** so the
recording stays in sync. All spaces are live data — reset anytime with
`node scripts/seed-demo.mjs`.

- Live URL: `https://hubblespace-c2adbd10.base44.app`
- Space A: `#/space/the-crew` — six friends, Maya's birthday week
- Space B: `#/space/the-build-room` — seven engineers, a shared reading pile

---

## Act 0 — cold open (0:00–0:12)

**On screen:** `#/about` hero — "Your people. Your plans. Your space."

[00:00:00] Remember MySpace? We used to spend all night making our pages perfect —
and now it's just ads and strangers.
[00:00:06] And your top friends? They're a wall of group chats. Good luck
keeping up with that.
[00:00:10] We built HubbleSpace — a little corner of the internet that's
actually yours.

## Act 1 — what it is (0:12–0:40)

**On screen:** `#/space/the-crew` — pan the canvas slowly. Land on the
birthday frame: countdown, cake poll, RSVP, potluck.

[00:00:12] Whether it's planning something or just staying in each other's
lives, it's all there — over thirty widgets, so a space can fit your group,
not the other way around.
[00:00:27] And it's as simple as dragging a card onto the board.

**Beat:** drag the "summer shortlist" note a few inches — it moves live.

[00:00:30] Everything shows up for everyone, instantly. Nothing refreshes —
it's always live.

**Beat:** point at the member faces / presence in the corner.

[00:00:37] You can see who's here right now, watch their cursors move.
Long distance? You can sit and color together anyway.

## Act 2 — it keeps up when you're away (0:40–1:00)

**On screen:** still `the-crew`. Hover the message wall, then the itinerary
frame ("japan trip").

[00:00:40] Every space has its own address too — you can email it anything.
A letter lands as an envelope on the board.
[00:00:52] And if you're gone for a week, it catches you up — one recap,
not four hundred messages.

## Act 3 — the receipt story (1:00–1:20)

**On screen:** `the-crew`, scroll right to the **"cake receipt"** expense
card. Chat thread on screen shows Maya's message: *"forwarded the cake
receipt to the space's email and it just... made a card."*

[00:01:00] Okay — real scenario. I paid for the cake, dropped the receipt
in the group chat, and nobody paid me back.
[00:01:06] So I forwarded it to the space. And that's it — it made the card.
[00:01:12] Twenty-one dollars each, and everyone can see who still owes.
[00:01:16] Every space has its own inbox. Receipts, bookings, letters —
they all land on the board.

**Beat:** point at the itinerary card — "??? — forward the booking."

## Act 4 — promoted decisions (1:20–1:35, new beat)

**On screen:** `the-crew` chat — Jules's message *"6pm at sam's place
friday — locked"* and the lime **"decision made"** card beside it.

[00:01:20] And when the chat finally agrees on something, it doesn't have
to get buried. Promote the message and it becomes a card — "6pm, Sam's
place" — pinned where nobody can miss it.
[00:01:32] The board remembers, so the group chat doesn't have to.

## Act 5 — the build room (1:35–2:10)

**On screen:** `#/space/the-build-room` — the pile (three link cards
fanned out), hot-now list, keeper notes, shipping wall, roundtable.

[00:01:35] And then there's my other space — the build room. Seven of us,
all engineers, where we swap articles and papers to keep learning.
[00:01:44] Someone drops a link, and the space reads it — boils it down to
a summary and leaves two discussion questions under it. So we actually
talk about what we read.

**Beat:** open the pinned "Inside the SQLite query planner" card — show the
summary, the two questions, and the thread replies under it.

[00:01:55] When we're done, the one takeaway gets pinned — "dual-write
before you backfill" — and that one stays forever.
[00:02:04] There's a shipping wall for what people made, and a roundtable
for the long threads.

## Act 6 — why it works + sign-off (2:10–2:40)

**On screen:** back to `#/space/the-crew`, slow zoom out; then `#/outro`
end card (new mark, "hubblespace", "live now · no signup").

[00:02:10] The whole thing is one live surface — she can color on her
phone and I watch it happen on my laptop, same second.
[00:02:20] We built HubbleSpace for our friends first. Then we figured
yours might want one too.
[00:02:28] It's live, there's no signup — go put something on a space.
[00:02:36] Thank you.

---

## Recording notes

- **Reset before each take:** `node scripts/seed-demo.mjs` restores exact
  state (same slugs, same cards).
- Cast is fictional: crew = Maya, Jules, Sam, Rio, Kenji, Ash; build room =
  Maya, Sam, Alex, Jordan, Priya, Marco, Riley. Timestamps are backdated
  ~3 days.
- If you want a "live cursor" beat, open the space in a second browser
  window and move it — presence is real, not faked.
- Don't show `#/about`'s under-the-hood detail or any lab route in the
  video; the script above never needs them.
