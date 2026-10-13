import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LoadMoreTrigger from './LoadMoreTrigger';

let observers;
beforeEach(() => {
    observers = [];
    vi.stubGlobal('IntersectionObserver', class {
        constructor(callback, options) { this.callback = callback; this.options = options; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this); }
        intersect() { this.callback([{ isIntersecting: true }]); }
    });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('observes the inner desktop main and preloads before its bottom', () => {
    const load = vi.fn();
    render(<main><LoadMoreTrigger hasMore busy={false} progress={24} onLoadMore={load} /></main>);
    expect(observers[0].options.root).toBe(document.querySelector('main'));
    expect(observers[0].options.rootMargin).toBe('0px 0px 800px 0px');
    act(() => { observers[0].intersect(); observers[0].intersect(); });
    expect(load).toHaveBeenCalledTimes(1);
});

it('rechecks after each page even if a short list never produces a scroll event', () => {
    const load = vi.fn();
    const { rerender } = render(<LoadMoreTrigger hasMore progress={24} onLoadMore={load} />);
    expect(observers[0].options.root).toBeNull();
    act(() => observers[0].intersect());
    rerender(<LoadMoreTrigger hasMore progress={48} onLoadMore={load} />);
    act(() => { observers[0].intersect(); observers[1].intersect(); });
    expect(load).toHaveBeenCalledTimes(2);
});

it('does not fetch while busy or once exhausted', () => {
    const load = vi.fn();
    const { rerender } = render(<LoadMoreTrigger hasMore busy progress={24} onLoadMore={load} />);
    expect(observers).toHaveLength(0);
    expect(screen.getByRole('button')).toBeDisabled();
    rerender(<LoadMoreTrigger hasMore={false} progress={24} onLoadMore={load} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(load).not.toHaveBeenCalled();
});

it('offers a working manual fallback without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const load = vi.fn();
    render(<LoadMoreTrigger hasMore progress={24} onLoadMore={load} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more creations' }));
    fireEvent.click(screen.getByRole('button'));
    expect(load).toHaveBeenCalledTimes(1);
});

it('ignores stale observer callbacks after unmount', () => {
    const load = vi.fn();
    const { unmount } = render(<LoadMoreTrigger hasMore progress={24} onLoadMore={load} />);
    unmount();
    act(() => observers[0].intersect());
    expect(load).not.toHaveBeenCalled();
    expect(observers[0].disconnect).toHaveBeenCalled();
});
