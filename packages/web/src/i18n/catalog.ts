/** Named placeholders in braces, such as "Deleted {name}". Plural messages need `other`; every language has it. */

/** Chosen by `Intl.PluralRules` for the `count` parameter. */
export type PluralMessage = Readonly<Partial<Record<Exclude<Intl.LDMLPluralRule, 'other'>, string>>> & {
  readonly other: string;
};

export type Message = string | PluralMessage;

export type MessageGroup = Readonly<Record<string, Message>>;

/** Numbers are written as they are, without grouping. */
export type MessageValue = string | number;

type Placeholders<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

type Texts<M extends Message> = M extends PluralMessage ? M[keyof M] & string : M;

export type ParamsOf<M extends Message> = M extends PluralMessage
  ? { readonly count: number } & { readonly [Name in Exclude<Placeholders<Texts<M>>, 'count'>]: MessageValue }
  : { readonly [Name in Placeholders<Texts<M>>]: MessageValue };

/** A placeholder without a value stays as written. */
export function interpolate(text: string, params: Readonly<Record<string, MessageValue>>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** Falls back to `other` for a missing category. */
export function pluralForm(message: PluralMessage, count: number, rules: Intl.PluralRules): string {
  return message[rules.select(count)] ?? message.other;
}
