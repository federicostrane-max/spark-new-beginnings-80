/**
 * Claude Launcher Desktop App API
 *
 * Client library for interacting with the Claude Launcher Desktop App.
 */

export { LauncherClient, createLauncherClient } from './client';
export type {
  SessionMetadata,
  SearchResult,
  ApiDocsResponse,
  SearchResponse,
  SessionMessagesResponse,
  BulkMetadataResponse,
  RestartResponse,
} from './types';
