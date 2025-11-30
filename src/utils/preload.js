/**
 * Preload-System für React Lazy Components
 * Ermöglicht das Vorladen von Komponenten bei Hover/Touch
 */

// Cache für bereits geladene/ladende Module
const preloadCache = new Map();

// Import-Funktionen für alle lazy-loaded Komponenten
const componentImports = {
    // Hauptseiten
    HomePage: () => import('../components/pages/HomePage'),
    ProfilePage: () => import('../components/pages/ProfilePage'),
    CreationDetail: () => import('../components/pages/CreationDetail'),
    CreationForm: () => import('../components/pages/CreationForm'),

    // Auth & Settings
    AuthPage: () => import('../components/pages/AuthPage'),
    SettingsPage: () => import('../components/pages/SettingsPage'),
    EditProfilePage: () => import('../components/pages/EditProfilePage'),

    // Communities
    CommunitysPage: () => import('../components/pages/CommunitysPage'),
    CommunityDetailPage: () => import('../components/pages/CommunityDetailPage'),
    CreateCommunityForm: () => import('../components/pages/CreateCommunityForm'),
    CommunityManagerPage: () => import('../components/pages/CommunityManagerPage'),

    // Events
    EventDetailPage: () => import('../components/pages/EventDetailPage'),
    EventForm: () => import('../components/pages/EventForm'),
    EventManager: () => import('../components/management/EventManager'),

    // Admin & Moderation
    AdminPage: () => import('../components/pages/AdminPage'),
    ModerationPage: () => import('../components/pages/ModerationPage'),

    // Sonstige
    LegalPage: () => import('../components/pages/LegalPage'),
    ClientInfoPage: () => import('../components/pages/ClientInfoPage'),
};

/**
 * Lädt eine Komponente vor
 * @param {string} componentName - Name der Komponente
 * @returns {Promise} - Promise das resolved wenn geladen
 */
export function preloadComponent(componentName) {
    // Bereits geladen/ladend?
    if (preloadCache.has(componentName)) {
        return preloadCache.get(componentName);
    }

    const importFn = componentImports[componentName];
    if (!importFn) {
        console.warn(`[Preload] Unknown component: ${componentName}`);
        return Promise.resolve();
    }

    // Import starten und cachen
    const promise = importFn()
        .then(module => {
            // console.log(`[Preload] Loaded: ${componentName}`);
            return module;
        })
        .catch(err => {
            console.error(`[Preload] Failed to load ${componentName}:`, err);
            preloadCache.delete(componentName); // Bei Fehler aus Cache entfernen
        });

    preloadCache.set(componentName, promise);
    return promise;
}

/**
 * Lädt mehrere Komponenten vor
 * @param {string[]} componentNames - Array von Komponentennamen
 */
export function preloadComponents(componentNames) {
    componentNames.forEach(name => preloadComponent(name));
}

/**
 * Mapping von Routes zu Komponenten für automatisches Preloading
 */
const routeComponentMap = {
    '/': ['HomePage'],
    '/login': ['AuthPage'],
    '/create': ['CreationForm'],
    '/settings': ['SettingsPage'],
    '/profile/edit': ['EditProfilePage'],
    '/communitys': ['CommunitysPage'],
    '/admin': ['AdminPage'],
    '/moderation': ['ModerationPage'],
    '/create-community': ['CreateCommunityForm'],
    '/client-info': ['ClientInfoPage'],
    '/terms-of-service': ['LegalPage'],
    '/impressum': ['LegalPage'],
};

/**
 * Preload-Handler für Route-basiertes Preloading
 * @param {string} path - Die Route die preloaded werden soll
 */
export function preloadRoute(path) {
    // Statische Routes
    const components = routeComponentMap[path];
    if (components) {
        preloadComponents(components);
        return;
    }

    // Dynamische Routes
    if (path.startsWith('/creation/') && path.endsWith('/edit')) {
        preloadComponent('CreationForm');
    } else if (path.startsWith('/creation/')) {
        preloadComponent('CreationDetail');
    } else if (path.startsWith('/profile/')) {
        preloadComponent('ProfilePage');
    } else if (path.startsWith('/community/') && path.includes('/create-event')) {
        preloadComponent('EventForm');
    } else if (path.startsWith('/community/')) {
        preloadComponent('CommunityDetailPage');
    } else if (path.startsWith('/event/') && path.endsWith('/edit')) {
        preloadComponent('EventForm');
    } else if (path.startsWith('/event/') && path.endsWith('/manage')) {
        preloadComponent('EventManager');
    } else if (path.startsWith('/event/')) {
        preloadComponent('EventDetailPage');
    } else if (path.startsWith('/manager/')) {
        preloadComponent('CommunityManagerPage');
    }
}

/**
 * Erstellt Event-Handler für Hover/Touch Preloading
 * @param {string} path - Die Route die preloaded werden soll
 * @returns {Object} - Event-Handler Objekte
 */
export function createPreloadHandlers(path) {
    let preloaded = false;

    const triggerPreload = () => {
        if (!preloaded) {
            preloaded = true;
            preloadRoute(path);
        }
    };

    return {
        onMouseEnter: triggerPreload,
        onTouchStart: triggerPreload,
        onFocus: triggerPreload,
    };
}

/**
 * Preloaded häufig genutzte Komponenten beim App-Start
 * Wird nach dem initialen Render aufgerufen
 */
export function preloadCriticalComponents() {
    // Nach kurzem Delay die wichtigsten Komponenten laden
    setTimeout(() => {
        preloadComponents(['ProfilePage', 'CreationDetail', 'CommunitysPage']);
    }, 2000);
}

export default {
    preloadComponent,
    preloadComponents,
    preloadRoute,
    createPreloadHandlers,
    preloadCriticalComponents,
};
