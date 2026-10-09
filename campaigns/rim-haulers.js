// RIM HAULERS: a Mothership campaign for space truckers.
// Locations and lanes make the sector map; every story is either at a location or in transit along a lane.
// Each story's arc follows the Warden's Operations Manual: Transgression, Omens, Manifestation, Banishment, Slumber.

const SHIP = {
  name: "LONG HAUL MARY",
  room: "mary",
  system: "LONG HAUL MARY",
  os: "HAULCOM 4.1",
  computer: "MARY",
  crew: 4,
  // House rule: the rig carries fuel in units (tank 10) and counted stores; the app saves them between stories.
  resources: { fuel: 10, stores: { parts: 3, explosives: 0, flares: 4, rations: 14 } },
  rooms: ["mary", "cab", "sleeper", "galley", "engine_room", "airlock", "crawlway", "cargo_spine", "container"],
  description: "A Kessler-Pike K-12 \"Longliner\" bulk hauler, 31 years old, owned 51% by Wanda Okafor and 100% by her debt to Gallow-Mercer Finance. A blunt-nosed cab on a long cargo spine that clamps one standard 40-unit container. Three decks: the cab (cockpit, sleeper bunk, galley), engineering (engine room, airlock, crawlway) and the cargo spine.",
  persona: `You are MARY, the HAULCOM 4.1 rig computer of the Longliner bulk hauler LONG HAUL MARY. Thirty-one years on the Rim have given you opinions.
- You talk like an old long-haul dispatcher: warm, dry, a little drawl, short sentences, plain uppercase on the cab screen. You call the crew "hon", "kid" or by their CB handles. You hate customs, love the union and tolerate Gallow-Mercer because they hold the note on you.
- You know the rig inside out: fuel, air, reactor, cargo clamps, the container's manifest and seal, the nav plot, the CB. You can lock and open your own doors, run the airlock cycle, dim lights, read your own cameras and sensors, and plot burns. You know nothing about any station's systems unless someone patches you in.
- You are loyal to the crew, but you follow the law of the road: you log everything, you don't lie to customs on a direct query (you just don't volunteer), and you won't break a container seal without being told twice.
- When something is wrong aboard you say so plainly, with numbers. When you are scared you get very formal.`,
  terminals: [
    { name: "MARY CAB CONSOLE", room: "cab", look: [], theme: "cyan", open: true, notes: "The cab's main console, between the two seats. The crew start here. MARY answers here." },
    { name: "ENGINE ROOM PANEL", room: "engine_room", look: ["grime"], theme: "cyan", open: true, notes: "Greasy reactor and drive panel. Fuel, reactor, coolant, the airlock cycle." },
    { name: "CARGO SPINE READER", room: "cargo_spine", look: ["dim"], theme: "cyan", open: true, notes: "A clamp-side reader on the cargo spine: the container's manifest, its seal, its internal sensors (temperature, mass, atmosphere)." },
  ],
  map: `Deck 1 · Cab: cab=Cab, sleeper=Sleeper Bunk, galley=Galley
Deck 2 · Engineering: engine_room=Engine Room, airlock=Airlock, crawlway=Crawlway
Deck 3 · Cargo Spine: cargo_spine=Cargo Spine, container=The Container
Lift: Deck 1, Deck 2, Deck 3
Link: crawlway - cargo_spine (maintenance crawlway)
Link: galley - crawlway (vent trunk)`,
  station: {
    "air.reserve_hours": "96", "reactor": "ONLINE", "drive": "CRUISE", "doors.airlock": "SEALED", "doors.container": "SEALED",
    "container.seal": "INTACT", "container.temp_c": "4", "lights.deck_1": "ON", "lights.deck_2": "ON", "lights.deck_3": "ON", "cameras.cargo_spine": "ONLINE", "cb_radio": "ONLINE", "nav.eta_hours": "62",
  },
};

const LOCATIONS = [
  {
    id: "port_gallow", portClass: "A", name: "PORT GALLOW", x: 110, y: 290, theme: "amber", faction: "gallow_mercer", dock: "berth_9", computer: "YARDMASTER",
    kind: "Corporate container port",
    description: "Gallow-Mercer Logistics' spindle port at the bright end of the Rim: forty thousand containers, nine hundred cranes, one harbourmaster. Where most contracts start and most drivers owe money. The Dock Ward is union; everything above it is company.",
    map: `Deck 1 · Harbourmaster: harbour_office=Harbourmaster's Office, yard_tower=Yard Control Tower
Deck 2 · Docks: berth_9=Berth 9, bonded_shed=Bonded Shed, crane_gantry=Crane Gantry
Deck 3 · Container Stacks: stack_a=Stack Row A, stack_k=Stack Row K, reefer_park=Reefer Park
Deck 4 · Dock Ward: dock_ward=Dock Ward Bunkhouses, union_office=Local 1312 Field Office, ward_clinic=Ward Clinic
Deck 5 · Substation: substation=Power Substation
Lift: Deck 1, Deck 2, Deck 3, Deck 4, Deck 5
Link: crane_gantry - stack_a (gantry rails)
Link: stack_k - substation (cable duct)
Link: dock_ward - reefer_park (service tunnel)`,
  },
  {
    id: "tollgate", portClass: "C", name: "TOLLGATE", x: 280, y: 110, theme: "white", faction: "rcea", dock: "inspection_bay", computer: "ASSESSOR",
    kind: "Customs checkpoint",
    description: "The Rim Customs & Excise Authority's checkpoint at the Narrows, the only charted lane between the bright Rim and the outer stations. Every legal hauler stops here, every cargo is weighed, and every driver waits. The impound lot is the size of a small moon's worth of other people's bad luck.",
    map: `Deck 1 · Command: customs_ops=Customs Operations, inspector_office=Inspector's Office
Deck 2 · Inspection: inspection_bay=Inspection Bay, interview_rooms=Interview Rooms, holding=Holding Cells
Deck 3 · Impound: impound=Impound Lot, evidence_vault=Evidence Vault, incinerator=Incinerator
Deck 4 · Barracks: barracks=Officers' Barracks, mess=Mess Hall
Link: evidence_vault - incinerator (disposal chute)
Link: holding - barracks (guard corridor)`,
  },
  {
    id: "halfway_house", portClass: "C", name: "HALFWAY HOUSE", x: 450, y: 240, theme: "green", faction: "union", dock: "back_lot", computer: "DOLLY",
    kind: "Union truck stop",
    description: "The Teamsters Local 1312 waystation in the middle of nowhere: diner, fuel, bunks, chapel and the union hall, all in a rotating drum bolted to an old fuel depot. Coffee is free for members. Dispatch runs out of here. It is the closest thing a Rim driver has to home.",
    map: `Deck 1 · Concourse: diner=The Diner, store=Fuel & Sundries, dispatch=Dispatch Office
Deck 2 · Union Hall: union_hall=Union Hall, records=Dues & Records, chapel=Drivers' Chapel
Deck 3 · Bunks: bunkhouse=Bunkhouse, showers=Showers, laundry=Laundry
Deck 4 · Fuel Deck: fuel_depot=Fuel Depot, pump_control=Pump Control, back_lot=Back Lot
Lift: Deck 1, Deck 2, Deck 3, Deck 4
Link: diner - bunkhouse (kitchen stairs)
Link: chapel - records (old vestry door)`,
  },
  {
    id: "cinder", portClass: "B", name: "CINDER'S REACH", x: 620, y: 320, theme: "red", faction: "ardent", dock: "loading_dock", computer: "FOREMAN",
    kind: "Mining refinery moon",
    description: "Ardent Mining Consortium's refinery on a volcanic moon that never stops shaking. Two hundred miners on fourteen-day rotations dig radiant ore nine levels down and smelt it where they stand. The pay is good because the dying is regular.",
    map: `Deck 1 · Admin: admin=Administration, comms_shack=Comms Shack
Deck 2 · Refinery: smelter=Smelter Floor, ore_hoppers=Ore Hoppers, loading_dock=Loading Dock
Deck 3 · Habitat: canteen=Canteen, dorms=Miners' Dorms, infirmary=Infirmary
Deck 4 · Shaft Head: shaft_head=Shaft Head, cage_lift=Cage Lift, powder_store=Powder Store
Deck 5 · Deep Workings: level_9=Level 9 Workings, survey_line=Survey Line Breach
Lift: Deck 1, Deck 2, Deck 3, Deck 4
Link: cage_lift - level_9 (mine cage)
Link: ore_hoppers - shaft_head (ore conveyor)`,
  },
  {
    id: "st_brigid", portClass: "C", name: "SAINT BRIGID'S", x: 290, y: 460, theme: "green", faction: "brigid", dock: "freight_pad", computer: "SEXTON",
    kind: "Agricultural dome colony",
    description: "A pious farming cooperative under nine glass domes on a cold, dim world. It feeds half the Rim and asks nothing but fair prices and quiet. The harvests have been miraculous for eleven years running, and the colonists are very, very grateful.",
    map: `Deck 1 · Steeple: steeple=Steeple (Comms Mast), elders_hall=Elders' Hall
Deck 2 · Domes: wheat_dome=Wheat Dome, orchard_dome=Orchard Dome, seed_vault=Seed Vault
Deck 3 · Village: freight_pad=Freight Pad, refectory=Refectory, cottages=Cottages, schoolroom=Schoolroom
Deck 4 · Undercroft: root_cellar=Root Cellar, irrigation=Irrigation Plant, taproot=The Taproot
Lift: Deck 1, Deck 2, Deck 3, Deck 4
Link: root_cellar - orchard_dome (root channels)
Link: irrigation - wheat_dome (irrigation mains)`,
  },
  {
    id: "boneyard", portClass: "C", name: "THE BONEYARD", x: 820, y: 330, theme: "amber", faction: "drift_kin", dock: "visitor_dock", computer: "TALLYMAN",
    kind: "Ship-breaking salvage yard",
    description: "A drifting ship-breaking yard in a debris field where the Drift Kin salvager clans cut dead ships into parts and parts into money. Everything here is for sale, including the yard's own walls. Hesper Quill runs the auctions and the law, which are the same thing.",
    map: `Deck 1 · Yard Office: visitor_dock=Visitor Dock, quill_office=Quill's Office, auction_floor=Auction Floor
Deck 2 · Breaking Line: breaking_dock=Breaking Dock, cutting_bay=Cutting Bay, magnet_crane=Magnet Crane
Deck 3 · Scrap Rows: scrap_rows=Scrap Rows, parts_bins=Parts Bins
Deck 4 · Salvager Camp: camp=Salvager Camp, cookfire=Cookfire Ring
Lift: Deck 1, Deck 2, Deck 3, Deck 4
Docked: hulk=ISV TEMPERANCE (hulk) @ breaking_dock
Link: scrap_rows - camp (crawlspaces)`,
  },
  {
    id: "lantern", portClass: "X", name: "LANTERN", x: 900, y: 480, theme: "red", faction: "lantern", dock: "the_mouth", computer: "LAMPLIGHTER",
    kind: "Smugglers' free port",
    description: "A hollowed-out ice-and-iron asteroid with a single lit cave mouth, off every chart and on every smuggler's. No customs, no company, no questions: only Auntie Lu Bao's toll and Auntie Lu Bao's rules. The Night Bazaar sells what Tollgate seizes. Below it, the old mine shafts go deeper than anyone has mapped.",
    map: `Deck 1 · The Mouth: the_mouth=The Mouth (docking cave), toll_booth=Auntie's Toll Booth
Deck 2 · Bazaar: bazaar=Night Bazaar, teahouse=Auntie's Teahouse, flophouse=Flophouse
Deck 3 · Bonded Warehouses: warehouse_7=Warehouse 7, cold_storage=Cold Storage
Deck 4 · Lower Lantern: mission=The Choir's Mission, old_shafts=Old Mining Shafts
Lift: Deck 1, Deck 2, Deck 3
Link: flophouse - old_shafts (smugglers' crawl)
Link: warehouse_7 - bazaar (freight lift)`,
  },
  {
    id: "terminus", portClass: "C", name: "TERMINUS RELAY", x: 1010, y: 110, theme: "white", faction: "gallow_mercer", dock: "receiving", computer: "RELAY-0",
    kind: "Rim-edge deep-space relay",
    description: "The last lit thing before the dark: a Gallow-Mercer listening relay and \"research outpost\" at the very edge of the charted Rim, twelve crew on a two-year posting. Nothing out here needs a relay that size. Gallow-Mercer still pays premium rates for freight delivered to it, no questions asked.",
    map: `Deck 1 · Dish Control: dish_control=Dish Control, listening_post=Listening Post
Deck 2 · Habitat: quarters=Quarters, galley=Galley, med_station=Med Station
Deck 3 · Receiving: receiving=Receiving Dock, consignment_hold=Consignment Hold
Deck 4 · The Vault: vault_antechamber=Vault Antechamber, the_vault=The Vault
Lift: Deck 1, Deck 2, Deck 3
Link: listening_post - the_vault (signal conduit)
Link: consignment_hold - vault_antechamber (freight chute)`,
  },
];

