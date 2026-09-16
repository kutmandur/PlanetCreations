import {encodeIndexInput} from './homeIndexTransfer';
let worker;
let sequence = 0;
const pending = new Map();
function getWorker() {
    if (!worker) {
        worker = new Worker(new URL('./homeIndexWorker.js', import.meta.url), {type: 'module'});
        worker.onmessage = ({data}) => {
            const task = pending.get(data.id); if (!task) return;
            pending.delete(data.id);
            if (data.error) task.reject(new Error(data.error)); else task.resolve(data.rows);
        };
        worker.onerror = error => {
            worker.terminate(); worker = null;
            for (const task of pending.values()) task.reject(error);
            pending.clear();
        };
    }
    return worker;
}
export async function runHomeIndexSearch(input) {
    try {
        const id = ++sequence;
        const target = getWorker();
        const encoded = encodeIndexInput(input);
        const rows = await new Promise((resolve, reject) => {
            pending.set(id, {resolve, reject});
            try { target.postMessage({id, input: encoded}); }
            catch (error) { pending.delete(id); reject(error); }
        });
        const originals = new Map(input.indexCreations.map(row => [row.id, row]));
        return rows.map(row => row.debug ? {...originals.get(row.id), __feedDebug: row.debug} : originals.get(row.id));
    } catch {
        // Older file:// clients or blocked workers retain the same complete search and ranking.
        return (await import('./homeIndexSearch')).searchHomeIndex(input);
    }
}
