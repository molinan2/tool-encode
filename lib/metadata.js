import fs from 'node:fs/promises';
import path from 'node:path';

const TEXT_FIELDS = {
    title: 'title',
    album: 'album',
    publisher: 'publisher',
    copyright: 'copyright',
    comment: 'comment',
    system: 'system',
    dumper: 'dumper'
};

async function readSidecar(filename) {
    const sidecar = path.join(path.dirname(filename), `${path.parse(filename).name}.json`);
    let contents;

    try {
        contents = await fs.readFile(sidecar, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return { tags: [], cover: null, warnings: [] };
        return { tags: [], cover: null, warnings: [`Cannot read ${sidecar}: ${error.message}`] };
    }

    let data;
    try {
        data = JSON.parse(contents);
    } catch (error) {
        return { tags: [], cover: null, warnings: [`Invalid JSON in ${sidecar}: ${error.message}`] };
    }

    if (data?.schema_version !== '1.0.0' || data.audio !== path.basename(filename) ||
        !data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
        return { tags: [], cover: null, warnings: [`Invalid sidecar schema or audio reference: ${sidecar}`] };
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

    if (metadata.authors != null) {
        if (Array.isArray(metadata.authors) && metadata.authors.every((author) => typeof author === 'string')) {
            if (metadata.authors.length) tags.push(`artist=${metadata.authors.join('; ')}`);
        } else {
            warnings.push(`Invalid authors in ${sidecar}`);
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

    return { tags, cover, warnings };
}

export default { readSidecar };
