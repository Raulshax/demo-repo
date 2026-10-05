// Seed catalogue for the central material database (UAE MEP wedge first).
// Benchmark prices are indicative AED unit rates used to seed the market index.

export interface CategoryDef { code: string; name: string; parent?: string; wedge: "primary" | "secondary" }

export const CATEGORIES: CategoryDef[] = [
  { code: "ELEC", name: "Electrical", wedge: "primary" },
  { code: "ELEC-CABLE", name: "Power cables", parent: "ELEC", wedge: "primary" },
  { code: "ELEC-WIRE", name: "Building wires", parent: "ELEC", wedge: "primary" },
  { code: "ELEC-ACC", name: "Wiring accessories", parent: "ELEC", wedge: "primary" },
  { code: "ELEC-PANEL", name: "Panels & protection", parent: "ELEC", wedge: "primary" },
  { code: "ELEC-CONTAIN", name: "Containment", parent: "ELEC", wedge: "primary" },
  { code: "ELEC-LIGHT", name: "Lighting", parent: "ELEC", wedge: "primary" },
  { code: "HVAC", name: "HVAC", wedge: "primary" },
  { code: "HVAC-PIPE", name: "Refrigerant piping", parent: "HVAC", wedge: "primary" },
  { code: "HVAC-EQUIP", name: "HVAC equipment", parent: "HVAC", wedge: "primary" },
  { code: "HVAC-AIR", name: "Air distribution", parent: "HVAC", wedge: "primary" },
  { code: "PLUMB", name: "Plumbing & drainage", wedge: "primary" },
  { code: "PLUMB-PIPE", name: "Pipes", parent: "PLUMB", wedge: "primary" },
  { code: "PLUMB-FIT", name: "Fittings", parent: "PLUMB", wedge: "primary" },
  { code: "PLUMB-VALVE", name: "Valves", parent: "PLUMB", wedge: "primary" },
  { code: "INSUL", name: "Insulation", wedge: "secondary" },
  { code: "CHEM", name: "Construction chemicals", wedge: "secondary" },
  { code: "FAST", name: "Fasteners & supports", wedge: "secondary" },
  { code: "CONS", name: "MEP consumables", wedge: "secondary" },
];

export interface CatalogItem {
  sku: string;
  family: string;
  category: string;
  name: string;
  spec: Record<string, string | number>;
  unit: string;
  keywords: string[];
  brands: string[];
  price: number;
}

const items: CatalogItem[] = [];
const add = (i: CatalogItem) => items.push(i);

// --- Power cables: Cu/XLPE/SWA/PVC 0.6/1kV
const xlpe4: [number, number][] = [[6, 22], [10, 32], [16, 48], [25, 72], [35, 98], [50, 135], [70, 188], [95, 255], [120, 320], [185, 490], [240, 640]];
for (const [s, p] of xlpe4)
  add({ sku: `CAB-XLPE-4C${s}`, family: "cable_xlpe", category: "ELEC-CABLE",
    name: `Cable Cu/XLPE/SWA/PVC 4C x ${s}mm² 0.6/1kV`, spec: { cores: 4, size_mm2: s, insulation: "XLPE", armour: "SWA", voltage: "0.6/1kV" },
    unit: "m", keywords: ["xlpe", "swa", "armoured", "cable"], brands: ["Ducab", "Oman Cables", "Riyadh Cables"], price: p });
for (const [s, p] of [[2.5, 6.5], [4, 9], [6, 12], [10, 18]] as [number, number][])
  add({ sku: `CAB-XLPE-2C${s}`, family: "cable_xlpe", category: "ELEC-CABLE",
    name: `Cable Cu/XLPE/SWA/PVC 2C x ${s}mm² 0.6/1kV`, spec: { cores: 2, size_mm2: s, insulation: "XLPE", armour: "SWA", voltage: "0.6/1kV" },
    unit: "m", keywords: ["xlpe", "swa", "cable"], brands: ["Ducab", "Oman Cables"], price: p });
