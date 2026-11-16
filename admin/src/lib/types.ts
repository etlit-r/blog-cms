export type PostState = 'draft' | 'published' | 'scheduled';

export type PostSummary = {
  id: number;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  state: PostState;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  tags: string[];
};

export type Post = PostSummary & {
  bodyHtml: string;
  editorMode: 'rich' | 'html';
  excerpt: string;
  excerptAuto: boolean;
};

export type Tag = { id: number; name: string; postCount: number };

export type SiteSettings = {
  siteTitle: string;
  siteDescription: string;
  postsPerPage: number;
  publicUrl: string;
};
