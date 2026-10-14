/**
 * Sending a document on WhatsApp.
 *
 * The app opens no socket of its own. It renders the document, puts the image
 * on the clipboard, and hands Windows a `wa.me` link — the shop's own WhatsApp
 * opens on the right chat with the message already typed, and the shopkeeper
 * presses paste and send. No account to register, nothing to pay per message,
 * and the conversation stays in the shop's own WhatsApp where a customer can
 * answer it.
 */
import { formatPaise } from './money';

/** What a shop's number looks like here unless the shop says otherwise. */
export const DEFAULT_COUNTRY_CODE = '91';

export interface PhoneResult {
  /** Digits only, country code included — what wa.me wants. */
  number: string | null;
  /** Why it could not be used, for the shop to read. */
  problem: string | null;
}

/**
 * A phone number as a shop types it — `98765 43210`, `+91 98765-43210`,
 * `098765 43210` — turned into what the link needs. A number that cannot be
 * made sense of is refused rather than guessed at: a bill sent to the wrong
 * person cannot be recalled.
 */
export function toWhatsappNumber(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): PhoneResult {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits === '') return { number: null, problem: 'No phone number on file.' };

  // A leading zero is how a number is written for dialling inside the country,
  // and is not part of the number itself.
  const local = digits.replace(/^0+/, '');

  if (local.length === 10) return { number: `${countryCode}${local}`, problem: null };
  if (local.length > 10 && local.length <= 15) return { number: local, problem: null };

  return {
    number: null,
    problem: `${raw} is not a number WhatsApp can open. Check it on the customer.`,
  };
}

/** The click-to-chat link. The message is carried in the URL, not sent by us. */
export function whatsappLink(input: { number: string; message: string }): string {
  return `https://wa.me/${input.number}?text=${encodeURIComponent(input.message)}`;
}

export interface MessageInput {
  shopName: string;
  /** Who it is going to, so the message opens by name. */
  toName?: string | null;
  documentNumber: string;
  amountPaise: number;
  /** A UPI handle turns the message into one the customer can pay from. */
  upiId?: string | null;
  /** The date a quotation holds until, or an order is wanted by. */
  byDate?: string | null;
}

const day = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
};

const greeting = (name: string | null | undefined): string =>
  name && name.trim() !== '' ? `Hello ${name.trim()},` : 'Hello,';

/**
 * The messages. Short enough to read on a phone without opening anything, and
 * complete enough that the attachment is a courtesy rather than the point —
 * the number, the amount and who it is from are all in the text itself.
 */
export function saleMessage(input: MessageInput): string {
  const lines = [
    greeting(input.toName),
    '',
    `Here is your bill ${input.documentNumber} from ${input.shopName}.`,
    `Total: ${formatPaise(input.amountPaise)}`,
  ];
  if (input.upiId) lines.push('', `You can pay by UPI to ${input.upiId}.`);
  lines.push('', 'Thank you for shopping with us.');
  return lines.join('\n');
}

export function quotationMessage(input: MessageInput): string {
  const until = day(input.byDate);
  const lines = [
    greeting(input.toName),
    '',
    `Here is our quotation ${input.documentNumber} from ${input.shopName}.`,
    `Total: ${formatPaise(input.amountPaise)}`,
  ];
  lines.push('', until ? `This price holds until ${until}.` : 'This price holds until withdrawn.');
  lines.push('', 'Please let us know if you would like to go ahead.');
  return lines.join('\n');
}

export function purchaseOrderMessage(input: MessageInput): string {
  const wanted = day(input.byDate);
  const lines = [
    greeting(input.toName),
    '',
    `Please find our purchase order ${input.documentNumber} from ${input.shopName}.`,
    `Order value: ${formatPaise(input.amountPaise)}`,
  ];
  if (wanted) lines.push('', `We would like the goods by ${wanted}.`);
  lines.push('', 'Please confirm. Thank you.');
  return lines.join('\n');
}

export function statementMessage(
  input: Omit<MessageInput, 'documentNumber'> & { bills: number },
): string {
  const lines = [
    greeting(input.toName),
    '',
    `This is your account with ${input.shopName}.`,
    `Outstanding: ${formatPaise(input.amountPaise)} across ${input.bills} ${
      input.bills === 1 ? 'bill' : 'bills'
    }.`,
  ];
  if (input.upiId) lines.push('', `You can pay by UPI to ${input.upiId}.`);
  lines.push('', 'Please ignore this message if you have already paid. Thank you.');
  return lines.join('\n');
}
