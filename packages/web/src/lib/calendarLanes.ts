/** A block on one calendar day: its stored span in clock minutes, and the lane the layout gives it. */
export interface LaneBlock {
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
}

/**
 * Sorts a day's blocks by start, then by end, and gives each a lane and the number of lanes in its
 * cluster. Blocks share a cluster while their stored spans overlap; a block takes the first lane
 * that no overlapping block of the cluster holds. The spans are the stored ones, not the drawn
 * heights, so a zero-length or very short entry that only touches the entry starting where it
 * ends stays in that entry's lane. At the same start the shorter span comes first for the same
 * reason: it closes its cluster before the longer one opens the next. A zero-length entry inside
 * another entry's span still overlaps it and takes a lane beside it. Sets `lane` and `lanes` on the
 * blocks and returns them in the sorted order.
 */
export function assignLanes<T extends LaneBlock>(blocks: T[]): T[] {
  const sorted = [...blocks].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  let cluster: T[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((block) => block.lane + 1));
    for (const block of cluster) block.lanes = lanes;
    cluster = [];
  };
  for (const block of sorted) {
    if (block.top >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    const used = new Set(cluster.filter((other) => other.bottom > block.top).map((other) => other.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    block.lane = lane;
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.bottom);
  }
  flush();
  return sorted;
}
