/** Returns whether the browser reports success. */
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
 * `navigator.clipboard` needs HTTPS or localhost and may be refused; both fall back to a textarea.
 * `failure` should tell the user how to copy by hand.
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
