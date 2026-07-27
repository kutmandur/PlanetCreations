const assert = require('node:assert/strict');
const path = require('node:path');
const WebSocket = require('ws');

const fixtureRoot = path.resolve(process.argv[2] || '');
const ports = (process.argv[3] || '9223,9224,9225')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter(Number.isInteger);

if (!process.argv[2] || ports.length < 2) {
    throw new Error('Pass the native Frontier fixture root and at least two debug ports.');
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getRendererTarget(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) throw new Error(`Could not inspect Electron instance on port ${port}.`);
    const targets = await response.json();
    const rendererTarget = targets.find((target) =>
        target.type === 'page' && !String(target.url).startsWith('devtools://'));
    if (!rendererTarget?.webSocketDebuggerUrl) {
        throw new Error(`Electron instance on port ${port} has no renderer target.`);
    }
    return rendererTarget;
}

function connectCdp(webSocketDebuggerUrl) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(webSocketDebuggerUrl);
        let nextId = 1;
        const pending = new Map();

        socket.on('open', () => {
            resolve({
                async call(method, params = {}) {
                    const id = nextId++;
                    const response = new Promise((resolveCall, rejectCall) => {
                        pending.set(id, { resolve: resolveCall, reject: rejectCall });
                    });
                    socket.send(JSON.stringify({ id, method, params }));
                    return response;
                },
                close() {
                    socket.close();
                },
            });
        });
        socket.on('message', (data) => {
            const message = JSON.parse(String(data));
            if (!message.id || !pending.has(message.id)) return;
            const request = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) request.reject(new Error(message.error.message));
            else request.resolve(message.result);
        });
        socket.on('error', reject);
        socket.on('close', () => {
            for (const request of pending.values()) {
                request.reject(new Error('Electron renderer connection closed.'));
            }
            pending.clear();
        });
    });
}

async function evaluate(client, expression) {
    const response = await client.call('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || 'Renderer evaluation failed.');
    }
    return response.result?.value;
}

async function waitForClientBridge(client, port) {
    const deadline = Date.now() + 20_000;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const state = await evaluate(client, `({
                href: window.location.href,
                isElectron: window.electronAPI?.isElectron === true,
                canScan: typeof window.electronAPI?.scanGames === 'function'
            })`);
            if (state?.href?.startsWith('http://127.0.0.1:3100') && state.isElectron && state.canScan) {
                return state;
            }
        } catch (error) {
            lastError = error;
        }
        await delay(250);
    }
    throw new Error(`Electron instance on port ${port} did not load the isolated client bridge: ${lastError?.message || 'timeout'}`);
}

async function inspectInstance(port) {
    const target = await getRendererTarget(port);
    const client = await connectCdp(target.webSocketDebuggerUrl);
    try {
        await client.call('Runtime.enable');
        const initialLocation = await evaluate(client, 'window.location.href');
        if (initialLocation.startsWith('file:')) {
            await evaluate(client, `window.electronAPI.selectMode('online')`);
        }
        const bridgeState = await waitForClientBridge(client, port);
        const result = await evaluate(client, `(async () => {
            const identity = await window.electronAPI.getClientIdentity();
            const scan = await window.electronAPI.scanGames(${JSON.stringify(fixtureRoot)});
            const game = scan['Planet Coaster 2'] || {};
            const files = [
                ...(game.parks || []),
                ...(game.blueprints || []),
                ...(game.autosaves || []),
            ];
            return {
                identity,
                files: files.map((file) => ({
                    name: file.name,
                    path: file.path,
                    size: file.size,
                })),
            };
        })()`);

        assert.equal(result.files.length, 3);
        assert.ok(result.identity?.clientId);
        for (const file of result.files) {
            assert.equal(path.resolve(file.path).startsWith(`${fixtureRoot}${path.sep}`), true);
            assert.equal(file.size > 0, true);
        }

        return {
            port,
            href: bridgeState.href,
            clientId: result.identity.clientId,
            displayName: result.identity.displayName,
            files: result.files,
        };
    } finally {
        client.close();
    }
}

async function run() {
    const instances = [];
    for (const port of ports) instances.push(await inspectInstance(port));
    assert.equal(new Set(instances.map((instance) => instance.clientId)).size, instances.length);
    process.stdout.write(`${JSON.stringify({
        success: true,
        instanceCount: instances.length,
        isolatedClientIds: true,
        fixtureRoot,
        instances,
    }, null, 2)}\n`);
}

run().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
