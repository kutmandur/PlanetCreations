async function responseToBuffer(response) {
    if (!response || typeof response.arrayBuffer !== 'function') {
        throw new TypeError('The download response does not provide arrayBuffer().');
    }
    return Buffer.from(await response.arrayBuffer());
}

module.exports = { responseToBuffer };
