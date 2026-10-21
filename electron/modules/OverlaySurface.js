// Keep the capture window fixed; only the content rectangle moves inside it.
class OverlaySurface {
    constructor(window, screen) {
        this.window = window;
        this.screen = screen;
        this.bounds = window.getBounds();
        this.displayId = screen.getDisplayMatching(this.bounds).id;
        this.update = () => this.sync();
        for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, this.update);
        window.on('show', this.update);
        window.once('closed', () => {
            for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(event, this.update);
        });
        window.setResizable(false);
        window.setHasShadow(false);
    }

    getBounds() { return { ...this.bounds }; }

    setBounds(bounds) {
        this.bounds = { ...bounds };
        this.sync();
    }

    sync() {
        if (this.window.isDestroyed()) return;
        const display = this.screen.getAllDisplays().find(item => item.id === this.displayId) || this.screen.getPrimaryDisplay();
        this.displayId = display.id;
        const area = display.bounds;
        const width = Math.min(this.bounds.width, area.width);
        const height = Math.min(this.bounds.height, area.height);
        this.bounds = {
            x: Math.max(area.x, Math.min(this.bounds.x, area.x + area.width - width)),
            y: Math.max(area.y, Math.min(this.bounds.y, area.y + area.height - height)),
            width, height,
        };
        const current = this.window.getBounds();
        if (['x', 'y', 'width', 'height'].some(key => current[key] !== area[key])) this.window.setBounds(area, false);
        // Native regions pass clicks through without cursor polling or relying on
        // mousemove forwarding (which Electron does not support on Linux).
        this.window.setShape([this.layout()]);
        this.window.webContents.send('overlay-surface-changed', this.layout());
    }

    layout() {
        const area = this.window.getBounds();
        return { ...this.bounds, x: this.bounds.x - area.x, y: this.bounds.y - area.y };
    }
}

module.exports = { OverlaySurface };
