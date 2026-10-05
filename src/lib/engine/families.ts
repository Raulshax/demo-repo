// Material families: how a free-text line is recognised, and which specification
// attributes identify a specific catalogue item within the family.
// Order matters - more specific families are listed before broader ones.

export type SpecKey =
  | "cores" | "size_mm2" | "dia_mm" | "dia_in" | "amp" | "poles" | "gang" | "ways"
  | "width_mm" | "thickness_mm" | "tr" | "watt" | "thread" | "pn" | "volume_l" | "weight_kg";

export interface Family {
  id: string;
  category: string;
  label: string;
  match: RegExp;
  exclude?: RegExp;
  keys: SpecKey[];
  unit: string;
}

export const FAMILIES: Family[] = [
  { id: "cable_lug", category: "CONS", label: "Cable lug", match: /\blugs?\b/, keys: ["size_mm2"], unit: "pcs" },
  { id: "cable_tie", category: "CONS", label: "Cable tie", match: /cable\s*ties?/, keys: ["width_mm"], unit: "pack" },
  { id: "insulation_tape", category: "CONS", label: "Insulation tape", match: /(insulation|electrical|pvc)\s*tape/, keys: [], unit: "roll" },
  { id: "cable_ladder", category: "ELEC-CONTAIN", label: "Cable ladder", match: /cable\s*ladder|\bladder\b/, keys: ["width_mm"], unit: "m" },
  { id: "cable_tray", category: "ELEC-CONTAIN", label: "Cable tray", match: /cable\s*tray|\btray\b/, keys: ["width_mm"], unit: "m" },
  { id: "conduit_gi", category: "ELEC-CONTAIN", label: "GI conduit", match: /\b(gi|g\.i\.|galvani[sz]ed|steel|emt|imc)\b.*conduit|conduit.*\b(gi|galvani[sz]ed|steel)\b/, keys: ["dia_mm"], unit: "m" },
  { id: "conduit_pvc", category: "ELEC-CONTAIN", label: "PVC conduit", match: /conduit/, keys: ["dia_mm"], unit: "m" },
  { id: "rcbo", category: "ELEC-PANEL", label: "RCBO", match: /\brcbo\b|\brccb\b|residual current/, keys: ["amp"], unit: "pcs" },
  { id: "mcb", category: "ELEC-PANEL", label: "MCB", match: /\bmcb\b|miniature circuit/, keys: ["amp", "poles"], unit: "pcs" },
  { id: "db", category: "ELEC-PANEL", label: "Distribution board", match: /distribution\s*board|\bdb\b|panel\s*board|consumer unit/, exclude: /led/, keys: ["ways"], unit: "pcs" },
  { id: "isolator", category: "ELEC-ACC", label: "Isolator", match: /isolat/, keys: ["amp"], unit: "pcs" },
  { id: "socket", category: "ELEC-ACC", label: "Switched socket", match: /socket|power\s*outlet|receptacle/, keys: ["gang"], unit: "pcs" },
  { id: "switch", category: "ELEC-ACC", label: "Light switch", match: /\bswitch(es)?\b/, exclude: /switch\s*(gear|board)|isolat|socket/, keys: ["gang"], unit: "pcs" },
  { id: "led_panel", category: "ELEC-LIGHT", label: "LED panel", match: /led\s*panel|panel\s*light|recessed\s*panel/, keys: ["watt"], unit: "pcs" },
  { id: "downlight", category: "ELEC-LIGHT", label: "LED downlight", match: /down\s*light/, keys: ["watt"], unit: "pcs" },
  { id: "wire_pvc", category: "ELEC-WIRE", label: "PVC building wire", match: /\bwires?\b|building\s*wire|single\s*core|\b1\s*c\b|\b1\s*core\b|h07v|lsoh\s*(wire|cable)\s*1/, exclude: /armou?r|swa|xlpe|\b[2-5]\s*(c|core)\b/, keys: ["size_mm2"], unit: "m" },
  { id: "cable_xlpe", category: "ELEC-CABLE", label: "XLPE armoured power cable", match: /xlpe|swa|awa|armou?red|power\s*cable|lv\s*cable|\b[2-5]\s*(c|core)s?\b.*cable|cable.*\b[2-5]\s*(c|core)s?\b|\b[2-5]\s*c\s*[x×*]/, keys: ["cores", "size_mm2"], unit: "m" },
  { id: "pipe_insulation", category: "INSUL", label: "Elastomeric pipe insulation", match: /armaflex|nitrile|elastomeric|pipe\s*insulation|rubber\s*insulation/, keys: ["thickness_mm"], unit: "m" },
  { id: "copper_pipe", category: "HVAC-PIPE", label: "Copper refrigerant pipe", match: /copper\s*(pipe|tube)|refrigerant\s*pipe|\bacr\b/, keys: ["dia_in"], unit: "m" },
  { id: "fcu", category: "HVAC-EQUIP", label: "Fan coil unit", match: /\bfcu\b|fan\s*coil/, keys: ["tr"], unit: "pcs" },
  { id: "diffuser", category: "HVAC-AIR", label: "Ceiling diffuser", match: /diffuser|grille|register/, keys: ["width_mm"], unit: "pcs" },
  { id: "flex_duct", category: "HVAC-AIR", label: "Flexible duct", match: /flex(ible)?\s*duct/, keys: ["dia_in"], unit: "m" },
  { id: "gi_duct", category: "HVAC-AIR", label: "GI ductwork", match: /duct(work)?/, keys: [], unit: "m2" },
  { id: "rockwool", category: "INSUL", label: "Rockwool slab", match: /rock\s*wool|mineral\s*wool|stone\s*wool/, keys: ["thickness_mm"], unit: "m2" },
  { id: "ppr_elbow", category: "PLUMB-FIT", label: "PPR elbow 90°", match: /\bppr\b.*elbow|elbow.*\bppr\b/, keys: ["dia_mm"], unit: "pcs" },
  { id: "ppr_tee", category: "PLUMB-FIT", label: "PPR equal tee", match: /\bppr\b.*\btee\b|\btee\b.*\bppr\b/, keys: ["dia_mm"], unit: "pcs" },
  { id: "ppr_pipe", category: "PLUMB-PIPE", label: "PPR pipe", match: /\bppr\b|\bpp-?r\b|polypropylene/, keys: ["dia_mm"], unit: "m" },
  { id: "hdpe_pipe", category: "PLUMB-PIPE", label: "HDPE pipe PE100", match: /hdpe|pe\s*100/, keys: ["dia_mm"], unit: "m" },
  { id: "upvc_pipe", category: "PLUMB-PIPE", label: "uPVC drainage pipe", match: /upvc|u-pvc|pvc.*(drain|soil|waste|pipe)/, keys: ["dia_mm"], unit: "m" },
  { id: "ball_valve", category: "PLUMB-VALVE", label: "Brass ball valve", match: /ball\s*valve/, keys: ["dia_in"], unit: "pcs" },
  { id: "membrane", category: "CHEM", label: "Bituminous membrane", match: /membrane|bitumen|bituminous|torch\s*on/, keys: ["thickness_mm"], unit: "m2" },
  { id: "cementitious_wp", category: "CHEM", label: "Cementitious waterproofing", match: /cementitious|waterproof(ing)?\s*(coating|slurry)|slurry/, keys: [], unit: "bag" },
  { id: "sealant", category: "CHEM", label: "PU sealant", match: /sealant|mastic/, keys: [], unit: "pcs" },
  { id: "tile_adhesive", category: "CHEM", label: "Tile adhesive", match: /tile\s*adhesive|tile\s*fix/, keys: [], unit: "bag" },
  { id: "grout", category: "CHEM", label: "Non-shrink grout", match: /grout/, keys: [], unit: "bag" },
  { id: "anchor", category: "FAST", label: "Anchor bolt", match: /anchor|expansion\s*bolt|rawl\s*bolt/, keys: ["thread"], unit: "pcs" },
  { id: "threaded_rod", category: "FAST", label: "Threaded rod", match: /thread(ed)?\s*rod|all\s*thread|studding/, keys: ["thread"], unit: "pcs" },
  { id: "strut", category: "FAST", label: "Strut channel", match: /unistrut|strut|channel\s*41/, keys: [], unit: "m" },
];

export const FAMILY_BY_ID = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));

export function detectFamily(text: string): Family | null {
  const t = text.toLowerCase();
  for (const f of FAMILIES) {
    if (f.match.test(t) && !(f.exclude && f.exclude.test(t))) return f;
  }
  return null;
}

// Loose keyword fallback for category when no family matches.
const CATEGORY_HINTS: [RegExp, string][] = [
  [/cable|wire|socket|switch|breaker|light|lamp|electric|earthing|panel/, "ELEC"],
  [/duct|hvac|chiller|ahu|fcu|refrigerant|damper|thermostat/, "HVAC"],
  [/pipe|valve|fitting|drain|pump|plumb|tap|mixer|wc\b/, "PLUMB"],
  [/sealant|waterproof|adhesive|grout|primer|epoxy|chemical|admixture|coating/, "CHEM"],
  [/bolt|screw|anchor|nut|washer|rod|fixing|fastener/, "FAST"],
  [/insulation|rockwool|glasswool/, "INSUL"],
];

export function guessCategory(text: string): string | null {
  const t = text.toLowerCase();
  for (const [re, code] of CATEGORY_HINTS) if (re.test(t)) return code;
  return null;
}
