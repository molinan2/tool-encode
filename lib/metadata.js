import fs from 'node:fs/promises';
import path from 'node:path';

const TEXT_FIELDS = {
    title: 'title',
    album: 'album',
    publisher: 'publisher',
    copyright: 'copyright',
    system: 'system',
    dumper: 'dumper'
};

function decodeNote(bytes) {
    if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ||
        bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
        const encoding = bytes[0] === 0xff ? 'utf-16le' : 'utf-16be';
        const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('binary content');
        return text.replace(/^\uFEFF/, '');
    }
    if (bytes.some((byte) => byte === 0 ||
        (byte < 0x20 && byte !== 9 && byte !== 10 && byte !== 13))) {
        throw new Error('binary content');
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
        if (bytes.some((byte) => [0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(byte))) {
            throw new Error('unsupported text encoding');
        }
        return new TextDecoder('windows-1252').decode(bytes);
    }
}

async function readSidecar(filename) {
    const sidecar = path.join(path.dirname(filename), `${path.parse(filename).name}.json`);
    let contents;

    try {
        contents = await fs.readFile(sidecar, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return { tags: [], cover: null, attachments: [], comment: null, warnings: [] };
        return { tags: [], cover: null, attachments: [], comment: null, warnings: [`Cannot read ${sidecar}: ${error.message}`] };
    }

    let data;
    try {
        data = JSON.parse(contents);
    } catch (error) {
        return { tags: [], cover: null, attachments: [], comment: null, warnings: [`Invalid JSON in ${sidecar}: ${error.message}`] };
    }

    const version = data?.schema_version;
    if (!['1.0.0', '2.0.0'].includes(version) || data.audio !== path.basename(filename) ||
        !data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
        return { tags: [], cover: null, attachments: [], comment: null, warnings: [`Invalid sidecar schema or audio reference: ${sidecar}`] };
    }

    const tags = [];
    const warnings = [];
    const metadata = data.metadata;

    for (const [field, tag] of Object.entries(TEXT_FIELDS)) {
        const value = metadata[field];
        if (value == null) continue;
        if (typeof value === 'string') {
            if (value) tags.push(`${tag}=${value}`);
        } else {
            warnings.push(`Invalid ${field} in ${sidecar}`);
        }
    }
    const comment = typeof metadata.comment === 'string' && metadata.comment
        ? metadata.comment : null;
    if (metadata.comment != null && typeof metadata.comment !== 'string') {
        warnings.push(`Invalid comment in ${sidecar}`);
    }

    const artistField = version === '2.0.0' ? 'artists' : 'authors';
    const artists = metadata[artistField];
    if (artists != null) {
        if (Array.isArray(artists) && artists.every((artist) => typeof artist === 'string')) {
            if (artists.length) tags.push(`artist=${artists.join('; ')}`);
        } else {
            warnings.push(`Invalid ${artistField} in ${sidecar}`);
        }
    }

    const date = metadata.date ?? metadata.year;
    if (date != null) {
        if (typeof date === 'string') {
            if (date) tags.push(`date=${date}`);
        } else {
            warnings.push(`Invalid date/year in ${sidecar}`);
        }
    }

    let cover = null;
    if (metadata.cover != null) {
        const coverPath = metadata.cover?.path;
        if (typeof coverPath !== 'string' || !coverPath || path.isAbsolute(coverPath)) {
            warnings.push(`Invalid cover path in ${sidecar}`);
        } else {
            cover = path.resolve(path.dirname(sidecar), coverPath);
            try {
                if (!(await fs.stat(cover)).isFile()) throw new Error('not a file');
            } catch (error) {
                warnings.push(`Cannot read cover ${cover}: ${error.message}`);
                cover = null;
            }
        }
    }

    const attachments = [{
        mimeType: 'application/json',
        filename: path.basename(sidecar),
        contentDescription: 'Normalized metadata sidecar',
        encapsulatedObject: Buffer.from(contents, 'utf8')
    }];
    if (Array.isArray(data.assets?.notes)) {
        for (const notePath of data.assets.notes) {
            if (typeof notePath !== 'string' || !notePath || path.isAbsolute(notePath) ||
                path.extname(notePath).toLowerCase() !== '.txt') {
                warnings.push(`Invalid TXT asset path in ${sidecar}`);
                continue;
            }
            const absolutePath = path.resolve(path.dirname(sidecar), notePath);
            try {
                const bytes = await fs.readFile(absolutePath);
                const decoded = decodeNote(bytes);
                attachments.push({
                    mimeType: 'text/plain',
                    filename: path.basename(notePath),
                    contentDescription: 'Source album notes',
                    encapsulatedObject: Buffer.from(decoded, 'utf8')
                });
            } catch (error) {
                warnings.push(`Cannot embed TXT ${absolutePath}: ${error.message}`);
            }
        }
    }

    return { tags, cover, attachments, comment, warnings };
}

export default { readSidecar };
