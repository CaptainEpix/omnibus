import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/admin/config/route';
import { loggerLog, auditLog } from '../helpers/setup-global';
import { pinPlatform } from '../helpers/platform';

// Settings-save response contract (2026-07-28 field repro on the dev box): once the settings
// transaction commits, NOTHING after it may stall or fail the response. With Redis down, the old
// `await syncSchedules()` ground through BullMQ command retries for minutes while the Save button
// sat disabled and the client silently skipped its saved-state bookkeeping — the save looked lost
// even though it had landed.

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    settingFindUnique: vi.fn(),
    settingUpsert: vi.fn(),
    transaction: vi.fn(),
    auditLog: vi.fn(),
    syncSchedules: vi.fn(),
    log: vi.fn(),
}));

vi.mock('next-auth/next', () => ({ getServerSession: mocks.getServerSession }));

vi.mock('@/lib/db', () => ({
    prisma: {
        systemSetting: { findUnique: mocks.settingFindUnique },
        $transaction: mocks.transaction,
    }
}));

// The real queue module dials Redis at import time — never load it in a unit test.
vi.mock('@/lib/queue', () => ({ syncSchedules: mocks.syncSchedules }));
vi.mock('@/lib/encryption', () => ({
    encryptSecret: vi.fn(async (v: string) => v),
    decryptSecret: vi.fn(async (v: string) => v),
}));
vi.mock('@/lib/annas-test', () => ({ testAnnasArchiveKey: vi.fn() }));

const mockReq = (body: any) => ({
    json: async () => body,
    url: 'http://localhost/api/admin/config',
    headers: new Headers({ 'content-type': 'application/json' }),
}) as unknown as Request;

describe('Settings save: the response never waits on (or fails from) post-commit work', () => {
    beforeEach(() => {
        mocks.getServerSession.mockResolvedValue({ user: { id: 'admin_1', role: 'ADMIN' } });
        mocks.settingFindUnique.mockResolvedValue({ key: 'setup_complete', value: 'true' });
        mocks.transaction.mockImplementation(async (fn: any) =>
            fn({ systemSetting: { upsert: mocks.settingUpsert } }));
        auditLog.mockResolvedValue(undefined);
        mocks.syncSchedules.mockResolvedValue(undefined);
    });

    it('answers 200 immediately even when the schedule sync never settles (dead Redis)', async () => {
        // The exact field condition: BullMQ retrying against a dead Redis = a promise that never
        // resolves. If anyone re-awaits syncSchedules in the route, this test hangs and fails.
        mocks.syncSchedules.mockReturnValue(new Promise(() => {}));

        const res = await POST(mockReq({ settings: { usenet_delete_after_import: 'true' } }));

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ success: true });
        // The save itself committed…
        expect(mocks.settingUpsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: 'usenet_delete_after_import' }
        }));
        // …and the sync was still kicked off (fire-and-forget, not dropped).
        expect(mocks.syncSchedules).toHaveBeenCalledTimes(1);
    });

    it('answers 200 when the schedule sync rejects, logging instead of throwing', async () => {
        mocks.syncSchedules.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));

        const res = await POST(mockReq({ settings: { test_key: 'v' } }));

        expect(res.status).toBe(200);
        // Give the detached rejection a microtask to reach its .catch logger.
        await new Promise(r => setTimeout(r, 0));
        expect(loggerLog).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'), 'error');
    });

    it('a failed audit write cannot turn a committed save into a 500', async () => {
        auditLog.mockRejectedValue(new Error('audit table locked'));

        const res = await POST(mockReq({ settings: { test_key: 'v' } }));

        expect(res.status).toBe(200);
        expect(mocks.settingUpsert).toHaveBeenCalled();
        expect(loggerLog).toHaveBeenCalledWith(expect.stringContaining('audit table locked'), 'error');
    });
});

