// #251: the bulk issue editor queued an embed for every save, whatever "Write metadata to
// ComicInfo.xml" said. It now follows the same rule as a single-issue edit: the edit's own
// writeToFile wins, and without one the setting decides.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    settingFindUnique: vi.fn(),
    queueAdd: vi.fn(async () => ({})),
}));

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'admin1', role: 'ADMIN' } })) }));
vi.mock('@/lib/db', () => ({
    prisma: {
        issue: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
        $transaction: vi.fn(async (ops: unknown[]) => ops),
        systemSetting: { findUnique: mocks.settingFindUnique },
    },
}));
vi.mock('@/lib/queue', () => ({ omnibusQueue: { add: mocks.queueAdd } }));

import { PUT } from '@/app/api/library/issue/bulk/route';

const bulkEdit = (body: Record<string, unknown>) => PUT(new Request('http://localhost/api/library/issue/bulk', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates: [{ id: 'i1', number: '1', name: 'Chapter One', releaseDate: null }], ...body }),
}));
const embedJobs = () => mocks.queueAdd.mock.calls.filter((c: unknown[]) => c[0] === 'EMBED_METADATA');
const setting = (value: string | null) =>
    mocks.settingFindUnique.mockResolvedValue(value === null ? null : { key: 'metadata_write_comicinfo', value });

describe('Bulk issue edit: ComicInfo.xml writes (#251)', () => {
    beforeEach(() => setting(null));

    it('embeds the edited issues at the default (writing on)', async () => {
        const res = await bulkEdit({});

        expect(res.status).toBe(200);
        expect(embedJobs()).toEqual([['EMBED_METADATA', { type: 'EMBED_METADATA', issueIds: ['i1'] }, expect.any(Object)]]);
    });

    it('leaves the files alone while writing is off', async () => {
        setting('false');

        const res = await bulkEdit({});

        expect(res.status).toBe(200);
        expect(embedJobs()).toEqual([]);
    });

    it("lets the edit's own toggle win either way", async () => {
        setting('false');
        await bulkEdit({ writeToFile: true });
        expect(embedJobs()).toHaveLength(1);

        mocks.queueAdd.mockClear();
        setting('true');
        await bulkEdit({ writeToFile: false });
        expect(embedJobs()).toEqual([]);
    });
});
