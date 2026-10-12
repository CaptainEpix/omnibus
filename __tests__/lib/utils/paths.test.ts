// __tests__/lib/utils/paths.test.ts
//
// The containment rules every series-folder write and every destructive folder operation leans on.
import { describe, it, expect } from 'vitest';
import { isPathWithinRoots, isInsideLibraryRoot } from '@/lib/utils/paths';

describe('isPathWithinRoots', () => {
    it('collapses .. before checking, and needs a separator boundary', () => {
        expect(isPathWithinRoots('/data/comics/Batman/01.cbz', ['/data/comics'])).toBe(true);
        expect(isPathWithinRoots('/data/comics/../../etc/passwd', ['/data/comics'])).toBe(false);
        expect(isPathWithinRoots('/data/comics-secret/x.cbz', ['/data/comics'])).toBe(false);
    });
});

describe('isInsideLibraryRoot', () => {
    const roots = ['/data/comics', '/data/manga/'];

    it('accepts a folder strictly inside a library root', () => {
        expect(isInsideLibraryRoot('/data/comics/Image/Saga (2012)', roots)).toBe(true);
        expect(isInsideLibraryRoot('/data/manga/Chainsaw Man', roots)).toBe(true);
        expect(isInsideLibraryRoot('/DATA/Comics/Image', roots)).toBe(true);
    });

    it('never accepts a library root itself, however it is spelled', () => {
        expect(isInsideLibraryRoot('/data/comics', roots)).toBe(false);
        expect(isInsideLibraryRoot('/data/comics/', roots)).toBe(false);
        expect(isInsideLibraryRoot('/data/manga', roots)).toBe(false);
        expect(isInsideLibraryRoot('/data/comics/Image/..', roots)).toBe(false);
        expect(isInsideLibraryRoot('/data/comics/../comics', roots)).toBe(false);
    });

    it('refuses anything that climbs out, a sibling prefix, or nothing at all', () => {
        expect(isInsideLibraryRoot('/data/comics/Image/../../config', roots)).toBe(false);
        expect(isInsideLibraryRoot('/data', roots)).toBe(false);
        expect(isInsideLibraryRoot('/', roots)).toBe(false);
        expect(isInsideLibraryRoot('/data/comics-secret/x', roots)).toBe(false);
        expect(isInsideLibraryRoot('', roots)).toBe(false);
        expect(isInsideLibraryRoot(null, roots)).toBe(false);
        expect(isInsideLibraryRoot('/data/comics/Image', [])).toBe(false);
    });
});
