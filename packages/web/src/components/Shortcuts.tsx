import { useEffect } from 'react';
import { Modal } from './Overlay.tsx';

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
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

/** Single-key shortcuts, ignored while typing or when a dialog is open. */
export function useShortcuts(enabled: boolean, handlers: Record<string, () => void>) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('.modal, .popover')) return;
      const handler = handlers[event.key.toLowerCase()] ?? handlers[event.key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled, handlers]);
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([key, label]) => (
          <div key={key}>
            <dt><kbd>{key}</kbd></dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
