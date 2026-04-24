/**
 * Text chunking utilities for agent memory indexing.
 *
 * Splits documents into overlapping chunks for embedding and search.
 * Used by the indexer to prepare files for vector storage.
 */
/**
 * Split text into overlapping chunks of specified size.
 *
 * @param text - The text to chunk
 * @param chunkSize - Maximum characters per chunk (default 500)
 * @param overlap - Character overlap between chunks (default 50)
 * @returns Array of chunk objects with content and indices
 */
export function chunkText(text, chunkSize = 500, overlap = 50) {
    if (!text || text.length === 0) {
        return [];
    }
    const chunks = [];
    let position = 0;
    while (position < text.length) {
        const charStart = position;
        const charEnd = Math.min(position + chunkSize, text.length);
        const content = text.slice(charStart, charEnd);
        chunks.push({
            content,
            index: chunks.length,
            charStart,
            charEnd,
        });
        if (charEnd >= text.length) {
            break;
        }
        // Move forward: chunkSize - overlap
        position += chunkSize - overlap;
    }
    return chunks;
}
/**
 * Generate a deterministic file ID from a file path.
 *
 * @param filePath - Absolute or relative file path
 * @returns File ID string prefixed with "file_"
 */
export function fileId(filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    const hash = simpleHash(normalized);
    return `file_${hash}`;
}
/**
 * Generate a deterministic chunk ID from file path and chunk index.
 *
 * @param filePath - File path
 * @param chunkIndex - Index of the chunk within the file
 * @returns Chunk ID string
 */
export function chunkId(filePath, chunkIndex) {
    const fid = fileId(filePath);
    return `${fid}_${chunkIndex}`;
}
/**
 * Generate a hash of file content to detect changes.
 *
 * @param content - File content as string
 * @returns Hex-encoded hash string
 */
export function generateFileHash(content) {
    return simpleHash(content);
}
// Simple non-cryptographic hash for generating stable IDs
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
}
//# sourceMappingURL=chunker.js.map