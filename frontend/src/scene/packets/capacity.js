/**
 * How many packets the 3D layer can draw at once, per protocol shape (one instanced mesh each).
 * A packet in flight beyond this is not drawn; the counters and inspectors still include it. The S4
 * flood peaks well below it (a test checks the peak against this number for every core trace).
 */
export const PACKET_CAPACITY = 800
