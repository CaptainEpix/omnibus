// src/lib/utils/synced-release-date.ts
// Review of #232 (#251 beta): which release date survives a provider sync. Both provider branches
// of metadata-fetcher.ts call this, so the "has a file" half can't be dropped at one site alone.
//
// EXACT twin: omnibus-engine/src/metadata.rs synced_release_date. Change one side only with a
// mirrored change + test on the other.

/** What a LIST sync should write into Issue.releaseDate.
 *  - a locked (hasCustomMetadata) row keeps its date;
 *  - with file_metadata_priority on, a row that HAS a file keeps its non-empty date (the cover
 *    date read from its ComicInfo.xml), and the provider only fills a blank;
 *  - a row with no file - a WANTED placeholder - takes the provider's date, so a delayed issue
 *    keeps moving on the release calendar;
 *  - otherwise the provider's date wins. */
export function syncedReleaseDate(
    existing: string | null | undefined,
    provider: string | null | undefined,
    locked: boolean,
    fillOnly: boolean,
    hasFile: boolean,
): string | null {
    const ex = existing ?? null;
    if (locked) return ex;
    if (fillOnly && hasFile && ex && ex.trim()) return ex;
    return provider ?? null;
}
