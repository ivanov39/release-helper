export const YOUTRACK_BASE_URL = 'https://tm.ertdev.com';
export const YOUTRACK_API_URL = `${YOUTRACK_BASE_URL}/api`;

export const GITHUB_REPOS = [
  'omi-enjoy/es-next',
  'omi-enjoy/es-application',
  'omi-enjoy/es-pass',
  'omi-enjoy/es-admin-api-client',
  'omi-enjoy/es-pass-api-client',
  'omi-enjoy/es-migrations',
  'omi-enjoy/es-auth',
  'omi-enjoy/es-autotester',
  'omi-enjoy/es-autotester-api-client',
  'omi-enjoy/epd-api-client',
  'omi-enjoy/epc-api-client',
  'omi-enjoy/ef-api-client',
  'omi-enjoy/em-api-client',
  'omi-enjoy/ed-api-bundle',
  'omi-enjoy/ed-api-client',
  'omi-enjoy/ed-codeception-modules',
  'omi-enjoy/ed-codestyle',
  'omi-enjoy/ed-doctrine-extension',
  'omi-enjoy/ed-fixtures',
  'omi-enjoy/ed-frontend-api-bundle',
  'omi-enjoy/ed-mq-event',
  'omi-enjoy/ed-query-dsl',
  'omi-enjoy/ed-rbac-bundle',
  'omi-enjoy/ed-validation-bundle',
];

/** @deprecated Retained for rollback only — no longer used by the active pipeline (Bitbucket migrated to GitHub under omi-enjoy). */
export const BITBUCKET_ORG = 'omi-russia';

/** @deprecated Retained for rollback only — no longer used by the active pipeline (Bitbucket migrated to GitHub under omi-enjoy). */
export const BITBUCKET_REPOS = [
  'es-admin-api-client',
  'es-pass-api-client',
  'es-migrations',
  'es-auth',
  'es-autotester',
  'es-autotester-api-client',
  'epd-api-client',
  'epc-api-client',
  'ef-api-client',
  'em-api-client',
  'ed-api-bundle',
  'ed-api-client',
  'ed-codeception-modules',
  'ed-codestyle',
  'ed-doctrine-extension',
  'ed-fixtures',
  'ed-frontend-api-bundle',
  'ed-mq-event',
  'ed-query-dsl',
  'ed-rbac-bundle',
  'ed-validation-bundle',
];

/** @deprecated Retained for rollback only — no longer used by the active pipeline (Bitbucket migrated to GitHub under omi-enjoy). */
export const BITBUCKET_API_URL = 'https://api.bitbucket.org/2.0';

export const REPO_SHORT_NAMES: Record<string, string> = {
  'omi-enjoy/es-next': 'es-next',
  'omi-enjoy/es-application': 'es-application',
  'omi-enjoy/es-pass': 'es-pass',
  'omi-enjoy/es-admin-api-client': 'es-admin-api-client',
  'omi-enjoy/es-pass-api-client': 'es-pass-api-client',
  'omi-enjoy/es-migrations': 'es-migrations',
  'omi-enjoy/es-auth': 'es-auth',
  'omi-enjoy/es-autotester': 'es-autotester',
  'omi-enjoy/es-autotester-api-client': 'es-autotester-api-client',
  'omi-enjoy/epd-api-client': 'epd-api-client',
  'omi-enjoy/epc-api-client': 'epc-api-client',
  'omi-enjoy/ef-api-client': 'ef-api-client',
  'omi-enjoy/em-api-client': 'em-api-client',
  'omi-enjoy/ed-api-bundle': 'ed-api-bundle',
  'omi-enjoy/ed-api-client': 'ed-api-client',
  'omi-enjoy/ed-codeception-modules': 'ed-codeception-modules',
  'omi-enjoy/ed-codestyle': 'ed-codestyle',
  'omi-enjoy/ed-doctrine-extension': 'ed-doctrine-extension',
  'omi-enjoy/ed-fixtures': 'ed-fixtures',
  'omi-enjoy/ed-frontend-api-bundle': 'ed-frontend-api-bundle',
  'omi-enjoy/ed-mq-event': 'ed-mq-event',
  'omi-enjoy/ed-query-dsl': 'ed-query-dsl',
  'omi-enjoy/ed-rbac-bundle': 'ed-rbac-bundle',
  'omi-enjoy/ed-validation-bundle': 'ed-validation-bundle',
};

