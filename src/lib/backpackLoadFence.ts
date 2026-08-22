/**
 * Small generation fence for Backpack reads.
 *
 * A manual refresh, circle change, or unmount retires every older ticket so a
 * late async continuation cannot replace a newer circle snapshot.
 */

export interface BackpackLoadTicket {
  generation: number;
  circleId: string;
}

export interface BackpackLoadFence {
  begin: (circleId: string) => BackpackLoadTicket;
  isCurrent: (ticket: BackpackLoadTicket) => boolean;
  retire: () => void;
}

export function createBackpackLoadFence(): BackpackLoadFence {
  let generation = 0;
  let currentCircleId = '';

  return {
    begin(circleId) {
      generation += 1;
      currentCircleId = circleId;
      return { generation, circleId };
    },
    isCurrent(ticket) {
      return ticket.generation === generation && ticket.circleId === currentCircleId;
    },
    retire() {
      generation += 1;
      currentCircleId = '';
    },
  };
}
