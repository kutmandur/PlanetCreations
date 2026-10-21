const fs = require('node:fs/promises');
const path = require('node:path');

const GAME_PROCESSES = [
    { gameId: 'planet-coaster-2', processName: 'PlanetCoaster2.exe' },
    { gameId: 'planet-zoo', processName: 'PlanetZoo.exe' },
    { gameId: 'planet-zoo-2', processName: 'PlanetZoo2.exe' },
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

function executableName(value) {
    // Wine can expose either a Unix path or a Windows path. Never split on
    // spaces: Steam libraries and game directories routinely contain them.
    return String(value || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
}

function detectActiveGameFromLinuxProcesses(processes) {
    const names = new Set();
    for (const { cmdline, comm = '' } of processes) {
        if (!cmdline) continue; // Kernel threads and zombies have empty cmdline.
        const args = String(cmdline).split('\0');
        const executable = executableName(args[0]);
        names.add(executable);
        names.add(String(comm).trim().toLowerCase());
        if (/^wine(?:64)?(?:-preloader)?$/.test(executable)) {
            names.add(executableName(args[1]));
        }
        // Do not search arbitrary arguments: launchers, scripts, editors and
        // Proton supervisors may mention a game after its process has exited.
    }
    return GAME_PROCESSES.find(({ processName }) => names.has(processName.toLowerCase()))?.gameId || null;
}

async function detectActiveGameFromProc({ procRoot = '/proc', readFile = fs.readFile, readdir = fs.readdir } = {}) {
    const pids = (await readdir(procRoot)).filter(name => /^\d+$/.test(name));
    const processes = [];
    // Bound simultaneous reads even on hosts with thousands of processes.
    for (let offset = 0; offset < pids.length; offset += 32) {
        const batch = await Promise.all(pids.slice(offset, offset + 32).map(async pid => {
            try {
                const cmdline = await readFile(path.join(procRoot, pid, 'cmdline'), 'utf8');
                if (!cmdline) return null;
                const comm = await readFile(path.join(procRoot, pid, 'comm'), 'utf8');
                return { cmdline, comm };
            } catch (error) {
                // Processes may exit during the scan; other users' processes
                // may be hidden by procfs permissions. Neither requires root.
                if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return null;
                throw error;
            }
        }));
        processes.push(...batch.filter(Boolean));
    }
    return detectActiveGameFromLinuxProcesses(processes);
}

module.exports = {
    GAME_PROCESSES,
    detectActiveGameFromTasklist,
    detectActiveGameFromLinuxProcesses,
    detectActiveGameFromProc,
};
