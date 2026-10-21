// Review of #232 (#251 beta): the release-date guard's "has a file" half had no test on either side -
// dropping it still passed both suites. It is one policy now, shared by the ComicVine and Metron
// paths. Engine twin: metadata.rs synced_release_date (same cases).
import { describe, it, expect } from 'vitest';
import { syncedReleaseDate } from '@/lib/utils/synced-release-date';

const FILE_DATE = '2017-06-30';
const STORE_DATE = '2017-04-19';

describe('syncedReleaseDate (engine twin)', () => {
    it("keeps a filed issue's own date under file priority", () => {
        expect(syncedReleaseDate(FILE_DATE, STORE_DATE, false, true, true)).toBe(FILE_DATE);
    });

    it("moves a placeholder's date: with no file there is nothing to protect, and a delayed issue keeps moving on the calendar", () => {
        expect(syncedReleaseDate(FILE_DATE, STORE_DATE, false, true, false)).toBe(STORE_DATE);
    });

    it('lets the provider fill a blank', () => {
        expect(syncedReleaseDate(null, STORE_DATE, false, true, true)).toBe(STORE_DATE);
        expect(syncedReleaseDate('  ', STORE_DATE, false, true, true)).toBe(STORE_DATE);
    });

    it("takes the provider's date when file priority is off, as before", () => {
        expect(syncedReleaseDate(FILE_DATE, STORE_DATE, false, false, true)).toBe(STORE_DATE);
    });

    it('keeps a hand-edited issue\'s date whatever else holds', () => {
        expect(syncedReleaseDate(FILE_DATE, STORE_DATE, true, false, false)).toBe(FILE_DATE);
    });
});
