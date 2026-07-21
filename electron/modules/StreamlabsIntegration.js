// Streamlabs-Desktop-Integration über dessen SockJS-Remote-Control-API.
// IP, Port und Token werden in Streamlabs unter Settings > Remote Control >
// Show details angezeigt. SockJS kapselt JSON-RPC-Nachrichten in Array-Frames.
//
// Gleiches Event-Interface wie OBSIntegration, damit main.js beide Adapter
// austauschbar betreiben kann:
//   'stream-started' {service} / 'stream-stopped' {} / 'status-changed' {...}
const WebSocket = require('ws');

const RECONNECT_DELAY_MS = 15 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

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
    }

    getRuntimeStatus() {
        return { connected: this.connected, streaming: this.streaming, service: this.service };
    }

    emitStatus() {
        this.onEvent('status-changed', this.getRuntimeStatus());
    }

    request(resource, method, args = []) {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
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
            this.socket.send(JSON.stringify([request]));
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

    async handleStreamingStatus(status) {
        if (status === 'live' && !this.streaming) {
            this.streaming = true;
            await this.refreshService();
            this.emitStatus();
            this.onEvent('stream-started', { service: this.service });
        } else if (status === 'offline' && this.streaming) {
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

    async connect() {
        const config = this.getConfig();
        if (!config.enabled || this.stopped || this.socket) return;
        const host = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host;
        const socket = new WebSocket(`ws://${host}:${config.port}/api/websocket`);
        this.socket = socket;

        socket.on('message', (raw) => this.handleSockJsFrame(raw));
        socket.on('error', () => { /* close-Handler übernimmt das Aufräumen */ });
        socket.on('close', () => {
            const wasConnected = this.connected;
            this.socket = null;
            this.connected = false;
            this.streaming = false;
            for (const { reject, timeout } of this.pending.values()) {
                clearTimeout(timeout);
                reject(new Error('Streamlabs connection closed.'));
            }
            this.pending.clear();
            if (wasConnected) this.emitStatus();
            this.scheduleReconnect();
        });
        socket.on('open', async () => {
            try {
                const authenticated = await this.request('TcpServerService', 'auth', [config.token || '']);
                if (!authenticated) throw new Error('Streamlabs rejected the API token.');
                this.connected = true;
                const model = await this.request('StreamingService', 'getModel').catch(() => null);
                this.streaming = model?.streamingStatus === 'live';
                await this.request('StreamingService', 'streamingStatusChange').catch(() => null);
                await this.refreshService();
                this.log.info('Connected to Streamlabs Desktop.');
                this.emitStatus();
            } catch (error) {
                // Falsche IP, falscher Token oder API noch nicht bereit.
                this.log.warn('Streamlabs connection failed:', error.message);
                try { socket.close(); } catch (closeError) { /* noop */ }
            }
        });
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
            try { this.socket.close(); } catch (error) { /* noop */ }
            this.socket = null;
            this.connected = false;
            this.streaming = false;
        }
    }
}

module.exports = { StreamlabsIntegration };