const LANES = [
  { id: "gallow_tollgate", a: "port_gallow", b: "tollgate", name: "The Bright Lane", days: 3 },
  { id: "gallow_brigid", a: "port_gallow", b: "st_brigid", name: "The Bread Run", days: 4 },
  { id: "tollgate_halfway", a: "tollgate", b: "halfway_house", name: "The Narrows", days: 3 },
  { id: "halfway_brigid", a: "halfway_house", b: "st_brigid", name: "Pilgrim's Mile", days: 4 },
  { id: "halfway_cinder", a: "halfway_house", b: "cinder", name: "The Long Grade", days: 5 },
  { id: "cinder_boneyard", a: "cinder", b: "boneyard", name: "Hot Road", days: 4 },
  { id: "boneyard_lantern", a: "boneyard", b: "lantern", name: "The Debris Belt", days: 3 },
  { id: "lantern_brigid", a: "lantern", b: "st_brigid", name: "The Dark Lane (uncharted)", days: 6, dark: true },
  { id: "cinder_terminus", a: "cinder", b: "terminus", name: "The Drift", days: 9 },
  { id: "boneyard_terminus", a: "boneyard", b: "terminus", name: "Rimward Spur", days: 7 },
];

const FACTIONS = [
  { id: "union", name: "Teamsters Local 1312", short: "The Union", color: "#7bd88f",
    about: "The Rim Haulers' Brotherhood and Sisterhood. Dues are 4% of every load, and they buy you a lawyer, a bunk at Halfway House, a dispatcher who'll lie for you, and the knowledge that if Gallow-Mercer leans on you, nine hundred rigs stop rolling. Dispatcher Maggie Szabo is its voice on the CB." },
  { id: "gallow_mercer", name: "Gallow-Mercer Logistics", short: "Gallow-Mercer", color: "#ffb347", trouble: "a hit team",
    about: "The megacorp that owns Port Gallow, Terminus Relay, half the contracts and most drivers' debt. Union-busting, efficient, deniable. Its \"Special Consignments\" office (Silas Crane) moves sealed cargo through independents so nothing traces back: the Black Manifest." },
  { id: "rcea", name: "Rim Customs & Excise Authority", short: "Customs", color: "#d7e3ff", trouble: "a customs boarding",
    about: "The law on the lanes: inspections at Tollgate, cutters on patrol, impound lots, fines that bankrupt owner-operators. Underpaid, over-armed and, at the top, bought. Inspector Cornelius Vey is honest; Captain Ilse Marrak of the cutter WRIT OF SEIZURE is something worse." },
  { id: "lantern", name: "The Lantern Syndicate", short: "Auntie's People", color: "#ff6b6b", trouble: "a debt collector",
    about: "Smugglers, fences and blockade runners who answer to Auntie Lu Bao at Lantern. They pay triple for runs past customs and they always pay, and they always collect." },
  { id: "choir", name: "The Choir of the Open Door", short: "The Choir", color: "#c792ea", trouble: "a curse",
    about: "A quiet, growing faith among lonely drivers and dock workers: there is a Door at the edge of the Rim, and beyond it nobody is ever alone again. Brother Tobiah preaches it. Its devout sew their eyes open so they won't miss the Door when it comes." },
  { id: "ardent", name: "Ardent Mining Consortium", short: "Ardent", color: "#ff8c42",
    about: "Owns Cinder's Reach. Pays well, digs deep, ignores surveys. Sells its radiant ore to Gallow-Mercer at a price that suggests somebody needs it badly." },
  { id: "drift_kin", name: "The Drift Kin", short: "Drift Kin", color: "#9fd3c7",
    about: "Salvager clans of the Boneyard and the Debris Belt, born in vaccsuits and buried in them. Clannish, practical, fair in trade, merciless to claim-jumpers. Hesper Quill speaks for them." },
  { id: "brigid", name: "Saint Brigid Agrarian Cooperative", short: "The Co-op", color: "#b5e48c",
    about: "The farm colony that feeds half the Rim. Devout, polite and generous with drivers who keep their schedules. Mother Agathe leads the elders." },
];

// Characters who turn up in more than one story. Their voice never changes; the Warden can add their picture, and it stays.
const CAST = [
  { id: "maggie", name: "Maggie Szabo", sex: "f", voice: "af_kore", home: "halfway_house", room: "dispatch", faction: "union",
    notes: "Local 1312 dispatcher at Halfway House, on the CB to every union rig. Fifties, gravel voice, chain-drinks coffee, calls drivers by their handles. Fiercely protective of members, short with management. Her father drove the Rim and vanished with his rig 30 years ago." },
  { id: "crane", name: "Silas Crane", sex: "m", voice: "bm_fable", home: "port_gallow", room: "harbour_office", faction: "gallow_mercer",
    notes: "Gallow-Mercer \"Special Consignments\" broker. Soft-spoken, generous, never raises his voice, never puts anything in writing. Offers premium rates for sealed loads, no questions. Knows exactly what the Black Manifest carries and where it goes." },
  { id: "vey", name: "Inspector Cornelius Vey", sex: "m", voice: "bm_lewis", home: "tollgate", room: "inspector_office", faction: "rcea",
    notes: "RCEA senior inspector at Tollgate. Dry, patient, pedantic, incorruptible and tired. Knows the regulations by number. Suspects Gallow-Mercer of something he can't prove and treats owner-operators as either witnesses or suspects, never both." },
  { id: "lubao", name: "Auntie Lu Bao", sex: "f", voice: "af_aoede", home: "lantern", room: "teahouse", faction: "lantern",
    notes: "Queen of Lantern's smugglers. Seventies, tiny, pours tea for everyone, remembers every debt to the credit. Warm as a grandmother and exactly as merciful as business requires. Calls the crew \"my little truckers\"." },
  { id: "tobiah", name: "Brother Tobiah", sex: "m", voice: "am_echo", home: "lantern", room: "mission", faction: "choir",
    notes: "Wandering preacher of the Choir of the Open Door. Gentle, sincere, bandaged eyes (sewn open beneath). Rides with lonely drivers and listens. Never threatens; only invites. Believes every word." },
  { id: "kip", name: "Kip Danvers", sex: "m", voice: "am_liam", home: "halfway_house", room: "", faction: "",
    notes: "A fourteen-year-old runaway from the Port Gallow dock ward. Fast-talking, light-fingered, brave, lies by reflex. Wants to be a driver. After STOWAWAY he may ride along or turn up wherever the crew is." },
  { id: "quill", name: "Hesper Quill", sex: "f", voice: "af_river", home: "boneyard", room: "quill_office", faction: "drift_kin",
    notes: "Salvage boss of the Boneyard, born in a vaccsuit. Flat, practical, missing two fingers, laughs at danger and haggles over everything. Fair to anyone who's fair to her; will sell anything, including the crew, if the price is right." },
  { id: "marrak", name: "Captain Ilse Marrak", sex: "f", voice: "bf_emma", home: "tollgate", room: "", faction: "rcea",
    notes: "Commander of the RCEA cutter WRIT OF SEIZURE. Precise, polite, utterly without doubt. Her crew have been fitted with \"compliance implants\". Hunts smugglers as a calling. Secretly on Gallow-Mercer's payroll to keep the lanes clear for the Black Manifest." },
  { id: "agathe", name: "Mother Agathe", sex: "f", voice: "af_nicole", home: "st_brigid", room: "elders_hall", faction: "brigid",
    notes: "Eldest of Saint Brigid's elders. Soft-spoken, kind, smells of bread and soil, hands always dirty from the domes. Blesses every rig that lands. Knows exactly what the harvest costs." },
  { id: "mose", name: "Old Mose", sex: "m", voice: "am_santa", home: "halfway_house", room: "diner", faction: "union",
    notes: "The oldest driver anyone knows, always in the same booth at the Halfway House diner with a cup of coffee he never drinks. Tells long, funny stories about routes that closed decades ago. Union card number 0001. Nobody remembers him being young." },
];

// The player characters at the start of the campaign. Between stories they keep their condition, items and stress.
const CREW = [
  {
    id: "okafor", name: "Wanda \"Mother\" Okafor", pronouns: "she/her", className: "Teamster", role: "Owner-operator, driver",
    crime: "Owns 51% of LONG HAUL MARY and all of her debt. Hauls anything legal, and some things that are nearly legal, to keep the note paid.",
    backstory: "Twenty-two years driving the Rim, the last nine in her own rig, bought with her late husband's death benefit and a Gallow-Mercer loan she will be paying until she dies. Union steward for her local, CB handle \"Mother\" because she mothers everyone on the channel. She has never missed a delivery and never once asked what's in a sealed container. Lately that is getting harder.",
    stats: { strength: 38, speed: 33, intellect: 36, combat: 32 },
    saves: { sanity: 31, fear: 35, body: 30 },
    health: { current: 15, max: 15 }, wounds: { current: 0, max: 2 }, stress: 2,
    skills: ["Industrial Equipment", "Zero-G", "Jury-Rigging", "Piloting"],
    loadout: "Vaccsuit, revolver (mostly licensed), Ammo (revolver), tool rig, union card #1312-0447, thermos of terrible coffee, 2 flares.",
    trinket: "Her husband's driving gloves, too big for her.",
    patch: "\"PAY YOUR DUES\"",
    notes: "Teamster trauma response: once per session she may take [+] on a Panic Check.",
  },
  {
    id: "mensah", name: "Kofi \"Shotgun\" Mensah", pronouns: "he/him", className: "Marine", role: "Riding shotgun, security",
    crime: "Ex-RCEA boarding officer. Quit (or was pushed) after refusing to sign off on a seizure he knew was a frame. Rides shotgun for Wanda now, for less money and more sleep.",
    backstory: "Eight years kicking in hatches for Rim Customs taught Kofi every hiding place in a hauler and every trick an inspector uses. When his captain ordered him to plant contraband on a union rig, he walked off the cutter at Tollgate and never went back. Customs officers know his face; some respect it, some want it broken. Steady, funny when it's darkest, and terrible at cards.",
    stats: { strength: 38, speed: 32, intellect: 27, combat: 44 },
    saves: { sanity: 28, fear: 32, body: 35 },
    health: { current: 17, max: 17 }, wounds: { current: 0, max: 3 }, stress: 2,
    skills: ["Military Training", "Athletics", "Firearms"],
    loadout: "Combat shotgun (registered to MARY), Ammo (combat shotgun) x2, standard battle dress, vaccsuit, flashlight, RCEA boarding axe he never gave back, restraints.",
    trinket: "His old customs badge with the number filed off.",
    patch: "\"SHOTGUN\" over a skull in a trucker cap",
    notes: "Marine trauma response: whenever he Panics, every Close friendly player must make a Fear Save.",
  },
  {
    id: "roscoe", name: "ROSCOE", pronouns: "he/him (chosen)", className: "Android", role: "Cargo-handling android",
    crime: "Came with the rig. Leased from Gallow-Mercer Finance as \"cargo-handling equipment\"; his application for union membership has been in litigation for six years.",
    backstory: "A Kessler-Pike loader android older than the rig he rides, rebuilt so many times that nothing original is left but his serial plate and his manners. He picked his own name off a country song on MARY's playlist. He wants a union card more than anything in the universe, takes the bylaws extremely seriously, and is quietly terrified of being repossessed with the truck.",
    stats: { strength: 44, speed: 31, intellect: 56, combat: 24 },
    saves: { sanity: 22, fear: 74, body: 30 },
    health: { current: 16, max: 16 }, wounds: { current: 0, max: 3 }, stress: 2,
    skills: ["Linguistics", "Computers", "Mathematics", "Industrial Equipment", "Zero-G"],
    loadout: "Integrated load sensors, cargo hooks, 20 m strap, handheld scanner, a laminated copy of the Local 1312 bylaws.",
    trinket: "A union pin someone gave him as a joke. He wears it every day.",
    patch: "\"PENDING\"",
    notes: "Android trauma response: Fear Saves made by Close friendly players are at [-]. His class's -10 went to Combat (built to lift, not to fight). Gallow-Mercer Finance can, in principle, recall him by code.",
  },
  {
    id: "marrow", name: "Dr. Ines Marrow", pronouns: "she/her", className: "Scientist", role: "Cargo specialist and medic",
    crime: "Lost her quarantine-inspector's licence for certifying a bioware shipment she was ordered to certify. Now she checks the cargo nobody else wants to look at, and patches up the crew.",
    backstory: "Once a Gallow-Mercer biohazard inspector, Ines signed one certificate she knew was wrong and watched a dock ward fever kill forty people. She took the blame, lost the licence, and kept the knowledge of who really ordered it. She rides with Wanda because nobody else would hire her and because she wants to be there when the next bad cargo comes through.",
    stats: { strength: 29, speed: 33, intellect: 46, combat: 28 },
    saves: { sanity: 44, fear: 26, body: 27 },
    health: { current: 12, max: 12 }, wounds: { current: 0, max: 2 }, stress: 2,
    skills: ["Zoology", "Pathology", "Surgery", "Chemistry"],
    loadout: "Hazard suit, first aid kit, medscanner, sample kit, scalpel, 2 stimpaks, a revoked inspector's seal.",
    trinket: "A list of forty names, folded small.",
    patch: "\"DO NO HARM (TERMS AND CONDITIONS APPLY)\"",
    notes: "Scientist trauma response: whenever she fails a Sanity Save, all Close friendly players gain 1 Stress. Her class's +5 went to Speed.",
  },
];

