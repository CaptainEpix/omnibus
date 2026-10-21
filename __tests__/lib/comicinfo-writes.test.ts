// #251: one rule for when Omnibus writes ComicInfo.xml into a comic. "Write metadata to
// ComicInfo.xml" covers every automatic write, and an edit's own toggle is the only override.
// Engine twin: metadata_writer.rs writes_comicinfo.
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { systemSetting: { findUnique: mocks.findUnique } } }));

import { comicInfoWritesEnabled, resolveWriteToFile } from '@/lib/comicinfo-writes';

describe('ComicInfo.xml write rule (#251)', () => {
    it('is on unless the admin turned it off (an absent row is on)', async () => {
        mocks.findUnique.mockResolvedValueOnce(null);
        expect(await comicInfoWritesEnabled()).toBe(true);
        mocks.findUnique.mockResolvedValueOnce({ key: 'metadata_write_comicinfo', value: 'true' });
        expect(await comicInfoWritesEnabled()).toBe(true);
        mocks.findUnique.mockResolvedValueOnce({ key: 'metadata_write_comicinfo', value: 'false' });
        expect(await comicInfoWritesEnabled()).toBe(false);
        expect(mocks.findUnique).toHaveBeenCalledWith({ where: { key: 'metadata_write_comicinfo' } });
    });

    it("lets an edit's own toggle win, and leaves it to the setting without one", async () => {
        mocks.findUnique.mockResolvedValue({ key: 'metadata_write_comicinfo', value: 'false' });
        expect(await resolveWriteToFile(true)).toBe(true);
        expect(await resolveWriteToFile(undefined)).toBe(false);

        mocks.findUnique.mockResolvedValue({ key: 'metadata_write_comicinfo', value: 'true' });
        expect(await resolveWriteToFile(false)).toBe(false);
        expect(await resolveWriteToFile(undefined)).toBe(true);
    });
});
