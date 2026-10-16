/** Copies through a hidden textarea; returns whether the browser reports success. */
function copyWithTextarea(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * Copies text to the clipboard. `navigator.clipboard` only exists on HTTPS or localhost, and a
 * self-hosted server is often reached over plain HTTP on the LAN. The browser can also refuse the
 * Clipboard API, for example when the user blocked clipboard access. Both cases fall back to a
 * hidden textarea; if that fails too, the promise rejects with `failure`, which should tell the
 * user how to copy by hand.
 */
export async function copyText(text: string, failure: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Refused; try the textarea below.
    }
  }
  if (!copyWithTextarea(text)) throw new Error(failure);
}
