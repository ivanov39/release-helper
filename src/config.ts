export const YOUTRACK_BASE_URL = 'https://issues.enjoydev.io';
export const YOUTRACK_API_URL = `${YOUTRACK_BASE_URL}/api`;

export const GITHUB_REPOS = [
  'omi-enjoy/es-next',
  'omi-enjoy/es-application',
];

export const BITBUCKET_ORG = 'omi-russia';

export const BITBUCKET_REPOS = [
  'es-pass',
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

export const BITBUCKET_API_URL = 'https://api.bitbucket.org/2.0';

export const REPO_SHORT_NAMES: Record<string, string> = {
  'omi-enjoy/es-next': 'es-next',
  'omi-enjoy/es-application': 'es-application',
  'es-pass': 'es-pass',
  'es-admin-api-client': 'es-admin-api-client',
  'es-pass-api-client': 'es-pass-api-client',
  'es-migrations': 'es-migrations',
  'es-auth': 'es-auth',
  'es-autotester': 'es-autotester',
  'es-autotester-api-client': 'es-autotester-api-client',
  'epd-api-client': 'epd-api-client',
  'epc-api-client': 'epc-api-client',
  'ef-api-client': 'ef-api-client',
  'em-api-client': 'em-api-client',
  'ed-api-bundle': 'ed-api-bundle',
  'ed-api-client': 'ed-api-client',
  'ed-codeception-modules': 'ed-codeception-modules',
  'ed-codestyle': 'ed-codestyle',
  'ed-doctrine-extension': 'ed-doctrine-extension',
  'ed-fixtures': 'ed-fixtures',
  'ed-frontend-api-bundle': 'ed-frontend-api-bundle',
  'ed-mq-event': 'ed-mq-event',
  'ed-query-dsl': 'ed-query-dsl',
  'ed-rbac-bundle': 'ed-rbac-bundle',
  'ed-validation-bundle': 'ed-validation-bundle',
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

/** Load Bitbucket credentials from environment variables */
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

  // URL pattern: https://issues.enjoydev.io/issue/ESN-2274 or /issue/ES-3310/release-6-116-0
  const urlMatch = input.match(/\/issue\/(ESN?-\d+)/);
  if (urlMatch) return urlMatch[1];

  // Direct ID pattern: ESN-2274, ES-3310
  const idMatch = input.match(/^(ESN?-\d+)$/);
  if (idMatch) return idMatch[1];

  return null;
}
