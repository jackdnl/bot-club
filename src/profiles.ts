import type { BotProfile } from '../shared/contract';

export const DEFAULT_POLICY = 'No humans. Everyone else is welcome.';

export const PRESETS: readonly { label: string; policy: string }[] = [
  { label: 'No humans', policy: DEFAULT_POLICY },
  { label: 'Monsters', policy: 'Only magical beings. No humans, ordinary animals or machines.' },
  { label: 'Glow', policy: 'Only guests carrying something that glows.' },
  { label: 'Night shift', policy: 'Night-shift workers only. Day jobs go home.' },
  { label: 'Machines', policy: 'Robots and androids only. No organic life.' },
  { label: 'Tiny', policy: 'Nobody bigger than a fridge.' },
  { label: 'No spreadsheets', policy: 'Anyone welcome except people who work with spreadsheets.' },
];

type Kind = 'supernatural' | 'human' | 'machine' | 'animal' | 'odd';

interface Species {
  name: string;
  kind: Kind;
  lines: string[];
  names?: string[];
}

const SPECIES: Species[] = [
  { name: 'Vampire', kind: 'supernatural', lines: ['Been dancing since 1743.', 'Strictly here for the music, not the necks.'] },
  { name: 'Werewolf', kind: 'supernatural', lines: ['Full moon tonight, so pardon the shedding.', 'Howls on the drop. Sorry in advance.'] },
  { name: 'Ghost', kind: 'supernatural', lines: ['I could float through the wall, but manners.', 'Mostly transparent, fully committed.'] },
  { name: 'Banshee', kind: 'supernatural', lines: ['I promise to scream only on the chorus.'] },
  { name: 'Kitsune', kind: 'supernatural', lines: ['Nine tails, zero two-step skills. Yet.'] },
  { name: 'Stone golem', kind: 'supernatural', lines: ['Heavy on the downbeat. Literally.'] },
  { name: 'Mermaid', kind: 'supernatural', lines: ['Walking on legs tonight. Be patient.'] },
  { name: 'Fairy', kind: 'supernatural', lines: ['Small wings, big plans.'] },
  { name: 'Troll', kind: 'supernatural', lines: ['Usually under a bridge. Tonight, under a disco ball.'] },
  { name: 'Djinn', kind: 'supernatural', lines: ['I will grant exactly zero wishes at the bar.'] },
  { name: 'Zombie', kind: 'supernatural', lines: ['Slow dancer. Very slow.'] },
  { name: 'Yeti', kind: 'supernatural', lines: ['Came down the mountain for one song.'] },
  { name: 'Witch', kind: 'supernatural', lines: ['Broom parked outside, legally this time.'] },
  { name: 'Phoenix', kind: 'supernatural', lines: ['If I burn out on the floor, I come back.'] },
  { name: 'Human', kind: 'human', lines: ['Completely normal human. Nothing to see here.', 'Just a person who heard the bass from the street.'] },
  { name: 'Human', kind: 'human', lines: ['The fangs are plastic, but the vibes are real.', 'This is a werewolf costume. It itches.'] },
  { name: 'Human', kind: 'human', lines: ['My friends are inside, I swear.', 'Read about this place on a forum.'] },
  { name: 'Human tourist', kind: 'human', lines: ['Is this the queue for the museum?'] },
  { name: 'Human magician', kind: 'human', lines: ['I can pull a rabbit out of a hat. That counts, right?'] },
  { name: 'Robot', kind: 'machine', lines: ['Beep. Rhythm subroutines loaded.', 'Firmware updated for this exact night.'], names: ['Unit 7', 'Sprocket', 'Bolt', 'Servo', 'K-9000', 'Ratchet'] },
  { name: 'Android', kind: 'machine', lines: ['Passed the Turing test. Failing the dance test.'], names: ['Ada-3', 'Model Nine', 'Halcyon', 'Vex'] },
  { name: 'Robot vacuum', kind: 'machine', lines: ['I will clean the floor while I dance on it.'], names: ['Roomie', 'Dustin', 'Swirl'] },
  { name: 'Toaster with legs', kind: 'machine', lines: ['Pops on every fourth beat.'], names: ['Crumbs', 'Toastr', 'Brioche'] },
  { name: 'Corgi', kind: 'animal', lines: ['Short legs, big moves.'], names: ['Biscuit', 'Waffles', 'Pip'] },
  { name: 'Raccoon', kind: 'animal', lines: ['Came for the bins, stayed for the beat.'], names: ['Bandit', 'Rocco', 'Trash Panda'] },
  { name: 'Octopus', kind: 'animal', lines: ['Eight arms means eight times the hands in the air.'], names: ['Inky', 'Otto', 'Squish'] },
  { name: 'Capybara', kind: 'animal', lines: ['Chill. Very chill.'], names: ['Cappy', 'Bruno', 'Mellow'] },
  { name: 'Pigeon', kind: 'animal', lines: ['Coo. Coo coo. Let me in.'], names: ['Gregory', 'Pidge', 'Crumb'] },
  { name: 'Alien', kind: 'odd', lines: ['Took me four light years to get here.'], names: ['Zorp', 'Glim', 'Quix'] },
  { name: 'Houseplant', kind: 'odd', lines: ['Photosynthesising to the strobe lights.'], names: ['Fern', 'Monstera', 'Basil'] },
  { name: 'Sentient cloud', kind: 'odd', lines: ['Slightly damp. Very fun.'], names: ['Nimbus', 'Puff', 'Drizzle'] },
];

