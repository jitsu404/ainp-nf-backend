import type { ParameterCategory } from './parameters.model.js';

// Starting parameter library, taken from the AINP-NF datasheets:
// 2a (production systems, varietal evaluation), 2b (long-term NF experiment) and
// 2c (deep insights study, which also gives the measurement methods).
// `npm run seed` inserts any that are missing; the PCU maintains the list in the app afterwards.

type Row = [
  code: string,
  name: string,
  unit: string | null,
  category: ParameterCategory,
  decimals: number,
  min: number | null,
  max: number | null,
  method?: string,
];

const rows: Row[] = [
  // Growth and yield
  ['PLANT_HEIGHT', 'Plant height at harvest', 'CM', 'Growth', 1, 0, 1000],
  ['EFFECTIVE_TILLERS', 'Effective tillers', 'NO_M2', 'Growth', 0, 0, 5000],
  [
    'GERMINATION',
    'Germination',
    'PCT',
    'Growth',
    1,
    0,
    100,
    'Field count using fixed quadrat / row length at 7–10 DAS',
  ],
  ['GRAIN_WEIGHT_PANICLE', 'Grain weight per panicle', 'G', 'Yield', 2, 0, 100],
  ['TEST_WEIGHT', '1000-grain weight', 'G', 'Yield', 2, 0, 1000],
  ['GRAIN_YIELD', 'Grain / economic yield (main crop)', 'KG_HA', 'Yield', 0, 0, 200000],
  ['INTERCROP_YIELD', 'Yield of intercrop', 'KG_HA', 'Yield', 0, 0, 200000],
  ['STRAW_YIELD', 'Straw / residue / by-product yield', 'KG_HA', 'Yield', 0, 0, 300000],
  ['HARVEST_INDEX', 'Harvest index', 'RATIO', 'Yield', 3, 0, 1],
  ['SYSTEM_EQ_YIELD', 'System equivalent yield (base crop)', 'KG_HA', 'Yield', 0, 0, 500000],
  ['EQ_YIELD', 'Main-crop equivalent yield (season)', 'KG_HA', 'Yield', 0, 0, 500000],
  // Plant nutrient uptake
  ['N_UPTAKE', 'Total N uptake', 'KG_HA', 'Plant nutrient', 2, 0, 2000],
  ['P_UPTAKE', 'Total P uptake', 'KG_HA', 'Plant nutrient', 2, 0, 1000],
  ['K_UPTAKE', 'Total K uptake', 'KG_HA', 'Plant nutrient', 2, 0, 2000],
  ['ZN_UPTAKE', 'Total Zn uptake', 'KG_HA', 'Plant nutrient', 3, 0, 100],
  ['FE_UPTAKE', 'Total Fe uptake', 'KG_HA', 'Plant nutrient', 3, 0, 100],
  // Quality
  ['BRIX', 'Brix', 'PCT', 'Quality', 1, 0, 100, 'Handheld refractometer on fresh juice / extract'],
  ['PROTEIN', 'Protein', 'PCT', 'Quality', 2, 0, 100, 'Kjeldahl nitrogen × 6.25 (or NIR calibration)'],
  ['OIL', 'Oil content', 'PCT', 'Quality', 2, 0, 100, 'Soxhlet extraction or NMR'],
  // Soil chemical
  ['SOC', 'Soil organic carbon', 'PCT', 'Soil chemical', 2, 0, 15, 'Walkley-Black wet oxidation'],
  [
    'POC',
    'Particulate organic carbon',
    'PCT',
    'Soil chemical',
    2,
    0,
    15,
    'Size fractionation (sieving / density)',
  ],
  ['SOIL_PH', 'Soil pH', null, 'Soil chemical', 2, 0, 14, 'pH meter, 1:2.5 soil:water suspension'],
  [
    'SOIL_EC',
    'Electrical conductivity',
    'DS_M',
    'Soil chemical',
    2,
    0,
    50,
    'EC meter, 1:2.5 soil:water extract at 25 °C',
  ],
  ['AVAIL_N', 'Available N', 'KG_HA', 'Soil chemical', 1, 0, 2000, 'Alkaline KMnO4 (Subbiah & Asija)'],
  ['AVAIL_P', 'Available P', 'KG_HA', 'Soil chemical', 1, 0, 500],
  ['AVAIL_K', 'Available K', 'KG_HA', 'Soil chemical', 1, 0, 3000],
  ['AVAIL_S', 'Available S', 'KG_HA', 'Soil chemical', 1, 0, 500],
  [
    'AVAIL_ZN',
    'Available Zn',
    'MG_KG',
    'Soil chemical',
    2,
    0,
    200,
    'DTPA (pH 7.3) extraction; AAS / ICP-OES',
  ],
  [
    'AVAIL_FE',
    'Available Fe',
    'MG_KG',
    'Soil chemical',
    2,
    0,
    1000,
    'DTPA (pH 7.3) extraction; AAS / ICP-OES',
  ],
  ['AVAIL_CU', 'Available Cu', 'MG_KG', 'Soil chemical', 2, 0, 200],
  ['AVAIL_MN', 'Available Mn', 'MG_KG', 'Soil chemical', 2, 0, 500],
  ['BORON', 'Boron', 'MG_KG', 'Soil chemical', 2, 0, 100, 'Hot water extraction; Azomethine-H'],
  // Soil physical
  ['BULK_DENSITY', 'Bulk density', 'G_CC', 'Soil physical', 2, 0, 3, 'Undisturbed core method'],
  ['SOIL_COVER_DAYS', 'Soil cover duration', 'DAYS', 'Soil physical', 0, 0, 366],
  ['WATER_TABLE', 'Water table level from surface', 'M', 'Water', 2, 0, 500, 'Observation well / piezometer'],
  // Soil biological
  [
    'MBC',
    'Microbial biomass carbon',
    'MG_KG',
    'Soil biological',
    1,
    0,
    10000,
    'Chloroform fumigation-extraction (Vance et al.)',
  ],
  [
    'DEHYDROGENASE',
    'Dehydrogenase activity',
    'UG_TPF',
    'Soil biological',
    2,
    0,
    10000,
    'TTC reduction to TPF; spectrophotometry',
  ],
  [
    'PHOSPHATASE',
    'Phosphatase activity',
    'UMOL_G_HR',
    'Soil biological',
    2,
    0,
    10000,
    'p-nitrophenyl phosphate assay',
  ],
  [
    'MICROBIAL_COUNT',
    'Soil microbial count',
    'CFU_G',
    'Soil biological',
    0,
    0,
    null,
    'Serial dilution and plating',
  ],
  [
    'EARTHWORMS',
    'Earthworm count',
    'NO_M2',
    'Soil biological',
    0,
    0,
    10000,
    'Fixed quadrat hand-sorting and / or dilute formalin',
  ],
  [
    'ARTHROPODS',
    'Soil arthropods',
    'NO_M2',
    'Soil biological',
    0,
    0,
    100000,
    'Pitfall traps / soil cores; Berlese funnel',
  ],
  [
    'MYCORRHIZA',
    'Mycorrhizal colonisation',
    'PCT',
    'Soil biological',
    1,
    0,
    100,
    'Root clearing and trypan blue staining',
  ],
  // Weeds, pests
  [
    'WEED_DENSITY',
    'Total weed density (dry weight)',
    'G_M2',
    'Weed',
    1,
    0,
    100000,
    '0.5×0.5 m (or 1×1 m) quadrat; oven-dry',
  ],
  ['INSECTS', 'Major insects', 'NO_M2', 'Pest & disease', 1, 0, 100000],
  ['DISEASES', 'Major diseases', 'NO_M2', 'Pest & disease', 1, 0, 100000],
  ['NEMATODES', 'Major nematodes', 'NO_M2', 'Pest & disease', 1, 0, 1000000],
  // Water
  ['WUE', 'Water use efficiency', 'KG_M3', 'Water', 2, 0, 100],
  ['IRRIGATION_APPLIED', 'Irrigation water applied', 'CM', 'Water', 1, 0, 1000],
  // Economics
  ['COST_CULTIVATION', 'Cost of cultivation', 'RS_HA', 'Economics', 0, 0, 10000000],
  ['GROSS_RETURNS', 'Gross returns', 'RS_HA', 'Economics', 0, 0, 100000000],
  ['NET_RETURNS', 'Net returns', 'RS_HA', 'Economics', 0, null, 100000000],
  ['NET_RETURNS_PREMIUM', 'Net returns (with organic premium)', 'RS_HA', 'Economics', 0, null, 100000000],
  ['BC_RATIO', 'Benefit : cost ratio', 'RATIO', 'Economics', 2, 0, 100],
  ['SALE_PRICE_MAIN', 'Sale price of main crop', 'RS_KG', 'Economics', 2, 0, 100000],
  ['SALE_PRICE_INTER', 'Sale price of intercrop', 'RS_KG', 'Economics', 2, 0, 100000],
  [
    'LABOUR_USE',
    'Labour use',
    'MANDAYS_HA',
    'Input use',
    1,
    0,
    5000,
    'Daily labour sheet converted to man-days per hectare',
  ],
  [
    'INPUT_COST_REDUCTION',
    'Input cost reduction',
    'PCT',
    'Economics',
    1,
    -100,
    100,
    'Baseline vs current input costs',
  ],
];

