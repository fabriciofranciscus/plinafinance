'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * Guarda o valor MAIS RECENTE numa referência estável. Serve para usar uma função que o Privy pode trocar a cada
 * renderização (ex.: `getAccessToken`) dentro de um efeito sem pô-la nas dependências: do contrário o efeito refaz o GET
 * sem fim e a rota passa a responder 429 (Vera, laço no stub). Uso: `const token = useLatest(getAccessToken);` e
 * `await token.current()` dentro do efeito/callback.
 */
export function useLatest<T>(valor: T): MutableRefObject<T> {
  const ref = useRef(valor);
  useEffect(() => {
    ref.current = valor;
  });
  return ref;
}
