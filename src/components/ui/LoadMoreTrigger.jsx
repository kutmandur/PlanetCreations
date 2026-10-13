import React, { useCallback, useEffect, useRef } from 'react';

// Observe the real app scroll container, including short lists that do not yet scroll.
export default function LoadMoreTrigger({ hasMore, busy, progress, onLoadMore, label = 'Load more creations' }) {
    const sentinel = useRef(null);
    const requested = useRef(false);
    useEffect(() => { requested.current = false; }, [progress, busy, hasMore]);
    const requestMore = useCallback(() => {
        if (busy || !hasMore || requested.current) return;
        requested.current = true;
        onLoadMore();
    }, [busy, hasMore, onLoadMore]);
    useEffect(() => {
        if (!hasMore || busy || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
        let active = true;
        const observer = new IntersectionObserver(entries => {
            if (active && entries.some(entry => entry.isIntersecting)) {
                observer.disconnect();
                requestMore();
            }
        }, { root: sentinel.current.closest('main'), rootMargin: '0px 0px 800px 0px' });
        observer.observe(sentinel.current);
        return () => { active = false; observer.disconnect(); };
    }, [hasMore, busy, progress, requestMore]);
    if (!hasMore) return null;
    return <div ref={sentinel} className="flex justify-center py-6">
        <button type="button" disabled={busy} onClick={requestMore}
            className="rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
            {busy ? 'Loading…' : label}
        </button>
    </div>;
}
