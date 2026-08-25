import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({mode}) => ({
    // Native web routes need root-relative assets on deep-link reloads. The
    // packaged Electron fallback is loaded through file:// and therefore keeps
    // a separate relative-asset build.
    base: mode === 'electron' ? './' : '/',
    plugins: [
        react(),
        tailwindcss(),
    ],
    server: {
        host: '127.0.0.1',
        port: 3000,
        strictPort: true,
        proxy: {
            '/api': {
                target: 'https://us-central1-planetcreationsdotnet.cloudfunctions.net',
                changeOrigin: true,
                configure(proxy) {
                    // Browser-Requests von localhost bleiben same-origin. Der
                    // Dev-Proxy ruft die Function serverseitig ohne Browser-Origin
                    // auf, sodass die produktive CORS-Allowlist strikt bleiben kann.
                    proxy.on('proxyReq', proxyRequest => {
                        proxyRequest.removeHeader('origin');
                    });
                },
            },
        },
    },
    build: {
        emptyOutDir: true,
        outDir: 'build',
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: [
            'src/**/*.test.{js,jsx}',
        ],
        setupFiles: [
            './src/setupTests.js',
        ],
    },
}));
