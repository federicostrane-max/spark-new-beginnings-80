/**
 * Claude Launcher Desktop App API Types
 */

export interface SessionMetadata {
  sessionId: string;
  title?: string;
  tags?: string[];
  topics?: string[];
  summary?: string;
  lastAnalyzed?: number;
}

export interface SearchResult {
  sessionId: string;
  folderName: string;
  projectPath?: string;
  title?: string;
  matchedIn: 'title' | 'content' | 'both';
  matchSnippet?: string;
}

export interface ApiDocsResponse {
  version: string;
  endpoints: Array<{
    method: string;
    path: string;
    description: string;
  }>;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
}

export interface SessionMessagesResponse {
  sessionId: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
  }>;
  total: number;
}

export interface BulkMetadataResponse {
  metadata: Record<string, SessionMetadata>;
  count: number;
}

export interface RestartResponse {
  success: boolean;
  message: string;
}
