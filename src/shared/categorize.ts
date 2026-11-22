import type { RegionId } from './types';

// Keyword heuristics used to sort a newly imported game into a world region.
// The user can always change the region from the chest's edit screen.
const RULES: [RegionId, RegExp][] = [
  ['fps', /\b(counter[- ]?strike|cs2|call of duty|valorant|doom|apex|overwatch|battlefield|halo|wolfenstein|quake|rainbow six|titanfall|borderlands|far cry|crysis|left 4 dead|team fortress|insurgency|ready or not|escape from tarkov|destiny|shooter|fps|metro|bioshock|deep rock|payday|hunt|trepang2?|f\.e\.a\.r|serious sam|ultrakill)\b/i],
  ['rpg', /\b(elder scrolls|skyrim|oblivion|witcher|fantasy|dragon|souls|elden|baldur|final fantasy|kingdom|rpg|diablo|path of exile|mass effect|fallout|cyberpunk|divinity|pillars|persona|starfield|knight|legend|age of|total war|crusader|mount ?& ?blade|lord|chronicles)\b/i],
  ['survival', /\b(survival|survive|rust|valheim|ark|the forest|sons of the forest|subnautica|don'?t starve|dayz|7 days|raft|green hell|grounded|project zomboid|palworld|enshrouded|the long dark|stranded|conan)\b/i],
  ['sandbox', /\b(garry|terraria|sandbox|simulator|factorio|cities|kerbal|sims|satisfactory|teardown|space engineers|besiege|planet|tycoon|stardew|builder|craft|dyson|rimworld|oxygen|no man'?s sky|beamng|euro truck|flight)\b/i],
  ['adventure', /\b(tomb raider|uncharted|zelda|adventure|portal|assassin|odyssey|journey|it takes two|god of war|spider|batman|horizon|red dead|grand theft|gta|death stranding|ori|hollow|life is strange|resident evil|alan wake|half-life|dishonored|prince|watch dogs|mario|sonic|hitman|mafia|control|kart|racing|forza|need for speed)\b/i],
];

export function guessCategory(title: string, hint?: string): RegionId {
  const text = `${title} ${hint ?? ''}`;
  for (const [region, re] of RULES) if (re.test(text)) return region;
  return 'indie';
}
