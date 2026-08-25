import {
  installLegacyHashRouteBridge,
  migrateLegacyHashRoute,
  usesHashRouting,
} from './routingMode';

test('uses hash routing only for the bundled file origin', () => {
  expect(usesHashRouting({ protocol: 'file:' })).toBe(true);
  expect(usesHashRouting({ protocol: 'https:' })).toBe(false);
  expect(usesHashRouting({ protocol: 'http:' })).toBe(false);
});

test('migrates a legacy web hash route to a native path', () => {
  const replaceState = vi.fn();
  const migrated = migrateLegacyHashRoute({
    protocol: 'https:',
    origin: 'https://www.planetcreations.net',
    hash: '#/creation/example?tab=stats',
    search: '?pcAppCheck=recaptcha-test-only',
  }, {
    state: { preserved: true },
    replaceState,
  });

  expect(migrated).toBe(true);
  expect(replaceState).toHaveBeenCalledWith(
    { preserved: true },
    document.title,
    '/creation/example?tab=stats&pcAppCheck=recaptcha-test-only'
  );
});

test('keeps hash routing unchanged for the bundled app', () => {
  const replaceState = vi.fn();
  expect(migrateLegacyHashRoute({
    protocol: 'file:',
    origin: 'null',
    hash: '#/client/dashboard',
    search: '',
  }, { replaceState })).toBe(false);
  expect(replaceState).not.toHaveBeenCalled();
});

test('bridges hash links received while the native router is already open', () => {
  const listeners = {};
  const replaceState = vi.fn();
  const dispatchEvent = vi.fn();
  const targetWindow = {
    location: {
      protocol: 'https:',
      origin: 'https://www.planetcreations.net',
      hash: '#/event/example',
      search: '',
    },
    history: { state: null, replaceState },
    PopStateEvent: class PopStateEvent {
      constructor(type) { this.type = type; }
    },
    addEventListener: vi.fn((type, listener) => { listeners[type] = listener; }),
    removeEventListener: vi.fn(),
    dispatchEvent,
  };

  const remove = installLegacyHashRouteBridge(targetWindow);
  listeners.hashchange();

  expect(replaceState).toHaveBeenCalledWith(
    null,
    document.title,
    '/event/example'
  );
  expect(dispatchEvent.mock.calls[0][0].type).toBe('popstate');
  remove();
  expect(targetWindow.removeEventListener)
    .toHaveBeenCalledWith('hashchange', listeners.hashchange);
});
