export interface ConfluencePage {
  id: string;
  title: string;
  spaceKey: string;
  excerpt: string;
  url: string;
  lastModified: string;
  discoveredAt: string;
}

export interface ConfluenceSearchResult {
  cql: string;
  pages: Omit<ConfluencePage, "discoveredAt">[];
}
