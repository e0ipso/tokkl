/**
 * The shape of a message catalog and the pure helpers that fill a message in. Messages use named
 * placeholders in braces, such as "Deleted {name}". A message that depends on a count has one form
 * per plural category of the language; `other` is required, since every language has it.
 */

/** One wording per plural category, chosen by `Intl.PluralRules` for the `count` parameter. */
export type PluralMessage = Readonly<Partial<Record<Exclude<Intl.LDMLPluralRule, 'other'>, string>>> & {
  readonly other: string;
};

export type Message = string | PluralMessage;

/** One feature's messages, such as the timer bar's or the reports'. */
export type MessageGroup = Readonly<Record<string, Message>>;

/** A value a placeholder takes. Numbers are written as they are, without grouping. */
export type MessageValue = string | number;

/** The placeholder names in a message's text, such as "name" in "Deleted {name}". */
export type Placeholders<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** The texts a message can render: the message itself, or each of its plural forms. */
type Texts<M extends Message> = M extends PluralMessage ? M[keyof M] & string : M;

/** The parameters a message needs: one per placeholder, plus `count` for a plural message. */
export type ParamsOf<M extends Message> = M extends PluralMessage
  ? { readonly count: number } & { readonly [Name in Exclude<Placeholders<Texts<M>>, 'count'>]: MessageValue }
  : { readonly [Name in Placeholders<Texts<M>>]: MessageValue };

/** Fills each `{name}` with its value. A placeholder without a value stays as written. */
export function interpolate(text: string, params: Readonly<Record<string, MessageValue>>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** The wording of a plural message for `count`, falling back to `other` for a missing category. */
export function pluralForm(message: PluralMessage, count: number, rules: Intl.PluralRules): string {
  return message[rules.select(count)] ?? message.other;
}
