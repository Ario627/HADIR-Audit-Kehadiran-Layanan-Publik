export interface PasswordIssue {
  code: string;
  message: string;
}

const MIN_CHARACTERS = 12;
const MAX_CHARACTERS = 256;

const BANNED_FRAGMENTS: readonly string[] = Object.freeze([
  'password',
  'passw0rd',
  'qwerty',
  '123456',
'iloveyou',                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
  'admin',
  'hadir',
  'dishub',
  'polrestabes',
]);

export function passwordIssues(raw: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const characters = Array.from(raw);

  if (characters.length < MIN_CHARACTERS) {
    issues.push({
      code: 'too_short',
      message: `Kata sandi minimal ${MIN_CHARACTERS} karakter.`,
    });
  }
  if (characters.length > MAX_CHARACTERS) {
    issues.push({
      code: 'too_long',
      message: `Kata sandi maksimal ${MAX_CHARACTERS} karakter.`,
    });
  }
  if (/^\s|\s$/.test(raw)) {
    issues.push({
      code: 'edge_whitespace',
      message: 'Kata sandi tidak boleh diawali atau diakhiri spasi.',
    });
  }

  const lowered = raw.toLowerCase();
  if (BANNED_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    issues.push({
      code: 'common_fragment',
      message: 'Kata sandi memuat frasa yang terlalu mudah ditebak.',
    });
  }

  const distinct = new Set(characters);
  if (distinct.size < 6) {
    issues.push({
      code: 'low_variety',
      message: 'Kata sandi terlalu monoton; gunakan lebih banyak karakter berbeda.',
    });
  }

  if (/^(.)\1+$/.test(raw)) {
    issues.push({
      code: 'single_character',
      message: 'Kata sandi tidak boleh satu karakter berulang.',
    });
  }

  return issues;
}

export function passwordAcceptable(raw: string): boolean {
  return passwordIssues(raw).length === 0;
}
