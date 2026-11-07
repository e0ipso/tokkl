import { useEffect, useEffectEvent, useRef, useState } from 'react';

/**
 * The description of a row. It follows the stored description, unless the user is typing a change
 * of their own: a refresh must not throw that away. Committing it then saves the typed text.
 */
export function useRowDescription(stored: string) {
  const [description, setDescription] = useState(stored);
  const input = useRef<HTMLInputElement>(null);
  const lastStored = useRef(stored);
  const follow = useEffectEvent((next: string) => {
    const typing = document.activeElement === input.current && description !== lastStored.current;
    lastStored.current = next;
    if (!typing) setDescription(next);
  });
  useEffect(() => follow(stored), [stored]);
  return { description, setDescription, input };
}