for (const [s, p] of [[2.5, 8], [4, 11.5], [6, 15]] as [number, number][])
  add({ sku: `CAB-XLPE-3C${s}`, family: "cable_xlpe", category: "ELEC-CABLE",
    name: `Cable Cu/XLPE/SWA/PVC 3C x ${s}mm² 0.6/1kV`, spec: { cores: 3, size_mm2: s, insulation: "XLPE", armour: "SWA", voltage: "0.6/1kV" },
    unit: "m", keywords: ["xlpe", "swa", "cable"], brands: ["Ducab", "Oman Cables"], price: p });

// --- Building wire 450/750V PVC single core
for (const [s, p] of [[1.5, 0.95], [2.5, 1.45], [4, 2.3], [6, 3.4], [10, 5.6], [16, 8.9]] as [number, number][])
  add({ sku: `WIR-PVC-${s}`, family: "wire_pvc", category: "ELEC-WIRE",
    name: `Wire Cu/PVC single core ${s}mm² 450/750V`, spec: { cores: 1, size_mm2: s, insulation: "PVC" },
    unit: "m", keywords: ["wire", "single core", "pvc"], brands: ["Ducab", "Oman Cables", "Bahra"], price: p });

// --- Wiring accessories
for (const [g, p] of [[1, 18], [2, 28]] as [number, number][])
  add({ sku: `ACC-SKT-${g}G`, family: "socket", category: "ELEC-ACC", name: `13A switched socket outlet ${g}-gang, white`,
    spec: { gang: g, amp: 13 }, unit: "pcs", keywords: ["socket", "13a"], brands: ["MK", "Schneider", "Legrand"], price: p });
for (const [g, p] of [[1, 12], [2, 16], [3, 22]] as [number, number][])
  add({ sku: `ACC-SW-${g}G`, family: "switch", category: "ELEC-ACC", name: `Light switch ${g}-gang 2-way 10A, white`,
    spec: { gang: g, amp: 10 }, unit: "pcs", keywords: ["switch"], brands: ["MK", "Schneider", "Legrand"], price: p });
for (const [a, p] of [[20, 35], [32, 48], [45, 65]] as [number, number][])
  add({ sku: `ACC-ISO-${a}A`, family: "isolator", category: "ELEC-ACC", name: `Isolator ${a}A DP with neon`,
    spec: { amp: a, poles: 2 }, unit: "pcs", keywords: ["isolator"], brands: ["MK", "Schneider"], price: p });

// --- Panels & protection
for (const [a, p] of [[6, 14], [10, 14], [16, 14], [20, 15], [32, 16], [40, 22], [63, 32]] as [number, number][])
  add({ sku: `PNL-MCB-1P${a}`, family: "mcb", category: "ELEC-PANEL", name: `MCB 1P ${a}A 10kA C-curve`,
    spec: { amp: a, poles: 1, ka: 10, curve: "C" }, unit: "pcs", keywords: ["mcb"], brands: ["Schneider", "ABB", "Hager"], price: p });
for (const [a, p] of [[16, 62], [32, 85], [63, 140]] as [number, number][])
  add({ sku: `PNL-MCB-3P${a}`, family: "mcb", category: "ELEC-PANEL", name: `MCB 3P ${a}A 10kA C-curve`,
    spec: { amp: a, poles: 3, ka: 10, curve: "C" }, unit: "pcs", keywords: ["mcb"], brands: ["Schneider", "ABB", "Hager"], price: p });
for (const [a, p] of [[16, 95], [20, 98], [32, 105]] as [number, number][])
  add({ sku: `PNL-RCBO-${a}`, family: "rcbo", category: "ELEC-PANEL", name: `RCBO 1P+N ${a}A 30mA`,
    spec: { amp: a, ma: 30 }, unit: "pcs", keywords: ["rcbo"], brands: ["Schneider", "ABB", "Hager"], price: p });
