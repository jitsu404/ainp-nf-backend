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

export const ROLE_IDS = ['superadmin', 'pc', 'pi'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** national = sees every centre; centre = limited to the user's own centre. */
export type RoleScope = 'national' | 'centre';

export interface RoleDefinition {
  label: string;
  scope: RoleScope;
  capabilities: readonly Capability[];
}

// Hierarchy for this phase (agreed with the PCU, 2026-11-14):
//   Super Admin  ═╗ same level for daily work: both manage centres and assign Centre PIs.
//   PCU          ═╝ (Super Admin is the system owner; only it manages PCU accounts.)
//     └─ Centre PI: the agronomist in charge of one centre. One active PI per centre.
// Finance, data entry and the PCU theme PIs (PI-1…PI-4) are added with their modules.
export const ROLES: Readonly<Record<RoleId, RoleDefinition>> = {
  // Every capability, including ones added later. All actions are audited like anyone else's.
  superadmin: {
    label: 'Super Admin',
    scope: 'national',
    capabilities: CAPABILITIES,
  },
  pc: {
    label: 'PCU',
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
  pi: {
    label: 'Centre PI',
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
};

export const hasCapability = (roleId: RoleId, capability: Capability): boolean =>
  ROLES[roleId].capabilities.includes(capability);

/**
 * Which roles each role may give to an account, and therefore also edit, deactivate or
 * reset (on top of needing `users.manage`). Only Super Admin manages PCU and Super Admin
 * accounts, so PCU users can't grant themselves or each other access.
 */
export const ASSIGNABLE_ROLES: Readonly<Record<RoleId, readonly RoleId[]>> = {
  superadmin: ['superadmin', 'pc', 'pi'],
  pc: ['pi'],
  pi: [],
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
