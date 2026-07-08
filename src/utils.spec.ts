import { styleText } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { colorizeDiff, updateSemverRange } from './utils';

describe('updateSemverRange', () => {
    it('should preserve caret prefix', () => {
        expect(updateSemverRange('^1.2.3', '1.3.0')).toBe('^1.3.0');
    });

    it('should preserve tilde prefix', () => {
        expect(updateSemverRange('~1.2.3', '1.2.4')).toBe('~1.2.4');
    });

    it('should preserve relational operators', () => {
        expect(updateSemverRange('>=1.2.3', '1.5.0')).toBe('>=1.5.0');
        expect(updateSemverRange('>1.2.3', '1.5.0')).toBe('>1.5.0');
    });

    it('should convert upper-bound to caret', () => {
        expect(updateSemverRange('<2.0.0', '2.5.0')).toBe('^2.5.0');
        expect(updateSemverRange('<=2.0.0', '2.5.0')).toBe('^2.5.0');
        expect(updateSemverRange('^1.0.0 || <2.0.0', '2.5.0')).toBe('^1.0.0 || ^2.5.0');
    });

    it('should preserve exact version', () => {
        expect(updateSemverRange('1.2.3', '1.4.0')).toBe('1.4.0');
    });

    it('should preserve global wildcards', () => {
        expect(updateSemverRange('*', '2.5.0')).toBe('*');
        expect(updateSemverRange('x', '2.5.0')).toBe('x');
    });

    it('should preserve major x-range wildcards', () => {
        expect(updateSemverRange('1.x', '2.5.0')).toBe('2.x');
        expect(updateSemverRange('1.X', '3.1.0')).toBe('3.X');
        expect(updateSemverRange('1.*', '4.0.1')).toBe('4.*');
    });

    it('should preserve minor x-range wildcards', () => {
        expect(updateSemverRange('1.2.x', '1.4.5')).toBe('1.4.x');
        expect(updateSemverRange('2.3.*', '2.6.1')).toBe('2.6.*');
    });

    it('should preserve hyphen ranges', () => {
        expect(updateSemverRange('1.0.0 - 2.0.0', '2.5.0')).toBe('1.0.0 - 2.5.0');
    });

    it('should preserve logical OR', () => {
        expect(updateSemverRange('^1.0.0 || ^2.0.0', '2.5.0')).toBe('^1.0.0 || ^2.5.0');
    });

    it('should block a downgrade inside a hyphen range format', () => {
        const original = '1.2.0 - 2.0.0';
        expect(updateSemverRange(original, '1.1.0')).toBe(original);
    });

    it('should block a downgrade if the target is lower than the lowest OR bounds', () => {
        const original = '^1.5.0 || ^2.0.0';
        expect(updateSemverRange(original, '1.4.0')).toBe(original);
    });

    it('should reject downgrades and return the original range', () => {
        const original = '^1.5.0';
        expect(updateSemverRange(original, '1.4.0')).toBe(original);
    });

    it('should reject invalid target version strings gracefully', () => {
        const original = '^1.2.3';
        expect(updateSemverRange(original, 'not-a-version')).toBe(original);
    });

    it('should handle completely invalid initial ranges safely', () => {
        expect(updateSemverRange('invalid-range', '1.0.0')).toBe('1.0.0');
    });
});

describe('colorizeDiff', () => {
    let originalForceColor: string | undefined;

    beforeAll(() => {
        originalForceColor = process.env['FORCE_COLOR'];
        process.env['FORCE_COLOR'] = '1';
    });

    afterAll(() => {
        if (originalForceColor === undefined) {
            delete process.env['FORCE_COLOR'];
        } else {
            process.env['FORCE_COLOR'] = originalForceColor;
        }
    });

    it('should return the version in gray if nothing changed', () => {
        expect(colorizeDiff('1.2.3', '1.2.3')).toBe(styleText('gray', '1.2.3'));
    });

    it('should colorize major version changes in red', () => {
        expect(colorizeDiff('1.2.3', '2.0.0')).toBe(styleText('red', '2.0.0'));
    });

    it('should colorize minor version changes in cyan', () => {
        expect(colorizeDiff('1.2.3', '1.3.0')).toBe(`1.${styleText('cyan', '3.0')}`);
    });

    it('should colorize patch version changes in green', () => {
        expect(colorizeDiff('1.2.3', '1.2.4')).toBe(`1.2.${styleText('green', '4')}`);
    });

    it('should colorize major version zero changes in magenta', () => {
        expect(colorizeDiff('0.1.0', '0.2.0')).toBe(`0.${styleText('magenta', '2.0')}`);
    });

    it('should colorize operator changes in red', () => {
        expect(colorizeDiff('^1.2.3', '~1.2.3')).toBe(`${styleText('red', '~')}1.2.3`);
    });
});
