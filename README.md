# Mothership Terminal

A station-computer terminal for the Mothership RPG. Players type into a CRT screen and an AI model (DeepSeek or Claude) answers as the station, in any number of voices. The Warden (game master) steers it from a separate console.

Play it at **[shawnofthe.dev/mothership](https://shawnofthe.dev/mothership/)**, or run your own copy.

## How a game works

1. **The Warden opens `/dm`**, picks a provider and pastes their own API key, and clicks **Create session**. They get a six-character **session code**.
2. **Players open `/`** (the terminal) on a laptop or TV, enter the code, pick their **crew file** (character), and start typing.
3. Many sessions can run at once; each is separate.

**API keys:**

- Each Warden brings their own key and pays their provider for what the agent uses. DeepSeek Flash costs a fraction of a cent per reply.
- Keys are held in the server's memory only. They are never written to disk or sent to players.
- After a server restart the Warden re-enters the key, or ticks **Remember this key on this device** to have their browser re-send it.

**Getting back into your console:**

- The console is tied to the device that created the session.
- **Copy Warden link** opens it on another device.
- Idle sessions are deleted after two weeks.

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

If a session has no key, the console still works in **Manual** mode and you type every reply.

To host it publicly, see [deploy/README.md](deploy/README.md).

## Choosing the AI

The picker in the console's top bar sets the **provider**, **model** and **thinking effort**. You can change them at any time, even mid-session. **🔑 Key** adds or replaces the session's key for any provider. Every list is ordered cheapest-first, and a session starts on the cheapest model it has a key for.

| Provider | Models (cheapest first) | Notes |
|---|---|---|
| DeepSeek | `deepseek-flash`, `deepseek-v4-pro` | Cheapest option. Default effort is "thinking off" (fastest). Uses JSON mode; replies are checked and cleaned up on the server. |
| Claude | `claude-haiku-4-5`, `claude-sonnet-5-5`, `claude-opus-5-5` | Uses structured outputs, so replies always match the schema. Sonnet and Opus fall back to another model automatically if they decline a request. |

### Adding a provider

Providers live in `providers/`. Each one is a module exposing `{ id, label, envKey, keyHint, keyUrl, models, generate({ apiKey, ... }) }`.

For anything that speaks the OpenAI chat-completions format (OpenRouter, Groq, Together, a local Ollama or LM Studio), copy `providers/deepseek.js`. Change the `baseURL`, key details and model list, then add it to `PROVIDERS` in `providers/index.js`. The console picks it up automatically.

## The default story: KESTREL-9

A rimward ice-mining platform where the drill team broke into a "pressurised void" 19 days ago. The players are a **convict maintenance crew** sent by Hollis-Vane on the prison tug SECOND CHANCE to fix a minor comms fault. Everything went wrong while they were in transit, so nobody briefed them and they brought tools, not weapons.

- **Player characters:** Teodora "Rook" Rusk (Teamster rigger, hijacked a hauler to save her brother's kids), Elias "Tick" Varga (Scientist, cooked combat stims), MOLL-7 (Android, refused an order that would have killed two workers) and Dax Oyelaran (ex-Marine, struck an officer to hold an evac ramp). Each has full Mothership stats, saves, health, skills, loadout, trinket and patch.
- **Cast on the intercom,** each with a description and their own voice: Administrator Ruth Okonkwo, Dr. Imre Salk, Chief Engineer Hana Marlowe, Security Officer Dmitri Voss, Comms Officer Juno Adar, drill lead Anton Petrov, drillers Carys Webb and Pell Ostrand, and refinery hand Sam Yusuf.

## Player characters

Up to four **crew files** per session. When a player joins, their screen asks which one is theirs (number keys or click; or "just watching"). The device remembers the choice. On wide screens their character sits in a sidebar beside the terminal (stats, saves, health, wounds and stress bars, skills, loadout, trinket), updating live; **FILE** in the header hides or shows it, and **FULL FILE** opens the whole sheet with conviction and backstory. On narrow screens **FILE** opens the full sheet.

- **Players track their own condition:** [-] / [+] next to Health, Wounds and Stress, for anything settled at the table. Each change is noted in the Warden's log (several clicks in a row become one note).
- **Players roll their own Stats and Saves:** click one on the sheet, tick a relevant skill (Trained +10, Expert +15 or Master +20) and [+]/[-] if it applies, then roll d100 or type their own dice. The result shows on their screen and in the Warden's log.
- When the Warden calls for a roll, the player's Stat or Save is filled in from their file.
- A failed roll adds 1 Stress to that character.
- **The agent can hurt and frighten them:** when the fiction clearly calls for it, a reply can take health, add a wound or add stress (each change is noted in your log; in Review mode you can untick them).
- What a player types is tagged with their character (`[PLAYER · Rook]`), and the agent knows every character's background, so it can answer them personally.
- The Warden sees and edits every sheet under **Crew** in the console, with who is playing each one.

### Different messages for different players

Each player reads their own screen as their own character, so one line can say different things to each of them. The agent is told to do this rarely, for special moments: the thing in the system tells the Android it is just a cold machine, while the humans hear that they are warm and full of blood; a voice uses one player's real name; someone hears a private warning the others don't. You can ask for it too ("Marla alone hears him say her brother's name").

- A line has its main text plus **variants**, each for a crew member (by name), a class (Android, Marine, Scientist, Teamster) or **Humans** (everyone but androids). Each screen shows, and speaks, the version for its character; everyone else sees the main text. A line can be for certain players only.
- Your log shows every version under the line ("↳ MARLA VOCEK"). In Review mode you can edit, add (**+ Variant for a player**) or remove variants before sending.

## Story builder

**✎ Story builder** (top of the console) creates a brand-new scenario with the agent. Describe what you have in mind, or ask it to surprise you. It asks questions and pitches ideas. When you press **Draft it**, it writes the whole scenario:

- station name, screen colour, public lore and guarded secrets,
- the station state and a deck/room layout with connections (previewed as a map),
- the computer's name and personality, the broadcast voice, and other voices with a named cast, each character with a description and their own speaker voice,
- up to four player characters with full sheets and backstories.

Keep talking to change things, then **Redraft**. **Apply to this session** replaces the station, lore, secrets, voices, map and crew, and clears the log; your provider, key, mode and sounds stay. Players stay connected and pick a new crew file. The builder uses the session's model and key; with DeepSeek a draft takes under a minute and costs a fraction of a cent.

## Terminals

Each player's screen is a physical terminal somewhere on the station, or a portable handheld unit. **TERM** in the player's header lists them: they can walk to any terminal marked reachable (if **Settings** allows it), and you can move anyone from their crew card.

- **Each terminal looks the part:** clean, blood on the screen, goo, a cracked screen, flickering, a dim failing backlight, grime, or a handheld frame with a weak-signal strip, and its own screen colour. In the default story the airlock terminal is clean, the med bay one grimy and flickering, the cargo bay one cracked and bloody, and the reactor one red and failing.
- **The agent knows where everyone is** and answers from that place (local cameras, doors, what happened there; the portable unit has remote-only access). With players at different terminals, per-player variants can give each their own view.
- Set them up under **Terminals** in the console: name, room on the map, look, colour, whether players can reach it yet, and notes for the agent, with who's at each one. The story builder creates terminals for new stories.

## All screens in step

Every player hears a line at the same moment. The server makes each voice clip once, measures it, and puts every line and spoken sentence on one timeline; each screen syncs its clock with the server and plays to that schedule (a screen that's a little late starts the clip part-way in). Beats such as a blackout are part of the schedule, and a player who reloads mid-speech rejoins in step.

## Settings

**⚙ Settings** in the console header holds the station name and screen colour, and switches for what the agent and players may do:

- the agent may trigger screen effects; send different versions of a line to different players; change the crew's health, wounds and stress,
- players may change their own health, wounds and stress; roll their own stats and saves; move between terminals,
- voices speak aloud on the players' screens.

## DM console

| Area | What it does |
|---|---|
| **Mode** (top right) | **Auto**: agent replies go straight to players. **Review**: every reply arrives as an editable draft that you send, regenerate with steering, or discard. **Manual**: agent is off. |
| **Comms log** | Full transcript. **⚑ Command agent** (Ctrl+Enter) gives the agent an order it must obey; it acts on it right away and players never see the order. **Send as voice** puts your exact words on screen as any voice (see below). **✉ Note to agent** is private between you and the agent (see below). Deleting an entry also removes it from the agent's memory. |
| **Command for the next reply** | A one-shot order applied to the agent's next reply, e.g. "lie about the door". |
| **Draft card** | A reply is a list of lines, each said by a voice. Edit the text, change who says each line, add or remove lines, and untick any station changes or effects you don't want. The 🧠 note is the agent's private read on what the players are attempting. |
| **Screen effects** | Blood, goo (players can drag to wipe these off the glass), cracked screen, hacker alarm with siren, red alert with klaxon, glitch, static, blackout, terminal lockout (blocks input), giant banner, text corruption. Set the caption, duration (0 = until cleared) and intensity. |
| **Station map** | The station state drawn as decks and rooms (see below). Click any value to change it; **⤢ Expand** opens the full map. |
| **Station state** | JSON the agent reads every turn and can change, e.g. opening doors or raising `access_level`. The player header shows `access_level`. |
| **Standing orders** | Persistent steering, e.g. "the AI is slowly being infected". |
| **Lore & secrets** | What the computer knows. Secrets, such as passwords and company directives, are guarded by access level. |
| **Voices & personas** | Every voice with its persona, look and sound (see below). Station name, screen colour and feature switches are under **⚙ Settings**. |

## Notes to the agent

**✉ Note to agent** sends a private note that only you and the agent see. Use it to tell the agent what is now true, without anything happening on the players' screen: "Voss died an hour ago in med bay", "Petrov has sealed himself in reactor access and cut the deck 4 lights". The agent:

- updates the station state to match, right away (e.g. `crew.voss = DEAD`, `lights.deck_4 = OFF`),
- keeps it in mind from then on,
- replies to you in the log ("Agent → you"), listing what it changed.

You can also ask it questions this way. Notes need an API key; they work in every mode.

## Station map

The **Station map** has two views (switch with **Drawing / Status**):

- **Drawing:** a schematic of the station. Decks are stacked on a lift shaft; each has a corridor its rooms open off. Doors sit in the doorways (green open, amber closed, red locked or sealed), cameras show on their rooms, airlocks open to space, and extra connections such as air vents or maintenance shafts are drawn as pipes between rooms. Click a door, light, camera or value to change it.
- **Status:** a board of every value by deck and room.

Both show every value in the state: doors, cameras and lights in their rooms and decks, and everything else (life support, power, comms, quarantine, crew...) as system panels. Values are coloured at a glance (green fine, amber degraded, red locked, offline or dangerous); a deck with its lights off goes dark, flickering lights flicker, and a quarantined deck is striped red. Anything the agent adds that isn't on the layout yet appears under "Not on the map yet".

Click a value to change it: pick a common one (OPEN, LOCKED, SEALED...) or type anything. The players see nothing; the agent sees the new state on its next reply. **⤢ Expand** opens the full map, where **Layout** sets the decks and rooms, one line per deck:

```
Deck 2 · Habitation / Med Bay: med_bay=Med Bay, galley
```

Room ids match station state keys anywhere in their path (`doors.med_bay`, `cameras.med_bay`), and "Deck 2" matches deck-wide keys like `lights.deck_2`. Add connections between rooms with `Link:` lines, e.g. `Link: med_bay - cargo_bay_deck3 (air vents)`.

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
- **Your side:** an **⚖ Your call** card appears in the console with **It works**, **It fails** or **Call for a roll**. The agent suggests a Stat or Save and whether [+] or [−] fits. Choosing works or fails has the agent narrate the result and make any station changes.

**Ability rolls** follow Mothership's rules:

- Pick a Stat (Strength, Speed, Intellect, Combat) or Save (Sanity, Fear, Body). Optionally add a skill (Trained +10, Expert +15, Master +20) and [+] / [−].
- If you know the character's value, enter it. Otherwise the players are asked for it.
- The players' terminal shows a **ROLL REQUIRED** box. They roll d100 on screen, or type in their physical dice.
- **Success:** under Stat + Skill. **Criticals:** doubles (00, 11 … 99). **[+] / [−]:** roll twice and keep the better or worse result. **Failure:** +1 Stress.
- The result appears on everyone's screen and in your console. **Have the agent narrate it** turns it into story. The agent never mentions dice or stats in-world.

## Screen effects from the agent

Besides you, the agent can trigger the electronic effects: alarm, red alert, glitch, static, blackout, lockout, banner and corrupted text. It can time them **between lines of dialogue**:

- **On a line:** an effect fires the moment that line begins, after the previous line has finished appearing and being spoken. For example, static as Salk's second sentence starts.
- **As a beat:** an effect on its own, between lines, pauses the dialogue for its duration. A blackout always plays as a beat: the screen goes dark, then the next line comes once the lights are back.
- **On the whole reply:** effects can also fire as soon as the reply starts.

In Review mode each line in the draft shows its effects as ⚡ chips, which you can untick before sending. **Agent may trigger screen effects** turns all of this off.

## Sounds

Upload your own audio in **Sounds** (middle column): monster growls, attacks, screams, station ambience. Use the button or drop files on it; MP3, WAV, OGG, M4A, FLAC and WebM work, up to 10 MB each and 100 MB per session (`MAX_SOUND_MB`, `MAX_SESSION_SOUNDS_MB`).

- **▶ Once** plays a sound on every player screen (an attack, a bang on the hull).
- **🔁 Loop** keeps it going until you stop it (a low growl, reactor hum, dripping). Loops fade in and out, and you can change a loop's volume live under **Playing**.
- **👂** lets you hear a sound yourself without the players hearing it.
- Each sound has its own name and volume, saved with the session. Restart story stops everything; the library stays (even through Factory reset).

Sounds play through the players' VOL control. Players who join or reload mid-scene pick up any running loops once they press a key. Files are kept under `data/sounds/<CODE>/` and deleted with their session.

## Voices & entities

Every line on the players' screen belongs to a voice, and **the agent can speak as any of them**. No voice is the default: the agent answers as whoever would really respond. If the players talk to Salk, Salk answers on the intercom; HV-CORE answers terminal commands. A reply can mix voices, for example Dr. Salk on the intercom, then a station-wide announcement. Two voices are built in: **HV-CORE** (the terminal) and **System Broadcast**. Add any number of others under **Voices, personas & settings**, such as an intercom, a stranger on comms, or the thing in the vents. You can also pick one in the comms box and **Send as voice** yourself.

Each voice has:

- **Persona:** who it is, how it talks and what it knows. The agent reads every voice's persona. HV-CORE's persona is the terminal's main personality.

- **Characters** (for voices several people share, like the intercom): each has a name, their own speaker voice and a short note the agent reads. The agent switches between them line by line ("INTERCOM · SALK:", then "INTERCOM · MARLOWE:"), so it can stage conversations. When it brings in someone new, they're added automatically with a voice of their own, matching whether it wrote them as a woman or a man; change it any time. You can also **Send as voice** as any character.
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
