const GAME_PROCESSES = [
    { gameId: 'planet-coaster-2', processName: 'PlanetCoaster2.exe' },
    { gameId: 'planet-zoo', processName: 'PlanetZoo.exe' },
];

/**
 * Resolve the supported game that appears in Windows' tasklist output.
 * The order above is also the deterministic priority if both games are open.
 */
function detectActiveGameFromTasklist(output) {
    const normalized = String(output || '').toLowerCase();
    const match = GAME_PROCESSES.find(({ processName }) => (
        normalized.includes(`"${processName.toLowerCase()}"`)
    ));
    return match ? match.gameId : null;
}

module.exports = {
    GAME_PROCESSES,
    detectActiveGameFromTasklist,
};