for (const [w, p] of [[12, 780], [18, 1050], [24, 1380]] as [number, number][])
  add({ sku: `PNL-DB-TPN${w}`, family: "db", category: "ELEC-PANEL", name: `Distribution board TPN ${w}-way, IP42`,
    spec: { ways: w, type: "TPN" }, unit: "pcs", keywords: ["distribution board", "db"], brands: ["Schneider", "ABB", "Hager"], price: p });

// --- Containment
for (const [d, p] of [[20, 2.6], [25, 3.6], [32, 5.4]] as [number, number][])
  add({ sku: `CNT-PVC-${d}`, family: "conduit_pvc", category: "ELEC-CONTAIN", name: `PVC conduit heavy gauge ${d}mm`,
    spec: { dia_mm: d }, unit: "m", keywords: ["conduit", "pvc"], brands: ["Marshal", "Atlas"], price: p });
for (const [d, p] of [[20, 9.5], [25, 12.8]] as [number, number][])
  add({ sku: `CNT-GI-${d}`, family: "conduit_gi", category: "ELEC-CONTAIN", name: `GI conduit class 4 ${d}mm`,
    spec: { dia_mm: d }, unit: "m", keywords: ["conduit", "gi"], brands: ["Marshal", "Tecnoflex"], price: p });
for (const [w, p] of [[100, 26], [150, 33], [200, 41], [300, 56], [450, 78], [600, 98]] as [number, number][])
  add({ sku: `CNT-TRAY-${w}`, family: "cable_tray", category: "ELEC-CONTAIN", name: `Cable tray perforated HDG ${w}x50mm`,
    spec: { width_mm: w, height_mm: 50, finish: "HDG" }, unit: "m", keywords: ["cable tray"], brands: ["Unitech", "OBO"], price: p });
for (const [w, p] of [[300, 95], [450, 120], [600, 145]] as [number, number][])
  add({ sku: `CNT-LAD-${w}`, family: "cable_ladder", category: "ELEC-CONTAIN", name: `Cable ladder HDG ${w}x100mm`,
    spec: { width_mm: w, height_mm: 100, finish: "HDG" }, unit: "m", keywords: ["cable ladder"], brands: ["Unitech", "OBO"], price: p });

// --- Lighting
add({ sku: "LGT-PNL-40", family: "led_panel", category: "ELEC-LIGHT", name: "LED panel 600x600 40W 4000K", spec: { watt: 40, size: "600x600" }, unit: "pcs", keywords: ["led panel"], brands: ["Philips", "Opple"], price: 95 });
add({ sku: "LGT-DL-12", family: "downlight", category: "ELEC-LIGHT", name: "LED downlight 12W 4000K", spec: { watt: 12 }, unit: "pcs", keywords: ["downlight"], brands: ["Philips", "Opple"], price: 38 });
add({ sku: "LGT-DL-18", family: "downlight", category: "ELEC-LIGHT", name: "LED downlight 18W 4000K", spec: { watt: 18 }, unit: "pcs", keywords: ["downlight"], brands: ["Philips", "Opple"], price: 49 });

// --- HVAC
for (const [d, p] of [["1/4", 9], ["3/8", 13], ["1/2", 18], ["5/8", 24], ["3/4", 31], ["7/8", 38]] as [string, number][])
  add({ sku: `HVP-CU-${d.replace("/", "-")}`, family: "copper_pipe", category: "HVAC-PIPE", name: `Copper pipe ACR ${d}" soft coil`,
    spec: { dia_in: d }, unit: "m", keywords: ["copper pipe"], brands: ["Mueller", "KMCT"], price: p });
for (const [t, p] of [[13, 11], [19, 15], [25, 21]] as [number, number][])
  add({ sku: `INS-ARM-${t}`, family: "pipe_insulation", category: "INSUL", name: `Elastomeric pipe insulation ${t}mm thk`,
    spec: { thickness_mm: t }, unit: "m", keywords: ["armaflex", "insulation"], brands: ["Armaflex", "Kaiflex"], price: p });
