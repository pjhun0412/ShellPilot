const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const HANGUL_INITIAL_BLOCK_SIZE = 588;
const HANGUL_INITIAL_CONSONANTS = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
];

export function matchesSearchText(searchText: string, ...values: string[]) {
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();

  if (!normalizedSearchText) {
    return true;
  }

  const searchableText = values.join(' ').toLocaleLowerCase();

  return searchableText.includes(normalizedSearchText) ||
    matchesKoreanInitialSearch(normalizedSearchText, searchableText);
}

function matchesKoreanInitialSearch(searchText: string, targetText: string) {
  if (searchText.length > targetText.length) {
    return false;
  }

  for (let startIndex = 0; startIndex <= targetText.length - searchText.length; startIndex += 1) {
    let didMatch = true;

    for (let searchIndex = 0; searchIndex < searchText.length; searchIndex += 1) {
      const searchChar = searchText[searchIndex];
      const targetChar = targetText[startIndex + searchIndex];

      if (
        searchChar !== targetChar &&
        (!isHangulInitialConsonant(searchChar) || getHangulInitialConsonant(targetChar) !== searchChar)
      ) {
        didMatch = false;
        break;
      }
    }

    if (didMatch) {
      return true;
    }
  }

  return false;
}

function isHangulInitialConsonant(value: string) {
  return HANGUL_INITIAL_CONSONANTS.includes(value);
}

function getHangulInitialConsonant(value: string) {
  const codePoint = value.charCodeAt(0);

  if (codePoint < HANGUL_SYLLABLE_START || codePoint > HANGUL_SYLLABLE_END) {
    return '';
  }

  return HANGUL_INITIAL_CONSONANTS[
    Math.floor((codePoint - HANGUL_SYLLABLE_START) / HANGUL_INITIAL_BLOCK_SIZE)
  ];
}
