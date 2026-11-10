export interface LaneBlock {
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
}

/** Touching ends do not overlap; zero-length blocks at the same instant do, so neither hides the other. */
function overlaps(a: LaneBlock, b: LaneBlock): boolean {
  if (a.top === a.bottom && b.top === b.bottom) return a.top === b.top;
  return a.top < b.bottom && b.top < a.bottom;
}

/**
 * Lanes come from stored spans, not drawn heights, so a short entry touching the next stays in its lane.
 * At equal starts the shorter span comes first. Sets `lane` and `lanes`; returns the sorted blocks.
 */
export function assignLanes<T extends LaneBlock>(blocks: T[]): T[] {
  const sorted = [...blocks].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  let cluster: T[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map(block => block.lane + 1));
    for (const block of cluster) block.lanes = lanes;
    cluster = [];
  };
  for (const block of sorted) {
    const overlapping = cluster.filter(other => overlaps(other, block));
    if (overlapping.length === 0) flush();
    const used = new Set(overlapping.map(other => other.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    block.lane = lane;
    cluster.push(block);
  }
  flush();
  return sorted;
}

function sharesWidth(a: LaneBlock, b: LaneBlock): boolean {
  return a.lane / a.lanes < (b.lane + 1) / b.lanes && b.lane / b.lanes < (a.lane + 1) / a.lanes;
}

/** Tall enough that `minHeight` pixels show below every zero-length block drawn over its start. */
export function heightClearingMarkers(
  block: LaneBlock,
  blocks: readonly LaneBlock[],
  pxPerMinute: number,
  minHeight: number,
): number {
  if (block.top === block.bottom) return minHeight;
  let height = minHeight;
  for (const other of blocks) {
    if (other.top !== other.bottom || other.top > block.top || !sharesWidth(other, block)) continue;
    height = Math.max(height, 2 * minHeight - (block.top - other.top) * pxPerMinute);
  }
  return height;
}
