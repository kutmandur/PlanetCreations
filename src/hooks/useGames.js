import { useState, useEffect } from 'react';
import { getGames, subscribeGames } from '../utils/gamesRegistry';

// Reaktive Sicht auf die Spiele-Registry: liefert die (enabled) Spiele und
// re-rendert, sobald loadGamesRegistry() bzw. der Admin-Games-Tab den
// Snapshot aktualisiert.
export default function useGames(options) {
    const [games, setGames] = useState(() => getGames(options));

    useEffect(() => {
        const update = () => setGames(getGames(options));
        update(); // Optionen können sich geändert haben
        return subscribeGames(update);
        // options ist ein Inline-Objekt-Literal an den Call-Sites — nur auf das
        // einzige Flag reagieren, nicht auf die Objekt-Identität.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options?.includeDisabled]);

    return games;
}
