// @vitest-environment jsdom
// #252 / #253 (conduit4731): the Reading Lists page loads the overview (names + counts) and then only
// the open list's items, shows where you are in a list (read / in progress / unread, "N / M read",
// Continue at the first owned unfinished entry), can hide read entries in the grouped view, and
// filters the sidebar by name.
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stubFetchRouter, ok } from '../helpers/fetch';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1', role: 'USER' } } }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import ReadingListsPage from '@/app/reading-lists/page';

const OVERVIEW = [
    { id: 'l1', name: 'Crisis', description: null, coverUrl: null, isGlobal: false, userId: 'u1', counts: { total: 4, owned: 2, read: 1 } },
    { id: 'l2', name: 'Blackest Night', description: null, coverUrl: null, isGlobal: false, userId: 'u1', counts: { total: 120, owned: 98, read: 42 } },
];
const SERIES = { id: 's1', name: 'Crisis', folderPath: '/comics/Crisis', metadataId: '42', metadataSource: 'COMICVINE' };
const linked = (id: string, number: string, filePath: string | null, progress: { isRead: boolean; readProgress: number } | null) => ({
    id: `it${id}`, order: Number(number) - 1, title: '', cvIssueId: null, metadataSource: 'COMICVINE', issueId: `i${id}`,
    issue: { id: `i${id}`, number, name: `Part ${number}`, filePath, coverUrl: null, metadataSource: 'COMICVINE', series: SERIES },
    progress,
});
const DETAIL = {
    ...OVERVIEW[0],
    items: [
        linked('1', '1', '/comics/Crisis/Crisis 001.cbz', { isRead: true, readProgress: 100 }),
        linked('2', '2', '/comics/Crisis/Crisis 002.cbz', { isRead: false, readProgress: 50 }),
        linked('3', '3', null, null),
        { id: 'it4', order: 3, title: 'Crisis #4', cvIssueId: 4004, metadataSource: 'COMICVINE', issueId: null, issue: null, progress: null },
    ],
};

let fetchMock: ReturnType<typeof stubFetchRouter>;

describe('Reading Lists page (#252, #253)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        fetchMock = stubFetchRouter([
            [/\/api\/reading-lists\?id=l1/, () => ok(DETAIL)],
            [/\/api\/reading-lists\?id=l2/, () => ok({ ...OVERVIEW[1], items: [] })],
            ['/api/reading-lists', () => ok(OVERVIEW)],
        ]);
    });
    afterEach(() => vi.unstubAllGlobals());

    const sidebar = async () => (await screen.findByPlaceholderText('Filter lists')).closest('[data-testid="reading-list-sidebar"]') as HTMLElement;
    const expandCrisis = async () => fireEvent.click(await screen.findByRole('button', { name: /Crisis.*3 Issues/ }));

    it("shows each list's counts in the sidebar and loads only the open list's items", async () => {
        render(<ReadingListsPage />);

        expect(await within(await sidebar()).findByText(/120 Issues · 42 Read/)).toBeInTheDocument();
        await screen.findByText(/1 \/ 4 read/);
        const urls = fetchMock.mock.calls.map(([u]) => String(u));
        expect(urls.filter(u => u.includes('?id=l1'))).toHaveLength(1);
        expect(urls.some(u => u.includes('?id=l2'))).toBe(false);
    });

    it('opens Continue on the first entry you own and have not finished', async () => {
        render(<ReadingListsPage />);

        const cont = await screen.findByRole('link', { name: /Continue/ });
        expect(cont).toHaveAttribute('href', expect.stringContaining(encodeURIComponent('/comics/Crisis/Crisis 002.cbz')));
        expect(screen.getByText(/2 in your library/)).toBeInTheDocument();
    });

    it("shows each entry's state, and an issue without a file gets no Read button", async () => {
        render(<ReadingListsPage />);
        await expandCrisis();

        const row = (name: string) => screen.getByText(new RegExp(`Issue #\\d • ${name}`)).closest('[data-testid="reading-list-row"]') as HTMLElement;
        expect(within(row('Part 1')).getByTestId('reading-state')).toHaveTextContent('Read');
        expect(within(row('Part 2')).getByTestId('reading-state')).toHaveTextContent('50%');
        expect(within(row('Part 3')).queryByTestId('reading-state')).not.toBeInTheDocument();
        expect(within(row('Part 1')).getByRole('link', { name: /Read/ })).toBeInTheDocument();
        expect(within(row('Part 3')).queryByRole('link', { name: /Read/ })).not.toBeInTheDocument();
        expect(within(row('Part 3')).getByText(/Not in your library/)).toBeInTheDocument();
    });

    it('hides read entries in the grouped view and remembers the choice', async () => {
        render(<ReadingListsPage />);
        await expandCrisis();
        expect(screen.getByText(/Part 1/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('switch', { name: /Hide read/ }));

        await waitFor(() => expect(screen.queryByText(/Part 1/)).not.toBeInTheDocument());
        expect(screen.getByText(/Part 2/)).toBeInTheDocument();
        expect(window.localStorage.getItem('omnibus-reading-lists-hide-read')).toBe('true');
    });

    it('filters the sidebar by name', async () => {
        render(<ReadingListsPage />);
        const list = await sidebar();
        await within(list).findByText('Blackest Night');

        fireEvent.change(screen.getByPlaceholderText('Filter lists'), { target: { value: 'black' } });

        expect(within(list).getByText('Blackest Night')).toBeInTheDocument();
        expect(within(list).queryByText('Crisis')).not.toBeInTheDocument();
    });
});
