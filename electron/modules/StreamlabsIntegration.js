// Streamlabs-Desktop-Integration über dessen SockJS-Remote-Control-API.
// IP, Port und Token werden in Streamlabs unter Settings > Remote Control >
// Show details angezeigt. SockJS kapselt JSON-RPC-Nachrichten in Array-Frames.
//
// Gleiches Event-Interface wie OBSIntegration, damit main.js beide Adapter
// austauschbar betreiben kann:
//   'stream-started' {service} / 'stream-stopped' {} / 'status-changed' {...}
const WebSocket = require('ws');
const net = require('net');

const RECONNECT_DELAY_MS = 15 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

// Streamlabs historically emitted a single string ("live"/"offline"). Newer
// versions can return a model for Dual Output with independent horizontal and
// vertical states. Keep both contracts working because released Streamlabs
// versions in the wild use either shape.
function collectStreamingStates(value, states = []) {
    if (typeof value === 'string') {
        states.push(value.toLowerCase());
        return states;
    }
    if (!value || typeof value !== 'object') return states;

    for (const key of ['streamingStatus', 'streaming']) {
        if (typeof value[key] === 'string') states.push(value[key].toLowerCase());
    }
    for (const key of ['horizontal', 'vertical']) {
        if (value[key] !== undefined) collectStreamingStates(value[key], states);
    }
    if (value.status && typeof value.status === 'object') {
        collectStreamingStates(value.status, states);
    }
    return states;
}

function normalizeStreamingStatus(value) {
    const states = collectStreamingStates(value);
    if (states.includes('live')) return 'live';
    if (states.length > 0 && states.every((state) => state === 'offline')) return 'offline';
    return null;
}

class StreamlabsIntegration {
    constructor({ getConfig, log, onEvent }) {
        this.getConfig = getConfig;
        this.log = log;
        this.onEvent = onEvent;
        this.socket = null;
        this.connected = false;
        this.streaming = false;
        this.service = null;
        this.reconnectTimer = null;
        this.stopped = false;
        this.requestId = 0;
        this.pending = new Map();
        this.transport = null;
        this.receiveBuffer = '';
        this.lastError = null;
    }

    getRuntimeStatus() {
        return { connected: this.connected, streaming: this.streaming, service: this.service, error: this.lastError };
    }

    emitStatus() {
        this.onEvent('status-changed', this.getRuntimeStatus());
    }

