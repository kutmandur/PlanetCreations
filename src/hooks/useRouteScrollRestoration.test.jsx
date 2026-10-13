import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useRouteScrollRestoration from './useRouteScrollRestoration';

const route = vi.hoisted(() => ({ key: 'list', type: 'POP' }));
vi.mock('react-router-dom', () => ({
    useLocation: () => ({ key: route.key }),
    useNavigationType: () => route.type,
}));
let notify;
function Page() {
    const ref = useRouteScrollRestoration();
    return <main ref={ref}><div>Content</div></main>;
}
beforeEach(() => {
    route.key = 'list'; route.type = 'POP';
    vi.useFakeTimers();
    vi.stubGlobal('MutationObserver', class {
        constructor(callback) { notify = callback; }
        observe() {}
        disconnect() {}
    });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function navigate(view, key, type) {
    route.key = key; route.type = type;
    view.rerender(<Page />);
}
function scroll(main, top) {
    main.scrollTop = top;
    fireEvent.scroll(main);
}
it('returns to the saved inner-container position and starts new entries at the top', () => {
    const view = render(<Page />);
    const main = view.container.querySelector('main');
    scroll(main, 2400);
    navigate(view, 'creation', 'PUSH');
    expect(main.scrollTop).toBe(0);
    scroll(main, 350);
    navigate(view, 'list', 'POP');
    expect(main.scrollTop).toBe(2400);
    navigate(view, 'creation', 'POP');
    expect(main.scrollTop).toBe(350);
    navigate(view, 'new-list-entry', 'PUSH');
    expect(main.scrollTop).toBe(0);
});
it('retries after async content grows and yields to user scrolling', () => {
    const view = render(<Page />);
    const main = view.container.querySelector('main');
    let top = 0;
    let maximum = 3000;
    Object.defineProperty(main, 'scrollTop', { configurable: true, get: () => top, set: value => { top = Math.min(value, maximum); } });
    scroll(main, 2400);
    navigate(view, 'creation', 'PUSH');
    maximum = 400;
    navigate(view, 'list', 'POP');
    expect(top).toBe(400);
    maximum = 3000;
    act(() => { notify(); vi.advanceTimersByTime(20); });
    expect(top).toBe(2400);
    fireEvent.wheel(main);
    scroll(main, 1000);
    act(() => { notify(); vi.advanceTimersByTime(20); });
    expect(top).toBe(1000);
});
it('cancels delayed restoration on navigation', () => {
    const view = render(<Page />);
    const main = view.container.querySelector('main');
    scroll(main, 2400);
    navigate(view, 'creation', 'PUSH');
    navigate(view, 'list', 'POP');
    act(() => notify());
    navigate(view, 'another-creation', 'PUSH');
    act(() => vi.advanceTimersByTime(16000));
    expect(main.scrollTop).toBe(0);
});
