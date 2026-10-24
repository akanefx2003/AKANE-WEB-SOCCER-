'use strict';

// Petit cache en mémoire. `fn` renvoie { value, ttl } : la durée de vie dépend des données
// (court quand un match est en cours). Si la source tombe, on garde la dernière valeur connue.
const store = new Map();
const inflight = new Map();

async function cached(key, fn) {
  const hit = store.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const { value, ttl } = await fn();
      store.set(key, { value, exp: Date.now() + ttl });
      return value;
    } catch (err) {
      if (hit) return hit.value;
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

// Exécute `fn` sur chaque élément, avec au plus `limit` appels en parallèle.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = { cached, mapLimit };
