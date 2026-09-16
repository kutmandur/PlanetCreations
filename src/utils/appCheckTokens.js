// Keep Firebase's persistent cache as the source of truth. The only token kept
// here identifies an already rejected request, to coalesce its recovery.
export function createAppCheckTokenAccess(fetchToken, now = Date.now) {
    let readPending = null;
    let recovery = null;
    const read = () => {
        if (!readPending) {
            readPending = Promise.resolve().then(() => fetchToken(false))
                .finally(() => { readPending = null; });
        }
        return readPending;
    };
    const refreshRejected = async rejectedToken => {
        const current = await read();
        if (current.token && current.token !== rejectedToken) return current;
        if (recovery?.token === rejectedToken &&
            (recovery.pending || (now() >= recovery.at && now() - recovery.at < 30_000))) {
            return recovery.promise;
        }
        const attempt = {token: rejectedToken, at: now(), pending: true};
        recovery = attempt;
        attempt.promise = Promise.resolve().then(() => fetchToken(true)).then(result => {
            // On a failed forced refresh Firebase can return the still locally
            // valid cached token. Retrying that server-rejected token cannot help.
            if (!result.token || result.token === rejectedToken) {
                throw Object.assign(new Error('App Check could not renew the rejected token.'), {
                    code: 'appCheck/token-refresh-failed',
                });
            }
            return result;
        }).finally(() => { attempt.pending = false; });
        return attempt.promise;
    };
    return {read, refreshRejected};
}
