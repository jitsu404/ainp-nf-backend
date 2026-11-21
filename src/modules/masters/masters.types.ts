// The simple lookup lists ("masters") kept in one collection, distinguished by `type`.
// Richer masters have their own modules: financial years, parameters, centres.
// Defaults come from the PCU master tables and the ICAR finance sheets (see seed.ts).

export interface MasterTypeConfig {
  label: string;
  description: string;
  /** If set, `group` must be one of these (e.g. budget head → Salaries / General / Capital). */
  groups?: readonly string[];
  groupLabel?: string;
  linkedTo?: string;
}

export const MASTER_TYPES = {
  season: {
    label: 'Seasons',
    description: 'Cropping seasons used in observation sheets (PCU master table).',
  },
  unit: {
    label: 'Units',
    description: 'Units of measurement for parameters (kg/ha, %, no./m² …).',
  },
  crop: {
    label: 'Crops',
    description: 'Crops and commodities used in cropping systems and varietal trials.',
    groups: [
      'Cereal',
      'Millet',
      'Pulse',
      'Oilseed',
      'Vegetable',
      'Fruit',
      'Spice',
      'Fibre',
      'Sugar',
      'Fodder',
      'Tuber',
      'Other',
    ],
    groupLabel: 'Crop group',
  },
  nfInput: {
    label: 'NF / organic inputs',
    description: 'Natural farming and organic inputs (Jeevamrit, Ghanjeevamrit, FYM …).',
    groups: ['Natural farming', 'Organic', 'Botanical', 'Biological', 'Other'],
    groupLabel: 'Input type',
  },
  programme: {
    label: 'Programmes',
    description: 'AINP-NF research programmes (Research Highlights proforma).',
  },
  budgetHead: {
    label: 'Budget heads',
    description: 'ICAR budget heads used in BE, releases, expenditure and AUC.',
    groups: ['Salaries', 'General', 'Capital'],
    groupLabel: 'Grant-in-Aid',
    linkedTo: 'fundCategory',
  },
  fundCategory: {
    label: 'Fund categories',
    description: 'ICAR fund streams: General (other than TSP/SCSP/NEH), TSP, SCSP, NEH.',
  },
  staffPost: {
    label: 'Staff posts',
    description: 'Project posts at centres and the PCU (monthly staff position sheet).',
    groups: ['Scientific', 'Research fellow', 'Technical', 'Administrative', 'Other'],
    groupLabel: 'Category',
  },
  zone: {
    label: 'Agro-climatic zones',
    description: 'Planning Commission agro-climatic zones; each centre is in one (PCU master table).',
  },
} as const satisfies Record<string, MasterTypeConfig>;

export type MasterType = keyof typeof MASTER_TYPES;
export const MASTER_TYPE_IDS = Object.keys(MASTER_TYPES) as [MasterType, ...MasterType[]];

/**
 * Default values, inserted by `npm run seed`. Existing items are never overwritten, so edits made
 * in the app are kept and new defaults can be appended safely. `sortOrder` defaults to the
 * position in the list × 10; give it explicitly to place a later addition between existing items.
 * Sources: PCU master table (seasons), Annual Report 2025-26 (crops: Appendix 9 and 7.2.5;
 * inputs: 7.1.3 and 7.2.5), NF datasheets 2a/2b/2c (units).
 * Crops and units get generated codes (CRP-001, UNT-001 …): for them `code` is only a key in this
 * file (parameter defaults use the unit keys), and the seed matches them by name.
 */
