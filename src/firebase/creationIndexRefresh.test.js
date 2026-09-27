import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { fetchSearchIndex } from './searchIndexService';
import { refreshCreatedCreationIndex } from './creationIndexRefresh';

vi.mock('./searchIndexService', () => ({ fetchSearchIndex: vi.fn() }));

const game = 'planet-coaster-2';
const queryKey = ['searchIndex', game];
const oldCreations = [{ id: 'older-park' }];
const newCreations = [...oldCreations, { id: 'new-park' }];
let queryClient;

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15 * 60 * 1000 } } });
    queryClient.setQueryData(queryKey, oldCreations);
});

afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
});

test('updates an already-open homepage when indexing finishes after the first refresh', async () => {
    fetchSearchIndex.mockResolvedValueOnce(oldCreations).mockResolvedValueOnce(newCreations);
    const observer = new QueryObserver(queryClient, { queryKey, queryFn: () => fetchSearchIndex(game) });
    const observed = [];
    const unsubscribe = observer.subscribe(result => observed.push(result.data));
    const pending = refreshCreatedCreationIndex(queryClient, { game, creationId: 'new-park' });

    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchSearchIndex).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(queryKey)).toEqual(oldCreations);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toBe(true);
    expect(fetchSearchIndex).toHaveBeenCalledTimes(2);
    expect(observed.at(-1)).toEqual(newCreations);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchSearchIndex).toHaveBeenCalledTimes(2);
    unsubscribe();
});

test('stops after one read if the creation is already indexed', async () => {
    fetchSearchIndex.mockResolvedValue(newCreations);
    const pending = refreshCreatedCreationIndex(queryClient, { game, creationId: 'new-park' });
    await vi.advanceTimersByTimeAsync(70000);
    expect(await pending).toBe(true);
    expect(fetchSearchIndex).toHaveBeenCalledTimes(1);
});

test('recovers from a temporary index read failure', async () => {
    fetchSearchIndex.mockRejectedValueOnce(new Error('Temporary network failure')).mockResolvedValueOnce(newCreations);
    const pending = refreshCreatedCreationIndex(queryClient, { game, creationId: 'new-park' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(true);
    expect(queryClient.getQueryData(queryKey)).toEqual(newCreations);
});

test('bounds retries for unpublished creations and leaves the cache stale for the next visit', async () => {
    fetchSearchIndex.mockResolvedValue(oldCreations);
    const pending = refreshCreatedCreationIndex(queryClient, { game, creationId: 'withheld-park' });
    await vi.advanceTimersByTimeAsync(70000);
    expect(await pending).toBe(false);
    expect(fetchSearchIndex).toHaveBeenCalledTimes(6);
    expect(queryClient.getQueryState(queryKey).isInvalidated).toBe(true);
    expect(queryClient.getQueryData(queryKey)).toEqual(oldCreations);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchSearchIndex).toHaveBeenCalledTimes(6);
});
