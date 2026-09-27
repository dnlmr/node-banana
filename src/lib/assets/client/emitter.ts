/** A minimal listener set. One listener throwing does not stop the others. */
export interface Emitter<T> {
  on(listener: (value: T) => void): () => void;
  emit(value: T): void;
}

export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value) {
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          console.error("Asset library listener failed:", error);
        }
      }
    },
  };
}
