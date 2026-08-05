export interface VirtualRange {
  start: number;
  end: number;
  offsets: number[];
  totalHeight: number;
}

export function calculateVirtualRange(
  heights: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 360,
): VirtualRange {
  const offsets: number[] = [];
  let totalHeight = 0;
  for (const height of heights) {
    offsets.push(totalHeight);
    totalHeight += height;
  }
  const lowerBound = Math.max(0, scrollTop - overscan);
  const upperBound = scrollTop + viewportHeight + overscan;
  let start = 0;
  while (start < heights.length && offsets[start] + heights[start] < lowerBound) start += 1;
  let end = start;
  while (end < heights.length && offsets[end] < upperBound) end += 1;
  return { start, end, offsets, totalHeight };
}
