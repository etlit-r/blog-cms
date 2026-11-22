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
  coverAuto: boolean;
  coverUrl: string | null;
};

export type Tag = { id: number; name: string; postCount: number };

export type SiteSettings = {
  siteTitle: string;
  siteDescription: string;
  postsPerPage: number;
  sitemapExtraUrls: string[];
  publicUrl: string;
};

export type Media = {
  id: number;
  url: string;
  thumbUrl: string;
  mime: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  bytes: number;
  alt: string;
  createdAt: number;
  usageCount?: number;
};

export type TemplateKind = 'page' | 'partial' | 'css';

export type TemplateSummary = {
  name: string;
  kind: TemplateKind;
  label: string;
  description: string;
  customized: boolean;
  updatedAt: number | null;
};

export type Template = TemplateSummary & {
  content: string;
  defaultContent: string;
};

export type TemplateRevision = { id: number; createdAt: number; length: number };

export type FixedPage = {
  id: number;
  slug: string;
  title: string;
  bodyHtml: string;
  editorMode: 'rich' | 'html';
  status: 'draft' | 'published';
  sortOrder: number;
  updatedAt: number;
};