for (const [tr, p] of [[1, 2100], [1.5, 2450], [2, 2900], [3, 3800]] as [number, number][])
  add({ sku: `HVE-FCU-${tr}`, family: "fcu", category: "HVAC-EQUIP", name: `Fan coil unit ducted ${tr} TR`,
    spec: { tr }, unit: "pcs", keywords: ["fcu", "fan coil"], brands: ["Carrier", "Daikin", "Trane"], price: p });
for (const [w, p] of [[300, 85], [600, 140]] as [number, number][])
  add({ sku: `HVA-DIF-${w}`, family: "diffuser", category: "HVAC-AIR", name: `Square ceiling diffuser ${w}x${w}mm aluminium`,
    spec: { width_mm: w }, unit: "pcs", keywords: ["diffuser"], brands: ["Trox", "Waterloo"], price: p });
for (const [d, p] of [["6", 16], ["8", 21], ["10", 27]] as [string, number][])
  add({ sku: `HVA-FLX-${d}`, family: "flex_duct", category: "HVAC-AIR", name: `Insulated flexible duct ${d}"`,
    spec: { dia_in: d }, unit: "m", keywords: ["flexible duct"], brands: ["Flexiduct"], price: p });
add({ sku: "HVA-GID-M2", family: "gi_duct", category: "HVAC-AIR", name: "GI rectangular ductwork, fabricated", spec: {}, unit: "m2", keywords: ["duct"], brands: [], price: 68 });

// --- Plumbing
for (const [d, p] of [[20, 4.2], [25, 6.4], [32, 10.2], [40, 15.8], [50, 24.5], [63, 38]] as [number, number][])
  add({ sku: `PLP-PPR-${d}`, family: "ppr_pipe", category: "PLUMB-PIPE", name: `PPR pipe PN20 ${d}mm`,
    spec: { dia_mm: d, pn: 20 }, unit: "m", keywords: ["ppr", "pipe"], brands: ["Cosmoplast", "Aquatherm", "Wefatherm"], price: p });
for (const [d, p] of [[20, 1.1], [25, 1.6], [32, 2.7]] as [number, number][])
  add({ sku: `PLF-PPR-EL${d}`, family: "ppr_elbow", category: "PLUMB-FIT", name: `PPR elbow 90° ${d}mm`,
    spec: { dia_mm: d }, unit: "pcs", keywords: ["ppr", "elbow"], brands: ["Cosmoplast", "Aquatherm"], price: p });
for (const [d, p] of [[20, 1.4], [25, 2.0], [32, 3.3]] as [number, number][])
  add({ sku: `PLF-PPR-TE${d}`, family: "ppr_tee", category: "PLUMB-FIT", name: `PPR equal tee ${d}mm`,
    spec: { dia_mm: d }, unit: "pcs", keywords: ["ppr", "tee"], brands: ["Cosmoplast", "Aquatherm"], price: p });
for (const [d, p] of [[50, 9], [75, 14], [110, 22], [160, 41]] as [number, number][])
  add({ sku: `PLP-UPVC-${d}`, family: "upvc_pipe", category: "PLUMB-PIPE", name: `uPVC drainage pipe ${d}mm`,
    spec: { dia_mm: d }, unit: "m", keywords: ["upvc", "drainage"], brands: ["Cosmoplast", "Hepworth"], price: p });
for (const [d, p] of [[63, 21], [110, 58]] as [number, number][])
  add({ sku: `PLP-HDPE-${d}`, family: "hdpe_pipe", category: "PLUMB-PIPE", name: `HDPE pipe PE100 PN16 ${d}mm`,
    spec: { dia_mm: d, pn: 16 }, unit: "m", keywords: ["hdpe"], brands: ["Cosmoplast", "Borouge"], price: p });
for (const [d, p] of [["1/2", 22], ["3/4", 31], ["1", 46], ["2", 125]] as [string, number][])
  add({ sku: `PLV-BV-${d.replace("/", "-")}`, family: "ball_valve", category: "PLUMB-VALVE", name: `Brass ball valve full bore ${d}" PN25`,
    spec: { dia_in: d }, unit: "pcs", keywords: ["ball valve"], brands: ["Pegler", "Giacomini"], price: p });

