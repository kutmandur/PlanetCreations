import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { cwd } from 'node:process';

const sourceRoot = join(cwd(), 'src');
const sourceExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx']);
const legacyOpacityClass = /\b(?:bg|border|divide|from|placeholder|ring|text|to|via)-opacity-\d+\b/g;

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        if (!sourceExtensions.has(extname(entry.name)) || entry.name.includes('.test.')) return [];
        return [path];
    });
}

test('uses Tailwind 4 slash opacity utilities so translucent surfaces stay translucent', () => {
    const offenders = sourceFiles(sourceRoot).flatMap(path => {
        const matches = readFileSync(path, 'utf8').match(legacyOpacityClass) || [];
        return matches.map(className => `${path.slice(sourceRoot.length + 1)}: ${className}`);
    });

    expect(offenders).toEqual([]);
});
