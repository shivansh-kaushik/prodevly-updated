/** Text boxes to and from lists of short strings. Pure, so they are unit tested. */

/** One entry per line. Blank lines are dropped. */
export const linesToList = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export const listToLines = (list: readonly string[]): string => list.join('\n');

/** Comma separated tags ("React, Node.js"). Blank entries are dropped. */
export const tagsToList = (text: string): string[] =>
  text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

export const listToTags = (list: readonly string[]): string => list.join(', ');

/** "" to null, so an emptied box CLEARS the field on the server instead of sending an empty string. */
export const orNull = (text: string): string | null => text.trim() || null;