// --- Insulation, chemicals, fasteners, consumables
for (const [t, p] of [[50, 24], [75, 34], [100, 44]] as [number, number][])
  add({ sku: `INS-RW-${t}`, family: "rockwool", category: "INSUL", name: `Rockwool slab ${t}mm 48kg/m³`,
    spec: { thickness_mm: t, density: 48 }, unit: "m2", keywords: ["rockwool"], brands: ["Rockwool", "Izocam"], price: p });
add({ sku: "CHM-MEM-4", family: "membrane", category: "CHEM", name: "Bituminous membrane torch-on 4mm", spec: { thickness_mm: 4 }, unit: "m2", keywords: ["membrane"], brands: ["Fosroc", "Sika", "Henkel"], price: 21 });
add({ sku: "CHM-CWP-20", family: "cementitious_wp", category: "CHEM", name: "Cementitious waterproofing coating 20kg", spec: { weight_kg: 20 }, unit: "bag", keywords: ["waterproofing"], brands: ["Fosroc", "Sika"], price: 118 });
add({ sku: "CHM-PU-600", family: "sealant", category: "CHEM", name: "Polyurethane joint sealant 600ml", spec: { volume_l: 0.6 }, unit: "pcs", keywords: ["sealant"], brands: ["Sika", "Fosroc"], price: 32 });
add({ sku: "CHM-TA-20", family: "tile_adhesive", category: "CHEM", name: "Tile adhesive C1T 20kg", spec: { weight_kg: 20 }, unit: "bag", keywords: ["tile adhesive"], brands: ["Fosroc", "Sika", "Mapei"], price: 24 });
add({ sku: "CHM-GR-25", family: "grout", category: "CHEM", name: "Non-shrink cementitious grout 25kg", spec: { weight_kg: 25 }, unit: "bag", keywords: ["grout"], brands: ["Fosroc", "Sika"], price: 38 });
for (const [m, p] of [["M10", 2.4], ["M12", 3.6], ["M16", 6.8]] as [string, number][])
  add({ sku: `FST-ANC-${m}`, family: "anchor", category: "FAST", name: `Sleeve anchor bolt ${m} zinc plated`,
    spec: { thread: m }, unit: "pcs", keywords: ["anchor"], brands: ["Hilti", "Fischer"], price: p });
for (const [m, p] of [["M8", 7], ["M10", 9.5], ["M12", 13]] as [string, number][])
  add({ sku: `FST-ROD-${m}`, family: "threaded_rod", category: "FAST", name: `Threaded rod ${m} x 3m GI`,
    spec: { thread: m }, unit: "pcs", keywords: ["threaded rod"], brands: ["Hilti", "Fischer"], price: p });
add({ sku: "FST-STR-41", family: "strut", category: "FAST", name: "Strut channel 41x41mm HDG", spec: { size: "41x41" }, unit: "m", keywords: ["strut"], brands: ["Unistrut", "Hilti"], price: 19 });
for (const [s, p] of [[16, 1.2], [25, 1.8], [35, 2.4], [50, 3.6], [95, 6.5], [185, 13]] as [number, number][])
  add({ sku: `CON-LUG-${s}`, family: "cable_lug", category: "CONS", name: `Copper cable lug ${s}mm²`,
    spec: { size_mm2: s }, unit: "pcs", keywords: ["lug"], brands: ["Klauke", "Dowells"], price: p });
for (const [w, p] of [[200, 9], [300, 14]] as [number, number][])
  add({ sku: `CON-TIE-${w}`, family: "cable_tie", category: "CONS", name: `Cable ties nylon ${w}mm (pack of 100)`,
    spec: { width_mm: w }, unit: "pack", keywords: ["cable tie"], brands: ["HellermannTyton"], price: p });
add({ sku: "CON-TAPE", family: "insulation_tape", category: "CONS", name: "PVC insulation tape 19mm x 20m", spec: {}, unit: "roll", keywords: ["tape"], brands: ["3M"], price: 4.5 });

export const CATALOG: CatalogItem[] = items;
