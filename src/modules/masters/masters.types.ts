// The simple lookup lists ("masters") kept in one collection, distinguished by `type`.
// Richer masters have their own modules: financial years, parameters, centres.
// Defaults come from the PCU master tables and the ICAR finance sheets (see seed.ts).

export interface MasterTypeConfig {
  label: string;
  description: string;
  /** If set, `group` must be one of these (e.g. budget head → Salaries / General / Capital). */
  groups?: readonly string[];
  groupLabel?: string;
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
    groups: ['Natural farming', 'Organic', 'Botanical', 'Other'],
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
} as const satisfies Record<string, MasterTypeConfig>;

export type MasterType = keyof typeof MASTER_TYPES;
export const MASTER_TYPE_IDS = Object.keys(MASTER_TYPES) as [MasterType, ...MasterType[]];

/** Default values, inserted by `npm run seed` (existing items are never overwritten). */
export const MASTER_DEFAULTS: Record<MasterType, { code: string; name: string; group?: string }[]> = {
  season: [
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
};
