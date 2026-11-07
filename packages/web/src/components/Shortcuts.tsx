import { useEffect, useEffectEvent } from 'react';
import { Modal } from './Overlay.tsx';
import { useOverlayStack } from './overlayStack.tsx';

export const SHORTCUTS: Array<[string, string]> = [
  ['N', 'Start a new timer'],
  ['S', 'Stop the running timer'],
  ['C', 'Continue the most recent entry'],
  ['M', 'Switch between timer and manual mode'],
  ['1 – 9', 'Start a pinned favorite'],
  ['@ / #', 'Pick project / tags from an empty description'],
  ['Ctrl+Enter', 'Create the project or tag typed in a picker'],
  ['?', 'Show this list'],
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Single-key shortcuts, ignored while typing or while a modal or popover is open. `handlers` may
 * change every render; the listener always calls the latest ones.
 */
export function useShortcuts(enabled: boolean, handlers: Record<string, () => void>) {
  const overlays = useOverlayStack();
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
    if (overlays.isOpen()) return;
    const handler = handlers[event.key.toLowerCase()] ?? handlers[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  });
  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [enabled]);
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
