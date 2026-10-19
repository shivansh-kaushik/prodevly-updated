import type { MediaPurpose } from './rules';

/** A file record as the admin UI sees it. Pure type, importable from client components. */
export interface MediaDTO {
  id: string;
  filename: string;
  /** The canonical URL. The serving route finds the file by id, so a wrong name still works. */
  url: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  visibility: 'public' | 'private';
  purpose: MediaPurpose | null;
  uploadedBy: string;
  createdAt: string;
}

export interface MediaPage {
  items: MediaDTO[];
  total: number;
  page: number;
  pages: number;
}
