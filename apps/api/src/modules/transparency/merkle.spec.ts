import { merkleParent, merkleProof, merkleRoot, merkleSummary, verifyMerkleProof } from './merkle';
import { createHash } from 'node:crypto';

function leaf(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

describe('merkleRoot', () => {
  it('returns thirty two zero bytes for an empty tree', () => {
    expect(merkleRoot([])).toEqual(Buffer.alloc(32));
  });

  it('returns the leaf itself for a single leaf', () => {
    const only = leaf('a');
    expect(merkleRoot([only])).toEqual(only);
  });

  it('hashes two leaves pairwise', () => {
    const left = leaf('a');
    const right = leaf('b');
    expect(merkleRoot([left, right])).toEqual(merkleParent(left, right));
  });

  it('duplicates the last node when the level is odd', () => {
    const nodes = [leaf('a'), leaf('b'), leaf('c')];
    const expected = merkleParent(
      merkleParent(nodes[0]!, nodes[1]!),
      merkleParent(nodes[2]!, nodes[2]!),
    );
    expect(merkleRoot(nodes)).toEqual(expected);
  });

  it('is deterministic regardless of call order', () => {
    const nodes = [leaf('a'), leaf('b'), leaf('c'), leaf('d'), leaf('e')];
    expect(merkleRoot(nodes)).toEqual(merkleRoot(nodes));
  });

  it('changes when any leaf changes', () => {
    const base = [leaf('a'), leaf('b'), leaf('c')];
    const mutated = [leaf('a'), leaf('b'), leaf('z')];
    expect(merkleRoot(base).equals(merkleRoot(mutated))).toBe(false);
  });

  it('changes when leaf order changes', () => {
    const a = leaf('a');
    const b = leaf('b');
    expect(merkleRoot([a, b]).equals(merkleRoot([b, a]))).toBe(false);
  });

  it('rejects leaves that are not thirty two bytes', () => {
    expect(() => merkleRoot([Buffer.alloc(31)])).toThrow();
  });
});

describe('merkleSummary', () => {
  it('reports level count and leaves digest', () => {
    const nodes = [leaf('a'), leaf('b'), leaf('c'), leaf('d')];
    const summary = merkleSummary(nodes);
    expect(summary.root).toEqual(merkleRoot(nodes));
    expect(summary.levels).toBe(3);
    expect(summary.leavesDigest).toEqual(
      createHash('sha256').update(Buffer.concat(nodes)).digest(),
    );
  });

  it('handles the single leaf case', () => {
    expect(merkleSummary([leaf('a')]).levels).toBe(1);
    expect(merkleSummary([]).levels).toBe(0);
  });
});

describe('merkleProof', () => {
  it('verifies every inclusion proof for odd and even trees', () => {
    for (const size of [1, 2, 3, 4, 5, 6, 7, 8, 11]) {
      const nodes = Array.from({ length: size }, (_value, index) => leaf(`leaf-${index}`));
      const root = merkleRoot(nodes);
      for (let index = 0; index < size; index += 1) {
        const proof = merkleProof(nodes, index);
        expect(verifyMerkleProof(nodes[index]!, proof, index, root)).toBe(true);
      }
    }
  });

  it('rejects a proof for the wrong index', () => {
    const nodes = [leaf('a'), leaf('b'), leaf('c'), leaf('d')];
    const root = merkleRoot(nodes);
    const proof = merkleProof(nodes, 0);
    expect(verifyMerkleProof(nodes[0]!, proof, 1, root)).toBe(false);
  });

  it('rejects a tampered sibling', () => {
    const nodes = [leaf('a'), leaf('b'), leaf('c'), leaf('d')];
    const root = merkleRoot(nodes);
    const proof = merkleProof(nodes, 2).map((node, index) =>
      index === 0 ? leaf('tampered') : node,
    );
    expect(verifyMerkleProof(nodes[2]!, proof, 2, root)).toBe(false);
  });

  it('refuses an out of range index', () => {
    expect(() => merkleProof([leaf('a')], 1)).toThrow();
    expect(() => merkleProof([], 0)).toThrow();
  });
});
