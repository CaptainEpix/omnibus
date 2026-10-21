// src/lib/comicinfo-writes.ts
//
// #251: one rule for when Omnibus writes ComicInfo.xml into a comic. "Write metadata to
// ComicInfo.xml" (metadata_write_comicinfo, default on) covers every automatic write - a metadata
// sync, following a series, an attach, the scheduled embed - and an edit's own "write to file"
// toggle is the only override. It used to hold back only the Edit Metadata dialog, so with it off
// every sync still rewrote the archives. Engine twin: metadata_writer.rs writes_comicinfo, which
// the engine's own sync reads. series.json is a separate setting (export_series_json).
import { prisma } from '@/lib/db';

/** True unless the admin turned "Write metadata to ComicInfo.xml" off (an absent row is on). */
export async function comicInfoWritesEnabled(): Promise<boolean> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'metadata_write_comicinfo' } });
    return setting?.value !== 'false';
}

/** Whether an edit writes its changes into the files: its own toggle wins; without one, the setting decides. */
export async function resolveWriteToFile(writeToFile: boolean | undefined): Promise<boolean> {
    return writeToFile === undefined ? comicInfoWritesEnabled() : !!writeToFile;
}