export interface MasterDefault {
  code: string;
  name: string;
  group?: string;
  sortOrder?: number;
}
export const MASTER_DEFAULTS: Record<MasterType, MasterDefault[]> = {
  season: [
    // Pre-kharif is used by Gangtok (maize, ginger, turmeric) in Appendix 9.
    { code: 'PRE_KHARIF', name: 'Pre-kharif', sortOrder: 5 },
    { code: 'KHARIF', name: 'Kharif' },
    { code: 'RABI', name: 'Rabi' },
    { code: 'SUMMER', name: 'Summer' },
    { code: 'WINTER', name: 'Winter' },
    { code: 'RAINY', name: 'Rainy' },
    { code: 'AUTUMN', name: 'Autumn' },
    { code: 'PERENNIAL', name: 'Perennial' },
  ],
  unit: [
    ['KG_HA', 'kg/ha'],
    ['Q_HA', 'q/ha'],
    ['T_HA', 't/ha'],
    ['RS_HA', 'Rs/ha'],
    ['RS_KG', 'Rs/kg'],
    ['RS', 'Rs'],
    ['PCT', '%'],
    ['CM', 'cm'],
    ['M', 'm'],
    ['G', 'g'],
    ['KG', 'kg'],
    ['L_HA', 'litres/ha'],
    ['NO_M2', 'no./m²'],
    ['G_M2', 'g/m²'],
    ['DAYS', 'days'],
    ['KG_M3', 'kg/m³'],
    ['DS_M', 'dS/m'],
    ['G_CC', 'g/cc'],
    ['MG_KG', 'mg/kg'],
    ['UG_G', 'µg/g soil'],
    ['UG_TPF', 'µg TPF/g/hr'],
    ['UMOL_G_HR', 'µmol/g/hr'],
    ['CFU_G', 'CFU/g'],
    ['MANDAYS_HA', 'man-days/ha'],
    ['RATIO', 'ratio'],
    ['NUMBER', 'number'],
    ['SCORE_10', 'score (0–10)'],
    ['MM', 'mm'],
    ['DEG_C', '°C'],
    ['DEGREE', 'degree'],
    // Data sheet 2b (cost of cultivation details) and the farmer survey (2c, 7.1.1).
    ['HOURS', 'hours'],
    ['L', 'litres'],
    ['HA', 'ha'],
    ['M3_HA', 'm³/ha'],
    ['NO_PLANT', 'no./plant'],
    ['G_PLANT', 'g/plant'],
    ['PPM', 'ppm'],
  ].map(([code, name]) => ({ code: code!, name: name! })),
  crop: [
    ['RICE', 'Rice', 'Cereal'],
    ['WHEAT', 'Wheat', 'Cereal'],
    ['MAIZE', 'Maize', 'Cereal'],
    ['BARLEY', 'Barley', 'Cereal'],
    ['PEARL_MILLET', 'Pearl millet', 'Millet'],
    ['FINGER_MILLET', 'Finger millet', 'Millet'],
    ['SORGHUM', 'Sorghum', 'Millet'],
    ['CHICKPEA', 'Chickpea', 'Pulse'],
    ['PIGEONPEA', 'Pigeonpea', 'Pulse'],
    ['GREENGRAM', 'Greengram', 'Pulse'],
    ['BLACKGRAM', 'Blackgram', 'Pulse'],
    ['LENTIL', 'Lentil', 'Pulse'],
    ['COWPEA', 'Cowpea', 'Pulse'],
    ['MUSTARD', 'Mustard', 'Oilseed'],
    ['SOYBEAN', 'Soybean', 'Oilseed'],
    ['GROUNDNUT', 'Groundnut', 'Oilseed'],
    ['SESAME', 'Sesame', 'Oilseed'],
    ['COTTON', 'Cotton', 'Fibre'],
    ['SUGARCANE', 'Sugarcane', 'Sugar'],
    ['POTATO', 'Potato', 'Tuber'],
    ['ONION', 'Onion', 'Vegetable'],
    ['TOMATO', 'Tomato', 'Vegetable'],
    // From the Annual Report 2025-26 (Appendix 9 crops and varieties; 7.2.5 cropping systems).
    ['SWEET_CORN', 'Sweet corn', 'Cereal'],
    ['BARNYARD_MILLET', 'Barnyard millet', 'Millet'],
    ['BUCKWHEAT', 'Buckwheat', 'Other'],
    ['FIELD_PEA', 'Field pea', 'Pulse'],
    ['FIELD_BEAN', 'Field bean', 'Pulse'],
    ['RAJMASH', 'Rajmash', 'Pulse'],
    ['LINSEED', 'Linseed', 'Oilseed'],
    ['TORIA', 'Toria', 'Oilseed'],
    ['GARDEN_PEA', 'Garden / vegetable pea', 'Vegetable'],
    ['VEGETABLE_COWPEA', 'Vegetable cowpea', 'Vegetable'],
    ['FRENCH_BEAN', 'French bean', 'Vegetable'],
    ['OKRA', 'Okra', 'Vegetable'],
    ['BRINJAL', 'Brinjal', 'Vegetable'],
    ['CHILLI', 'Chilli', 'Vegetable'],
    ['CABBAGE', 'Cabbage', 'Vegetable'],
    ['CAULIFLOWER', 'Cauliflower', 'Vegetable'],
    ['CARROT', 'Carrot', 'Vegetable'],
    ['CUCUMBER', 'Cucumber', 'Vegetable'],
    ['SUMMER_SQUASH', 'Summer squash', 'Vegetable'],
    ['AMARANTH', 'Amaranth', 'Vegetable'],
    ['GINGER', 'Ginger', 'Spice'],
    ['TURMERIC', 'Turmeric', 'Spice'],
    ['CORIANDER', 'Coriander', 'Spice'],
    ['FENNEL', 'Fennel', 'Spice'],
    ['FENUGREEK', 'Fenugreek', 'Spice'],
    ['CASSAVA', 'Cassava', 'Tuber'],
    ['TARO', 'Taro', 'Tuber'],
    ['SWEET_POTATO', 'Sweet potato', 'Tuber'],
    ['BANANA', 'Banana', 'Fruit'],
    ['BERSEEM', 'Berseem', 'Fodder'],
    ['LUCERNE', 'Lucerne', 'Fodder'],
    ['FODDER_MAIZE', 'Fodder maize', 'Fodder'],
    ['FODDER_SORGHUM', 'Fodder sorghum', 'Fodder'],
    ['DHAINCHA', 'Dhaincha (Sesbania)', 'Other'],
  ].map(([code, name, group]) => ({ code: code!, name: name!, group: group! })),
  nfInput: [
    ['BEEJAMRIT', 'Beejamrit', 'Natural farming'],
    ['JEEVAMRIT', 'Jeevamrit', 'Natural farming'],
    ['GHANJEEVAMRIT', 'Ghanjeevamrit', 'Natural farming'],
    ['AGNIASTRA', 'Agniastra', 'Botanical'],
    ['BRAHMASTRA', 'Brahmastra', 'Botanical'],
    ['NEEMASTRA', 'Neemastra', 'Botanical'],
    ['DASHPARNI_ARK', 'Dashparni ark', 'Botanical'],
    ['FYM', 'Farmyard manure (FYM)', 'Organic'],
    ['VERMICOMPOST', 'Vermicompost', 'Organic'],
    ['COMPOST', 'Compost', 'Organic'],
    ['OILCAKES', 'Oilcakes', 'Organic'],
    // Named in the Annual Report 2025-26 (7.1.3 input characterization, 7.2.5 treatments).
    ['PANCHAGAVYA', 'Panchagavya', 'Natural farming'],
    ['SOUR_BUTTERMILK', 'Sour buttermilk', 'Natural farming'],
    ['COW_URINE', 'Cow urine', 'Natural farming'],
    ['NEEM_OIL', 'Neem oil', 'Botanical'],
    ['NEEM_CAKE', 'Neem cake', 'Organic'],
    ['VERMIWASH', 'Vermiwash', 'Organic'],
    ['ENRICHED_COMPOST', 'Enriched compost', 'Organic'],
    ['POULTRY_MANURE', 'Poultry manure', 'Organic'],
    ['GREEN_MANURE', 'Green manure', 'Organic'],
    ['AZOLLA', 'Azolla', 'Organic'],
    ['TRICHODERMA', 'Trichoderma', 'Biological'],
    ['PSEUDOMONAS', 'Pseudomonas fluorescens', 'Biological'],
    ['BEAUVERIA', 'Beauveria bassiana', 'Biological'],
    ['RHIZOBIUM', 'Rhizobium', 'Biological'],
    ['PSB', 'Phosphate solubilizing bacteria (PSB)', 'Biological'],
  ].map(([code, name, group]) => ({ code: code!, name: name!, group: group! })),
  programme: [
    { code: 'P1', name: 'Characterisation of organic and natural farming inputs and practices' },
    {
      code: 'P2',
      name: 'Development and validation of scientific package of practices for organic and natural farming',
    },
    { code: 'P3', name: 'Integrated Organic Farming Systems' },
    { code: 'P4', name: 'Capacity building including policy support to Central and State agencies' },
  ],
  budgetHead: [
    ['SALARY', 'Salaries', 'Salaries'],
    ['TA', 'Domestic T.A.', 'General'],
    ['OC', 'Operational charges', 'General'],
    ['RE', 'Research expenses', 'General'],
    ['HRD', 'HRD', 'General'],
    ['PUBLICITY', 'Publicity & exhibitions', 'General'],
    ['EQUIPMENT', 'Equipment', 'Capital'],
    ['WORKS', 'Works', 'Capital'],
    ['IT', 'Information technology', 'Capital'],
    ['LIVESTOCK', 'Livestock', 'Capital'],
    ['FURNITURE', 'Furniture & fixtures', 'Capital'],
    ['VEHICLE', 'Vehicle', 'Capital'],
  ].map(([code, name, group]) => ({ code: code!, name: name!, group: group! })),
  fundCategory: [
    { code: 'GENERAL', name: 'Other than TSP / SCSP / NEH' },
    { code: 'TSP', name: 'TSP (STC)' },
    { code: 'SCSP', name: 'SCSP' },
    { code: 'NEH', name: 'NEH' },
  ],
  staffPost: [
    ['PI', 'Principal Investigator', 'Scientific'],
    ['CO_PI', 'Co-Principal Investigator', 'Scientific'],
    ['SRF', 'Senior Research Fellow', 'Research fellow'],
    ['JRF', 'Junior Research Fellow', 'Research fellow'],
    ['YP1', 'Young Professional I', 'Research fellow'],
    ['YP2', 'Young Professional II', 'Research fellow'],
    ['STO', 'Senior Technical Officer', 'Technical'],
    ['TA', 'Technical Assistant', 'Technical'],
  ].map(([code, name, group]) => ({ code: code!, name: name!, group: group! })),
  // The 15 Planning Commission zones, numbered as in the Planning Commission list. Names follow the
  // wording of the PCU master table, which the seeded centres use.
  zone: [
    ['Z01', 'Western Himalaya'],
    ['Z02', 'Eastern Himalaya'],
    ['Z03', 'Lower Gangetic Plains'],
    ['Z04', 'Middle Gangetic Plains'],
    ['Z05', 'Upper Gangetic Plains'],
    ['Z06', 'Trans Gangetic Plains'],
    ['Z07', 'Eastern Plateau and Hills'],
    ['Z08', 'Central Plateau and Hills'],
    ['Z09', 'Western Plateau and Hills'],
    ['Z10', 'Southern Plateau and Hills'],
    ['Z11', 'East Coast Plains and Hills'],
    ['Z12', 'West Coast Plains and Ghat'],
    ['Z13', 'Gujarat Plains and Hills'],
    ['Z14', 'Western Dry Region'],
    ['Z15', 'Island Region'],
  ].map(([code, name]) => ({ code: code!, name: name! })),
};
