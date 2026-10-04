# Mothership Terminal

A station-computer terminal for the Mothership RPG. Players type into a CRT screen and an AI model (DeepSeek or Claude) answers as the station, in any number of voices. The Warden (game master) steers it from a separate console.

Play it at **[shawnofthe.dev/mothership](https://shawnofthe.dev/mothership/)**, or run your own copy.

## How a game works

1. **The Warden opens `/dm`**, picks a provider and pastes their own API key, and clicks **Create session**. They get a six-character **session code**.
2. **Players open `/`** (the terminal) on a laptop or TV, enter the code, and start typing.
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

## DM console

| Area | What it does |
|---|---|
| **Mode** (top right) | **Auto**: agent replies go straight to players. **Review**: every reply arrives as an editable draft that you send, regenerate with steering, or discard. **Manual**: agent is off. |
| **Comms log** | Full transcript. **⚑ Command agent** (Ctrl+Enter) gives the agent an order it must obey; it acts on it right away and players never see the order. **Send as voice** puts your exact words on screen as any voice (see below). **Private note** is for you only. Deleting an entry also removes it from the agent's memory. |
| **Command for the next reply** | A one-shot order applied to the agent's next reply, e.g. "lie about the door". |
| **Draft card** | A reply is a list of lines, each said by a voice. Edit the text, change who says each line, add or remove lines, and untick any station changes or effects you don't want. The 🧠 note is the agent's private read on what the players are attempting. |
| **Screen effects** | Blood, goo (players can drag to wipe these off the glass), cracked screen, hacker alarm with siren, red alert with klaxon, glitch, static, blackout, terminal lockout (blocks input), giant banner, text corruption. Set the caption, duration (0 = until cleared) and intensity. |
| **Station state** | JSON the agent reads every turn and can change, e.g. opening doors or raising `access_level`. The player header shows `access_level`. |
| **Standing orders** | Persistent steering, e.g. "the AI is slowly being infected". |
| **Lore & secrets** | What the computer knows. Secrets, such as passwords and company directives, are guarded by access level. |
| **Voices, personas & settings** | Every voice with its persona, look and sound (see below), plus station name, screen colour, whether the agent may fire effects itself (such as an alarm when it catches a hack), and whether voices speak aloud. |

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

Every line on the players' screen belongs to a voice, and **the agent can speak as any of them**. A reply can mix voices, for example a terminal readout, then Dr. Salk on the intercom, then a station-wide announcement. Two voices are built in: **HV-CORE** (the terminal) and **System Broadcast**. Add any number of others under **Voices, personas & settings**, such as an intercom, a stranger on comms, or the thing in the vents. You can also pick one in the comms box and **Send as voice** yourself.

Each voice has:

- **Persona:** who it is, how it talks and what it knows. The agent reads every voice's persona. HV-CORE's persona is the terminal's main personality.

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
