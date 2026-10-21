/** Joins the class names that are set. CSS Modules type each class as possibly undefined. */
export const cx = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(" ");
