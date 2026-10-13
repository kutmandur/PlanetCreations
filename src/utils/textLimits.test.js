import { expect, it } from 'vitest';
import { TEXT_LIMITS, textLengthError } from './textLimits';

it.each(Object.entries(TEXT_LIMITS))('%s accepts its boundary and rejects excess without truncation', (name, limit) => {
    expect(textLengthError('a'.repeat(limit), limit)).toBe('');
    expect(textLengthError('a'.repeat(limit + 1), limit)).toContain(String(limit));
});
it('checks username minimum and counts supplementary characters consistently', () => {
    expect(textLengthError('ab', TEXT_LIMITS.username, 'Username', 3)).toContain('at least 3');
    expect(textLengthError('abc', TEXT_LIMITS.username, 'Username', 3)).toBe('');
    expect(textLengthError('😀', 2)).toBe('');
    expect(textLengthError('😀a', 2)).not.toBe('');
});
