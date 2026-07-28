import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    base: './',
    plugins: [
        react(),
        tailwindcss(),
    ],
    server: {
        host: '127.0.0.1',
        port: 3000,
        strictPort: true,
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
});
