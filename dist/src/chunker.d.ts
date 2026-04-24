/**
 * Text chunking utilities for agent memory indexing.
 *
 * Splits documents into overlapping chunks for embedding and search.
 * Used by the indexer to prepare files for vector storage.
 */
export interface Chunk {
    content: string;
    index: number;
    charStart: number;
    charEnd: number;
}
/**
 * Split text into overlapping chunks of specified size.
 *
 * @param text - The text to chunk
 * @param chunkSize - Maximum characters per chunk (default 500)
 * @param overlap - Character overlap between chunks (default 50)
 * @returns Array of chunk objects with content and indices
 */
export declare function chunkText(text: string, chunkSize?: number, overlap?: number): Chunk[];
/**
 * Generate a deterministic file ID from a file path.
 *
 * @param filePath - Absolute or relative file path
 * @returns File ID string prefixed with "file_"
 */
export declare function fileId(filePath: string): string;
/**
 * Generate a deterministic chunk ID from file path and chunk index.
 *
 * @param filePath - File path
 * @param chunkIndex - Index of the chunk within the file
 * @returns Chunk ID string
 */
export declare function chunkId(filePath: string, chunkIndex: number): string;
/**
 * Generate a hash of file content to detect changes.
 *
 * @param content - File content as string
 * @returns Hex-encoded hash string
 */
export declare function generateFileHash(content: string): string;
//# sourceMappingURL=chunker.d.ts.map