/** Composer-related file patterns */
export const COMPOSER_PATTERNS = [
  'composer.json',
  'composer.lock',
];

/** Parameters file patterns */
export const PARAMS_PATTERNS = [
  /parameters\.yml\.dist$/,
  /parameters_.*\.yml\.dist$/,
  /app\/config\/parameters.*\.yml\.dist$/,
];

/** Link types and their search queries */
export const LINK_SEARCH_MAP: Record<string, { search: string; reverseSearch: string }> = {
  'parent for': { search: 'subtask of', reverseSearch: 'parent for' },
  'subtask of': { search: 'parent for', reverseSearch: 'subtask of' },
  'depends on': { search: 'is required for', reverseSearch: 'depends on' },
  'is required for': { search: 'depends on', reverseSearch: 'is required for' },
  'relates to': { search: 'relates to', reverseSearch: 'relates to' },
  'duplicates': { search: 'is duplicated by', reverseSearch: 'duplicates' },
  'is duplicated by': { search: 'duplicates', reverseSearch: 'is duplicated by' },
};

/** Task types to include when checking linked tasks */
export const INCLUDED_TASK_TYPES = ['Task', 'Feature', 'Bug'];

/**
 * YouTrack `Status` values meaning the task was dropped. Such tasks bring no
 * changes into the release and are struck through in the report.
 */
export const CANCELLED_STATUSES = ['canceled', 'cancelled'];

/** Whether a YouTrack status marks the task as cancelled */
export function isCancelledStatus(status: string): boolean {
  return CANCELLED_STATUSES.includes(status.trim().toLowerCase());
}

/** Prefix of release branches, e.g. release/3.161.0 */
export const RELEASE_BRANCH_PREFIX = 'release/';

/** Extract the release version from the release issue summary: "Release 3.161.0" -> "3.161.0" */
export function parseReleaseVersion(summary: string): string | null {
  if (!summary) return null;
  const match = summary.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

/**
 * Branch names to try for a version, most specific first. The bare version is a
 * legacy naming form still present in older repos (e.g. `6.119.0` without prefix).
 */
export function releaseBranchCandidates(version: string): string[] {
  return [`${RELEASE_BRANCH_PREFIX}${version}`, version];
}

/**
 * @deprecated Retained for rollback only — no longer used by the active pipeline (Bitbucket migrated to GitHub under omi-enjoy).
 * Load Bitbucket credentials from environment variables.
 */
export function loadBitbucketCredentials(): { email: string; token: string } {
  const email = process.env.BITBUCKET_EMAIL ?? '';
  const token = process.env.BITBUCKET_TOKEN ?? '';

  if (!email || !token) {
    throw new Error('Missing BITBUCKET_EMAIL or BITBUCKET_TOKEN in environment (check .env file)');
  }

  return { email, token };
}

/** Get YouTrack token from environment */
export function getYouTrackToken(): string {
  const token = process.env.YOUTRACK_TOKEN;
  if (!token) {
    throw new Error('YOUTRACK_TOKEN environment variable is not set');
  }
  return token;
}

/** Parse issue ID from URL or direct input */
export function parseIssueId(input: string): string | null {
  if (!input) return null;

  // URL pattern: https://tm.ertdev.com/issue/ESN-2274 or /issue/ES-3310/release-6-116-0
  const urlMatch = input.match(/\/issue\/(ESN?-\d+)/);
  if (urlMatch) return urlMatch[1];

  // Direct ID pattern: ESN-2274, ES-3310
  const idMatch = input.match(/^(ESN?-\d+)$/);
  if (idMatch) return idMatch[1];

  return null;
}
