// Documents and audio logs in rooms (config.roomDocs), part of the story. Where one
// is tells the agent what it can hand the players while they're in that room (when
// they search it, or pull it up on a terminal there); the Warden can give any of them.
// Given, it becomes a handout (session.js "handouts"), everyone's unless it's for one.
//   { id, room, title, text, voice }  voice: "" for a document; else an audio log's
//   speaker (a voice id, or "cast:<id>"), and text is what's said, a line at a time,
//   "NAME: ..." starting someone else's lines (session.js logParts).

export const MAX_ROOM_DOCS = 60;

export function sanitizeRoomDocs(list) {
  const out = [], ids = new Set();
  for (const d of Array.isArray(list) ? list : []) {
    const id = String(d?.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    const room = String(d?.room || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60);
    const title = String(d?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const text = String(d?.text ?? "").replace(/\r/g, "").trim().slice(0, 6000);
    if (!id || ids.has(id) || !room || !title || !text) continue;
    ids.add(id);
    out.push({ id, room, title, text, voice: String(d?.voice || "").slice(0, 60) });
    if (out.length >= MAX_ROOM_DOCS) break;
  }
  return out;
}

export const newRoomDocId = () => `rd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// The default story's (KESTREL-9). The void opened on day 1, 19 days before the crew arrive.
const SALK = "cast:dr-imre-salk", OKONKWO = "cast:administrator-ruth-okonkwo";
export const DEFAULT_ROOM_DOCS = [
  // Med bay: Salk's medical logs, his two patients getting worse; the last, his own first symptoms.
  { id: "salk-day-2", room: "med_bay", voice: SALK, title: "AUDIO LOG: DR. I. SALK, DAY 2", text: `Medical log, Doctor Imre Salk. Day two after the breach.
Two admissions from the drill team. Carys Webb and Pell Ostrand.
Both were at the face when the void opened.
Fever, they say. They say they're burning up.
Their skin reads twelve degrees below normal.
I've put them under warming blankets. Webb laughed at that.
A contaminant in the ice, probably. Probably.` },
  { id: "salk-day-4", room: "med_bay", voice: SALK, title: "AUDIO LOG: DR. I. SALK, DAY 4", text: `Day four.
Webb's core temperature is down another three degrees, and she's awake. Cheerful, even.
She keeps asking me which way the cargo bay is.
Ostrand hasn't spoken since yesterday.
When he does, it's in someone else's rhythm. He finished a sentence of mine before I'd started it.
Okonkwo wants this kept off the open log. I've told her it's a fever.
It is not behaving like a fever.` },
  { id: "salk-day-9", room: "med_bay", voice: SALK, title: "AUDIO LOG: DR. I. SALK, DAY 9", text: `Day nine.
Both patients sleep with their faces to the deck. Toward Deck 3.
I turned Webb's bed around. By morning she had turned it back.
They hum in their sleep. Three notes. The same three notes, both of them.
Petrov came in for a bandage and hummed them too. He didn't notice he was doing it.
Nothing on any slide. No pathogen. Their blood is clean.
Whatever this is, I can't see it.` },
  { id: "salk-day-15", room: "med_bay", voice: SALK, title: "AUDIO LOG: DR. I. SALK, DAY 15", text: `Day fifteen. A personal note. Not for the medical file.
My hands are cold. They have been for two days.
That's exhaustion. I haven't slept properly since the breach.
Webb told me this morning that I'll feel warmer soon. She said it kindly.
There's a ringing when the room is quiet. It isn't quite a ringing.
It's three notes.
I'm sure it's nothing.
I'm sure it's just... I'm tired. That's all it is.` },
  // Cargo bay: Okonkwo stopping Voss from burning it, under directive 7-K.
  { id: "cargo-7k", room: "cargo_bay_deck3", voice: OKONKWO, title: "AUDIO RECORDING: CARGO BAY, DAY 3", text: `VOSS: Recording. Cargo bay, Deck 3. Day three. Administrator Okonkwo present.
VOSS: It's in the power trunk, Ruth. You can see it from here. It's growing along the cable.
OKONKWO: I can see it, Dmitri.
VOSS: Then let me cut the feed. Or burn it off. One drum of refinery fuel and it's done.
OKONKWO: No. Nobody touches it.
OKONKWO: Directive seven-K came through this morning.
If containment fails, HV-CORE seals every deck and preserves the specimen.
VOSS: Preserves it. And the crew?
OKONKWO: The directive says the crew is expendable.
VOSS: You're reading that off the screen like it's a supply order.
OKONKWO: HV-CORE keeps the trunk live. It won't let anyone cut it without my codes, and I'm not giving them out.
VOSS: Then God help whoever they send to fix that reactor.
OKONKWO: Stop the recording, Dmitri.` },
  // Command: Okonkwo's report to Hollis-Vane, and the company sending the convict crew anyway.
  { id: "command-report", room: "command_deck", voice: OKONKWO, title: "COMMS RECORDING: HOLLIS-VANE PRIORITY CHANNEL, DAY 2", text: `OKONKWO: Kestrel-9 to Hollis-Vane operations. Administrator Okonkwo, priority channel.
The drill team breached a void at four hundred metres. Something came out of it. Something alive.
Two crew are sick. I'm requesting evacuation.
And I'm asking you to recall the maintenance tug before it docks.
HOLLIS-VANE: Administrator. Your report is received and classified.
HOLLIS-VANE: The maintenance crew will not be recalled.
OKONKWO: They're convicts on a work order. They don't know what's here.
HOLLIS-VANE: That is why they were selected.
They are expendable, Administrator. Nobody will ask questions if they don't come back.
HOLLIS-VANE: Directive seven-K is now in effect. Preserve the specimen. Evacuation is denied.
OKONKWO: Understood.
OKONKWO: Okonkwo out.` },
  // Reactor access: how to fix it, and where the power is really going (the Deck 3 trunk).
  { id: "reactor-procedure", room: "reactor_access", voice: "", title: "HV-STD 12.4: REACTOR EFFICIENCY RESTORATION", text: `# HOLLIS-VANE STANDARD 12.4
## REACTOR EFFICIENCY RESTORATION

1. Confirm core output at the reactor access console. Rated minimum: **99%**.
2. Service the core: flush the coolant lines, re-seat the moderator rods, recalibrate the regulator. Expected gain: up to 15%.
3. If output is still below rated after service, the loss is **downstream**: power is bleeding off a distribution trunk.
4. Read each deck's trunk draw at **junction panel J** (reactor access, aft wall). A healthy trunk draws under 6%.
5. Clear the fault at the trunk itself, or isolate the trunk: trip its breaker at the junction panel.

> Isolating a trunk cuts power, heat and life support to that deck.

---
**NOTE:** isolation is authorised through the station OS (ADMIN), or by manual breaker at the junction panel.` },
  { id: "marlowe-notes", room: "reactor_access", voice: "", title: "MAINTENANCE NOTES: CHIEF ENGINEER H. MARLOWE", text: `**DAY 6.** Serviced the core again. 85%. That's the best it'll do. Rods are fine. Core is fine.
The loss isn't in here. It's the **Deck 3 trunk**: drawing 29% on panel J and climbing. Nothing on Deck 3 should pull more than 4.

**DAY 11.** Asked HV-CORE to isolate the Deck 3 trunk. ACCESS DENIED. Asked again on my codes. DENIED: "DIRECTIVE 7-K". What the hell is 7-K?

**DAY 13.** Whoever reads this: breaker **J-3** on the junction panel cuts the Deck 3 trunk by hand. HV-CORE can't stop a breaker.
Pull it and Deck 3 goes dark and __cold__.
Or go up to the cargo bay and see what's eating the cable. ~~I'll go tomorrow.~~ I'm not going up there.` },
];
