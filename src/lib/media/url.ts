/**
 * The canonical URL of a stored file: /media/<id>/<filename>. The id is what finds the file; the
 * filename is only for people (and for the download name), so a wrong filename still serves the
 * same bytes. Pure, so client components can build links too.
 */
export const mediaPath = (id: string, filename: string): string => `/media/${id}/${encodeURIComponent(filename)}`;
