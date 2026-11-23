import { describe, expect, it } from 'vitest';
import { MAX_PROMPT_BOOKMARKS, restorePromptBookmarks } from './prompt-history';

describe('restorePromptBookmarks', () => {
  it('drops non-objects, empty text and duplicates, and keeps savedAt', () => {
    expect(
      restorePromptBookmarks([
        { text: 'Fix tests', savedAt: 10 },
        { text: 'Fix tests', savedAt: 20 },
        { text: '   ' },
        { text: 42 },
        null,
        { text: 'Ship it' },
      ]),
    ).toEqual([
      { text: 'Fix tests', savedAt: 10 },
      { text: 'Ship it', savedAt: 0 },
    ]);
  });

  it('caps the list and returns undefined for unusable values', () => {
    const many = Array.from({ length: MAX_PROMPT_BOOKMARKS + 5 }, (_, index) => ({
      text: `prompt ${index}`,
      savedAt: index,
    }));
    expect(restorePromptBookmarks(many)).toHaveLength(MAX_PROMPT_BOOKMARKS);
    expect(restorePromptBookmarks([])).toBeUndefined();
    expect(restorePromptBookmarks('nope')).toBeUndefined();
    expect(restorePromptBookmarks(undefined)).toBeUndefined();
  });
});