/**
 * Calculated parameters, as the NF datasheets define them (2a: "B:C = Total Net Return / Total
 * cost of cultivation"). Yields are kg/ha and prices Rs/kg, so returns come out in Rs/ha. The
 * intercrop is optional (IFEMPTY), since not every cropping system has one.
 * System equivalent yield over a whole year needs all seasons together, so it stays entered.
 */
export const PARAMETER_FORMULAS: Record<string, string> = {
  GROSS_RETURNS: 'GRAIN_YIELD * SALE_PRICE_MAIN + IFEMPTY(INTERCROP_YIELD, 0) * IFEMPTY(SALE_PRICE_INTER, 0)',
  NET_RETURNS: 'GROSS_RETURNS - COST_CULTIVATION',
  BC_RATIO: 'NET_RETURNS / COST_CULTIVATION',
  EQ_YIELD: 'GRAIN_YIELD + IFEMPTY(INTERCROP_YIELD, 0) * IFEMPTY(SALE_PRICE_INTER, 0) / SALE_PRICE_MAIN',
};

export const PARAMETER_DEFAULTS = rows.map(
  ([code, name, unitCode, category, decimals, min, max, method]) => ({
    code,
    name,
    unitCode,
    category,
    dataType: 'number' as const,
    decimals,
    min,
    max,
    method: method ?? null,
    formula: PARAMETER_FORMULAS[code] ?? null,
  }),
);
