/**
 * Cola de escritura por clave (p. ej. una carta o un mazo).
 *
 * Problema que resuelve: si el usuario pulsa varias veces seguidas, las peticiones salen en orden pero pueden
 * LLEGAR y aplicarse en otro, y el servidor se queda con un valor antiguo (la pantalla dice 2, la base de datos 3).
 *
 *  - Las escrituras de una misma clave se envían de una en una y en orden.
 *  - Si mientras una está en vuelo se acumulan varias, solo se envía la última (las intermedias no importan).
 *  - Claves distintas no se bloquean entre sí.
 *  - Si una escritura falla, la promesa de quien la provocó se rechaza y las siguientes siguen funcionando.
 */
export interface KeyedWriter<T> {
  write: (key: string, value: T) => Promise<void>
  /** Espera a que no quede nada pendiente (no falla aunque alguna escritura haya fallado). */
  idle: () => Promise<void>
}

export function createKeyedWriter<T>(persist: (key: string, value: T) => Promise<void>): KeyedWriter<T> {
  const latest = new Map<string, T>()
  const chains = new Map<string, Promise<void>>()

  return {
    write(key, value) {
      latest.set(key, value)
      const previous = chains.get(key) ?? Promise.resolve()
      const run = previous.then(async () => {
        // otra escritura posterior de esta clave ya envió el último valor
        if (!latest.has(key)) return
        const next = latest.get(key) as T
        latest.delete(key)
        await persist(key, next)
      })
      chains.set(
        key,
        run.catch(() => undefined),
      )
      return run
    },
    async idle() {
      await Promise.all([...chains.values()])
    },
  }
}
