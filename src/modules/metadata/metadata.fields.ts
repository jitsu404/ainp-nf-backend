// The ICAR "Proposed Meta Data Format" for research datasets (fields 1–38; the format has no 19).
// Each field has one source:
//   common: the same for every centre; stored on the experiment, edited by the PCU;
//   auto:   derived from the protocol, the trial, the centre, its current PI and its sheets;
//   centre: entered by the centre running the trial (modules/metadata, one record per trial).
// The client renders the form from this list (returned with every record), so it lives only here.

export type FieldSource = 'common' | 'auto' | 'centre';
export type FieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'number' | 'people';

export interface FieldDef {
  /** Number in the ICAR format; the Co-PI list has none (it feeds 9–11). */
  no: number | null;
  key: string;
  label: string;
  source: FieldSource;
  type: FieldType;
  options?: readonly string[];
  /** Must be filled before the centre submits. */
  required?: boolean;
  hint?: string;
}

export const UNIT_TYPES = [
  'Division',
  'Unit',
  'Section',
  'AICRP',
  'Network Project',
  'Research Station',
] as const;
export const FUNDING_TYPES = ['Internal', 'External'] as const;
export const DATA_CATEGORIES = [
  'Experimental',
  'Survey',
  'Observational',
  'Simulation / Modelling',
  'Sensor',
  'NGS',
  'Drone',
] as const;
export const DATA_TYPES = ['Numerical data (tables)', 'Images', 'Video', 'Audio', 'Mixed'] as const;
export const DATA_SCALES = ['Raw', 'Analyzed'] as const;
export const DATA_FORMATS = [
  'Digital',
  'Print',
  'Registers',
  'Schedules',
  'CSV',
  'Excel',
  'Word',
  'Physical sample',
  'JPEG',
] as const;
export const AVAILABILITY_LOCATIONS = [
  'AINP-NF data management system',
  'PI / Co-PI',
  'PME cell',
  'Division',
  'Institute repository',
] as const;

const common = (no: number, key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  no,
  key,
  label,
  source: 'common',
  type: 'text',
  ...extra,
});
const auto = (no: number, key: string, label: string, hint: string): FieldDef => ({
  no,
  key,
  label,
  source: 'auto',
  type: 'text',
  hint,
});
const centre = (no: number | null, key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  no,
  key,
  label,
  source: 'centre',
  type: 'text',
  ...extra,
});

export const METADATA_FIELDS: readonly FieldDef[] = [
  common(1, 'smdName', 'SMD name'),
  common(2, 'instituteName', 'Name of the institute'),
  common(3, 'unitType', 'Division / Unit / Section / AICRP / Network Project / Research Station', {
    type: 'select',
    options: UNIT_TYPES,
  }),
  common(4, 'unitName', 'Full name of the division / unit / network project'),
  auto(5, 'projectTitle', 'Project title', 'The experiment title'),
  common(6, 'projectCode', 'Project code (as per PME)'),
  centre(7, 'datasetTitle', 'Dataset name / title'),
  centre(8, 'description', 'Dataset description (2–3 line abstract)', { type: 'textarea' }),
  auto(9, 'piNames', 'PI / Co-PI names', "The centre's current PI, then the Co-PIs below"),
  auto(10, 'piDesignations', 'PI / Co-PI designations', "The centre's current PI, then the Co-PIs below"),
  auto(11, 'piEmails', 'PI / Co-PI e-mail', "The centre's current PI, then the Co-PIs below"),
  centre(null, 'coPis', 'Co-PIs', { type: 'people', hint: 'Added after the PI in fields 9–11' }),
  common(12, 'fundingType', 'Funding type', { type: 'select', options: FUNDING_TYPES }),
  common(13, 'fundingSource', 'Funding source'),
  common(14, 'subject', 'Subject (broad domain)'),
  common(15, 'keywords', 'Keywords (4–5, comma separated)'),
  auto(16, 'commodity', 'Commodity name', "Crops in the centre's cropping systems"),
  centre(17, 'completionDate', 'Completion date', { type: 'date', hint: 'Leave empty while the trial runs' }),
  common(18, 'dataCategory', 'Data category / type of study', { type: 'select', options: DATA_CATEGORIES }),
  auto(
    20,
    'design',
    'Statistical / survey design used',
    'Design, replications and treatments of the protocol',
  ),
  centre(21, 'plotSize', 'Spatial resolution / plot size', {
    hint: 'e.g. 6 m × 5 m (30 m²)',
  }),
  centre(22, 'dataFormat', 'Available data format', {
    type: 'multiselect',
    options: DATA_FORMATS,
  }),
  common(23, 'dataType', 'Data type', { type: 'select', options: DATA_TYPES }),
  common(24, 'methodology', 'Methodology / protocol followed', { type: 'textarea' }),
  centre(25, 'instruments', 'Instrument / equipment used', {
    type: 'textarea',
    hint: 'Make, model, serial number, calibration date',
  }),
  common(26, 'dataScale', 'Data scale', { type: 'select', options: DATA_SCALES }),
  common(27, 'language', 'Language'),
  auto(28, 'temporalExtent', 'Temporal extent', 'Years with observation sheets'),
  auto(29, 'seasons', 'Season(s) / growing period(s)', "The protocol's seasons"),
  auto(30, 'spatialExtent', 'Spatial extent', 'Site-specific: the centre, its state and zone'),
  centre(31, 'availabilityLocation', 'Data availability location', {
    type: 'select',
    options: AVAILABILITY_LOCATIONS,
  }),
  auto(32, 'custodian', 'Data custodian / contact', "The centre's current PI"),
  centre(33, 'embargoYears', 'Embargo (years), if any', { type: 'number' }),
  centre(34, 'source', 'Source (URI of a previous record)'),
  centre(35, 'relation', 'Relation with previous data'),
  centre(36, 'citation', 'Related publication / citation (URI / DOI)', { type: 'textarea' }),
  auto(37, 'attributes', 'List of attributes with units', "The protocol's parameters"),
  auto(38, 'resource', 'Resource (data files)', 'Observation sheets recorded in this system'),
];

export const ALL_TRIAL_FIELD_KEYS = [
  'smdName',
  'instituteName',
  'unitType',
  'unitName',
  'projectTitle',
  'projectCode',
  'datasetTitle',
  'description',
  'piNames',
  'piDesignations',
  'piEmails',
  'coPis',
  'fundingType',
  'fundingSource',
  'subject',
  'keywords',
  'commodity',
  'completionDate',
  'dataCategory',
  'design',
  'plotSize',
  'dataFormat',
  'dataType',
  'methodology',
  'instruments',
  'dataScale',
  'language',
  'temporalExtent',
  'seasons',
  'spatialExtent',
  'availabilityLocation',
  'custodian',
  'embargoYears',
  'source',
  'relation',
  'citation',
  'attributes',
  'resource',
] as const;

export const CENTRE_FIELD_KEYS = ALL_TRIAL_FIELD_KEYS;
export type CentreFieldKey = (typeof CENTRE_FIELD_KEYS)[number];

/** Values of the common fields used until the PCU sets them. */
export const COMMON_DEFAULTS = {
  smdName: 'Natural Resource Management',
  instituteName: 'ICAR-Indian Institute of Farming Systems Research',
  unitType: 'Network Project',
  unitName: 'All India Network Programme on Natural Farming',
  fundingType: 'Internal',
  fundingSource: 'ICAR',
  subject: 'Agronomy / Natural Resource Management',
  keywords: 'natural farming, on-station trial, crop yield, soil health',
  dataType: 'Numerical data (tables)',
  dataScale: 'Raw',
  language: 'English',
} as const;