// Discord field report (2026-10-13, Docker Desktop on Windows): a library saved as `C:\…` made every
// Smart Match fail with "EACCES: permission denied, mkdir 'C:'". The Settings page and the Setup
// Wizard both save here, so this is where a path the server can't use gets turned away - before
// anything is written.
describe('Settings save: folders must be paths the server itself can use', () => {
    let restorePlatform: (() => void) | null = null;
    const tx = {
        systemSetting: { upsert: mocks.settingUpsert },
        library: { findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
        downloadClient: { findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    };
    const lib = (path: string, name = 'Standard Comics') =>
        ({ id: 'tmp_1', name, path, isManga: false, isDefault: true });

    beforeEach(() => {
        restorePlatform = pinPlatform('linux'); // the Docker image
        mocks.getServerSession.mockResolvedValue({ user: { id: 'admin_1', role: 'ADMIN' } });
        mocks.settingFindUnique.mockResolvedValue({ key: 'setup_complete', value: 'true' });
        mocks.transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx));
        tx.library.findMany.mockResolvedValue([]);
        tx.downloadClient.findMany.mockResolvedValue([]);
        auditLog.mockResolvedValue(undefined);
        mocks.syncSchedules.mockResolvedValue(undefined);
    });
    afterEach(() => { restorePlatform?.(); restorePlatform = null; });

    it('turns away a Windows library path with the fix, and writes nothing', async () => {
        const res = await POST(mockReq({ libraries: [lib('C:\\Comics')], settings: { download_path: '/data/downloads' } }));

        expect(res.status).toBe(400);
        const { error } = await res.json();
        expect(error).toContain('Root Path of library "Standard Comics": "C:\\Comics" is a Windows path');
        expect(error).toContain('C:/Comics:/data/comics');
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it.each([
        { path: 'comics', expected: '"comics" isn\'t a full path' },
        { path: '', expected: 'No folder is set.' },
    ])('turns away a library path of "$path"', async ({ path, expected }) => {
        const res = await POST(mockReq({ libraries: [lib(path, 'Manga')] }));

        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain(`Root Path of library "Manga": ${expected}`);
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it('checks the Download Scan Root too, when one is set', async () => {
        const res = await POST(mockReq({ settings: { download_path: 'C:\\Downloads\\Comics' } }));

        expect(res.status).toBe(400);
        const { error } = await res.json();
        expect(error).toContain('Download Scan Root: "C:\\Downloads\\Comics" is a Windows path');
        expect(error).toContain('C:/Downloads/Comics:/data/downloads');
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it('checks a download client\'s Omnibus-side path, never its client-side one', async () => {
        const client = { id: 'tmp_c', name: 'qBittorrent', type: 'qbit', url: 'http://qbit:8080', remotePath: 'D:\\Torrents', localPath: 'downloads' };
        const res = await POST(mockReq({ downloadClients: [client] }));

        expect(res.status).toBe(400);
        const { error } = await res.json();
        expect(error).toContain('Local Path of download client "qBittorrent": "downloads" isn\'t a full path');
        expect(error).not.toContain('D:\\Torrents');
    });

    it('lists every problem in one answer', async () => {
        const res = await POST(mockReq({
            libraries: [lib('C:\\Comics'), { ...lib('/data/manga', 'Manga'), id: 'tmp_2', isManga: true }, { ...lib('', 'Spare'), id: 'tmp_3' }],
            settings: { download_path: 'downloads' },
        }));

        const { error } = await res.json();
        expect(error).toContain('library "Standard Comics"');
        expect(error).toContain('library "Spare"');
        expect(error).toContain('Download Scan Root');
        expect(error).not.toContain('"Manga"');
    });

    it('saves container paths, an empty Download Scan Root and unmapped clients', async () => {
        const client = { id: 'tmp_c', name: 'SABnzbd', type: 'sab', url: 'http://sab:8080', remotePath: '/downloads', localPath: '/data/downloads' };
        const res = await POST(mockReq({
            libraries: [lib('/data/comics')],
            downloadClients: [client, { ...client, id: 'tmp_d', name: 'qBittorrent', localPath: null, remotePath: null }],
            settings: { download_path: '' },
        }));

        expect(res.status).toBe(200);
        expect(tx.library.create).toHaveBeenCalledWith({ data: expect.objectContaining({ path: '/data/comics' }) });
    });

    it('keeps drive-letter paths working on a native Windows install', async () => {
        restorePlatform?.();
        restorePlatform = pinPlatform('win32');
        const res = await POST(mockReq({
            libraries: [lib('C:\\Users\\adam\\LIBRARIES\\comics')],
            settings: { download_path: 'C:\\Users\\adam\\Downloads' },
        }));

        expect(res.status).toBe(200);
    });
});
