/**
 * Merkle tree over credential leaves.
 *
 * Real computation, not a simulation: the university builds the tree, the
 * student receives one authentication path, and `computeRootFromPath` folds
 * that path back to the root inside `generateProof`. A tampered path simply
 * will not reproduce the published root.
 *
 * Internal nodes are `Poseidon(left, right)`, matching what a Circom
 * `MerkleTreeInclusionProof` template would constrain.
 */

import { poseidonHash, stringToField, toField, toHex, type FieldLike } from "./poseidon";

/**
 * Padding leaf.
 *
 * The tree is padded to a power of two with `Poseidon(dummy)` for a fixed,
 * domain-separated dummy — never with zero. A zero leaf is a valid preimage of
 * nothing in particular and invites confusion with an unset slot; hashing a
 * fixed dummy makes empty slots unmistakably non-credential values.
 */
export const EMPTY_LEAF_PREIMAGE = stringToField(
  "zk-credentials/v1/empty-leaf",
);
export const EMPTY_LEAF = poseidonHash([EMPTY_LEAF_PREIMAGE]);

/**
 * Minimum tree depth. A batch is padded up to at least this depth so that a
 * small demo cohort still carries a meaningful anonymity set — the employer
 * learns only "one of the leaves under this root", so a larger tree is a
 * larger crowd to hide in.
 */
export const MIN_TREE_DEPTH = 5;

export interface MerkleTree {
  /** Bottom-up layers: layers[0] are the padded leaves, last layer is [root]. */
  layers: bigint[][];
  root: bigint;
  depth: number;
  /** Number of leaf slots after padding (2 ** depth). */
  leafCount: number;
  /** Number of real credentials before padding. */
  realLeafCount: number;
}

export interface MerkleProof {
  pathElements: string[];
  /** 0 = current node is the left child, 1 = right child. */
  pathIndices: number[];
}

/** Hash one internal node. */
export function hashPair(left: FieldLike, right: FieldLike): bigint {
  return poseidonHash([left, right]);
}

/** Build a Merkle tree, padding to a power of two (and to MIN_TREE_DEPTH). */
export function buildMerkleTree(
  leaves: FieldLike[],
  minDepth: number = MIN_TREE_DEPTH,
): MerkleTree {
  if (leaves.length === 0) {
    throw new Error("buildMerkleTree: cannot build a tree with no leaves");
  }

  const realLeaves = leaves.map(toField);

  let depth = minDepth;
  while (2 ** depth < realLeaves.length) depth += 1;
  const leafCount = 2 ** depth;

  const padded = [...realLeaves];
  while (padded.length < leafCount) padded.push(EMPTY_LEAF);

  const layers: bigint[][] = [padded];
  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next: bigint[] = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(hashPair(current[i], current[i + 1]));
    }
    layers.push(next);
  }

  return {
    layers,
    root: layers[layers.length - 1][0],
    depth,
    leafCount,
    realLeafCount: realLeaves.length,
  };
}

/** Extract the authentication path for one leaf index. */
export function getMerkleProof(tree: MerkleTree, leafIndex: number): MerkleProof {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new Error(
      `getMerkleProof: leaf index ${leafIndex} is outside the tree (0–${tree.leafCount - 1})`,
    );
  }

  const pathElements: string[] = [];
  const pathIndices: number[] = [];
  let index = leafIndex;

  for (let level = 0; level < tree.depth; level += 1) {
    const isRightChild = index % 2 === 1;
    const siblingIndex = isRightChild ? index - 1 : index + 1;
    pathElements.push(toHex(tree.layers[level][siblingIndex]));
    pathIndices.push(isRightChild ? 1 : 0);
    index = Math.floor(index / 2);
  }

  return { pathElements, pathIndices };
}

/**
 * Fold a leaf and its authentication path back up to a root.
 *
 * This is the operation the ZK circuit constrains, and it is run for real
 * inside `generateProof`.
 */
export function computeRootFromPath(
  leaf: FieldLike,
  pathElements: FieldLike[],
  pathIndices: number[],
): bigint {
  if (pathElements.length !== pathIndices.length) {
    throw new Error(
      `computeRootFromPath: path length mismatch (${pathElements.length} elements vs ${pathIndices.length} indices)`,
    );
  }

  let node = toField(leaf);
  for (let level = 0; level < pathElements.length; level += 1) {
    const sibling = toField(pathElements[level]);
    const bit = pathIndices[level];
    if (bit !== 0 && bit !== 1) {
      throw new Error(
        `computeRootFromPath: path index at level ${level} must be 0 or 1, got ${bit}`,
      );
    }
    node = bit === 1 ? hashPair(sibling, node) : hashPair(node, sibling);
  }
  return node;
}

/** True when the path genuinely places `leaf` under `root`. */
export function verifyMerkleProof(
  leaf: FieldLike,
  pathElements: FieldLike[],
  pathIndices: number[],
  root: FieldLike,
): boolean {
  try {
    return computeRootFromPath(leaf, pathElements, pathIndices) === toField(root);
  } catch {
    return false;
  }
}
