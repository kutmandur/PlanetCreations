export const usesHashRouting = (location = window.location) =>
  location?.protocol === 'file:';

export const migrateLegacyHashRoute = (
  location = window.location,
  history = window.history
) => {
  if (!location || location.protocol === 'file:' ||
      !String(location.hash || '').startsWith('#/')) {
    return false;
  }

  const legacyTarget = new URL(location.hash.slice(1), location.origin);
  const outerParameters = new URLSearchParams(location.search || '');
  outerParameters.forEach((value, key) => {
    if (!legacyTarget.searchParams.has(key)) {
      legacyTarget.searchParams.append(key, value);
    }
  });

  history.replaceState(
    history.state,
    document.title,
    `${legacyTarget.pathname}${legacyTarget.search}`
  );
  return true;
};

export const installLegacyHashRouteBridge = (targetWindow = window) => {
  if (!targetWindow || usesHashRouting(targetWindow.location)) return () => {};
  const handleHashChange = () => {
    if (!migrateLegacyHashRoute(targetWindow.location, targetWindow.history)) {
      return;
    }
    targetWindow.dispatchEvent(new targetWindow.PopStateEvent('popstate'));
  };
  targetWindow.addEventListener('hashchange', handleHashChange);
  return () => targetWindow.removeEventListener('hashchange', handleHashChange);
};
