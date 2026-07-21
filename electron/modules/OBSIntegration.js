// OBS-WebSocket-Integration (obs-websocket v5, in OBS 28+ eingebaut).
// Läuft komplett lokal (ws://127.0.0.1:<port>) und plattformneutral — die
// Verbindung lebt im Main-Process, damit sie unabhängig von offenen Fenstern
// besteht und Reconnects überlebt. Konfiguration kommt vom Manager in main.js
// (streaming-settings.json); das Event-Interface ist identisch zum
// Streamlabs-Adapter, damit beide austauschbar sind:
//   'stream-started' {service}   → Go-Live-Popup in der hosted UI
//   'stream-stopped' {}          → Live-Session serverseitig beenden
//   'status-changed' {connected, streaming, service}
const { OBSWebSocket } = require('obs-websocket-js');

const RECONNECT_DELAY_MS = 15 * 1000;

class OBSIntegration {
    constructor({ getConfig, log, onEvent }) {
        this.getConfig = getConfig;
        this.log = log;
        this.onEvent = onEvent;
        this.obs = new OBSWebSocket();
        this.connected = false;
        this.streaming = false;
        this.service = null;
        this.reconnectTimer = null;
        this.stopped = false;

        this.obs.on('ConnectionClosed', () => {
            const wasConnected = this.connected;
            this.connected = false;
            this.streaming = false;
            if (wasConnected) this.emitStatus();
            this.scheduleReconnect();
        });
        this.obs.on('StreamStateChanged', (event) => this.handleStreamState(event));
    }

    getRuntimeStatus() {
        return { connected: this.connected, streaming: this.streaming, service: this.service };
    }

    emitStatus() {
        this.onEvent('status-changed', this.getRuntimeStatus());
    }

    async handleStreamState(event) {
        if (event.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
            this.streaming = true;
            await this.refreshService();
            this.emitStatus();
            this.onEvent('stream-started', { service: this.service });
        } else if (event.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
            this.streaming = false;
            this.emitStatus();
            this.onEvent('stream-stopped', {});
        }
    }

    async refreshService() {
        try {
            const response = await this.obs.call('GetStreamServiceSettings');
            this.service = response?.streamServiceSettings?.service || response?.streamServiceType || null;
        } catch (error) {
            this.service = null;
        }
    }

    async connect() {
        const config = this.getConfig();
        if (!config.enabled || this.stopped || this.connected) return;
        try {
            await this.obs.connect(`ws://127.0.0.1:${config.port}`, config.password || undefined);
            this.connected = true;
            await this.refreshService();
            try {
                const status = await this.obs.call('GetStreamStatus');
                this.streaming = status?.outputActive === true;
            } catch (error) {
                this.streaming = false;
            }
            this.log.info('Connected to OBS WebSocket.');
            this.emitStatus();
        } catch (error) {
            // OBS läuft (noch) nicht oder Passwort falsch — leise weiter versuchen.
            this.scheduleReconnect();
        }
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
        if (this.connected) {
            try { await this.obs.disconnect(); } catch (error) { /* noop */ }
            this.connected = false;
        }
    }
}

module.exports = { OBSIntegration };
