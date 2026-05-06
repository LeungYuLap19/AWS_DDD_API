import fs from 'node:fs';
import path from 'node:path';

const templateCache: Record<string, string> = {};

/**
 * Escapes HTML special characters to prevent XSS in email content.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Renders a static HTML email template by replacing {{KEY}} placeholders.
 * Keys suffixed with _HTML are inserted as raw HTML (not escaped).
 * Template files are read once from disk and cached for the Lambda container lifetime.
 *
 * @param templateName - Filename inside the static/ directory (e.g. "order-confirmation-email.html")
 * @param data - Map of placeholder keys to replacement values
 */
export function renderTemplate(templateName: string, data: Record<string, string>): string {
  if (!templateCache[templateName]) {
    // __dirname is dist/functions/commerce-orders/src/utils/ at runtime
    const filePath = path.join(__dirname, '..', '..', 'static', templateName);
    templateCache[templateName] = fs.readFileSync(filePath, 'utf8');
  }

  let html = templateCache[templateName];

  for (const [key, value] of Object.entries(data)) {
    const isRawHtml = key.endsWith('_HTML');
    const replacement = isRawHtml ? (value || '') : escapeHtml(value);
    html = html.split(`{{${key}}}`).join(replacement);
  }

  return html;
}
