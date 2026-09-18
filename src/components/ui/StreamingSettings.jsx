import React, { useEffect, useState } from 'react';

const YOUTUBE_BOT_CHANNEL_URL = 'https://www.youtube.com/channel/UCmDRfBoKKcQkPgbxNeGiYug';

const PROVIDERS = {
    obs: {
        label: 'OBS Studio',
        defaultPort: 4455,
        secretLabel: 'Password',
        secretHint: 'Optional',
        instructions: 'In OBS (version 28 or newer), enable the server under Tools > WebSocket Server Settings.',
    },
    streamlabs: {
        label: 'Streamlabs Desktop',
        defaultPort: 59650,
        secretLabel: 'API Token',
        secretHint: 'Required',
        instructions: 'In Streamlabs Desktop, open Settings > Remote Control, show the QR code, then copy the IP address and API token from "Show details".',
    },
};

// Streaming-Sektion der Settings (nur Desktop-Client ab 1.0.23 — rendert
// ausschließlich, wenn die Streaming-Bridge im preload vorhanden ist).
// Verbindet den Client wahlweise mit OBS (obs-websocket) oder Streamlabs
// Desktop (eigene Remote-Control-API), damit Go Live beim Stream-Start
// angeboten und beim Stream-Ende automatisch beendet wird.
const StreamingSettings = ({ setModalMessage }) => {
    const [status, setStatus] = useState(null);
    const [provider, setProvider] = useState('obs');
    const [enabled, setEnabled] = useState(false);
    const [host, setHost] = useState('127.0.0.1');
    const [port, setPort] = useState(PROVIDERS.obs.defaultPort);
    const [portDirty, setPortDirty] = useState(false);
    const [secret, setSecret] = useState('');
    const [secretDirty, setSecretDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [copyMessage, setCopyMessage] = useState('');
    const supported = Boolean(window.electronAPI?.getObsStatus);

    useEffect(() => {
        if (!supported) return undefined;
        let cancelled = false;
        window.electronAPI.getObsStatus()
            .then((result) => {
                if (cancelled || !result?.supported) return;
                setStatus(result);
                const loadedProvider = result.provider === 'streamlabs' ? 'streamlabs' : 'obs';
                setProvider(loadedProvider);
                setEnabled(Boolean(result.enabled));
                setHost(result.slHost || '127.0.0.1');
                setPort(loadedProvider === 'streamlabs'
                    ? (result.slPort || PROVIDERS.streamlabs.defaultPort)
                    : (result.obsPort || PROVIDERS.obs.defaultPort));
            })
            .catch(() => {});
        const unsubStatus = window.electronAPI.onObsStatusChanged?.((next) =>
            setStatus((current) => ({ ...current, ...next })));
        return () => {
            cancelled = true;
            if (typeof unsubStatus === 'function') unsubStatus();
        };
    }, [supported]);

    if (!supported) return null;

    const providerInfo = PROVIDERS[provider];
    const hasStoredSecret = provider === 'streamlabs' ? Boolean(status?.hasToken) : Boolean(status?.hasPassword);

    const handleProviderChange = (nextProvider) => {
        setProvider(nextProvider);
        setSecret('');
        setSecretDirty(false);
        if (nextProvider === 'streamlabs') setHost(status?.slHost || '127.0.0.1');
        if (!portDirty) {
            const saved = nextProvider === 'streamlabs' ? status?.slPort : status?.obsPort;
            setPort(saved || PROVIDERS[nextProvider].defaultPort);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const result = await window.electronAPI.setObsConfig({
                provider,
                enabled,
                host: provider === 'streamlabs' ? host : undefined,
                port: Number(port) || providerInfo.defaultPort,
                // Nicht angefasstes Feld = gespeicherten Wert behalten.
                password: provider === 'obs' && secretDirty ? secret : undefined,
                token: provider === 'streamlabs' && secretDirty ? secret : undefined,
            });
            if (result?.supported) {
                setStatus(result);
                setSecret('');
                setSecretDirty(false);
                setPortDirty(false);
            }
            setModalMessage(enabled
                ? (result?.connected
                    ? `Connected to ${providerInfo.label}!`
                    : `Integration enabled — connecting as soon as ${providerInfo.label} is running with its API active.`)
                : 'Streaming integration disabled.');
        } catch (error) {
            setModalMessage(`Could not update the streaming settings: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopyBotChannel = async () => {
        try {
            await navigator.clipboard.writeText(YOUTUBE_BOT_CHANNEL_URL);
            setCopyMessage('Channel URL copied. Paste it into Standard moderators in YouTube Studio.');
        } catch {
            setCopyMessage('Could not copy automatically. Select the channel URL above and copy it manually.');
        }
    };

    const statusText = !status?.enabled ? 'Disabled'
        : !status?.connected ? (status?.error || `Waiting for ${PROVIDERS[status?.provider === 'streamlabs' ? 'streamlabs' : 'obs'].label}...`)
            : status?.streaming ? `Connected — streaming${status?.service ? ` on ${status.service}` : ''}`
                : 'Connected';
    const statusColor = !status?.enabled ? 'text-gray-500'
        : !status?.connected ? 'text-orange-500'
            : 'text-green-600';

    return (
        <div className="pc-theme-card bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-2">Streaming</h2>
            <p className="text-gray-600 mb-4">
                Connect your streaming software so PlanetCreations can offer to link a creation when your stream starts
                and automatically end the LIVE badge when it stops.
            </p>

            <div className="flex items-center justify-between mb-4">
                <span className="text-lg font-semibold text-gray-800">Integration</span>
                <span className={`text-sm font-semibold ${statusColor}`}>{statusText}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
                {Object.entries(PROVIDERS).map(([key, info]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => handleProviderChange(key)}
                        className={`p-3 rounded-lg border-2 font-semibold transition-colors ${provider === key
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                        {info.label}
                    </button>
                ))}
            </div>

            <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 sm:p-5 dark:border-blue-800 dark:bg-blue-950/40">
                <h3 className="text-lg font-bold text-gray-800 text-center mb-4 dark:text-blue-100">
                    How to connect {providerInfo.label}
                </h3>
                {provider === 'obs' ? (
                    <ol className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white font-bold flex items-center justify-center">1</span>
                            <span>Open <strong>OBS Studio</strong>, then select <strong>Tools → WebSocket Server Settings</strong> from the top menu.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white font-bold flex items-center justify-center">2</span>
                            <span>Enable <strong>Enable WebSocket server</strong>. OBS 28 or newer already includes this feature.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white font-bold flex items-center justify-center">3</span>
                            <span>Copy the displayed <strong>Server Port</strong> below. The default is <strong>4455</strong>.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white font-bold flex items-center justify-center">4</span>
                            <span>If authentication is enabled, copy the WebSocket password as well. Leave the password empty only when OBS authentication is disabled.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white font-bold flex items-center justify-center">5</span>
                            <span>Click <strong>Apply</strong> in OBS, keep OBS running, then choose <strong>Save & Connect</strong> here.</span>
                        </li>
                    </ol>
                ) : (
                    <ol className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500 text-white font-bold flex items-center justify-center">1</span>
                            <span>Open <strong>Streamlabs Desktop</strong> and click the <strong>Settings</strong> cog in the lower-left corner.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500 text-white font-bold flex items-center justify-center">2</span>
                            <span>Open <strong>Remote Control</strong> and click the QR code or its <strong>Show</strong> button.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500 text-white font-bold flex items-center justify-center">3</span>
                            <span>Below the QR code, select <strong>Show details</strong>. Streamlabs now displays the IP address, port and API token required below.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500 text-white font-bold flex items-center justify-center">4</span>
                            <span>Copy only the numeric <strong>IP address</strong>, without <code>http://</code>, <code>ws://</code> or the port. Then copy the <strong>Port</strong> and complete <strong>API Token</strong> into their own fields.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500 text-white font-bold flex items-center justify-center">5</span>
                            <span>Keep Remote Control enabled and Streamlabs running. Close the Streamlabs settings window, then choose <strong>Save & Connect</strong> here.</span>
                        </li>
                    </ol>
                )}
                <p className="mt-4 text-xs text-gray-500 text-center dark:text-blue-200/80">
                    {provider === 'streamlabs'
                        ? 'The API token grants local control of Streamlabs. Keep it private and never share it publicly.'
                        : 'PlanetCreations connects only to OBS on this computer; your streaming account password is never requested.'}
                </p>
                <div className="mt-4 rounded-lg border border-blue-200 bg-white/70 p-3 text-sm text-gray-700 dark:border-blue-700 dark:bg-gray-900/40 dark:text-gray-200">
                    <p className="font-bold text-center text-gray-800 dark:text-blue-100">Live preview on PlanetCreations</p>
                    <p className="mt-2">
                        <strong>YouTube:</strong> Embedding must be enabled for the live video. In <strong>YouTube Studio</strong>, open
                        <strong> Content → Live</strong>, select the stream, expand <strong>Show more</strong> in its details and enable
                        <strong> Allow embedding</strong>.
                    </p>
                    <p className="mt-2">
                        <strong>Twitch:</strong> No separate embedding switch is required. The Twitch channel player can be embedded automatically;
                        viewers may still need to confirm age or content notices before playback.
                    </p>
                    <p className="mt-2 text-xs text-center text-gray-500 dark:text-blue-200/80">
                        If embedding is disabled or restricted, the LIVE badge and external stream link still work, but the gallery preview cannot play the stream.
                    </p>
                </div>
            </div>

            <div className={`grid grid-cols-1 ${provider === 'streamlabs' ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4 items-end`}>
                <label className="flex items-center gap-3 cursor-pointer sm:col-span-1">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                        className="h-5 w-5 accent-blue-600"
                    />
                    <span className="font-semibold text-gray-700">Enable</span>
                </label>
                {provider === 'obs' ? <>
                    <div>
                        <label className="block text-sm font-bold text-gray-600 mb-1" htmlFor="streaming-port">Port</label>
                        <input
                            id="streaming-port"
                            type="number"
                            min="1"
                            max="65535"
                            value={port}
                            onChange={(e) => { setPort(e.target.value); setPortDirty(true); }}
                            className="w-full p-2 border rounded-lg"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-600 mb-1" htmlFor="streaming-secret">{providerInfo.secretLabel}</label>
                        <input
                            id="streaming-secret"
                            type="password"
                            value={secret}
                            onChange={(e) => { setSecret(e.target.value); setSecretDirty(true); }}
                            placeholder={hasStoredSecret ? '(unchanged)' : providerInfo.secretHint}
                            className="w-full p-2 border rounded-lg"
                        />
                    </div>
                </> : <>
                    <div>
                        <label className="block text-sm font-bold text-gray-600 mb-1" htmlFor="streamlabs-host">IP address</label>
                        <input
                            id="streamlabs-host"
                            type="text"
                            value={host}
                            onChange={(e) => setHost(e.target.value)}
                            placeholder="192.168.1.100"
                            className="w-full p-2 border rounded-lg text-center"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-600 mb-1" htmlFor="streaming-port">Port</label>
                        <input
                            id="streaming-port"
                            type="number"
                            min="1"
                            max="65535"
                            value={port}
                            onChange={(e) => { setPort(e.target.value); setPortDirty(true); }}
                            className="w-full p-2 border rounded-lg text-center"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-600 mb-1" htmlFor="streaming-secret">API Token</label>
                        <input
                            id="streaming-secret"
                            type="password"
                            value={secret}
                            onChange={(e) => { setSecret(e.target.value); setSecretDirty(true); }}
                            placeholder={hasStoredSecret ? '(unchanged)' : 'Required'}
                            className="w-full p-2 border rounded-lg"
                        />
                    </div>
                </>}
            </div>
            <button
                onClick={handleSave}
                disabled={isSaving}
                className="mt-4 w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 transition-colors"
            >
                {isSaving ? 'Saving...' : 'Save & Connect'}
            </button>

            <section aria-labelledby="youtube-bot-setup-heading" className="mt-6 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h3 id="youtube-bot-setup-heading" className="text-lg font-bold text-gray-800 dark:text-gray-100">
                    Set up the YouTube chat bot
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    Bot replies include links, which YouTube may filter. Add <strong>PlanetCreationsBot</strong> as
                    a <strong>Standard moderator</strong> once for your channel. You can add it by channel URL even
                    when it does not appear in the chat or viewer list.
                </p>
                <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-gray-700 dark:text-gray-200">
                    <li>
                        Open <a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer"
                            className="text-blue-600 underline dark:text-blue-300">YouTube Studio</a> and select the channel you stream on.
                    </li>
                    <li>
                        Go to <strong>Settings → Community moderation → User management</strong> and paste the bot channel URL
                        below into <strong>Standard moderators</strong>.
                    </li>
                    <li>Select <strong>PlanetCreationsBot</strong> from the result and click <strong>Save</strong>.</li>
                </ol>
                <label htmlFor="youtube-bot-channel-url" className="mt-4 block text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Bot channel URL
                </label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                    <input
                        id="youtube-bot-channel-url"
                        type="text"
                        readOnly
                        value={YOUTUBE_BOT_CHANNEL_URL}
                        onFocus={(event) => event.target.select()}
                        className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    />
                    <button type="button" onClick={handleCopyBotChannel}
                        className="shrink-0 rounded-lg bg-blue-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-600">
                        Copy channel URL
                    </button>
                </div>
                <p role="status" className="mt-2 text-sm text-gray-600 dark:text-gray-300">{copyMessage}</p>
                <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                    To test, keep your stream running with LIVE active in PlanetCreations, switch YouTube&apos;s chat view
                    to <strong>Live chat</strong> and send <code>!builder</code>. Repeating the same command has a 60-second cooldown.
                </p>
                <a href="https://support.google.com/youtube/answer/9826490" target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm text-blue-600 underline dark:text-blue-300">
                    YouTube&apos;s moderator setup guide
                </a>
            </section>

            <section aria-labelledby="twitch-bot-setup-heading" className="mt-6 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h3 id="twitch-bot-setup-heading" className="text-lg font-bold text-gray-800 dark:text-gray-100">
                    Set up the Twitch chat bot
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    If you use moderation bots or link filters, add <strong>planetcreationsbot</strong> as a moderator
                    so its replies and creation links can appear in chat.
                </p>
                <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-gray-700 dark:text-gray-200">
                    <li>Open your Twitch channel&apos;s chat while signed in as the channel owner.</li>
                    <li>
                        Send <code className="select-all rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">/mod planetcreationsbot</code>.
                        You can use <code>/mods</code> to check that the bot is listed.
                    </li>
                    <li>
                        If another moderation bot still blocks the replies, add <strong>planetcreationsbot</strong> to
                        that bot&apos;s allowlist for chat messages and links.
                    </li>
                </ol>
                <a href="https://help.twitch.tv/s/article/Managing-Roles-for-your-Channel" target="_blank" rel="noopener noreferrer"
                    className="mt-3 inline-block text-sm text-blue-600 underline dark:text-blue-300">
                    Twitch&apos;s moderator setup guide
                </a>
            </section>

        </div>
    );
};

export default StreamingSettings;
