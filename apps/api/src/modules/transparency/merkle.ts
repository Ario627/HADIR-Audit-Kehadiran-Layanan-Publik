import { createHash } from 'node:crypto';

export const MERKLE_ALGORITHM = 'sha256-duplicate-last-v1';
export const LEAF_BYTES = 32;

export function merkleParent(left: Buffer, right: Buffer): Buffer {
  return createHash('sha256').update(left).update(right).digest();
}

export function merkleRoot(leaves: readonly Buffer[]): Buffer {
  if (leaves.length === 0) {
    return Buffer.alloc(LEAF_BYTES);
  }
  for (const leaf of leaves) {
    if (leaf.length !== LEAF_BYTES) {
      throw new Error('Daun Merkle harus 32 byte.');
    }
  }
  let level: Buffer[] = [...leaves];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(merkleParent(left, right));
    }
    level = next;
  }
  return level[0]!;
}

export interface MerkleLevels {
  root: Buffer;
  levels: number;
  leavesDigest: Buffer;
}

export function merkleSummary(leaves: readonly Buffer[]): MerkleLevels {
  const root = merkleRoot(leaves);
  const digest = createHash('sha256');
  for (const leaf of leaves) {
    digest.update(leaf);
  }
  const count = leaves.length;
  const levels = count <= 1 ? count : Math.ceil(Math.log2(count)) + 1;
  return { root, levels, leavesDigest: digest.digest() };
}

export function merkleProof(leaves: readonly Buffer[], index: number): Buffer[] {
  if (index < 0 || index >= leaves.length) {
    throw new Error('Indeks daun di luar rentang.');
  }
  const proof: Buffer[] = [];
  let level: Buffer[] = [...leaves];
  let cursor = index;
  while (level.length > 1) {
    const sibling = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
    const siblingNode = level[sibling] ?? level[cursor]!;
    proof.push(siblingNode);
    const next: Buffer[] = [];
    for (let position = 0; position < level.length; position += 2) {
      const left = level[position]!;
      const right = level[position + 1] ?? left;
      next.push(merkleParent(left, right));
    }
    level = next;
    cursor = Math.floor(cursor / 2);
  }
  return proof;
}

export function verifyMerkleProof(
  leaf: Buffer,
  proof: readonly Buffer[],
  index: number,
  root: Buffer,
): boolean {
  let cursor = index;
  let current = leaf;
  for (const sibling of proof) {
    current =
      cursor % 2 === 0 ? merkleParent(current, sibling) : merkleParent(sibling, current);
    cursor = Math.floor(cursor / 2);
  }
  return current.length === root.length && current.equals(root);
}
