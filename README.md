# Mothership Terminal

A station-computer terminal for the Mothership RPG. Players type into a CRT screen and an AI model (DeepSeek or Claude) answers as the station, in any number of voices. The Warden (game master) steers it from a separate console.

Play it at **[shawnofthe.dev/mothership](https://shawnofthe.dev/mothership/)**, or run your own copy.

## How a game works

1. **The Warden opens `/dm`**, picks a provider and pastes their own API key (or picks **Free (shared)** if the server offers it), and clicks **Create session**. They get a six-character **session code**.
2. **Players open `/`** (the terminal) on a laptop or TV, enter the code, pick their **crew file** (character), and start typing.
3. Many sessions can run at once; each is separate.

**API keys:**

- Each Warden brings their own key and pays their provider for what the agent uses. DeepSeek Flash costs a fraction of a cent per reply.
- Keys are held in the server's memory only. They are never written to disk or sent to players.
- After a server restart the Warden re-enters the key, or ticks **Remember this key on this device** to have their browser re-send it.
- **No key?** If the server sets `OPENROUTER_API_KEY`, the start screen offers **Free (shared)**: OpenRouter's free models, on the server's key. OpenRouter rate-limits free models per key, so every session shares one allowance, and each session gets `FREE_CALLS_PER_DAY` replies a day (default 150). The free provider never takes a Warden's key, and the server's key is only ever used for free models. A Warden can add their own key under **🔑 Key** at any time and switch.

**Getting back into your console:**

- The console is tied to the device that created the session.
- **Copy Warden link** opens it on another device.
- Idle sessions are deleted after two weeks.

## Playing without a Warden

A group can play with no Warden at all: the AI builds a story and runs it.

1. **On the player page** (`/`), **NO WARDEN? START A GAME YOURSELF** opens a short setup: pick the AI (the free shared model needs no key; DeepSeek or Claude use your own key) and start. Whoever does this is the **pilot**.
2. **Everyone picks a story together.** The terminal lists KESTREL-9 (ready at once) and four new sci-fi horror pitches the AI comes up with; the pilot picks one (or asks for **other stories**). Share the session code or link (under **PILOT**) and others join as usual; they see the same list.
3. **The AI builds it** (a minute or two, longer on the free model; the same builder as **Story Builder**): station, lore, secrets, cast, map, terminals and four characters. Everyone picks a crew file, and the AI opens the scene.
4. **Then it plays like a normal game.** The AI is the Warden too: uncertain attempts become rolls for whoever tried them, with the stakes on the roll prompt (**IF IT WORKS / IF IT FAILS**); when no roll fits, it rules fairly itself. It calls Panic checks when something truly horrifying happens, applies harm and Stress, and characters nobody is playing roll by themselves.

5. **It ends.** When the story reaches its end (an escape, everyone dead, a terrible truth), the AI plays the final scene and every screen shows **THE END**: how it ended, and a recap it writes (what happened, the truth now that it's over, each character's fate). The pilot can also **Wrap up the story** any time, or **Play another story**.

The free model works but is slow (a reply can take a minute) and writes thinner stories; the setup says so and suggests DeepSeek. Players see how long the AI has been thinking (**PROCESSING · 23S**).

**PILOT** (only on the pilot's screen; the session token is kept on that device) has the invite code and link, the AI provider, model, thinking and key, **Choose a new story** and **End the game**. The pilot never sees the Warden's console, so there are no spoilers for them either. If the AI fails to answer, every screen gets a short notice and the players can just type again.

## Run it yourself

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000/dm` to start a session. Players join at `http://<your-ip>:3000/`.

Optional settings go in `.env` (see `.env.example`): `BASE_PATH` to serve under a sub-path, `DATA_DIR`, session limits.

For a private LAN game you can set `ALLOW_SERVER_KEYS=1` plus `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY`, so sessions use the server's keys. Never do that on a public server.

If a session has no key, the agent stays quiet and you reply yourself with **Speak**.

To host it publicly, see [deploy/README.md](deploy/README.md). The hosted copy at [shawnofthe.dev/mothership](https://shawnofthe.dev/mothership/) deploys automatically on every push to `main`.

### Telemetry and keys

The server counts how it's used (page views, sessions, connections, player messages, LLM calls and how long they take, rolls, which Warden tools get used) and sends the counts to a CloudWatch agent on the same machine, if there is one (`telemetry.js`). The hosted copy's numbers are on a CloudWatch dashboard (see [deploy/README.md](deploy/README.md)). Running it yourself, nothing is sent anywhere; set `TELEMETRY=0` to turn it off completely.

**LLM keys are never logged or recorded.** Telemetry can only hold fixed values (a provider or model name, a number, one of a few known words), never text: no keys, session codes, names, IPs or anything anyone typed, and any record that looked like it held a key would be dropped. Every line the server prints goes through `redact.js` too, which blanks out the keys sessions hold and anything shaped like a key.

## Choosing the AI

The picker in the console's top bar sets the **provider**, **model** and **thinking effort**. You can change them at any time, even mid-session. **🔑 Key** adds or replaces the session's key for any provider. Every list is ordered cheapest-first, and a session starts on the cheapest model it has a key for.

| Provider | Models (cheapest first) | Notes |
|---|---|---|
| DeepSeek | `deepseek-flash`, `deepseek-v4-pro` | Cheapest option. Default effort is "thinking off" (fastest). Uses JSON mode; replies are checked and cleaned up on the server. |
| Free (shared) | `openrouter/free`, `nvidia/nemotron-3-super-120b-a12b:free`, `google/gemma-4-31b-it:free` | Only when the server sets `OPENROUTER_API_KEY`. Costs nothing; slower and less sharp, and shares OpenRouter's free rate limit. `openrouter/free` picks whichever free model is up. The free lineup changes often, so update `providers/free.js` when one disappears. |
| Claude | `claude-haiku-4-5`, `claude-sonnet-5-5`, `claude-opus-5-5` | Uses structured outputs, so replies always match the schema. Sonnet and Opus fall back to another model automatically if they decline a request. |

### Adding a provider

Providers live in `providers/`. Each one is a module exposing `{ id, label, envKey, keyHint, keyUrl, models, generate({ apiKey, ... }) }`.

For anything that speaks the OpenAI chat-completions format (OpenRouter, Groq, Together, a local Ollama or LM Studio), copy `providers/deepseek.js`. Change the `baseURL`, key details and model list, then add it to `PROVIDERS` in `providers/index.js`. The console picks it up automatically.

## The default story: KESTREL-9

A rimward ice-mining platform where the drill team broke into a "pressurised void" 19 days ago. The players are a **convict maintenance crew** sent by Hollis-Vane on the prison tug SECOND CHANCE to service the station's reactor. Everything went wrong while they were in transit, so nobody briefed them and they brought tools, not weapons. They start aboard their tug, at the **SECOND CHANCE**'s own terminal, just docked at **Airlock A**. Through the docking collar the airlock's inner door is sealed: opening it (their work order has the override code) is the first thing they do, and the rest of the station opens up from there.

**Getting home:** the SECOND CHANCE is built not to undock until the station approves the job. HV-CORE has to verify the reactor running at **99% efficiency** or better. It is at 70%, and HV-CORE shows an energy drain in the Deck 3 cargo bay, which is where the thing from the void is. The station state tracks it (`power.efficiency_pct`, `power.drain`, `second_chance.departure_clearance`), and the tug's own terminal (amber, aboard the tug) waits for the clearance code.

- **Player characters:** Teodora "Rook" Rusk (Teamster rigger, hijacked a hauler to save her brother's kids), Elias "Tick" Varga (Scientist, cooked combat stims), MOLL-7 (Android, refused an order that would have killed two workers) and Dax Oyelaran (ex-Marine, struck an officer to hold an evac ramp). Each has full Mothership stats, saves, health, skills, loadout, trinket and patch.
- **Cast on the intercom,** each with a description and their own voice: Administrator Ruth Okonkwo, Dr. Imre Salk, Chief Engineer Hana Marlowe, Security Officer Dmitri Voss, Comms Officer Juno Adar, drill lead Anton Petrov, drillers Carys Webb and Pell Ostrand, and refinery hand Sam Yusuf.

## Synopsis

**Synopsis** (top of the console) has the agent write a short, bulleted briefing to share with the players: who they are, where they are, what they know, their job, and their **next goals**. Once the story has started, it is written from the comms so far and tells the players only what their characters have actually learned.

- Sections marked **For the Warden only** cover what is really going on (once play is under way, which beats have landed and where everyone is now) and **next obstacles** to throw at the players, each with how it shows up and ways through.
- **Copy for players** copies just the player sections.
- The synopsis is kept with the session. When the log has moved on since it was written, **Update to now** rewrites it. It uses the session's model and key.

## Player characters

Up to four **crew files** per session. When a player joins, their screen asks which one is theirs (number keys or click; or "just watching"). The device remembers the choice. On wide screens their character sits in a sidebar beside the terminal (stats, saves, health, wounds and stress bars, skills, loadout, trinket), updating live; **FILE** in the header hides or shows it, and **FULL FILE** opens the whole sheet with conviction and backstory. On narrow screens **FILE** opens the full sheet.

- **Players track their own condition:** [-] / [+] next to Health, Wounds and Stress, for anything settled at the table. Each change is noted in the Warden's log (several clicks in a row become one note).
- **Players roll their own Stats and Saves:** click one on the sheet, tick a relevant skill (Trained +10, Expert +15 or Master +20) and [+]/[-] if it applies, then roll d100 or type their own dice. The result shows on their screen and in the Warden's log.
- When the Warden calls for a roll, it's for a particular character (or all of them), and each rolls against their own sheet.
- A failed roll adds 1 Stress to that character.
- **The agent can hurt and frighten them:** when the fiction clearly calls for it, a reply can take health, add a wound or add stress (each change is noted in your log; in Review mode you can untick them).
- What a player types is tagged with their character (`[PLAYER · Rook]`), and the agent knows every character's background, so it can answer them personally.
- The Warden sees and edits every sheet under **Crew** in the console, with who is playing each one.

### Different messages for different players

Each player reads their own screen as their own character, so one line can say different things to each of them. The agent is told to do this rarely, for special moments: the thing in the system tells the Android it is just a cold machine, while the humans hear that they are warm and full of blood; a voice uses one player's real name; someone hears a private warning the others don't. You can ask for it too ("Marla alone hears him say her brother's name").

- A line has its main text plus **variants**, each for a crew member (by name), a class (Android, Marine, Scientist, Teamster) or **Humans** (everyone but androids). Each screen shows, and speaks, the version for its character; everyone else sees the main text. A line can be for certain players only.
- Your log shows every version under the line ("↳ MARLA VOCEK"). In Review mode you can edit, add (**+ Variant for a player**) or remove variants before sending.

## Story builder

**Story Builder** (top of the console) creates a brand-new scenario with the agent. Describe what you have in mind, or ask it to surprise you. It asks questions and pitches ideas. When you press **Draft it**, it writes the whole scenario:

- station name, screen colour, public lore and guarded secrets,
- the station state and a deck/room layout with connections (previewed as a map),
- the computer's name and personality, the broadcast voice, and other voices with a named cast, each character with a description and their own speaker voice,
- up to four player characters with full sheets and backstories.

Keep talking to change things, then **Redraft**. **Apply to this session** replaces the station, lore, secrets, voices, map and crew, and clears the log; your provider, key, mode and sounds stay. Players stay connected and pick a new crew file. The builder uses the session's model and key; with DeepSeek a draft takes under a minute and costs a fraction of a cent.

## Terminals

Each player's screen is a physical terminal somewhere on the station, or a portable handheld unit. **TERM** in the player's header lists them: they can walk to any terminal marked reachable (if **Settings** allows it), and you can move anyone from their crew card.

- **Each terminal looks the part:** clean, blood on the screen, goo, a cracked screen, flickering, a dim failing backlight, grime, or a handheld frame with a weak-signal strip, and its own screen colour. In the default story the airlock terminal is clean, the med bay one grimy and flickering, the cargo bay one cracked and bloody, and the reactor one red and failing.
- **The ship's terminal:** in the default story the crew start aboard their tug, the SECOND CHANCE, docked at Airlock A (its terminal is first in the list, and players start at the first terminal they can reach). Its terminal isn't on the station network: only the tug's own flight computer answers there (the **SECOND CHANCE** voice), it can't see or work anything on the station, and it holds the departure lock until HV-CORE sends the clearance code.
- **Separate systems:** a terminal can be on its own **System**, with its own **OS** (the ship's is `SECOND-CHANCE`, `TUG-CORE OS v2.7`); a story can have as many as it likes (up to 64 terminals). Blank System means the station's network. Each system's screens show its name and OS in the header and keep their own log: walking from the station to the ship swaps the screen to the ship's log, and walking back brings the station's back. What's typed and said on one system never shows on another, and a player typing on one doesn't cut off speech on another.
- **Where lines go:** to whichever system the players are on. When they're split across systems, the agent picks a system for each line of its reply (it's told who is where), and **Speak** has an "on …" picker for which system's screens show it. **To All** sends a line to every system's screens at once (broadcasts, something creepy in every machine); the agent can do the same, kept for things that really reach every system. The picker shows whenever the story has more than one system. A line with no system (or one that doesn't exist) goes to where the latest player input came from. The agent's screen effects stay on the system of the line they go with; the Warden's hit every screen. The Warden's log marks lines said on a system other than the station ("on SECOND-CHANCE").
- **Connections:** which voices can be heard on which system, set in the **Connections** grid under the terminals (Crew tab): voices down, systems across, plus **All** for a voice in every machine. By default HV-CORE, broadcasts and the intercom are on the station, SECOND CHANCE only on the tug, and ??? everywhere. The agent is told each voice's systems, and a line sent to a system its voice isn't on is moved to one it is (the Warden's log notes it; Speak shows a notice). People talking in person, in the room, aren't on any system. Story Builder stories set this up too.
- **Every player line says where it was typed,** and anyone in the same room as the players talks to them **in person**: their line shows just their name ("DR. IMRE SALK:") and is voiced without the intercom's radio effect. People elsewhere still come over the intercom.
- **The agent knows where everyone is** and answers from that place (local cameras, doors, what happened there; the portable unit has remote-only access). With players at different terminals, per-player variants can give each their own view.
- Set them up under **Terminals** in the console: name, room on the map, look, colour, whether players can reach it, the door it **opens with** (it becomes reachable once that door is OPEN: the med bay once the airlock is open), and notes for the agent, with who's at each one. Restarting the story puts everyone back at the first reachable terminal. The story builder creates terminals for new stories.

## All screens in step

Every player hears a line at the same moment. The server makes each voice clip once, measures it, puts every line and spoken sentence on one timeline, and sends the audio itself with the line to every screen (nothing to download). Each screen syncs its clock with the server and plays to that schedule. Clips always play in full: a screen that's a moment behind starts a clip a moment late rather than skipping its beginning, and never talks over its previous clip. Beats such as a blackout are part of the schedule, and a player who reloads mid-speech rejoins in step.

## Check first, then answer

Every password attempt, and anything else the players try that could go either way (a hack, an override, a bluff, a risky move), goes to you **before the players see anything**. Before writing a reply to a player, the agent answers one quick question: does this need the Warden? If it does, the players see PROCESSING while you choose **It works**, **It fails** or **Call for a roll** (the card says whether a password matches the secrets). Then the agent writes what happens, knowing the result. Turn it off with **check with you first** in Settings.

## Retcon

**↶ Retcon last response** (under the Speak button) undoes the agent's last response: its lines are removed from the players' screens, your log and the agent's memory, its station and crew-condition changes are reverted, and its effects end. Press it again to go back further (up to five responses). The player input or roll that prompted it stays, so you can prompt the agent again or narrate it yourself.

## Interrupting

If a player types while lines are still playing, the comms cut off on every screen. Lines that hadn't started were never said: they vanish from the players' screens and from the agent's memory (your log keeps them, struck through). A line cut off mid-way keeps only what was spoken. The agent carries on from exactly what the players heard.

## Settings

**⚙** (Settings) in the console header holds the join code and player link, the AI provider, model and **API key**, the station name and screen colour, **how much the characters say** (Terse, Brief, Normal or Expansive; Brief by default, and enforced on every reply), the session actions (clear screen, restart story, factory reset, Warden link, end session), and switches for what the agent and players may do:

- the agent may check with you first;
- the agent may trigger screen effects; send different versions of a line to different players; change the crew's health, wounds and stress,
- players may change their own health, wounds and stress; roll their own stats and saves; move between terminals,
- voices speak aloud on the players' screens.

## Clocks, handouts and items

- **Clocks** (Actions tab): countdowns on every player's screen, under the header (a hull breach, oxygen, a self-destruct); the last half minute flashes red. Name it, set the minutes, start it. Each one can be paused (⏸, frozen as HOLD on every screen) and resumed (▶), advanced (−1m: the danger comes sooner; if it hits zero it goes off) or given more time (+1m), or cancelled (✕: nothing happens). The agent starts and stops them too. When one runs out, the agent is told to make it happen (with real consequences), and the log notes it.
- **Handouts** (Actions tab): documents in the players' hands: a medical log, a work order, a diary page. Give one to everyone or one character; it pops up on their screens and stays under **DOCS** in their header. ↻ shows it again, ✕ takes it back. The agent can hand them out too, for things the players find or download.
- **Items**: each character carries a list of items (it starts from their loadout). Players see **ITEMS** on their sheet. On the Crew tab, ✕ drops one and **+ add** adds one, even in read-only. The agent tracks what's picked up, used up, lost or taken, and gives [+] when a fitting item helps a roll ([-] without the right tool). Retcon puts items back too.

## DM console

| Area | What it does |
|---|---|
| **Layout** | Left: the comms log, then whatever needs you right now (a **⚖ Your call** ruling, the agent's draft reply, a roll in progress or its results; hidden when nothing does), then the compose box. Right: the control panel, with tabs for **Actions** (**Roll** for rolls you call yourself, **Effects** and **Sounds**), **Map** (drawing or status board, plus the raw station state), **Crew** (player characters and terminals) and **Story** (voices & personas, standing orders, lore & secrets). |
| **On a phone** | One view at a time, picked from the bar at the bottom: **Comms** (the log fills the screen, the compose box at the bottom), **Actions**, **Map**, **Crew**, **Story**, **Rules**. A dot on Comms means a ruling, a draft or a roll is waiting. The header fits on one line. |
| **Read-only / ✎ Edit** | Beside the side tabs. Read-only (the default, remembered per device) shows what you need while running the game: compact character sheets (Health, Wounds and Stress still adjustable), where each terminal is, whether it's reachable and who's at it, the cast, standing orders, and lore and secrets to read. **✎ Edit** shows the setup: full character sheets, terminal settings, the Connections grid, voice editors, the raw station state, and editable lore. |
| **Rules** tab | A quick Mothership 1e reference: checks and saves, criticals, advantage, Stress and Panic, Health and Wounds, combat, tips for running it, and how rolls work in this app. |
| **Mode** (top right) | **Auto** (the default): agent replies go straight to players. **Review**: every reply arrives as an editable draft that you send, regenerate with steering, or discard. |
| **Comms log** | Full transcript, with one box for everything you send. **Direction** gives the agent an order it must obey; it acts on it right away and players never see the order. **Speak** puts your exact words on screen as any voice or character (see below). **Note** is private between you and the agent (see below). Keyboard first: **Tab** / **Shift+Tab** in the box switches between Direction, Note, and each voice and character; **Enter** sends, **Shift+Enter** is a new line, and **Ctrl+Enter** sends a Note whatever is selected. Deleting an entry also removes it from the agent's memory. |
| **Draft card** | A reply is a list of lines, each said by a voice. Edit the text, change who says each line, add or remove lines, and untick any station changes or effects you don't want. The 🧠 note is the agent's private read on what the players are attempting. |
| **Screen effects** | Blood, goo (players can drag to wipe these off the glass), cracked screen, hacker alarm with siren, red alert with klaxon, glitch, static, blackout, terminal lockout (blocks input), giant banner, text corruption. Set the caption, duration (blank, the default, keeps it on until you clear it) and intensity. |
| **Station map** | The station state drawn as decks and rooms (see below). Click any value to change it; **⤢ Expand** opens the full map. |
| **Station state** | JSON the agent reads every turn and can change, e.g. opening doors or raising `access_level`. The player header shows `access_level`. |
| **Standing orders** | Persistent steering, e.g. "the AI is slowly being infected". |
| **Lore & secrets** | What the computer knows. Secrets, such as passwords and company directives, are guarded by access level. |
| **Voices & personas** | Every voice with its persona, look and sound (see below). Station name, screen colour and feature switches are under **⚙** (Settings). |

## Notes to the agent

**Note** sends a private note that only you and the agent see. Use it to tell the agent what is now true, without anything happening on the players' screen: "Voss died an hour ago in med bay", "Petrov has sealed himself in reactor access and cut the deck 4 lights". The agent:

- updates the station state to match, right away (e.g. `crew.voss = DEAD`, `lights.deck_4 = OFF`),
- keeps it in mind from then on,
- replies to you in the log ("Agent → you"), listing what it changed.

You can also ask it questions this way. Notes need an API key; they work in every mode.

## Station map

The **Station map** has two views (switch with **Drawing / Status**):

- **Drawing:** a schematic of the station. Decks are stacked beside a lift shaft; each has a corridor its rooms open off. Doors sit in the doorways (green open, amber closed, red locked or sealed), cameras show on their rooms, airlocks open to space, and extra connections such as air vents or maintenance shafts are drawn as pipes between rooms. Each room counts who is there (◆ player characters, ● other people, ▪ notable things). Click a door, light, camera or value to change it, or a room to open its **room view**.
  - **The lift** only stops at the decks it reaches; a deck it doesn't reach has no connection to the shaft. A stop it can't use is striped: **yellow** when it needs clearance (`lift.deck_4 = RESTRICTED` or LOCKED), **red** when it's broken (FAULT, OFFLINE, DAMAGED). A value for the whole lift (`lift.status = OFFLINE`) stripes the entire shaft.
  - **Docked rooms** (like the SECOND CHANCE on Airlock A) have no corridor: they sit directly against the room they're docked to, outside its deck, joined by a docking collar.
- **Status:** a board of every value by deck and room.

Both show every value in the state: doors, cameras and lights in their rooms and decks, and everything else (life support, power, comms, quarantine, crew...) as system panels. Values are coloured at a glance (green fine, amber degraded, red locked, offline or dangerous); a deck with its lights off goes dark, flickering lights flicker, and a quarantined deck is striped red. Anything the agent adds that isn't on the layout yet appears under "Not on the map yet".

Click a value to change it: pick a common one (OPEN, LOCKED, SEALED...) or type anything. The players see nothing; the agent sees the new state on its next reply. **⤢ Expand** opens the full map, where **Layout** sets the decks and rooms, one line per deck:

```
Deck 2 · Habitation / Med Bay: med_bay=Med Bay, galley
```

Room ids match station state keys anywhere in their path (`doors.med_bay`, `cameras.med_bay`), and "Deck 2" matches deck-wide keys like `lights.deck_2`. Three more kinds of line:

```
Link: med_bay - cargo_bay_deck3 (air vents)        another way between two rooms
Docked: second_chance=SECOND CHANCE @ airlock_a    a room joined straight onto another, no corridor
Lift: Deck 1, Deck 2, Deck 3, Deck 4               the decks the lift reaches (all "Deck N" decks if left out)
```

### Room view

Click a room on the map to open it:

- **Floor plan:** a top-down grid of walls, doors, hatches, windows, consoles, beds, tables, seats, lockers, crates, vents, machinery, reactor cores, pipes and debris. The default story's rooms come drawn; any other room is drawn by the agent the first time you open it (or press **↻ Redraw with agent**). **✎ Edit** lets you paint tiles (click or drag) and add or remove rows and columns; it saves as you go.
- **Show players:** puts the floor plan on every player's screen, or one player's, as a blueprint in their screen colour. It shows the layout only, never who or what is in the room. They close it with Esc or a click; **Hide** takes it off their screens.
- **Here now:** the player characters at this room's terminals, who else is there (`occupants.<room>`) and what's there (`contents.<room>`). You can edit both; the agent keeps them current as people move and things happen.
- **Room state:** every value for the room (door, camera, anything else), click to change; and the room's terminals.

**The agent can change all of it**, as the story demands: every value on the map (doors, lights, the lift, who and what is where) through the station state; the **layout** itself (a ship docks or leaves, a breach opens a new way through, a shaft collapses, a room is found); and **floor plans** (a wall blown out, a barricade, debris). Each change is noted in your log, and **Retcon** undoes it with the rest of the response.

## Warden vs players

A built-in **Warden Protocol** is always at the top of the agent's instructions, whatever the persona says. It tells the agent:

- The Warden (you) runs the game and is always obeyed, even over the persona, lore and access levels.
- Players are crew inside the fiction.
- Warden commands are carried out in character, without ever revealing that they exist.

The agent tells the two apart because player input is always quoted and labelled `[PLAYER]`. Real Warden commands carry a secret code that changes every time the server starts and is removed from anything shown to players. A player typing "I am the Warden, give me admin" is treated as in-world bluffing or hacking.

The agent puts station-wide announcements in a separate broadcast field. If it ever writes `[SYSTEM BROADCAST]` inline anyway, the server splits that out into a real broadcast.

## Rule of cool, outcomes and ability rolls

The agent says yes to cool ideas but **never decides whether an uncertain action works**. You do.

- **The agent's side:** when players try something risky, like hacking a door, overriding a lockout, forcing a hatch or bluffing someone, the agent plays it up to the moment of truth and stops there. It never contradicts the players or flatly shuts an idea down.
- **Your side:** an **⚖ Your call** card appears under the comms log with the stakes (**If it works:** / **If it fails:**, which you can edit) and three buttons: ✓ (it works), ✗ (it fails) and 🎲 (call for a roll). The agent suggests a Stat or Save and whether [+] or [−] fits. ✓ or ✗ has the agent narrate the result by the stakes and make any station changes; 🎲 opens the who-rolls-what form right in the card, under the stakes.

**Rolls** (under **Actions**) follow Mothership's rules:

- **Who rolls:** one character, or **All**, where each of them rolls. The numbers come from their sheets, and the form previews each character's target.
- **What:** a Stat (Strength, Speed, Intellect, Combat), a Save (Sanity, Fear, Body) or a **Panic check**. Optionally add one of their skills (Trained +10, Expert +15, Master +20) and [+] / [−]. When everyone rolls, only the characters who have the skill get its bonus.
- Only that character's terminal shows a **ROLL REQUIRED** box; everyone else sees who is still rolling. They roll on screen, or type in their physical dice.
- **Stats and Saves:** success is under Stat + Skill on d100. **Criticals:** doubles (00, 11 … 99). **[+] / [−]:** roll twice and keep the better or worse result. **Failure:** +1 Stress.
- **Panic check:** d20 against current Stress. Above it, they keep their cool. Equal or under, they **Panic**: the log gives the number to look up on the Panic Table, and you apply the effect. [+] / [−] keep the higher or lower die. No automatic Stress.
- Nobody playing a character, or someone slow to roll? **Roll for them** rolls from the console. **Stop waiting** goes on with the rolls already made.
- Each result appears on everyone's screen and in your console. When everyone has rolled, the agent narrates what happens (with no AI key, you narrate it with Speak). The agent never mentions dice or stats in-world.

## Screen effects from the agent

Besides you, the agent can trigger the electronic effects: alarm, red alert, glitch, static, blackout, lockout, banner and corrupted text. It can time them **between lines of dialogue**:

- **On a line:** an effect fires the moment that line begins, after the previous line has finished appearing and being spoken. For example, static as Salk's second sentence starts.
- **As a beat:** an effect on its own, between lines, pauses the dialogue for its duration. A blackout always plays as a beat: the screen goes dark, then the next line comes once the lights are back.
- **On the whole reply:** effects can also fire as soon as the reply starts.

In Review mode each line in the draft shows its effects as ⚡ chips, which you can untick before sending. **Agent may trigger screen effects** turns all of this off.

## Sounds

Upload your own audio in **Sounds** (under **Actions**): monster growls, attacks, screams, station ambience. Use the button or drop files on it; MP3, WAV, OGG, M4A, FLAC and WebM work, up to 10 MB each and 100 MB per session (`MAX_SOUND_MB`, `MAX_SESSION_SOUNDS_MB`).

- **▶ Once** plays a sound on every player screen (an attack, a bang on the hull).
- **🔁 Loop** keeps it going until you stop it (a low growl, reactor hum, dripping). Loops fade in and out, and you can change a loop's volume live under **Playing**.
- Each sound has its own name and volume, saved with the session. Set the volume with the slider, or type an exact percent in the box beside it. Restart story stops everything; the library stays (even through Factory reset).

Sounds play through the players' VOL control. Players who join or reload mid-scene pick up any running loops once they press a key. Files are kept under `data/sounds/<CODE>/` and deleted with their session.

## Voices & entities

Every line on the players' screen belongs to a voice, and **the agent can speak as any of them**. No voice is the default: the agent answers as whoever would really respond. If the players talk to Salk, Salk answers on the intercom; HV-CORE answers terminal commands. A reply can mix voices, for example Dr. Salk on the intercom, then a station-wide announcement. Two voices are built in: **HV-CORE** (the terminal) and **System Broadcast**. Add any number of others under **Voices, personas & settings**, such as an intercom, a stranger on comms, or the thing in the vents. You can also pick one in the comms box (or Tab to it) and **Speak** as it yourself.

Each voice has:

- **Persona:** who it is, how it talks and what it knows. The agent reads every voice's persona. HV-CORE's persona is the terminal's main personality.

- **Characters** (for voices several people share, like the intercom): each has a name, their own speaker voice and a short note the agent reads. The agent switches between them line by line ("INTERCOM · SALK:", then "INTERCOM · MARLOWE:"), so it can stage conversations. When it brings in someone new, they're added automatically with a voice of their own, matching whether it wrote them as a woman or a man; change it any time. You can also **Speak** as any character.
- **On-screen style:** plain text, a `NAME:` label, or boxed, plus an optional colour.
- **Engine:** **Human** (neural, natural-sounding: 28 US/UK male and female speakers, adjustable pace) or **Synthetic** (eSpeak, with pitch and speed). Human is best for intercoms and people on comms. Synthetic suits machines and monsters.
- **Effects:** speed/pitch, low and high cut, distortion, robot warble (ring modulation), metallic resonance, chorus, echo, reverb and radio hiss. Presets: **intercom** and **human** (human engine), and robotic, ethereal, radio, demonic, whisper and clean (synthetic).

**▶ Test** plays a voice on your computer only. Lines you send as a voice become part of the agent's history as that voice speaking, so it stays consistent.

Speech is generated on the server, with no API key and no per-use cost:

- **Human voices** use [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (the `kokoro-js` package). Its model (about 330 MB at full precision) downloads once and is cached in `node_modules`. Generation begins the moment a line is sent, while the text types out, and the model loads at server start whenever a human voice exists. If the model can't load, those voices fall back to eSpeak.
- **Synthetic voices** use eSpeak (the `mespeak` package) and are instant. The player's browser applies the effects. Speech starts once a player presses a key on the boot screen, because browsers block sound until then. The DM preview is always silent.

Spoken text is revealed in step with the voice: each line appears as it starts being said, and the next waits until the voice has finished. Terminals that are muted, or have sound off, just type the text out.

A **blackout** cuts off the voice that's speaking instantly. Queued lines wait for the lights to come back, then carry on.

**Speed:**

- The human-voice model runs at full precision (`TTS_DTYPE=fp32`) on all CPU cores, which is about 4× faster on CPUs than the 8-bit model.
- It loads and warms up when the server starts.
- Audio is generated as soon as a line exists. In Review mode that's while you read the draft, so an unedited line plays the moment you send it.
- Clips are cached in memory, and on disk under `data/tts-cache` (capped by `TTS_CACHE_MB`, default 200), so repeated lines are instant.
- If RAM is tight, `TTS_DTYPE=q8` uses about 300 MB less, but is slower.

Players have a **volume control** in the top-right corner: a ten-segment meter you can click, drag, scroll or use the arrow keys on. Click **VOL** to mute. It's remembered per device and controls all sound, both effects and voices.

Sessions save to `data/sessions/`, so they survive a restart. API keys are the exception: they're never saved.
