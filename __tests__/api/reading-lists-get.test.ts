// #252 (conduit4731): GET /api/reading-lists loaded every visible list with every item, each with its
// full issue and series rows, and relinked every unlinked item across all lists - on every page load.
// With a few hundred imported CBL lists the page was unusable. The overview is list details plus
// counts now; one list's items come from GET ?id=. #253: each item carries the caller's progress.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    listFindMany: vi.fn(),
    listFindFirst: vi.fn(),
    itemGroupBy: vi.fn(),
    itemFindMany: vi.fn(),
    itemUpdate: vi.fn(),
    issueFindMany: vi.fn(),
    progressFindMany: vi.fn(),
    transaction: vi.fn(async (ops: unknown[]) => ops),
    accessibleLibs: vi.fn(),
}));

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1', role: 'USER' } })) }));
vi.mock('@/lib/library-access', () => ({ getAccessibleLibraryIds: mocks.accessibleLibs }));
vi.mock('@/lib/db', () => ({
    prisma: {
        readingList: { findMany: mocks.listFindMany, findFirst: mocks.listFindFirst },
        readingListItem: { groupBy: mocks.itemGroupBy, findMany: mocks.itemFindMany, update: mocks.itemUpdate },
        issue: { findMany: mocks.issueFindMany },
        readProgress: { findMany: mocks.progressFindMany },
        $transaction: mocks.transaction,
    },
}));

import { GET } from '@/app/api/reading-lists/route';

const get = (query = '') => GET(new Request(`http://localhost/api/reading-lists${query}`));
const VISIBLE = { OR: [{ userId: 'u1' }, { isGlobal: true }, { userId: null }] };
const LIST = { id: 'l1', name: 'Crisis', description: null, coverUrl: null, isGlobal: true, userId: 'u2', shareId: null, user: { username: 'admin' } };
const issue = (id: string, number: string, filePath: string | null) => ({
    id, number, name: `Part ${number}`, filePath, coverUrl: null, metadataSource: 'COMICVINE',
    series: { id: 's1', name: 'Crisis', folderPath: '/comics/Crisis', metadataId: '42', metadataSource: 'COMICVINE' },
});

describe('GET /api/reading-lists: the overview (#252)', () => {
    beforeEach(() => {
        mocks.accessibleLibs.mockResolvedValue('ALL');
        mocks.listFindMany.mockResolvedValue([{ ...LIST }, { ...LIST, id: 'l2', name: 'Blackest Night' }]);
        mocks.itemGroupBy.mockImplementation(async ({ where }: { where: unknown }) => {
            const w = JSON.stringify(where);
            if (w.includes('readProgresses')) return [{ listId: 'l1', _count: { _all: 42 } }];
            if (w.includes('filePath')) return [{ listId: 'l1', _count: { _all: 98 } }];
            return [{ listId: 'l1', _count: { _all: 120 } }, { listId: 'l2', _count: { _all: 3 } }];
        });
    });

    it('returns every visible list with its counts and none of its items', async () => {
        const res = await get();
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual([
            expect.objectContaining({ id: 'l1', name: 'Crisis', counts: { total: 120, owned: 98, read: 42 } }),
            expect.objectContaining({ id: 'l2', name: 'Blackest Night', counts: { total: 3, owned: 0, read: 0 } }),
        ]);
        expect(body[0]).not.toHaveProperty('items');

        const listArgs = mocks.listFindMany.mock.calls[0][0];
        expect(listArgs.where).toEqual(VISIBLE);
        expect(JSON.stringify(listArgs)).not.toContain('items');
        // Nothing per item: no issue rows, no relinking.
        expect(mocks.itemFindMany).not.toHaveBeenCalled();
        expect(mocks.issueFindMany).not.toHaveBeenCalled();
        expect(mocks.itemUpdate).not.toHaveBeenCalled();
    });

    it("counts only the items the caller may see, and only the caller's own finished issues as read", async () => {
        mocks.accessibleLibs.mockResolvedValue(['lib1']);

        await get();

        expect(mocks.itemGroupBy).toHaveBeenCalledTimes(3);
        for (const [args] of mocks.itemGroupBy.mock.calls) {
            const where = JSON.stringify(args.where);
            expect(where).toContain(JSON.stringify(VISIBLE.OR));
            expect(where).toContain('"libraryId":{"in":["lib1"]}');
        }
        const read = mocks.itemGroupBy.mock.calls.map(([a]) => JSON.stringify(a.where)).find(w => w.includes('readProgresses'))!;
        expect(read).toContain('"some":{"userId":"u1","isCompleted":true}');
        // "Owned" is an issue with a file - a linked placeholder doesn't count.
        const owned = mocks.itemGroupBy.mock.calls.map(([a]) => JSON.stringify(a.where)).find(w => w.includes('filePath'))!;
        expect(owned).toContain('{"filePath":{"not":null}}');
        expect(owned).toContain('{"filePath":{"not":""}}');
    });
});

