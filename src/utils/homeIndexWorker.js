import {searchHomeIndex} from './homeIndexSearch';
import {decodeIndexInput} from './homeIndexTransfer';
self.onmessage = event => {
    try {
        const rows = searchHomeIndex(decodeIndexInput(event.data.input));
        self.postMessage({id: event.data.id, rows: rows.map(row => ({id: row.id, debug: row.__feedDebug}))});
    } catch (error) { self.postMessage({id: event.data.id, error: error.message}); }
};
