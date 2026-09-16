'use strict';
const fs = require('node:fs');

function readFileBoundedSync(filePath, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid file size limit.');
    const fd = fs.openSync(filePath, 'r');
    try {
        const before = fs.fstatSync(fd);
        if (!before.isFile() || before.size < 1 || before.size > maxBytes) throw new Error('File exceeds its size limit or is not a regular file.');
        const bytes = Buffer.allocUnsafe(before.size);
        let offset = 0;
        while (offset < bytes.length) {
            const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
            if (!count) throw new Error('File changed while reading.');
            offset += count;
        }
        const after = fs.fstatSync(fd);
        if (fs.readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('File changed while reading.');
        return bytes;
    } finally { fs.closeSync(fd); }
}
module.exports = {readFileBoundedSync};