describe('GET /api/reading-lists?id=: one list (#252, #253)', () => {
    beforeEach(() => {
        mocks.accessibleLibs.mockResolvedValue('ALL');
        mocks.listFindFirst.mockResolvedValue({ ...LIST });
        mocks.itemFindMany.mockImplementation(async ({ where }: { where: { issueId?: unknown } }) => (where.issueId === null ? [] : [
            { id: 'it1', order: 0, title: '', cvIssueId: null, metadataSource: 'COMICVINE', issueId: 'i1', issue: issue('i1', '1', '/comics/Crisis/Crisis 001.cbz') },
            { id: 'it2', order: 1, title: '', cvIssueId: null, metadataSource: 'COMICVINE', issueId: 'i2', issue: issue('i2', '2', null) },
            { id: 'it3', order: 2, title: 'Crisis #3', cvIssueId: 532209, metadataSource: 'COMICVINE', issueId: null, issue: null },
        ]));
        mocks.progressFindMany.mockResolvedValue([{ issueId: 'i1', currentPage: 10, totalPages: 20, isCompleted: false }]);
        mocks.issueFindMany.mockResolvedValue([]);
    });

    it("answers 404 for a list the caller can't see, without reading its items", async () => {
        mocks.listFindFirst.mockResolvedValueOnce(null);

        const res = await get('?id=private');

        expect(res.status).toBe(404);
        expect(mocks.listFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'private', ...VISIBLE } }));
        expect(mocks.itemFindMany).not.toHaveBeenCalled();
    });

    it("returns the list's items in order with the caller's progress on each", async () => {
        const res = await get('?id=l1');
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual(expect.objectContaining({ id: 'l1', name: 'Crisis' }));
        expect(body.items.map((i: { id: string }) => i.id)).toEqual(['it1', 'it2', 'it3']);
        // The series page's shape: isRead from isCompleted, readProgress as a percentage.
        expect(body.items[0].progress).toEqual({ isRead: false, readProgress: 50 });
        expect(body.items[1].progress).toBeNull();
        expect(body.items[2].progress).toBeNull();
        expect(mocks.progressFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId: 'u1', issueId: { in: ['i1', 'i2'] } },
        }));

        const itemArgs = mocks.itemFindMany.mock.calls.map(([a]) => a).find(a => a.where.issueId !== null)!;
        expect(itemArgs.where).toEqual({ listId: 'l1' });
        expect(itemArgs.orderBy).toEqual({ order: 'asc' });
        // Only the fields the page uses - not whole Series rows.
        expect(JSON.stringify(itemArgs)).not.toContain('"series":true');
        expect(itemArgs.select.issue.select.series.select).toEqual(
            { id: true, name: true, folderPath: true, metadataId: true, metadataSource: true });
    });

    it('hides items from libraries the caller has no access to', async () => {
        mocks.accessibleLibs.mockResolvedValue(['lib1']);

        await get('?id=l1');

        const itemArgs = mocks.itemFindMany.mock.calls.map(([a]) => a).find(a => a.where.issueId !== null)!;
        expect(itemArgs.where).toEqual({ listId: 'l1', OR: [{ issueId: null }, { issue: { series: { libraryId: { in: ['lib1'] } } } }] });
    });

    it("relinks only this list's unlinked items, by their provider issue id", async () => {
        mocks.itemFindMany.mockImplementationOnce(async () => [
            { id: 'it3', cvIssueId: 532209, metadataSource: 'COMICVINE' },
            { id: 'it4', cvIssueId: 77, metadataSource: 'METRON' },
        ]);
        mocks.issueFindMany.mockResolvedValueOnce([{ id: 'i9', metadataId: '532209', metadataSource: 'COMICVINE' }]);

        await get('?id=l1');

        expect(mocks.itemFindMany.mock.calls[0][0]).toEqual(expect.objectContaining({
            where: { listId: 'l1', issueId: null, cvIssueId: { not: null } },
        }));
        expect(mocks.issueFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { OR: [
                { metadataSource: 'COMICVINE', metadataId: { in: ['532209'] } },
                { metadataSource: 'METRON', metadataId: { in: ['77'] } },
            ] },
        }));
        expect(mocks.itemUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.itemUpdate).toHaveBeenCalledWith({ where: { id: 'it3' }, data: { issueId: 'i9' } });
    });
});
