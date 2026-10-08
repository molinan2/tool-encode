# About

Encodes multiple audio files to Mp3 VBR at maximum quality (q=0 and maximum quality). Sends each file to a different thread, so all cores will be used if you encode enough files at the same time. This is a very simple implementation that does the trick to speed up the process.

# Requirements

Use Node 24 or higher.

Install `ffmpeg` as binary, for instance using `brew` (macOS):

```shell
brew install ffmpeg
```

# Usage

Pass the file or folder to encode as an argument. To encode the current folder, run:

```shell
tool-encode .
```

All subfolders will be traversed recursively. Newly created Mp3 files will be stored next to their source files, within the same folder. Source files/folders will remain untouched.

If a source file has a sibling JSON sidecar with the same basename, `tool-encode`
reads its version 1 or 2 normalized `metadata` and embeds available text tags and
cover art in the MP3. For example, `song.wav` uses `song.json`. The sidecar's
`audio` must name the source file, and a cover path is relative to the sidecar.
It also embeds the complete JSON sidecar and available TXT files from
`assets.notes` as ID3 `GEOB` attachments. TXT attachments are UTF-8 text;
BOM-marked UTF-16 and older Windows-1252 notes are converted to UTF-8. The
normalized `comment` is written
to the MP3's `COMM` frame, so it is visible without opening the TXT attachment.
Version 2 uses `metadata.artists`; existing version 1 sidecars use
`metadata.authors`. Both are written to the MP3's Artist tag.
Missing sidecars do not change the normal encode. Invalid metadata produces a
warning after the batch; the MP3 is still encoded, with any usable metadata.
The final warning gives the number of affected tracks. No report file is created.

Running `tool-encode` without an input path shows the command's basic usage help:

```shell
tool-encode
```

### Quality

Specify the quality of the encoding with the option `--quality` (or `-q`) as a number ranging from `0` (highest) to `9` (lowest). Default quality is `0` (maximum):

```shell
tool-encode -q 2 .
tool-encode --quality 2 "./my-folder"
```

### Inputs

Specify one or more input paths as positional arguments. Each path can be either a file or a folder. Folders are traversed recursively:

```shell
tool-encode "./my-folder"
tool-encode "./my-song.flac"
tool-encode "./album" "./single.wav" "./another-folder"
```

# Notes

Command line for maximum VBR quality using `ffmpeg`:

```sh
ffmpeg -y -v error -i INPUT.wav -c:v copy -c:a libmp3lame -q:a 0 compression_level 0 OUTPUT.mp3
```

Note that `ffmpeg` maps LAME's `-V0` option (quality) to `-q:a 0` and LAME's `-q 0` option (noise shaping & psycho acoustic algorithms) to `-compression_level 0`, as documented [here](https://ffmpeg.org/ffmpeg-codecs.html#libmp3lame-1).
