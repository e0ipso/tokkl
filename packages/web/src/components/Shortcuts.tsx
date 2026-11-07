import { useEffect, useEffectEvent } from 'react';
import { Modal } from './Overlay.tsx';
import { useOverlayStack } from './overlayStack.tsx';
import { t, type MessageKey } from '../i18n/messages.ts';

/** Each key as printed on the keyboard, with the catalog key of what it does. */
export const SHORTCUTS: Array<[string, MessageKey]> = [
  ['N', 'timer.shortcutNew'],
  ['S', 'timer.shortcutStop'],
  ['C', 'timer.shortcutContinue'],
  ['M', 'timer.shortcutMode'],
  ['1 – 9', 'timer.shortcutFavorite'],
  ['@ / #', 'timer.shortcutPickers'],
  ['Ctrl+Enter', 'timer.shortcutCreate'],
  ['?', 'timer.shortcutHelp'],
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
    <Modal title={t('timer.shortcutsTitle')} onClose={onClose}>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{t(label)}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
