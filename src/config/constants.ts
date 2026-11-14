// Shared enums for the whole API.
// ROLES and CAPABILITIES mirror ../client/src/roles.js. Keep the two files in sync.

export const CAPABILITIES = [
  'research.enter',
  'research.submit',
  'research.review',
  'research.approve',
  'research.config',
  'finance.manage',
  'finance.expenditure',
  'finance.receipt',
  'finance.request',
  'aucsoe.enter',
  'aucsoe.submit',
  'aucsoe.review',
  'aucsoe.approve',
  'comm.issue',
  'comm.ack',
  'staff.manage',
  'staff.propose',
  'meetings.manage',
  'meetings.update',
  'admin.manage',
  'admin.approve',
  'admin.request',
  'docs.upload',
  'masters.edit',
  'centres.manage',
  'users.manage',
  'system.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_IDS = [
  'superadmin',
  'pc',
  'finance',
  'adminOfficer',
  'reviewer',
  'pi',
  'dataEntry',
  'admin',
] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** national = sees every centre; centre = limited to the user's own centre. */
export type RoleScope = 'national' | 'centre';

export interface RoleDefinition {
  label: string;
  scope: RoleScope;
  capabilities: readonly Capability[];
}

export const ROLES: Readonly<Record<RoleId, RoleDefinition>> = {
  // Every capability, every centre. Keep to one or two accounts; all actions are audited like anyone else's.
  superadmin: {
    label: 'Super Administrator',
    scope: 'national',
    capabilities: CAPABILITIES,
  },
  pc: {
    label: 'Project Coordinator',
    scope: 'national',
    capabilities: [
      'centres.manage',
      'users.manage',
      'research.approve',
      'research.config',
      'aucsoe.approve',
      'finance.manage',
      'comm.issue',
      'staff.manage',
      'meetings.manage',
      'admin.manage',
      'admin.approve',
      'docs.upload',
    ],
  },
  finance: {
    label: 'Finance Officer',
    scope: 'national',
    capabilities: ['finance.manage', 'aucsoe.review', 'docs.upload'],
  },
  adminOfficer: {
    label: 'Administrative Officer',
    scope: 'national',
    capabilities: ['comm.issue', 'staff.manage', 'meetings.manage', 'admin.manage', 'docs.upload'],
  },
  reviewer: {
    label: 'Reviewer',
    scope: 'national',
    capabilities: ['research.review', 'aucsoe.review'],
  },
  pi: {
    label: 'Nodal Officer / PI',
    scope: 'centre',
    capabilities: [
      'research.enter',
      'research.submit',
      'finance.expenditure',
      'finance.receipt',
      'finance.request',
      'aucsoe.enter',
      'aucsoe.submit',
      'comm.ack',
      'staff.propose',
      'meetings.update',
      'admin.request',
      'docs.upload',
    ],
  },
  dataEntry: {
    label: 'Data Entry Staff',
    scope: 'centre',
    capabilities: ['research.enter', 'finance.expenditure', 'aucsoe.enter', 'docs.upload'],
  },
  admin: {
    label: 'Administrator',
    scope: 'national',
    capabilities: [
      'masters.edit',
      'users.manage',
      'system.manage',
      'docs.upload',
      'comm.issue',
      'meetings.manage',
      'staff.manage',
      'admin.manage',
      'finance.manage',
      'research.config',
    ],
  },
};

export const hasCapability = (roleId: RoleId, capability: Capability): boolean =>
  ROLES[roleId].capabilities.includes(capability);

/**
 * Which roles each role may give to a new or existing account (on top of needing `users.manage`).
 * - Only the PCU (Project Coordinator) and the Super Administrator can create centre staff (PI, data entry).
 * - Privileged roles (Project Coordinator, Administrator, Super Administrator) can only be given by a
 *   Super Administrator, so nobody can create an account more powerful than their own.
 */
export const ASSIGNABLE_ROLES: Readonly<Record<RoleId, readonly RoleId[]>> = {
  superadmin: ROLE_IDS,
  pc: ['pi', 'dataEntry', 'reviewer', 'finance', 'adminOfficer'],
  admin: ['reviewer', 'finance', 'adminOfficer'],
  finance: [],
  adminOfficer: [],
  reviewer: [],
  pi: [],
  dataEntry: [],
};

export const canAssignRole = (actor: RoleId, target: RoleId): boolean =>
  ASSIGNABLE_ROLES[actor].includes(target);

export const WORKFLOW_STATUSES = [
  'Draft',
  'Submitted',
  'Scrutinised',
  'Returned',
  'Resubmitted',
  'Approved',
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const CENTRE_TYPES = ['Network Centre', 'Voluntary Centre'] as const;
export type CentreType = (typeof CENTRE_TYPES)[number];

export const AUTH_COOKIE = 'nf_session';