    request(resource, method, args = []) {
        return new Promise((resolve, reject) => {
            const isOpen = this.transport === 'tcp'
                ? this.socket && !this.socket.destroyed
                : this.socket?.readyState === WebSocket.OPEN;
            if (!isOpen) {
                reject(new Error('Streamlabs socket is not open.'));
                return;
            }
            const id = ++this.requestId;
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Streamlabs request ${method} timed out.`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timeout });
            const request = JSON.stringify({ jsonrpc: '2.0', id, method, params: { resource, args } });
            if (this.transport === 'tcp') this.socket.write(`${request}\n`);
            else this.socket.send(JSON.stringify([request]));
        });
    }

    handleMessage(raw) {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch (error) {
            return;
        }
        // Antwort auf einen eigenen Request
        if (message.id && this.pending.has(message.id)) {
            const { resolve, reject, timeout } = this.pending.get(message.id);
            this.pending.delete(message.id);
            clearTimeout(timeout);
            if (message.error) reject(new Error(message.error.message || 'Streamlabs API error'));
            else resolve(message.result);
            return;
        }
        // Push-Event einer Subscription
        const event = message.result;
        if (event?._type === 'EVENT' && event.resourceId === 'StreamingService.streamingStatusChange') {
            this.handleStreamingStatus(event.data);
        }
    }

    handleSockJsFrame(raw) {
        const frame = raw.toString();
        if (frame === 'o' || frame === 'h') return;
        if (!frame.startsWith('a')) return;
        try {
            const messages = JSON.parse(frame.slice(1));
            if (Array.isArray(messages)) messages.forEach((message) => this.handleMessage(message));
        } catch (error) {
            this.log.warn('Could not decode Streamlabs SockJS frame:', error.message);
        }
    }

    handleTcpData(chunk) {
        this.receiveBuffer += chunk.toString('utf8');
        const messages = this.receiveBuffer.split('\n');
        this.receiveBuffer = messages.pop() || '';
        messages.filter(Boolean).forEach((message) => this.handleMessage(message));
    }

    clearPending(message = 'Streamlabs connection closed.') {
        for (const { reject, timeout } of this.pending.values()) {
            clearTimeout(timeout);
            reject(new Error(message));
        }
        this.pending.clear();
    }

    async initializeConnection({ authenticate = false, token = '' } = {}) {
        try {
            if (authenticate) {
                const authenticated = await this.request('TcpServerService', 'auth', [token]);
                if (!authenticated) throw new Error('Streamlabs rejected the API token.');
            }
            this.connected = true;
            this.lastError = null;
            const model = await this.request('StreamingService', 'getModel').catch(() => null);
            this.streaming = normalizeStreamingStatus(model) === 'live';
            await this.request('StreamingService', 'streamingStatusChange').catch(() => null);
            await this.refreshService();
            this.log.info(`Connected to Streamlabs Desktop via ${this.transport}.`);
            this.emitStatus();
        } catch (error) {
            this.lastError = error.message;
            this.log.warn('Streamlabs connection failed:', error.message);
            this.emitStatus();
            if (this.transport === 'tcp') this.socket?.destroy();
            else this.socket?.close();
        }
    }

    async handleStreamingStatus(status) {
        const normalizedStatus = normalizeStreamingStatus(status);
        if (normalizedStatus === 'live' && !this.streaming) {
            this.streaming = true;
            await this.refreshService();
            this.emitStatus();
            this.onEvent('stream-started', { service: this.service });
        } else if (normalizedStatus === 'offline' && this.streaming) {
            this.streaming = false;
            this.emitStatus();
            this.onEvent('stream-stopped', {});
        }
        // 'starting'/'ending'/'reconnecting' bewusst ignoriert: erst der finale
        // Zustand zählt (goLive verifiziert ohnehin gegen die Plattform-API).
    }

    // Best-effort-Erkennung der Streaming-Plattform des eingeloggten
    // Streamlabs-Accounts — Ausgabeformat wie der OBS-Adapter ('Twitch'/...).
    async refreshService() {
        try {
            const user = await this.request('UserService', 'getModel');
            const type = user?.platform?.type || null;
            this.service = type === 'twitch' ? 'Twitch' :
                type === 'youtube' ? 'YouTube' :
                    (type ? String(type) : null);
        } catch (error) {
            this.service = null;
        }
    }

    connect() {
        const config = this.getConfig();
        if (!config.enabled || this.stopped || this.socket) return;
        const socket = net.createConnection({ host: '127.0.0.1', port: 28194 });
        this.socket = socket;
        this.transport = 'tcp';

        socket.on('data', (raw) => this.handleTcpData(raw));
        socket.on('error', (error) => { this.lastError = error.message; });
        socket.on('close', () => {
            const wasConnected = this.connected;
            this.socket = null;
            this.transport = null;
            this.receiveBuffer = '';
            this.connected = false;
            this.streaming = false;
            this.clearPending();
            if (wasConnected) {
                this.emitStatus();
                this.scheduleReconnect();
            } else if (!this.stopped && this.getConfig().enabled) {
                this.connectRemote(config);
            }
        });
        socket.on('connect', () => this.initializeConnection());
    }

    connectRemote(config = this.getConfig()) {
        if (!config.enabled || this.stopped || this.socket) return;
        const host = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host;
        const socket = new WebSocket(`ws://${host}:${config.port}/api/websocket`);
        this.socket = socket;
        this.transport = 'sockjs';

        socket.on('message', (raw) => this.handleSockJsFrame(raw));
        socket.on('error', (error) => { this.lastError = error.message; });
        socket.on('close', () => {
            const wasConnected = this.connected;
            this.socket = null;
            this.transport = null;
            this.connected = false;
            this.streaming = false;
            this.clearPending();
            if (wasConnected || this.lastError) this.emitStatus();
            this.scheduleReconnect();
        });
        socket.on('open', () => this.initializeConnection({ authenticate: true, token: config.token || '' }));
    }

    scheduleReconnect() {
        if (this.stopped || this.reconnectTimer) return;
        if (!this.getConfig().enabled) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, RECONNECT_DELAY_MS);
    }

    start() {
        this.stopped = false;
        this.connect();
    }

    async stop() {
        this.stopped = true;
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.socket) {
            try {
                if (this.transport === 'tcp') this.socket.destroy();
                else this.socket.close();
            } catch (error) { /* noop */ }
            this.socket = null;
            this.transport = null;
            this.connected = false;
            this.streaming = false;
        }
    }
}

module.exports = { StreamlabsIntegration, normalizeStreamingStatus };
