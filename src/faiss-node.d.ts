/**
 * Type declarations for faiss-node (CJS module).
 * The lib/index.d.ts has proper exports, but NodeNext resolution needs help.
 */
declare module "faiss-node" {
  export interface SearchResult {
    distances: number[];
    labels: number[];
  }

  export class IndexFlatL2 {
    constructor(d: number);
    ntotal(): number;
    getDimension(): number;
    isTrained(): boolean;
    add(x: number[]): void;
    search(x: number[], k: number): SearchResult;
    write(fname: string): void;
    static read(fname: string): IndexFlatL2;
  }
}
