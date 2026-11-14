// Person-name helpers, following the PCU master table ("Users" sheet):
// Title (Dr/Mr/Mrs) | First Name | Middle Name | Surname | Designation | Email | Mobile | Organization Name.

/** Titles offered in forms. The sheet lists Dr/Mr/Mrs; Prof and Ms are added for completeness. */
export const TITLES = ['Dr', 'Prof', 'Mr', 'Mrs', 'Ms'] as const;
export type Title = (typeof TITLES)[number];

export interface NameParts {
  title?: Title | null;
  firstName?: string | null;
  middleName?: string | null;
  surname?: string | null;
}

/** "Dr. Sujit Kumar Singh": the display name stored in `name` (used for sorting, search, audit). */
export const composeName = ({ title, firstName, middleName, surname }: NameParts): string =>
  [title ? `${title}.` : null, firstName, middleName, surname]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');

const TITLE_PREFIX = /^(dr|prof|mr|mrs|ms)\.?\s+/i;

/**
 * Best-effort split of an old single-field name ("Dr. A. K. Sharma") into parts, for migrating
 * accounts created before the name fields existed. One word → first name only;
 * two → first + surname; more → first + middle (the rest) + surname.
 */
export const splitName = (fullName: string): Required<NameParts> => {
  let rest = fullName.trim().replace(/\s+/g, ' ');
  let title: Title | null = null;
  const match = TITLE_PREFIX.exec(rest);
  if (match) {
    const word = match[1]!.toLowerCase();
    title = TITLES.find((t) => t.toLowerCase() === word) ?? null;
    rest = rest.slice(match[0].length);
  }
  const words = rest.split(' ').filter(Boolean);
  const firstName = words[0] ?? '';
  const surname = words.length > 1 ? words[words.length - 1]! : null;
  const middleName = words.length > 2 ? words.slice(1, -1).join(' ') : null;
  return { title, firstName, middleName, surname };
};