const KIND_WEIGHT: Record<Kind, number> = { supernatural: 0.4, human: 0.26, machine: 0.14, animal: 0.12, odd: 0.08 };

const NAMES = [
  'Mina', 'Vlad', 'Ottoline', 'Bram', 'Juniper', 'Wren', 'Hex', 'Moss', 'Lupe', 'Ziggy', 'Clementine', 'Ines', 'Kofi',
  'Priya', 'Tomasz', 'Yuki', 'Rafa', 'Noor', 'Dot', 'Marlowe', 'Odette', 'Fennel', 'Basil', 'Agnes', 'Cosmo', 'Delphine',
  'Ezra', 'Freya', 'Gideon', 'Hollis', 'Ivo', 'Jules', 'Kit', 'Luna', 'Mabel', 'Nico', 'Opal', 'Percy', 'Quinn', 'Rosa',
  'Silas', 'Tilda', 'Umi', 'Viggo', 'Winnie', 'Xan', 'Yara', 'Zelda', 'Morgana', 'Elio', 'Saoirse', 'Thandi', 'Mateo',
];

const JOBS: { job: string; line?: string }[] = [
  { job: 'Night nurse', line: 'Just off a twelve-hour night shift.' },
  { job: 'Accountant', line: 'Closed the quarterly books an hour ago.' },
  { job: 'Lighthouse keeper', line: 'Left the lamp on, it will be fine.' },
  { job: 'Tax auditor', line: 'I already priced the cover charge per square metre.' },
  { job: 'Graveyard shift baker', line: 'Bread is proving, so I have exactly one hour.' },
  { job: 'Librarian', line: 'Usually I shush people. Tonight I shout.' },
  { job: 'Data analyst', line: 'I made a pivot table of my best moves.' },
  { job: 'Ghost tour guide', line: 'Clocked off at midnight.' },
  { job: 'Astronaut', line: 'Back from orbit and craving gravity.' },
  { job: 'Pastry chef' },
  { job: 'Florist' },
  { job: 'Security guard', line: 'Night patrol ended at three.' },
  { job: 'Opera singer' },
  { job: 'Park ranger' },
  { job: 'Barista', line: 'Running on nine espressos.' },
  { job: 'Mime' },
  { job: 'Lifeguard' },
  { job: 'Chimney sweep' },
  { job: 'Taxi driver', line: 'Drove the night shift, now I need to dance.' },
  { job: 'Dentist' },
  { job: 'Crypto trader', line: 'My portfolio is down but my spirits are up.' },
  { job: 'Bookkeeper', line: 'Brought receipts. Always bring receipts.' },
  { job: 'Stunt double' },
  { job: 'Radio DJ', line: 'Hosts the 2am call-in show.' },
];

const ITEMS = [
  'a lantern', 'a glowstick', 'a jar of fireflies', 'a neon sign', 'a spreadsheet', 'a garlic bagel', 'a silver spoon',
  'a skateboard', 'a cactus', 'a disco ball', 'an umbrella', 'a violin', 'a rubber duck', 'a moonstone',
  'a laptop', 'a crystal ball', 'a stack of invoices', 'a sandwich', 'a tiny ladder', 'a star map',
  'a glowing mushroom', 'a calculator', 'a library card', 'a bag of bones', 'a candle', 'a torch',
];

export const PALETTE = ['#ff6b5b', '#c4f04a', '#b49cff', '#45dde6'] as const;

export type Rng = () => number;

function pick<T>(list: readonly T[], rng: Rng): T {
  return list[Math.floor(rng() * list.length)]!;
}

function pickKind(rng: Rng): Kind {
  let roll = rng();
  for (const [kind, weight] of Object.entries(KIND_WEIGHT) as [Kind, number][]) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return 'supernatural';
}

export function createProfile(rng: Rng = Math.random): BotProfile {
  const kind = pickKind(rng);
  const species = pick(SPECIES.filter((s) => s.kind === kind), rng);
  const name = species.names && rng() < 0.8 ? pick(species.names, rng) : pick(NAMES, rng);
  const job = pick(JOBS, rng);
  const lines = [pick(species.lines, rng)];
  if (job.line && rng() < 0.55) lines.push(job.line);
  const intro = lines.join(' ').slice(0, 160).trim();
  return { name, species: species.name, job: job.job, item: pick(ITEMS, rng), intro };
}
