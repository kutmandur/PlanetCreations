'use strict';

const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const { getNewerReleaseVersion } = require('./ReleaseVersion');

const RELEASES_URL = 'https://api.github.com/repos/kutmandur/PlanetCreations/releases/latest';

class ClientUpdater {
    constructor({ updater, version, isStore = false, enabled = true, statePath,
        notify = () => {}, legacyEvent = () => {}, fetchRelease = fetch,
        now = Date.now, logger = console }) {
        Object.assign(this, { updater, version, isStore, enabled, statePath, notify, legacyEvent, fetchRelease, now, logger });
        this.inFlight = null;
        this.state = {
            version,
            status: isStore ? 'store' : enabled ? 'idle' : 'disabled',
            lastCheckedAt: null,
            availableVersion: null,
            downloadUrl: null,
        };
        if (isStore || !enabled || !updater) return;
        try {
            const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            if (typeof saved.lastCheckedAt === 'string' && Number.isFinite(Date.parse(saved.lastCheckedAt))) {
                this.state.lastCheckedAt = saved.lastCheckedAt;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') logger.warn('Could not read the last update check:', error.message);
        }
        // All checks (startup, daily and manual) share one promise. Download
        // failures are handled through downloadPromise so an emitted error and
        // a rejected promise cannot trigger duplicate GitHub fallback requests.
        updater.on('error', error => logger.warn('Auto-update error:', error.message));
        updater.on('update-available', info => {
            this.setState({ status: 'downloading', availableVersion: info.version });
            legacyEvent('update-available');
        });
        updater.on('update-downloaded', info => {
            this.setState({ status: 'downloaded', availableVersion: info.version, downloadUrl: null });
            legacyEvent('update-downloaded');
        });
    }

    getStatus() { return { ...this.state }; }

    setState(patch) {
        Object.assign(this.state, patch);
        this.notify(this.getStatus());
    }

    recordCheck() {
        this.setState({ lastCheckedAt: new Date(this.now()).toISOString() });
        try {
            fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
            const temporaryPath = `${this.statePath}.tmp`;
            fs.writeFileSync(temporaryPath, JSON.stringify({ lastCheckedAt: this.state.lastCheckedAt }), { mode: 0o600 });
            fs.renameSync(temporaryPath, this.statePath);
        } catch (error) {
            this.logger.warn('Could not save the last update check:', error.message);
        }
    }

    check() {
        if (this.isStore || !this.enabled || !this.updater) return Promise.resolve(this.getStatus());
        if (this.inFlight) return this.inFlight;
        if (['downloading', 'downloaded'].includes(this.state.status)) return Promise.resolve(this.getStatus());
        this.inFlight = Promise.resolve().then(() => this.runCheck()).finally(() => { this.inFlight = null; });
        return this.inFlight;
    }

    async runCheck() {
        this.setState({ status: 'checking', availableVersion: null, downloadUrl: null });
        try {
            const result = await this.updater.checkForUpdates();
            if (!result) {
                this.setState({ status: 'disabled' });
                return this.getStatus();
            }
            if (result.isUpdateAvailable) {
                if (this.state.status !== 'downloaded') {
                    this.setState({
                        status: result.downloadPromise ? 'downloading' : 'available',
                        availableVersion: result.updateInfo.version,
                        downloadUrl: result.downloadPromise ? null : this.releaseUrl(result.updateInfo.version),
                    });
                }
                // Do not block the settings button on a potentially large download.
                result.downloadPromise?.catch(error => this.handleDownloadFailure(error));
            } else {
                this.setState({ status: 'current' });
            }
        } catch (error) {
            this.logger.warn('Update check failed; trying the release API:', error.message);
            await this.checkReleaseApi();
        }
        // This is the last completed search, including failed attempts. Merely
        // opening settings, downloading or restarting does not change it.
        this.recordCheck();
        return this.getStatus();
    }

    releaseUrl(version) {
        return `https://github.com/kutmandur/PlanetCreations/releases/tag/v${encodeURIComponent(version)}`;
    }

    async checkReleaseApi({ downloadFailed = false } = {}) {
        if (this.isStore || !this.enabled || !this.updater) return;
        try {
            const response = await this.fetchRelease(RELEASES_URL, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error(`Release API returned HTTP ${response.status}`);
            const release = await response.json();
            if (typeof release.tag_name !== 'string' || !semver.valid(release.tag_name)) {
                throw new Error('The release API returned an invalid version.');
            }
            const version = getNewerReleaseVersion(release.tag_name, this.version);
            if (version) {
                const url = `https://github.com/kutmandur/PlanetCreations/releases/tag/${encodeURIComponent(release.tag_name)}`;
                this.setState({ status: 'available', availableVersion: version, downloadUrl: url });
                this.legacyEvent('update-info-available', { version, url });
            } else {
                this.setState({ status: downloadFailed ? 'error' : 'current', availableVersion: null, downloadUrl: null });
            }
        } catch (error) {
            this.logger.warn('Release API update check failed:', error.message);
            this.setState({ status: 'error', downloadUrl: null });
        }
    }

    async handleDownloadFailure(error) {
        this.logger.warn('Update download failed:', error.message);
        await this.checkReleaseApi({ downloadFailed: true });
    }
}

module.exports = { ClientUpdater };
