const cache = new Map<string, Promise<string | null>>();
const queue: (() => Promise<void>)[] = [];
let active = 0;
function drain() {
  while (active < 3 && queue.length) {
    active++;
    void queue.shift()!().finally(() => {
      active--;
      drain();
    });
  }
}
export function officialPoster(id: string): Promise<string | null> {
  if (!cache.has(id))
    cache.set(
      id,
      new Promise((resolve) => {
        queue.push(async () => {
          try {
            const response = await fetch(`/api/catalog/poster/${encodeURIComponent(id)}`);
            const data = await response.json();
            resolve(response.ok ? data.posterPath || null : null);
          } catch {
            resolve(null);
          }
        });
        drain();
      })
    );
  return cache.get(id)!;
}
