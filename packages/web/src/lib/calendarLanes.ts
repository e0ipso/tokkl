/** A block on one calendar day: its stored span in clock minutes, and the lane the layout gives it. */
export interface LaneBlock {
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
}

/**
 * Whether two blocks share stored time. A block that only touches the other at an end does not,
 * and neither do two zero-length blocks at different instants. Two zero-length blocks at the same
 * instant do, so neither hides the other.
 */
function overlaps(a: LaneBlock, b: LaneBlock): boolean {
  if (a.top === a.bottom && b.top === b.bottom) return a.top === b.top;
  return a.top < b.bottom && b.top < a.bottom;
}

/**
 * Sorts a day's blocks by start, then by end, and gives each a lane and the number of lanes in its
 * cluster. Blocks share a cluster while their stored spans overlap; a block takes the first lane
 * that no overlapping block of the cluster holds. The spans are the stored ones, not the drawn
 * heights, so a zero-length or very short entry that only touches the entry starting where it
 * ends stays in that entry's lane. At the same start the shorter span comes first for the same
 * reason: it closes its cluster before the longer one opens the next. A zero-length entry inside
 * another entry's span still overlaps it and takes a lane beside it, and zero-length entries at
 * one instant take lanes beside each other. Sets `lane` and `lanes` on the blocks and returns them
 * in the sorted order.
 */
export function assignLanes<T extends LaneBlock>(blocks: T[]): T[] {
  const sorted = [...blocks].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  let cluster: T[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((block) => block.lane + 1));
    for (const block of cluster) block.lanes = lanes;
    cluster = [];
  };
  for (const block of sorted) {
    const overlapping = cluster.filter((other) => overlaps(other, block));
    if (overlapping.length === 0) flush();
    const used = new Set(overlapping.map((other) => other.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    block.lane = lane;
    cluster.push(block);
  }
  flush();
  return sorted;
}

/** Whether two blocks cover any of the same width of the column, given their lanes. */
function sharesWidth(a: LaneBlock, b: LaneBlock): boolean {
  return a.lane / a.lanes < (b.lane + 1) / b.lanes && b.lane / b.lanes < (a.lane + 1) / a.lanes;
}

/**
 * The height in pixels a block is drawn at least, so that `minHeight` pixels of it show below every
 * zero-length block over its start. A zero-length block is drawn `minHeight` tall from its start and
 * sits above the blocks it shares the column with, so a block that starts at or just under one would
 * otherwise be hidden by it. A zero-length block needs `minHeight` itself. `pxPerMinute` converts
 * the blocks' clock minutes to pixels.
 */
export function heightClearingMarkers(block: LaneBlock, blocks: readonly LaneBlock[], pxPerMinute: number, minHeight: number): number {
  if (block.top === block.bottom) return minHeight;
  let height = minHeight;
  for (const other of blocks) {
    if (other.top !== other.bottom || other.top > block.top || !sharesWidth(other, block)) continue;
    height = Math.max(height, 2 * minHeight - (block.top - other.top) * pxPerMinute);
  }
  return height;
}
