/** Join class names, skipping falsy values. */
export const cx = (...parts: readonly (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");

/** Props that pass `data-*` attributes (e.g. data-testid) through, like the existing ops Badge. */
export type DataAttrs = Record<`data-${string}`, string | undefined>;
