import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { promisify } from 'node:util';
import NodeID3 from 'node-id3';
import pLimit from 'p-limit';
import helpers from './helpers.js';
import metadata from './metadata.js';

const execFile = promisify(childProcess.execFile);

function errorSummary(error) {
    return error.stderr?.trim().split('\n')[0] || error.message;
}

async function encodeMp3(filename, quality = 0, basePath = process.cwd()) {
    const extension = path.extname(filename);
    const destination = path.format({
        ...path.parse(filename),
        base: undefined,
        ext: '.mp3',
        name: path.basename(filename, extension)
    });

    console.log(helpers.colorizeFilename(destination, basePath));

    const sidecar = await metadata.readSidecar(filename);
    const baseArgs = [
        '-y',
        '-v',
        'error',
        '-i',
        filename
    ];
    const audioArgs = [
        '-c:v',
        'copy',
        '-c:a',
        'libmp3lame',
        '-q:a',
        String(quality),
        '-compression_level',
        '0'
    ];
    const metadataArgs = sidecar.tags.flatMap((tag) => ['-metadata', tag]);
    const coverArgs = sidecar.cover
        ? ['-i', sidecar.cover, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'mjpeg',
            '-disposition:v:0', 'attached_pic', '-metadata:s:v', 'title=Album cover',
            '-metadata:s:v', 'comment=Cover (front)']
        : [];
    const args = sidecar.cover
        ? [...baseArgs, ...coverArgs, '-c:a', 'libmp3lame', '-q:a', String(quality),
            '-compression_level', '0', ...metadataArgs, destination]
        : [...baseArgs, ...audioArgs, ...metadataArgs, destination];

    try {
        await execFile('ffmpeg', args, { encoding: 'utf-8' });
    } catch (error) {
        if (!sidecar.cover && sidecar.tags.length === 0) throw error;
        sidecar.warnings.push(`Cannot apply all sidecar metadata: ${errorSummary(error)}`);

        try {
            await execFile('ffmpeg', [...baseArgs, ...audioArgs, ...metadataArgs, destination],
                { encoding: 'utf-8' });
        } catch (retryError) {
            if (sidecar.tags.length === 0) throw retryError;
            sidecar.warnings.push(`Cannot apply text metadata: ${errorSummary(retryError)}`);
            await execFile('ffmpeg', [...baseArgs, ...audioArgs, destination], { encoding: 'utf-8' });
        }
    }

    if (sidecar.attachments.length) {
        const temporary = `${destination}.attachments-${process.pid}-${Math.random().toString(16).slice(2)}`;
        try {
            await fs.copyFile(destination, temporary);
            const id3Tags = { generalObject: sidecar.attachments };
            if (sidecar.comment) id3Tags.comment = { language: 'eng', text: sidecar.comment };
            const result = NodeID3.update(id3Tags, temporary);
            if (result !== true) throw result instanceof Error ? result : new Error('ID3 update failed');
            await fs.rename(temporary, destination);
        } catch (error) {
            sidecar.warnings.push(`Cannot embed sidecar attachments: ${error.message}`);
            await fs.rm(temporary, { force: true }).catch(() => {});
        }
    }

    return { destination, warnings: sidecar.warnings };
}

async function batchEncodeMp3(filenames, quality = 0, basePath = process.cwd()) {
    const limit = pLimit(os.availableParallelism());
    const jobs = filenames.map((filename) => limit(() => encodeMp3(filename, quality, basePath)));
    return Promise.all(jobs);
}

export default {
    encodeMp3,
    batchEncodeMp3
};