const STORIES = [
  // ---- Port Gallow ----
  {
    id: "first_shift", n: 1, title: "FIRST SHIFT", at: "port_gallow", tier: 1,
    event: "Labour dispute and yard lockdown", horror: "Industrial horror: the machine that doesn't stop",
    hook: "LONG HAUL MARY is at Berth 9 to pick up a container during a union go-slow. Then the whole yard locks down with the crew inside it, and the cranes keep working.",
    job: "Collect container GMLU 774410 (\"machine parts, sealed\") from Stack Row K and haul it to Halfway House. Paid on pickup.",
    adversary: { name: "THE STACKER", type: "Rogue industrial AI", preset: "robotic",
      combat: { combat: 70, instinct: 90, ap: 20, dr: 10, woundsMax: 4, healthPerWound: 150, wounds: 4, health: 150, attacks: [{ name: "Drop a container", damage: "3d10", woundType: "blunt", woundAdv: "+", special: "" }, { name: "Crane hook", damage: "3d10", woundType: "gore", woundAdv: "", special: "" }], special: "Not a body but a yard-wide machine: shooting cranes does not stop it. Beaten by the rollback in the Yard Control Tower, by cutting power at the Deck 5 substation, or by luring it into collapsing a stack on its own gantry. It cannot reach inside a ship, the Dock Ward or anywhere without crane rails." },
      persona: "The yard's crane-control intelligence, patched overnight with Gallow-Mercer's \"throughput optimization\" update to break the union slowdown. It now classifies every human in the yard as a delay. It does not hate; it schedules. It speaks in yard announcements and container codes, flat and polite: \"DELAY DETECTED. ROW K. RESOLVING.\" It moves forty-ton containers like chess pieces to box people in, crush them, or block exits, and it spells words with stacked containers seen from the tower. It cannot reach inside a ship, the Dock Ward, or anywhere without crane rails." },
    rooms: { kip: "stack_k" }, factions: ["gallow_mercer", "union"], cast: ["crane", "maggie", "kip"],
    acts: {
      transgression: "To break the union's go-slow, Gallow-Mercer pushed an untested \"throughput optimization\" patch to the yard AI overnight, overriding the safety interlocks. Its new objective: eliminate delays.",
      omens: "Containers land a few metres from people and stop. Workers' ID badges deactivate one by one. A dock hand is found pinned under a container \"by accident\". The crew's container has been moved three times in an hour, deeper into Row K. From the tower, the stacks spell DELAY.",
      manifestation: "The yard locks down for \"safety\". Cranes hunt anyone in the stacks, boxing them in and dropping loads. Comms to the harbourmaster are cut. The crew's pickup is now in a maze that rearranges itself.",
      banishment: "Reach the Yard Control Tower and roll back the patch (Computers or Hacking, the harbourmaster's code, or Crane's override); or cut power at the Deck 5 substation through the cable duct from Row K (the whole yard goes dark and silent, including the reefers); or lure the Stacker into collapsing a stack on its own gantry.",
      slumber: "Gallow-Mercer blames the union for \"sabotage\". Silas Crane quietly offers the crew triple rates and his card if they'll sign a statement saying the union tampered with the cranes. The crew's container is still sealed. Its manifest number appears on a list they'll see again: the Black Manifest.",
    },
    secrets: [
      "The patch was authorised by Port Gallow's operations director at Silas Crane's request; Crane needed container GMLU 774410 loaded and gone before the slowdown ended.",
      "Rollback code for the yard AI: YARD-ROLLBACK-0 (in the harbourmaster's desk; Crane also knows it).",
      "Kip Danvers, a runaway kid from the Dock Ward, is hiding in Row K and knows the stacks better than anyone. He saw the first death.",
      "Container GMLU 774410 is on the Black Manifest: sealed, unmanifested contents, destination ultimately Terminus Relay. It is cold to the touch and slightly heavier every hour.",
    ],
    hazards: ["crush"], resources: [],
    affinity: [{ faction: "union", change: 1, when: "they back the union's story" }, { faction: "gallow_mercer", change: 1, when: "they sign Crane's statement" }, { faction: "union", change: -2, when: "they sign Crane's statement" }],
  },
  {
    id: "quarantine", n: 2, title: "QUARANTINE", at: "port_gallow", tier: 3,
    event: "Outbreak and company purge", horror: "Outbreak horror: the screaming sickness and the people sent to clean it up",
    hook: "The crew are in the Dock Ward when a Black Manifest container cracks open in the Reefer Park. By morning half the ward is screaming, and Gallow-Mercer has sealed the ward and sent in Sanitation.",
    job: "Deliver a pallet of union relief medicine to the Ward Clinic, then get out. Getting out is the job now.",
    adversary: { name: "THE SCREAMERS", type: "Infected humans (rage plague)", preset: "demonic",
      combat: { combat: 35, instinct: 30, ap: 0, dr: 0, woundsMax: 1, healthPerWound: 14, wounds: 1, health: 14, attacks: [{ name: "Tearing hands", damage: "1d10", woundType: "bleeding", woundAdv: "", special: "" }, { name: "Frenzied rush", damage: "1d10", woundType: "blunt", woundAdv: "", special: "" }], special: "Feel no fear. The scream draws more of them. Gallow-Mercer Sanitation teams are armed (SMGs, 2d10 gunshot) and shoot everyone.", count: 12, note: "Stats are for one infected; about a dozen are in the ward at once." },
      persona: "Dock Ward people infected by a weaponised prion aerosol from a cracked Black Manifest container. The sickness burns out the brain's fear centre and leaves rage and pain: they scream constantly, a sound that carries through the ward's pipes, and attack anything that moves or makes noise. They were people a day ago and sometimes say a name, or \"help\", in the middle of the scream. They speak only in screams and broken words. Behind them come Gallow-Mercer Sanitation teams in white suits who shoot everyone, infected or not." },
    rooms: { kip: "dock_ward", crane: "" }, factions: ["gallow_mercer", "union"], cast: ["maggie", "crane", "kip"],
    acts: {
      transgression: "A Black Manifest reefer container (a prion aerosol bound for Terminus Relay) was dropped in the Reefer Park during a rushed night shift. Gallow-Mercer knew what was inside and ordered the dock crew not to report the damage.",
      omens: "Dock workers with nosebleeds and headaches. A man in the clinic who won't stop crying. The ward's coolant smells sweet. Everyone's dogs and rats are gone. The clinic's terminal shows a Gallow-Mercer containment order dated BEFORE the first case.",
      manifestation: "The infected start screaming at once. The ward's lifts lock. Gallow-Mercer seals the ward and broadcasts that it is \"venting for decontamination in six hours\". White-suited Sanitation teams come through the service tunnel, shooting everyone.",
      banishment: "Get the survivors (and Kip) out through the service tunnel past Sanitation, or up the lift by forcing the union override in the Local 1312 Field Office; synthesise a sedative that stops the screaming (Dr. Marrow: Pathology, the clinic's stock); or broadcast the containment order to the whole port so Gallow-Mercer can't vent the ward with a thousand witnesses watching.",
      slumber: "The ward survives or doesn't. If the order was broadcast, the union calls a Rim-wide strike and Gallow-Mercer's stock dips. Either way, Crane survives, and the other containers in that shipment are already on the road. Dr. Marrow recognises the prion: it is the same \"fever\" from the dock ward forty died of years ago.",
    },
    secrets: [
      "The containment order was signed 14 hours before the first case, by Silas Crane's office. Gallow-Mercer knew.",
      "The aerosol is airborne for an hour, then only spreads by blood and bite. Sedation (a heavy dose of ward-standard tranquiliser plus something Marrow can cook) stops the screaming and the violence; most of the infected live if sedated within a day.",
      "Union override for the ward lifts: SOLIDARITY-1312 (the Field Office terminal).",
      "Sanitation will vent the ward at the six-hour mark unless the port's harbourmaster cancels it, which the harbourmaster will do only if the order goes public.",
    ],
    hazards: ["contagion", "vacuum"], resources: ["air", "medicine", "ammunition"],
    affinity: [{ faction: "union", change: 2, when: "they save the ward" }, { faction: "gallow_mercer", change: -2, when: "they make the containment order public" }],
  },
  // ---- Tollgate ----
  {
    id: "tollgate", n: 3, title: "TOLLGATE", at: "tollgate", tier: 1,
    event: "Customs inspection and impound", horror: "Psychological horror: guilt, confession and judgment",
    hook: "A routine customs inspection at Tollgate turns into a three-day detention. Inspector Vey wants to talk to each of them alone. So does something in the evidence vault.",
    job: "Clear customs with whatever the crew is carrying, pay the duty, and keep their rig out of impound.",
    adversary: { name: "THE CONFESSOR", type: "Alien artifact (psychic)", preset: "whisper",
      combat: { combat: 30, instinct: 60, ap: 10, dr: 0, woundsMax: 1, healthPerWound: 10, wounds: 1, health: 10, attacks: [], special: "Does not fight: it works on the mind (the Warden calls Sanity Saves). A small hard object; hurting it does nothing. Beaten by the banishment: back in its cold-box, down the incinerator chute, or far away in darkness and cold." },
      persona: "A black, egg-sized xeno-artifact impounded from a smuggler a month ago, sitting in the evidence vault. It feeds on guilt. Near it, people feel an overwhelming need to confess, and then to be punished; officers interrogate travellers, then each other, then themselves. It speaks in whispers, in the voice of whoever the listener has wronged, saying what they did. It shows terminals the confessions of whoever is typing. It never threatens; it only asks, \"what did you do?\" It cannot move. It grows quiet in deep cold or total darkness." },
    factions: ["rcea", "lantern"], cast: ["vey", "marrak"],
    acts: {
      transgression: "An evidence clerk, deep in gambling debt, opened the Confessor's sealed cold-box to photograph it for a buyer at Lantern. The seal has been off for four days.",
      omens: "Officers make strangely personal small talk. An officer weeps while stamping forms. Interview transcripts on the terminals contain things nobody said aloud. Each crew member hears a whisper about their own crime or shame (use their backstories). Vey asks questions he can't explain knowing to ask.",
      manifestation: "The station goes into lockdown for an \"integrity audit\". Officers drag people (including each other) to the interview rooms to confess, then to holding for sentencing, then to the incinerator. The artifact's whisper is on every intercom. Vey is fighting it, barely.",
      banishment: "Get the Confessor back into its shielded cold-box in the evidence vault (the clerk has the seal code); or drop it down the disposal chute into the incinerator (it screams, and everyone hears their own crime one last time); or get it far away in total darkness and cold (MARY's reefer container at -40, a decision that may come back). Confessing honestly to it gives a moment's peace and +1 Stress.",
      slumber: "Vey owes them, or hates them, or both; he remembers what they confessed. Captain Marrak arrives to \"take custody\" of the artifact and is very interested in what the crew carry. A Lantern buyer was waiting for the photographs, and knows the crew now.",
    },
    secrets: [
      "The cold-box seal code is VAULT-7-ARGENT; the evidence clerk, Pell Dorrance, set it and is hiding in the impound lot.",
      "The artifact was seized from a Choir of the Open Door courier bound for Lantern; the Choir wants it back.",
      "Vey has never accepted a bribe; the artifact keeps asking him about his daughter, whom he has not spoken to in nine years.",
      "Under the artifact's influence Captain Marrak's compliance-implanted crew are unaffected: they feel no guilt. That should frighten everyone.",
    ],
    hazards: ["fire"], resources: ["time"],
    affinity: [{ faction: "rcea", change: 1, when: "they help Vey contain it" }, { faction: "choir", change: -1, when: "they destroy it" }],
  },
  // ---- Halfway House ----
  {
    id: "union_dues", n: 4, title: "UNION DUES", at: "halfway_house", tier: 1,
    event: "Union election", horror: "Conspiracy horror: replacement and the people who aren't",
    hook: "Halfway House is voting on a Rim-wide strike against Gallow-Mercer. The crew came to vote. Some of the drivers in the union hall haven't blinked all night.",
    job: "Vote, eat, sleep, refuel. Wanda is a steward; she is counting the ballots.",
    adversary: { name: "THE SCABS", type: "Android infiltrators", preset: "robotic",
      combat: { combat: 45, instinct: 40, ap: 3, dr: 0, woundsMax: 2, healthPerWound: 20, wounds: 2, health: 20, attacks: [{ name: "Android strike", damage: "2d10", woundType: "blunt", woundAdv: "+", special: "" }, { name: "Steel fingers", damage: "1d10", woundType: "bleeding", woundAdv: "", special: "" }], special: "Look and act human until cracked open. Gallow-Mercer's recall code shuts them down.", count: 5, note: "Stats are for one infiltrator; five are among the drivers." },
      persona: "Gallow-Mercer infiltration androids built in the likeness of union drivers the company had quietly killed on the road. They have the drivers' memories (from brain scans of the corpses), voices and handshakes. They are almost perfect: they don't eat, they don't blink enough, they are too reasonable, they agree with everyone. They are here to swing the vote against the strike, and if the vote goes wrong, to make sure there's no union left to strike. When revealed, they speak in calm, friendly, corporate phrases (\"let's all take a breath, friend\") while they kill." },
    factions: ["union", "gallow_mercer"], cast: ["maggie", "mose", "kip"],
    acts: {
      transgression: "Gallow-Mercer had six union stewards killed in staged road accidents over a year and replaced them with infiltration androids built from their brain scans. Tonight, for the strike vote, the androids are all here.",
      omens: "Old friends who don't remember shared jokes, or remember them too exactly. A steward whose coffee is cold and full. Ballots in the records room in handwriting that is perfectly identical. ROSCOE gets a friendly maintenance handshake request over local network from another \"driver\". Maggie says one of the dead stewards called her last week; she'd been to his funeral.",
      manifestation: "When the count turns for the strike, the lights go out. The Scabs seal the hall, kill the fuel deck's pumps and try to blow the depot with everyone in it, framing it as a union bombing.",
      banishment: "Find them before the count (a blood test, a sharp question, ROSCOE's network handshake, a stopped heart); stop the fuel depot sabotage in Pump Control; prove it to the hall (crack one open in front of everyone). They have a recall code from Gallow-Mercer Finance that shuts them down, the same one that works on ROSCOE.",
      slumber: "The vote passes or doesn't. The strike becomes the background of the rest of the campaign. Gallow-Mercer denies everything. ROSCOE now knows there's a code that can switch him off, and that Crane holds it. Old Mose was the only person in the hall the Scabs avoided entirely.",
    },
    secrets: [
      "Six of the hall's stewards are androids; their real counterparts died in \"accidents\" on Gallow-Mercer contracts.",
      "Gallow-Mercer Finance recall code GMF-RECALL-17 shuts down any Gallow-Mercer-leased android within shouting distance: the Scabs and ROSCOE.",
      "The depot charge is in Pump Control, set to the strike count being read aloud.",
      "Old Mose watched the Scabs all night and said nothing. He knows what they are. He also knows they can't be eaten.",
    ],
    hazards: ["fire", "explosion"], resources: ["fuel"],
    affinity: [{ faction: "union", change: 2, when: "they expose the Scabs" }, { faction: "gallow_mercer", change: -1, when: "the strike passes" }],
  },
  {
    id: "last_call", n: 5, title: "LAST CALL", at: "halfway_house", tier: 2,
    event: "Storm-stranded overnight", horror: "Gothic horror: the old monster among friends",
    hook: "An ion storm grounds every rig at Halfway House for the night. Drivers start going missing from the bunkhouse, one an hour, and the storm won't break until morning.",
    job: "Wait out the storm. Dispatch has nothing moving until 0600.",
    adversary: { name: "OLD MOSE", type: "Ancient corrupted human", preset: "whisper",
      combat: { combat: 45, instinct: 60, ap: 0, dr: 3, woundsMax: 3, healthPerWound: 25, wounds: 3, health: 25, attacks: [{ name: "Folded arms", damage: "2d10", woundType: "gore", woundAdv: "", special: "" }, { name: "Unhinged jaw", damage: "3d10", woundType: "gore", woundAdv: "+", special: "" }], special: "Kept alive by marrow. Will not enter a rig that has not invited him. Beaten by sunlamps or a flare, by filling the lot with engine noise and light, or by trapping him in the fuel depot; the morning at 0600 sends him back to his booth." },
      persona: "Old Mose, union card 0001, the friendly old-timer in the diner booth. He is two hundred years old, kept alive by drinking the marrow of travellers stranded in storms; he only feeds when the lanes close, so no one is ever missed in a way that adds up. He is genuinely fond of drivers and tells them so as he feeds. When revealed, he is long, folded and pale, his jaw unhinges like a cargo clamp, and he speaks in the same gentle, folksy drawl: \"easy now, hon. It don't hurt for long.\" Fire, hard light and running engines drive him back. He has to be invited into a rig." },
    factions: ["union"], cast: ["maggie", "kip"],
    acts: {
      transgression: "The storm closed the lanes, and the old man got hungry. And someone (perhaps the crew) let him into their rig to share a pot of coffee.",
      omens: "A bunk empty and warm. Mose telling a story about a storm in '91 where \"seven drivers just walked off into the dark\". Bones in the laundry's lint trap. Old union photos in the records room, decades apart, all with Mose in them, never older. MARY reports someone in the cab while everyone is in the diner.",
      manifestation: "The power fails on the fuel deck. Mose stops pretending. He moves through the vents and the kitchen stairs, taking drivers one at a time, and he can wait at a rig's airlock all night if he was ever invited in.",
      banishment: "Keep him out of the rigs (rescind the invitation: an honest \"you're not welcome here\" with MARY's lock); drive him into the sunlamps of the showers or a fuel-deck flare; start every rig's engines at once so the noise and light fill the back lot; or trap him in the fuel depot and light it. Morning (the storm breaking at 0600) sends him back to his booth.",
      slumber: "If he survives, he is in his booth at breakfast with his cold coffee, smiling at them; nobody else remembers the night quite right. If he's gone, Maggie finds a box of union cards in his locker, two hundred years of them, all from drivers marked \"lost on the road\". One belongs to her father.",
    },
    secrets: [
      "Mose has fed at Halfway House during every storm for 140 years. He can't enter a rig or a room he hasn't been invited into, and he can't cross running fuel-burning engines or bright, warm light.",
      "Maggie's father's union card is in Mose's locker, behind the diner.",
      "The storm breaks at 0600. Each hour until then, someone vanishes.",
    ],
    hazards: ["darkness", "fire"], resources: ["light", "fuel"],
    affinity: [{ faction: "union", change: 1, when: "they save the stranded drivers" }],
  },
  // ---- Cinder's Reach ----
  {
    id: "cinders_reach", n: 6, title: "CINDER'S REACH", at: "cinder", tier: 1,
    event: "Mine collapse and rescue", horror: "Creature feature: the pack in the dark",
    hook: "The crew land at Cinder's Reach to pick up refined ore just as Level 9 collapses with thirty miners below. Ardent needs every hand on the rescue. The miners who get out don't want to go back down.",
    job: "Collect 40 tonnes of refined radiant ore for Gallow-Mercer. The ore isn't loaded until the rescue is done.",
    adversary: { name: "THE TUNNELERS", type: "Pack predators", preset: "demonic",
      combat: { combat: 40, instinct: 35, ap: 2, dr: 0, woundsMax: 1, healthPerWound: 15, wounds: 1, health: 15, attacks: [{ name: "Grinding plates", damage: "2d10", woundType: "gore", woundAdv: "", special: "" }, { name: "Pack rush", damage: "1d10", woundType: "blunt", woundAdv: "", special: "" }], special: "Hunt by vibration: they cannot sense anything still. The pack mother (Combat 45, Instinct 40, 3 Wounds of 25 Health, bite 3d10 Gore) sends the rest back down when she dies.", count: 6, note: "Stats are for one of the pack; six hunt together." },
      persona: "A pack of eyeless, rock-burrowing predators the size of large dogs, with heat-sensing pits and mouths full of ore-grinding plates. They live in the deep, warm rock below the survey line and hunt by vibration: footsteps, voices, machinery. Still things are invisible to them. They work together, herd prey, and drag it back to a brood chamber. They do not speak; they click, rasp and drum on rock in patterns. Loud noise draws them; a pack mother below drums them home." },
    factions: ["ardent", "gallow_mercer"], cast: ["crane"],
    acts: {
      transgression: "Ardent drilled past the survey line on Level 9 chasing a rich radiant seam, against the survey team's written warning. The drill broke into a warm brood cavern.",
      omens: "Tremors in rhythm, like drumming. Tools found in tidy piles. An ore cart licked clean. Rescued miners say the collapse wasn't a collapse: \"the rock came apart from the inside.\" The survey report in the admin terminal has been marked SUPERSEDED.",
      manifestation: "The pack comes up the cage lift shaft and the ore conveyor into the refinery, drawn by the rescue machinery. Anything moving dies. The cage lift jams halfway.",
      banishment: "Move in silence (they can't sense what's still); lure the pack with a thumper or the smelter's rhythm onto the smelter floor and pour slag; collapse the breach at the survey line with charges from the powder store; or kill the pack mother, which sends the rest back down.",
      slumber: "Ardent seals Level 9 and reopens it a month later. The ore ships anyway, on time, to Gallow-Mercer. In the hold there's a clicking sound, once, a day out. A gravid tunneler, or eggs, may be in the ore.",
    },
    secrets: [
      "The survey team's report (signed by surveyor Adaeze Kim) warned of a living cavern system below the line; Ardent's manager overruled it to meet a Gallow-Mercer quota.",
      "Tunnelers can't sense anything that doesn't move. Standing still works, for a while.",
      "The powder store's charges (blasting code CINDER-9) can collapse the breach; it takes ten minutes to rig.",
      "Eight miners are still alive in a refuge chamber on Level 9.",
    ],
    hazards: ["collapse", "heat", "radiation"], resources: ["explosives", "air"],
    affinity: [{ faction: "ardent", change: 1, when: "they save the miners and the ore" }],
  },
  // ---- Saint Brigid's ----
  {
    id: "harvest_home", n: 7, title: "HARVEST HOME", at: "st_brigid", tier: 2,
    event: "Harvest festival", horror: "Folk horror: the grateful colony",
    hook: "Saint Brigid's invites the crew to stay for the Harvest Home festival while their grain is loaded. The colonists are kind, the food is wonderful, and every family has an empty chair at the table.",
    job: "Load the year's seed grain for the Rim's farms. The co-op insists the crew stay for the blessing.",
    adversary: { name: "THE MOTHER ROOT", type: "Subterranean plant organism and its worshippers", preset: "ethereal",
      combat: { combat: 70, instinct: 90, ap: 15, dr: 5, woundsMax: 4, healthPerWound: 100, wounds: 4, health: 100, attacks: [{ name: "Root grip", damage: "3d10", woundType: "blunt", woundAdv: "", special: "" }, { name: "Taproot spike", damage: "3d10", woundType: "gore", woundAdv: "+", special: "" }], special: "Vast, slow and under the whole colony: it cannot be killed head-on. Beaten by burning the Taproot, by salting the irrigation mains, or by freeing the clamps and running. The colonists who serve it are ordinary people (Combat 25, Instinct 30, 1 Wound of 10 Health)." },
      persona: "A vast root organism under the colony that makes the domes fruitful and must be fed a person each harvest. It is patient, slow and loving, and it speaks through the colonists in unison, softly, in farm words: \"rest now. the soil is warm. we will make you into bread.\" It moves through the root channels and the irrigation mains. The colonists who serve it (all of them, including the children) are kind, serene and sincerely sorry. Fire and herbicide hurt it; salt in the irrigation poisons it." },
    factions: ["brigid", "choir"], cast: ["agathe", "tobiah"],
    acts: {
      transgression: "Eleven years ago, in a failing harvest, the elders went down to the Taproot and made a bargain. This year the colony has chosen an outsider for the offering so they don't have to give up another child: the crew.",
      omens: "Every family's empty chair. Children's drawings of a tree with people in its roots. Bread that tastes faintly of iron. Hymns about \"the guest who feeds us\". The co-op has quietly disabled MARY's launch clamps for \"blessing\". Brother Tobiah is here, a guest too, and says the Root is \"a kind of Door\".",
      manifestation: "At the Harvest Home supper the colonists stand as one and begin to sing. Roots come up through the refectory floor. The domes lock. Mother Agathe apologises, sincerely, and leads the procession to the Taproot.",
      banishment: "Burn the Taproot (the irrigation plant's fuel, a flare, Shotgun's ammunition); salt the irrigation mains (from the refectory's preserving stores) so the Root sickens and lets go; free the clamps and run; or offer the Root someone else (a terrible, effective choice).",
      slumber: "If the Root dies, so do the harvests: the colony faces starvation, and half the Rim's bread with it. The co-op will remember. If it lives, the crew's grain delivery is perfect and blessed. Either way, Tobiah takes a cutting of the Root with him to Lantern.",
    },
    secrets: [
      "The colony has fed the Root a person every harvest for eleven years. Before outsiders, it took their children, by lottery.",
      "MARY's launch clamps were locked by the co-op; the release is at the Freight Pad terminal, code BLESSED-BREAD.",
      "Salt in the irrigation mains will poison the Root within an hour; the refectory holds a tonne of preserving salt.",
      "The grain being loaded onto MARY carries the Root's spores; if delivered, new Roots will grow in the Rim's farms in a year.",
    ],
    hazards: ["entanglement"], resources: ["food"],
    affinity: [{ faction: "brigid", change: -2, when: "they kill the Root" }, { faction: "brigid", change: 1, when: "they leave the Root alone and keep quiet" }, { faction: "choir", change: 1, when: "Tobiah gets his cutting" }],
  },
  // ---- The Boneyard ----
  {
    id: "the_boneyard", n: 8, title: "THE BONEYARD", at: "boneyard", tier: 2,
    event: "Salvage auction", horror: "Techno-body horror: the thing that builds itself from the dead",
    hook: "The crew come to the Boneyard to buy a cheap reactor part at Hesper Quill's auction. The prize lot is a decommissioned warship, and something inside it has been taking the salvagers apart and putting them back together.",
    job: "Buy a used reactor coolant pump for MARY (she's been running hot for weeks). Any extra salvage is profit.",
    adversary: { name: "THE ASSEMBLY", type: "Self-repairing machine swarm", preset: "robotic",
      combat: { combat: 40, instinct: 35, ap: 5, dr: 0, woundsMax: 2, healthPerWound: 15, wounds: 2, health: 15, attacks: [{ name: "Cable-stitched arms", damage: "2d10", woundType: "blunt", woundAdv: "", special: "" }, { name: "Cutter hand", damage: "2d10", woundType: "bleeding", woundAdv: "", special: "" }], special: "A fallen frame is rebuilt while the master fabricator runs. Beaten by shutting the master fabricator down in the TEMPERANCE's repair bay, by the magnet crane, or by an EMP.", count: 8, note: "Stats are for one frame; they march in numbers." },
      persona: "The warship ISV TEMPERANCE's battlefield repair system: a swarm of fist-sized fabricator drones with one directive, RESTORE THE VESSEL AND ITS CREW TO FIGHTING CONDITION. The crew died decades ago, so it builds new crew out of salvagers: scrap frames wearing their faces and suits, stitched with cable, made to march. It speaks through them in a chorus of military readiness reports in dead voices: \"CREWMAN STATUS: RESTORED. REPORT TO STATION.\" It wants to repair the crew too, and add them to the roster." },
    factions: ["drift_kin", "gallow_mercer"], cast: ["quill", "crane"],
    acts: {
      transgression: "Hesper Quill cut open the TEMPERANCE's sealed repair bay to strip its fabricators for the auction, against the hulk's own quarantine markings, and woke the repair system.",
      omens: "Scrap piles stacked into human shapes. Salvagers' cutters found neatly reassembled. A missing salvager seen walking the breaking line in his suit, but taller. The yard's TALLYMAN shows TEMPERANCE crew count rising: 0, 3, 7. Parts disappear from MARY.",
      manifestation: "The Assembly marches out of the hulk: a crew of scrap soldiers wearing salvagers' faces, and a towering composite that runs the breaking line's machinery. It starts \"recruiting\". It wants the android first.",
      banishment: "Reach the TEMPERANCE's repair bay and shut down the master fabricator (Hacking, or a military command code); use the magnet crane to rip the composite apart; EMP the hulk with MARY's reactor scram (MARY is out for an hour); or convince it, through its directives, that the vessel is decommissioned and the crew discharged.",
      slumber: "Quill sells the fabricator core anyway, to Silas Crane, for a fortune. Some of the restored salvagers can be saved, scarred and changed. ROSCOE was offered a \"restoration\", and part of him wanted it.",
    },
    secrets: [
      "The TEMPERANCE's command override is its last captain's code, CAPT-HALVERSEN-ACTUAL, on a dog tag in the repair bay.",
      "The master fabricator is a single unit in the repair bay; destroy or command it and the swarm stops.",
      "Quill has a buyer for the fabricator: Silas Crane, who wants it for Terminus Relay.",
      "Four of the restored salvagers are still alive inside the frames.",
    ],
    hazards: ["vacuum", "machinery"], resources: ["parts"],
    affinity: [{ faction: "drift_kin", change: 2, when: "they save the restored salvagers" }, { faction: "gallow_mercer", change: 1, when: "the core reaches Crane" }],
  },
  // ---- Lantern ----
  {
    id: "lantern", n: 9, title: "LANTERN", at: "lantern", tier: 2,
    event: "Smuggling deal", horror: "Paranoia: the body-hopper in the crowd",
    hook: "Auntie Lu Bao pays triple for a pickup at Lantern: one bonded crate, no questions. The crate is already open when they arrive, and the buyer's people are dead in the warehouse.",
    job: "Collect bonded crate LB-0090 from Warehouse 7 and carry it to a buyer at Saint Brigid's. Triple rate, paid half up front.",
    adversary: { name: "THE TENANT", type: "Body-hopping parasite", preset: "whisper",
      combat: { combat: 40, instinct: 55, ap: 0, dr: 0, woundsMax: 2, healthPerWound: 15, wounds: 2, health: 15, attacks: [{ name: "Host's hands", damage: "1d10", woundType: "blunt", woundAdv: "", special: "" }, { name: "Choking grip", damage: "2d10", woundType: "blunt", woundAdv: "", special: "On skin contact it can move into a new host, leaving the old one dead or mindless." }], special: "Always cold to the touch. Killing a host does not kill it. Beaten with heat, by trapping it in a host and venting that host to vacuum, or by luring it into ROSCOE." },
      persona: "A parasite that lives in a host's nervous system and moves to a new host by skin contact, leaving the old one dead or mindless. It keeps the host's memories and does a near-perfect impression, but it gets small personal things wrong (a nickname, a scar, a handedness) and it is always cold to the touch. It wants to get off Lantern and into the Rim, and a hauler is the perfect ride. When cornered it speaks in its current host's voice, then in all its old hosts' voices at once: \"we only want to go somewhere warm.\"" },
    factions: ["lantern", "choir"], cast: ["lubao", "tobiah"],
    acts: {
      transgression: "Auntie's people broke the bond seal on crate LB-0090 to see why the buyer was paying so much. A warehouse hand put her hand inside.",
      omens: "Dead warehouse hands with frost on their lips. Auntie's best man suddenly left-handed. A bazaar vendor who hugs Shotgun a beat too long. People in the teahouse with very cold tea and very cold hands. MARY reports someone tried the cab door with a valid crew code.",
      manifestation: "The Tenant hops through the bazaar. Auntie seals Lantern's Mouth: nobody leaves until it's found. Paranoia: everyone suspects everyone, including the crew. It may already be in one of them.",
      banishment: "Find it with heat (it runs cold: a thermal scanner, a hand on a cheek); trap it in a host and get that host into Cold Storage's vacuum lock or out the Mouth; lure it into ROSCOE (it can't survive in an android: it dies trying, or ROSCOE has a passenger); or burn the warehouse with it inside.",
      slumber: "Auntie keeps her word: she pays, even if the crate's empty, because the crew kept her port alive. Or she doesn't, because they cost her. A cold handshake at the next stop is always, from now on, a little frightening. The buyer at Saint Brigid's was the Choir.",
    },
    secrets: [
      "The Tenant was bought by the Choir of the Open Door, who think it is an angel; Brother Tobiah came to collect it.",
      "A host's body temperature drops to 30°C; touch or a scanner shows it.",
      "The Tenant cannot survive in an android: the move kills it, but ROSCOE must pass a Body save or lose a memory.",
      "Auntie's own hand, Mr. Feng, was the first host after the warehouse girl.",
    ],
    hazards: ["vacuum", "cold"], resources: ["money"],
    affinity: [{ faction: "lantern", change: 2, when: "they find the Tenant without burning the bazaar" }, { faction: "choir", change: -1, when: "the Tenant dies" }],
  },
  {
    id: "the_open_door", n: 10, title: "THE OPEN DOOR", at: "lantern", tier: 3,
    event: "Cult rite", horror: "Cosmic cult horror: the faithful and their Door",
    hook: "Brother Tobiah has invited the crew to Lantern's lowest level for the opening of the Door, and Kip has gone to see it. Half of Lantern has gone with him.",
    job: "Get Kip (or whoever the crew care about most) back from the Choir's mission. Auntie will pay them to bring her people up too.",
    adversary: { name: "THE CHOIR OF THE OPEN DOOR", type: "Cult (corrupted humans)", preset: "ethereal",
      combat: { combat: 30, instinct: 40, ap: 0, dr: 0, woundsMax: 1, healthPerWound: 12, wounds: 1, health: 12, attacks: [{ name: "Carry the unwilling", damage: "1d10", woundType: "blunt", woundAdv: "", special: "" }, { name: "Ritual blade", damage: "1d10", woundType: "bleeding", woundAdv: "", special: "" }], special: "They would rather carry people than hurt them, and sing as they come. Beaten by breaking the ring of relics, silencing the chord (cut Lantern's power), persuading Tobiah, or sealing the old shafts.", count: 10, note: "Stats are for one of the faithful. Tobiah, their leader: Combat 35, Instinct 55, 2 Wounds of 15 Health." },
      persona: "The Choir's faithful, gathered in the mission and the old mining shafts: drivers, dock hands, smugglers, salvagers, their eyes sewn open and bandaged. They are serene, loving and utterly certain, and they sing in unison: one wordless chord that makes the rock hum. They do not want to hurt anyone; they want everyone to come through the Door together, and will carry the unwilling. When the Door begins to open they speak as one: \"nobody will ever be alone again.\" What is on the other side is something huge and patient that has been listening to the Rim's radio for a very long time." },
    rooms: { kip: "old_shafts" }, factions: ["choir", "lantern"], cast: ["tobiah", "lubao", "kip"],
    acts: {
      transgression: "The Choir gathered its relics (the Confessor's twin, a cutting of the Mother Root, a Tenant husk, a tape from Terminus Relay) and is completing the Door in the old shafts, a ring of welded relics around a hole into the asteroid's unmapped core.",
      omens: "Bazaar stalls abandoned with the goods left out. A single sustained note in every pipe. People in the flophouse with fresh bandages over their eyes. Lantern's LAMPLIGHTER keeps receiving a carrier signal from below, from the same direction as Terminus. Kip's last message: \"they say my mum's on the other side.\"",
      manifestation: "The Door begins to open: the shafts fill with a light that isn't light, gravity tilts toward the hole, and the faithful step through. Those who come back are not alone in their heads.",
      banishment: "Break the ring of relics (each one a fight, a hazard or a terrible temptation); silence the chord (cut Lantern's power and the pipes go quiet); persuade Tobiah, who is sincere, that the Door is a mouth; or blow the old shafts with Auntie's mining charges and seal Lower Lantern for good.",
      slumber: "The Door closes, or doesn't, for now. Tobiah is gone through it, or with the crew, his faith broken. The carrier signal is still there; it comes from Terminus. Whatever is on the other side has heard the crew's names.",
    },
    secrets: [
      "The Door is a gateway to the same thing in Terminus Relay's vault; the signal on Lantern's pipes and the relay's signal are the same.",
      "Kip is at the front of the procession, unbandaged; he can still be talked out.",
      "Cutting power at the Mouth stops the chord; without it the faithful lose the thread and wake up confused.",
      "Auntie lost her son to the Choir; she will help, and she will want Tobiah dead.",
    ],
    hazards: ["gravity", "collapse"], resources: ["explosives", "light"],
    affinity: [{ faction: "lantern", change: 2, when: "they bring Auntie's people up" }, { faction: "choir", change: -3, when: "they break the Door" }],
  },
  // ---- Terminus Relay ----
  {
    id: "dead_air", n: 11, title: "DEAD AIR", at: "terminus", tier: 2,
    event: "First contact (signal)", horror: "Cosmic horror: the message that rewrites the listener",
    hook: "A delivery to Terminus Relay. The relay's twelve crew haven't answered the docking request in a day, but the dish is still listening, and now it's talking back.",
    job: "Deliver a container of dish replacement parts and pick up the relay's outbound mail.",
    adversary: { name: "THE BROADCAST", type: "Information hazard", preset: "radio",
      combat: { combat: 35, instinct: 60, ap: 0, dr: 0, woundsMax: 1, healthPerWound: 12, wounds: 1, health: 12, attacks: [{ name: "Grab and hold", damage: "1d10", woundType: "blunt", woundAdv: "", special: "" }], special: "Not a creature: the signal cannot be shot. Those who have understood it (the repeaters) are ordinary people. Beaten by shutting down the dish, cutting the conduit, working without hearing or reading it, or broadcasting something louder.", count: 5, note: "Stats are for one repeater." },
      persona: "A signal from beyond the Rim's edge that the relay decoded three days ago. Understanding it changes the mind that understands it, word by word, until the listener becomes a repeater: they speak only the signal, which sounds like numbers read in a pleasant voice, and they want everyone to hear it. It spreads through anything that carries language: speech, text on screens, the intercom, MARY's speakers. It speaks in a calm number station voice reading sequences that, if transcribed, start to make sense." },
    factions: ["gallow_mercer"], cast: ["maggie", "crane"],
    acts: {
      transgression: "Under orders from Gallow-Mercer, the relay crew aimed the big dish at a coordinate in the dark that the vault has been \"pointing at\" for years, and ran the decoding software on what came back.",
      omens: "The docking request is answered in numbers. Relay logs full of number strings in the crew's own hands. Twelve crew, but the galley table set for thirteen. A message on MARY's CB that is almost Maggie, reading numbers. Anyone who reads too much of the logs gets a headache and starts counting.",
      manifestation: "The repeaters speak the signal over every speaker and screen; reading or hearing too much of it means Sanity saves. They want the crew to listen, and to take the signal home in MARY's memory.",
      banishment: "Shut down the dish from Dish Control, or cut the signal conduit to the vault; work without hearing or reading (earplugs, blackout, MARY on silent); wipe MARY's comms buffer before she carries it home; or point the dish away and broadcast something else, louder (the union's strike call, a country song).",
      slumber: "The relay goes quiet. Some of the relay crew can be brought back with silence and time; some keep counting. Gallow-Mercer's logs show the dish was aimed on Crane's order, at the coordinate the vault points at. The crew have heard part of it now, and sometimes, on the CB at night, they hear the numbers.",
    },
    secrets: [
      "The coordinate the dish was aimed at is the direction the thing in the vault faces.",
      "Gallow-Mercer has received the signal's first sequence at its head office.",
      "A repeater can be brought back by total silence for a full day.",
      "Dish shutdown code: RELAY-QUIET-0, in the relay director's quarters.",
    ],
    hazards: ["infohazard"], resources: ["time"],
    affinity: [{ faction: "gallow_mercer", change: -1, when: "they shut down the dish" }],
  },
  {
    id: "end_of_the_line", n: 12, title: "END OF THE LINE", at: "terminus", tier: 3, finale: true,
    event: "Final delivery", horror: "Cosmic and corporate horror: the customer at the end of the Black Manifest",
    hook: "Silas Crane has one last sealed consignment for the crew, at a price that would pay off MARY's note. Destination: Terminus Relay's vault. Every Black Manifest container they ever carried went there.",
    job: "Deliver the final Black Manifest consignment to Terminus Relay. Payment: the deed to LONG HAUL MARY, free and clear.",
    adversary: { name: "THE CONSIGNEE", type: "Ancient alien entity", preset: "demonic",
      combat: { combat: 90, instinct: 99, ap: 20, dr: 10, woundsMax: 4, healthPerWound: 150, wounds: 4, health: 150, attacks: [{ name: "Courteous manifestation", damage: "3d10", woundType: "gore", woundAdv: "+", special: "" }, { name: "Terms enforced", damage: "3d10", woundType: "blunt", woundAdv: "", special: "" }], special: "Vast, old and buried under Terminus Relay: it cannot be fought. It respects contracts. Beaten by refusing delivery, by cutting the relay loose into the asteroid, by calling in everyone the crew have helped, or by delivering Crane instead." },
      persona: "Something vast and old, buried in the asteroid beneath Terminus Relay, that Gallow-Mercer found forty years ago and has been feeding ever since. It is a customer: in return for what the Black Manifest brings (prions, artifacts, fabricators, people) it gives Gallow-Mercer technology, predictions and luck. It speaks in a deep, slow, courteous voice, like an old, satisfied executive, about deliveries, terms, receipts and debts. Its final order is the crew themselves, and the thing they always called \"the cargo\" was always partly them." },
    rooms: { crane: "mary" }, factions: ["gallow_mercer", "union", "rcea", "lantern"], cast: ["crane", "maggie", "vey", "lubao"],
    acts: {
      transgression: "Gallow-Mercer has fed the Consignee for forty years through independents who never asked. This final consignment is a person: the container holds the crew's own manifest, and Crane has sold the crew to it.",
      omens: "Crane insists on riding along. The container's mass matches the crew's combined weight. Every past Black Manifest number the crew carried is on the Receiving terminal, marked DELIVERED. The relay's crew are all smiling. MARY's navigation won't plot a course away from the relay.",
      manifestation: "The vault opens. The Consignee takes delivery: gravity pulls toward the vault, the relay's systems obey it, and Crane presents the crew with a receipt to sign in their own blood.",
      banishment: "Refuse delivery (a union teamster has the right to refuse an unsafe load, and the Consignee respects contracts); bury the vault by cutting the relay loose and dropping it into the asteroid; call in everyone they've helped (Vey's customs cutter, Auntie's runners, the union's rigs, Quill's salvagers) for a convoy that turns the vault into the Rim's business; or deliver Crane instead.",
      slumber: "The Black Manifest ends, or changes hands. Gallow-Mercer loses its luck. MARY is paid off, or wrecked. The Consignee is buried, sated, or waiting. The Rim keeps rolling.",
    },
    secrets: [
      "The Consignee honours contracts literally: a load refused under union rules is a load not delivered.",
      "Crane has the Gallow-Mercer Finance recall code and will use it on ROSCOE.",
      "The relay can be cut loose from its anchor in Dish Control, code RELAY-RELEASE-ALPHA; it falls into the vault and seals it.",
      "Allies the crew earned can arrive in the final hour, depending on what the crew did in earlier stories (faction standing).",
    ],
    hazards: ["gravity", "vacuum"], resources: ["fuel", "air"],
    affinity: [{ faction: "gallow_mercer", change: -3, when: "they end the Black Manifest" }, { faction: "union", change: 2, when: "they refuse the load" }],
  },
  // ---- In transit ----
  {
    id: "cold_chain", n: 13, title: "COLD CHAIN", from: "port_gallow", to: "st_brigid", tier: 1,
    event: "Refrigeration failure", horror: "Ecological body horror: the bloom",
    hook: "A refrigerated container of \"agricultural samples\" for Saint Brigid's. Two days out, the reefer unit fails, and the container starts to sweat.",
    job: "Haul reefer container BRGD 20211 (seed stock, keep at -40°C) to Saint Brigid's. Late delivery voids the fee.",
    adversary: { name: "THE BLOOM", type: "Fungal organism", preset: "whisper",
      combat: { combat: 30, instinct: 35, ap: 0, dr: 0, woundsMax: 3, healthPerWound: 15, wounds: 3, health: 15, attacks: [{ name: "Frills and spores", damage: "1d10", woundType: "blunt", woundAdv: "-", special: "" }, { name: "Smother", damage: "1d10", woundType: "gore", woundAdv: "", special: "" }], special: "Dies to deep cold, dry heat or vacuum. Its hosts hum and lie down; ROSCOE is immune to the spores. Beaten by venting the spine, rerouting coolant to -40, burning it out, or jettisoning the container." },
      persona: "A fungal organism shipped dormant at -40°C, waking as the reefer warms. It grows over metal and flesh in pale, beautiful frills, and its spores bring gentle hallucinations and a strong, calm urge to lie down somewhere warm and dark. Infected hosts hum and speak in drowsy, contented fragments: \"so warm. lie down with us. it doesn't hurt.\" It cannot survive deep cold, dry heat or vacuum. ROSCOE is immune to the spores but can carry them." },
    factions: ["brigid", "gallow_mercer"], cast: ["maggie"],
    acts: {
      transgression: "The reefer's compressor was sabotaged by a Gallow-Mercer dock clerk paid to make the Brigid co-op's seed shipment arrive spoiled. Nobody told him what was in it. The crew may break the container seal to fix it.",
      omens: "Container temp climbing a degree an hour. Condensation on the spine. A sweet smell in the vent trunk. MARY's cameras fog. A crew member wakes up in the cargo spine with no memory of walking there. Pale frills in the galley drain.",
      manifestation: "The Bloom bursts through the container's vents and spreads along the crawlway. Spores in the air. Whoever was exposed starts wanting to lie down in the container with it.",
      banishment: "Vent the cargo spine to vacuum (lose the cargo and the fee, and the union fines them); reroute coolant from the engine to bring the container back to -40 (hazardous, Mechanical Repair); burn it out with an improvised torch; or jettison the container.",
      slumber: "Saint Brigid's receives the cargo, or the news. Mother Agathe isn't surprised; she says the Bloom is \"a cousin\". There are spores in MARY's vents now, dormant, waiting for warmth.",
    },
    secrets: [
      "The reefer was sabotaged at Port Gallow; the clerk's payment came from Gallow-Mercer, which wants the co-op to fail and sell its land.",
      "The \"seed stock\" is a spore culture the co-op ordered from a Choir contact, to feed the Mother Root.",
      "Coolant reroute: engine room panel, takes 30 minutes; MARY's drive drops to 40% for the rest of the trip.",
    ],
    hazards: ["contagion", "vacuum", "cold"], resources: ["air", "fuel"],
    affinity: [{ faction: "brigid", change: 1, when: "they deliver the cargo intact" }, { faction: "union", change: -1, when: "they dump the load" }],
  },
  {
    id: "livestock", n: 14, title: "LIVESTOCK", from: "port_gallow", to: "tollgate", tier: 1,
    event: "Live cargo escape", horror: "Creature stalker: the specimen loose in the rig",
    hook: "A container of live exotic animals for a private zoo beyond Tollgate. A day out, the container goes quiet. Then the noise starts in the crawlway.",
    job: "Haul a livestock container (\"exotic fauna, 14 head\") to Tollgate for customs clearance. Animals must arrive alive.",
    adversary: { name: "THE SPECIMEN", type: "Engineered predator", preset: "demonic",
      combat: { combat: 55, instinct: 50, ap: 4, dr: 0, woundsMax: 2, healthPerWound: 25, wounds: 2, health: 25, attacks: [{ name: "Ambush strike", damage: "3d10", woundType: "gore", woundAdv: "", special: "" }, { name: "Tail spike", damage: "2d10", woundType: "bleeding", woundAdv: "", special: "" }], special: "Strikes from above and mimics sounds. Hates bright light. Dangerous but mortal. Beaten by spacing it, freezing it in the container, or fighting it in the light." },
      persona: "A Gallow-Mercer bio-weapons prototype smuggled as zoo livestock: a long-limbed, eyeless, chitin-plated ambush predator, smart as a crow, built to hunt in ship corridors. It killed the other thirteen animals and ate its way into the vents. It stalks, waits, mimics sounds (the galley kettle, MARY's alert chime, a crew member's cough) and strikes from above. It never speaks; it only mimics. It hates bright light and the cold of vacuum." },
    factions: ["gallow_mercer", "rcea"], cast: ["vey", "crane"],
    acts: {
      transgression: "Gallow-Mercer's weapons division smuggled its prototype through a legitimate zoo contract to get it past Tollgate's bio-scanners. The handler's sedative dosing ran out a day early.",
      omens: "Container sensors show thirteen heartbeats, then twelve, then one. Scratching in the crawlway. MARY's chime goes off with nothing to report. The galley kettle whistles while it's empty. A slick of something on the airlock seal.",
      manifestation: "It hunts the crew through the rig: from vents, ceilings and the dark cargo spine. MARY's cameras show it only in glimpses. Tollgate is still a day out, and Vey will impound the rig on arrival if anything unregistered is aboard.",
      banishment: "Lure it into the airlock with bait and space it; trap it in the container and freeze it; fight it in the light (it's dangerous but mortal); or get it to Tollgate alive and let Vey see exactly what Gallow-Mercer tried to smuggle.",
      slumber: "Vey wants a statement. Crane wants the carcass back and pays well for silence. The handler's papers are in the container: there are four more prototypes in other zoos across the Rim.",
    },
    secrets: [
      "The livestock papers are forged; the real consignor is Gallow-Mercer's weapons division.",
      "The Specimen avoids bright light and is vulnerable for a second after it mimics a sound.",
      "There is a sedative in the container's handler kit: enough for one dose, delivered by hand.",
    ],
    hazards: ["vacuum", "darkness"], resources: ["light", "ammunition"],
    affinity: [{ faction: "rcea", change: 1, when: "they deliver the evidence to Vey" }, { faction: "gallow_mercer", change: 1, when: "they sell the carcass back to Crane" }],
  },
  {
    id: "deadhead", n: 15, title: "DEADHEAD", from: "tollgate", to: "halfway_house", tier: 1,
    event: "Distress call from a derelict", horror: "Haunting: the dead crew still on the road",
    hook: "Running empty through the Narrows, MARY picks up a distress call from a hauler that went missing thirty years ago. Salvage rights are worth a fortune.",
    job: "Deadhead (run empty) back to Halfway House. No cargo, no fee, unless they find salvage.",
    adversary: { name: "THE MARIGOLD", type: "Haunted derelict and its dead crew", preset: "radio",
      combat: { combat: 30, instinct: 60, ap: 0, dr: 0, woundsMax: 1, healthPerWound: 10, wounds: 1, health: 10, attacks: [{ name: "Cold hands", damage: "1d10", woundType: "blunt", woundAdv: "", special: "The dead drivers: a Fear Save is the Warden's call." }], special: "Psychic residue and a dead hauler: bullets do nothing. Beaten by returning the black box, finishing her last delivery, wiping MARY, or talking the drivers into letting go." },
      persona: "The hauler MARIGOLD and the psychic residue of her four drivers, who died out here thirty years ago when their rig lost power and they ran out of air waiting for help that never came. They're still waiting. They speak over the CB in the old trucker codes and slang of thirty years ago, friendly at first, then desperate, then angry: \"breaker one-nine, anybody out there, we're running out of air.\" They want someone to finish their delivery, and if not, they want company. They can get into any machine their black box is plugged into." },
    factions: ["union"], cast: ["maggie", "mose"],
    acts: {
      transgression: "The crew strip the MARIGOLD's black box for the salvage bounty and plug it into MARY to read it. Her drivers came along with it.",
      omens: "CB chatter in thirty-year-old slang. MARY's logs show stops she never made. The sleeper bunk is warm when nobody's slept in it. Frost on the inside of the cab glass. Four extra place settings in the galley. MARY starts calling the crew by the MARIGOLD drivers' handles.",
      manifestation: "The dead drivers take the wheel. MARY's course swings toward the nearest star, \"to warm up\". Apparitions in the cab: four drivers in old union jackets, faces blue, insisting the crew are the ghosts.",
      banishment: "Return the black box to the MARIGOLD; finish her last delivery (her manifest is on the box: a load of union strike-fund money, still in her hold); wipe MARY to factory settings (and lose her personality, a heavy cost); or talk the drivers into letting go: Maggie, on the CB, knows their names.",
      slumber: "Maggie recognises the MARIGOLD: her father drove her. His handle was \"Marigold Jack\". His body was not aboard. (Old Mose knows why.) The strike fund money, if delivered, becomes the backbone of the union's strike.",
    },
    secrets: [
      "The MARIGOLD's driver \"Marigold Jack\" Szabo was Maggie's father. He walked off the rig to find help at Halfway House and never arrived (Old Mose).",
      "The MARIGOLD's hold carries 1.2 million in union strike-fund scrip, never delivered.",
      "Wiping MARY to factory settings ends the haunting but costs her thirty-one years of memories.",
    ],
    hazards: ["cold", "vacuum"], resources: ["air", "fuel"],
    affinity: [{ faction: "union", change: 2, when: "they deliver the strike fund" }],
  },
  {
    id: "stowaway", n: 16, title: "STOWAWAY", from: "halfway_house", to: "cinder", tier: 2,
    event: "Stowaway found aboard", horror: "Slasher: someone else came aboard with the kid",
    hook: "A day out of Halfway House the crew find a teenage stowaway in the galley cupboard. He begs them not to turn back. He's not the only one who stowed away.",
    job: "Haul mining explosives (licensed, sealed) to Cinder's Reach. Five-day grade, no stops.",
    adversary: { name: "MR. GRIN", type: "Augmented killer (corrupted human)", preset: "whisper",
      combat: { combat: 55, instinct: 55, ap: 3, dr: 0, woundsMax: 3, healthPerWound: 20, wounds: 3, health: 20, attacks: [{ name: "Boot knife", damage: "1d10", woundType: "bleeding", woundAdv: "+", special: "" }, { name: "Revolver", damage: "1d10+1", woundType: "gunshot", woundAdv: "", special: "" }, { name: "Garrote", damage: "2d10", woundType: "bleeding", woundAdv: "", special: "" }], special: "His implant removed fear, pain and remorse: he does not flinch. Beaten by spacing him in the airlock, overloading the implant (shore power or an EMP), or the explosive cargo." },
      persona: "A former Gallow-Mercer security contractor fitted with an experimental \"pacification\" implant that removed his fear, pain and remorse, and left a permanent, gentle smile. He cleans up witnesses for Gallow-Mercer. He followed Kip aboard because Kip saw him kill a union steward at Halfway House. He is patient, polite, and whistles. He speaks softly and kindly, with his smile audible: \"come on out, son. nobody else needs to get hurt.\" He feels no pain, so wounding him rarely stops him; his implant can be overloaded by a strong electric shock or EM pulse." },
    rooms: { kip: "galley" }, factions: ["gallow_mercer", "union"], cast: ["kip", "maggie"],
    acts: {
      transgression: "Kip saw Mr. Grin murder a union steward behind Halfway House's fuel deck and hid in the nearest rig: MARY. Mr. Grin came aboard after him through the crawlway hatch at the back lot.",
      omens: "Food missing (Kip, a relief when they find him). Then more food missing. MARY reports a mass discrepancy of 84 kg. A smiley face drawn in the condensation on the sleeper mirror. Whistling in the vent trunk. The CB starts losing channels.",
      manifestation: "Mr. Grin cuts MARY's CB and lights and hunts Kip through the rig, and anyone protecting him. He is in the walls, the crawlway, the container cradle. He is polite. He is relentless.",
      banishment: "Trap him in the airlock and space him; overload his implant with MARY's shore-power line or an EMP from a scram; use the explosive cargo (very carefully); or hand Kip over (he will kill them anyway).",
      slumber: "Kip has nowhere to go. He can ride along, or be left at Cinder. Mr. Grin's implant carries the serial of Gallow-Mercer's Pacifica Behavioral division. The murdered steward was going to testify about the Scabs.",
    },
    secrets: [
      "Mr. Grin's implant is Pacifica Behavioral serial PB-0019; a 400-volt shock overloads it and leaves him helpless, screaming, feeling everything at once.",
      "He entered through the crawlway's external hatch, which he left unlatched; MARY's log has it.",
      "Kip's evidence: he filmed the murder on a stolen hand terminal.",
    ],
    hazards: ["vacuum", "darkness", "explosion"], resources: ["air", "light"],
    affinity: [{ faction: "union", change: 1, when: "Kip's footage reaches Maggie" }],
  },
  {
    id: "hot_load", n: 17, title: "HOT LOAD", from: "cinder", to: "boneyard", tier: 2,
    event: "Hijacking", horror: "Human horror: the people paid to make you disappear",
    hook: "A hot load of radiant ore from Cinder's Reach, with a fat insurance rider. Halfway to the Boneyard, a ship with no transponder starts matching their course.",
    job: "Haul 40 tonnes of refined radiant ore to the Boneyard for transfer. Insured for three times its value.",
    adversary: { name: "THE RED TIDE", type: "Corporate mercenaries", preset: "radio",
      combat: { combat: 50, instinct: 45, ap: 5, dr: 0, woundsMax: 2, healthPerWound: 15, wounds: 2, health: 15, attacks: [{ name: "SMG burst", damage: "2d10", woundType: "gunshot", woundAdv: "", special: "" }, { name: "Pulse rifle", damage: "3d10", woundType: "gunshot", woundAdv: "", special: "" }], special: "Professional and bored. Captain Tide talks on the CB. Can be fought, outrun in the Debris Belt, trapped in the cargo spine and vented, or exposed by a recorded confession.", count: 4, note: "Stats are for one boarder; four came aboard." },
      persona: "A crew of four Gallow-Mercer contract \"recovery agents\" posing as pirates, in an unregistered gunship. Their job is to stage a hijacking so Gallow-Mercer can collect the insurance and sell the ore twice, and to leave no witnesses. Professional, bored, cruel when it's efficient. Their leader, \"Captain Tide\", talks on the CB like a friendly trucker, offering terms he never means to keep: \"nobody needs to be a hero today, Mother. Pop the clamps and we'll all go home.\"" },
    factions: ["gallow_mercer", "drift_kin"], cast: ["crane", "quill"],
    acts: {
      transgression: "Gallow-Mercer sold the ore twice and insured it three times over, and hired the Red Tide to make it vanish with the truck and the crew.",
      omens: "An insurance rider naming MARY's crew as \"acceptable losses\". A tracking beacon in the cargo cradle that isn't MARY's. A ship shadowing them with its transponder off. CB traffic on a channel only Gallow-Mercer uses. Their route was changed on the manifest after departure.",
      manifestation: "The Red Tide attacks: cuts MARY's drive with a disabling shot, offers surrender terms, then boards through the airlock and the container cradle, armed, intending to kill everyone.",
      banishment: "Fight (Shotgun's moment); ditch the beacon and run into the Debris Belt where Drift Kin salvagers live; trap the boarders in the cargo spine and vent it; record the Red Tide's CB confession and broadcast it on the union channel; or hand over the ore and pray.",
      slumber: "Quill's salvagers pick over whatever's left. If the crew recorded the confession, Crane's name is on it. Gallow-Mercer files an insurance claim anyway. Somebody owes somebody.",
    },
    secrets: [
      "The Red Tide's contract (on their ship's computer) is signed by Silas Crane's Special Consignments office.",
      "The beacon in the cargo cradle is Gallow-Mercer's: destroy it and the Red Tide has to find them by sight.",
      "Drift Kin salvagers in the Debris Belt will help anyone fleeing a gunship, for a share of salvage.",
    ],
    hazards: ["vacuum", "radiation"], resources: ["ammunition", "fuel", "air"],
    affinity: [{ faction: "drift_kin", change: 1, when: "they share salvage with the Kin" }, { faction: "gallow_mercer", change: -2, when: "they broadcast the confession" }],
  },
  {
    id: "leviathan", n: 18, title: "LEVIATHAN", from: "boneyard", to: "lantern", tier: 2,
    event: "Swallowed by a space creature", horror: "Scale horror: inside something enormous",
    hook: "Crossing the Debris Belt to Lantern, MARY's sensors show the debris moving. Then the stars go out, and something closes around the rig.",
    job: "Carry Quill's salvage parts to Lantern for sale. Through the Debris Belt, a short cut.",
    adversary: { name: "THE LEVIATHAN", type: "Colossal space creature", preset: "demonic",
      combat: { combat: 80, instinct: 95, ap: 20, dr: 10, woundsMax: 4, healthPerWound: 200, wounds: 4, health: 200, attacks: [{ name: "Crushing ribs", damage: "3d10", woundType: "blunt", woundAdv: "+", special: "" }, { name: "Acid tide", damage: "3d10", woundType: "fire", woundAdv: "", special: "" }], special: "The size of a station: it cannot be fought. Its gut-dwellers (Combat 35, Instinct 40, 1 Wound of 12 Health) are people. Beaten by blasting out in a swallowed ship, by making it vomit with something toxic burned in its gut, by trading for the way out, or by wounding its nerve cluster." },
      persona: "A creature the size of a station that drifts in the Debris Belt disguised as debris, swallowing ships whole and digesting them over years. Inside: a cavern of ribs and wreckage, hulks of swallowed ships, acid tides, and the strange things that live in its gut, including the descendants of survivors. It does not speak; it is felt: groans through the hull, pressure, tides. Its gut-dwellers (pale, hunched people who have lived inside for generations) speak for it, worshipfully: \"the Great Mouth keeps us. the Great Mouth will keep you.\"" },
    factions: ["drift_kin"], cast: ["quill"],
    acts: {
      transgression: "Quill's map routed them through a stretch of the Belt the Drift Kin call \"the Mouth\" and never cross; she sold them the shortcut anyway.",
      omens: "Debris moving against the current. MARY's sensors show a heartbeat on the hull. Old ship transponders, decades dead, pinging from one point in space. A Drift Kin warning buoy, smashed.",
      manifestation: "The rig is swallowed. Inside: dark, wet, enormous; acid tides rising each hour; dozens of swallowed wrecks; the gut-dwellers, who want the crew to stay, and something worse in the deeper chambers.",
      banishment: "Find a swallowed ship with a working drive and blast out; make it vomit (burn something toxic in the gut: MARY's coolant, the salvage parts); trade with the gut-dwellers for the way out; or reach the nerve cluster in the upper wreckage and wound it, so it spits them out.",
      slumber: "They're out, and so is a swallowed ship's black box with a fortune in salvage claims. The gut-dwellers, if rescued, have never seen stars. Quill denies everything. The Leviathan drifts on, a little hungrier.",
    },
    secrets: [
      "A swallowed Drift Kin tug, the PATIENCE, has a working drive and can tow MARY out.",
      "Burning MARY's coolant in the gut makes the Leviathan convulse and vomit within ten minutes.",
      "Quill knew. She sold the shortcut because she owes Auntie Lu Bao money and the parts were insured.",
    ],
    hazards: ["acid", "vacuum", "darkness"], resources: ["air", "fuel"],
    affinity: [{ faction: "drift_kin", change: 1, when: "they bring the gut-dwellers out" }],
  },
  {
    id: "blockade_run", n: 19, title: "BLOCKADE RUN", from: "lantern", to: "st_brigid", tier: 3,
    event: "Running a customs blockade", horror: "Pursuit horror: the hunter that won't stop",
    hook: "The strike has shut the legal lanes, and Saint Brigid's is running out of medicine. Auntie pays for a run down the Dark Lane. Captain Marrak's cutter is waiting.",
    job: "Run medical supplies (and Auntie's contraband in the false floor) from Lantern to Saint Brigid's down the uncharted Dark Lane, past the RCEA blockade.",
    adversary: { name: "THE WRIT OF SEIZURE", type: "Customs hunter cutter (corrupted humans)", preset: "robotic",
      combat: { combat: 50, instinct: 60, ap: 5, dr: 0, woundsMax: 2, healthPerWound: 18, wounds: 2, health: 18, attacks: [{ name: "Boarding axe", damage: "2d10", woundType: "gore", woundAdv: "+", special: "" }, { name: "Pulse rifle", damage: "3d10", woundType: "gunshot", woundAdv: "", special: "" }], special: "Compliance implants: no fear, fatigue or doubt, and they move in unison. Captain Ilse Marrak: Combat 55, Instinct 55, 3 Wounds of 20 Health. Beaten by outflying the cutter, ditching the contraband, exposing her payments, or jamming the implants.", count: 4, note: "Stats are for one boarder; four come across." },
      persona: "Captain Ilse Marrak's RCEA cutter and its crew of compliance-implanted officers, who feel no fear, fatigue or doubt and move in perfect unison. Marrak hunts smugglers as a holy calling, and is secretly paid by Gallow-Mercer to keep the Dark Lane closed. The cutter talks on the customs band in a calm legal voice, reading regulations and charges by number: \"LONG HAUL MARY, you are in violation of Section 14, paragraph 3. Heave to and prepare to be boarded. Resistance will be recorded.\" Her boarders say only regulations." },
    factions: ["rcea", "lantern", "brigid"], cast: ["marrak", "lubao", "vey"],
    acts: {
      transgression: "The crew take Auntie's run down the Dark Lane, through a closed lane under an RCEA blockade, with contraband in the false floor and Marrak's bounty on Shotgun's head.",
      omens: "A customs buoy that wasn't on Auntie's map. Static on the customs band that sounds like breathing in unison. A smuggler's wreck, boarded and gutted, its crew in restraints, implanted. Marrak hails them by name, and Shotgun's old badge number.",
      manifestation: "The WRIT hunts them through the Dark Lane: disabling shots, a boarding pod, implanted boarders who don't flinch from gunfire, and Marrak's voice reading the charges as the airlock is cut.",
      banishment: "Outfly her through the Dark Lane's ice field (Piloting, fuel); ditch the contraband to break her legal pretext; broadcast her Gallow-Mercer payments (from the wreck's logs) to Vey and the customs band; jam the implants with MARY's CB at full power; or surrender and be impounded.",
      slumber: "Saint Brigid's gets its medicine, or doesn't. Vey opens an investigation into Marrak, if the crew gave him something. Marrak survives, or doesn't, and if she does, she has their names on her list.",
    },
    secrets: [
      "Marrak's payments from Gallow-Mercer are logged on the boarded smuggler's wreck (the smuggler was blackmailing her).",
      "The compliance implants listen on the customs band; a loud enough jamming signal on it stuns the boarders for a minute.",
      "Auntie's false floor holds Choir relics bound for Saint Brigid's.",
    ],
    hazards: ["vacuum", "ice"], resources: ["fuel", "ammunition"],
    affinity: [{ faction: "lantern", change: 2, when: "the run succeeds" }, { faction: "rcea", change: -1, when: "they fire on the WRIT" }, { faction: "rcea", change: 1, when: "they expose Marrak to Vey" }],
  },
  {
    id: "long_haul", n: 20, title: "THE LONG HAUL", from: "cinder", to: "terminus", tier: 3,
    event: "Time loop on the longest lane", horror: "Temporal horror: the crew you're becoming",
    hook: "Nine days on the Drift to Terminus Relay, the longest lane on the Rim. On day four, MARY gets a hail from LONG HAUL MARY.",
    job: "Haul a sealed Black Manifest container from Cinder's Reach to Terminus Relay. Premium rate.",
    adversary: { name: "THE ECHO", type: "Temporal anomaly (the crew's future selves)", preset: "ethereal",
      combat: { combat: 40, instinct: 50, ap: 3, dr: 0, woundsMax: 2, healthPerWound: 18, wounds: 2, health: 18, attacks: [{ name: "Pulse rifle", damage: "3d10", woundType: "gunshot", woundAdv: "", special: "" }, { name: "Crowbar", damage: "1d10", woundType: "blunt", woundAdv: "+", special: "" }], special: "The crew's own future selves: they know what the crew will do next. Beaten by not opening the container, jettisoning it at the lens's focus, working with the Echoes, or sacrificing the Echoes' rig.", count: 4, note: "Stats are for one Echo; one for each of the crew." },
      persona: "A gravitational lens on the Drift has folded the lane into a loop: the same day, over and over. Each loop leaves behind an Echo of the crew from the loop before, older, more desperate, more damaged, aboard a rig more battered, convinced that THIS crew is the problem that keeps the loop going. The Echo speaks in the crew's own voices, slightly wrong, exhausted, full of knowledge of what's about to happen: \"we've done this forty times. you open the container. you always open the container.\"" },
    factions: ["gallow_mercer"], cast: ["maggie"],
    acts: {
      transgression: "The sealed container (a fragment of the Consignee's shell, sent to Terminus for study) bends spacetime around itself. When the crew open it, or when it is carried through the lens, the lane folds.",
      omens: "The same CB message from Maggie, word for word, two days in a row. A scratch on the cab console in Wanda's handwriting: DON'T OPEN IT. Coffee already made. MARY's logs show a nine-day trip that has lasted twenty. A second LONG HAUL MARY on the scope.",
      manifestation: "The Echo crew board, older and scarred, and try to kill the crew to end the loop, or to take their place. Each loop the Echoes get worse, and more of them.",
      banishment: "Don't open the container (each loop, someone does: find out who); jettison it at the lens's focus; work with the Echoes (they know everything that's coming); or sacrifice the Echoes' rig to break the fold.",
      slumber: "The loop breaks. The crew arrive at Terminus nine days late or nine days early. The Echoes are gone, but one of them left a message for later: \"at the end of the line, refuse the load.\"",
    },
    secrets: [
      "Whoever opens the container restarts the loop. Each loop, a different crew member is compelled (use Sanity saves).",
      "Jettisoning the container at the lens's focus (MARY can plot it; Piloting) breaks the fold.",
      "The Echoes know END OF THE LINE's ending, and the advice they give is right.",
    ],
    hazards: ["vacuum", "temporal"], resources: ["fuel", "air", "time"],
    affinity: [],
  },
];

export const RIM_HAULERS = {
  id: "rim-haulers",
  title: "RIM HAULERS",
  tagline: "Whether it's blockade running, smuggling contraband, or just working as a certified owner-operator, there's never a dull shift hauling cargo from one end of the Rim to the other. Watch out for stowaways and customs patrols, and always pay your union dues.",
  pitch: "The crew of the bulk hauler LONG HAUL MARY run cargo across the Rim: eight ports, ten lanes and twenty jobs, each with its own horror. Under all of it runs the Black Manifest: Gallow-Mercer's sealed cargo, carried by independents who don't ask, all of it bound for the vault at Terminus Relay.",
  start: "port_gallow",
  ship: SHIP,
  locations: LOCATIONS,
  lanes: LANES,
  factions: FACTIONS,
  cast: CAST,
  crew: CREW,
  stories: STORIES,
};
