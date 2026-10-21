/**
 * How many rows a list shows at once.
 *
 * Ten first. A shop looking for one customer reads ten names faster than
 * fifty, and a counter PC paints ten rows faster than fifty; a shop that would
 * rather see more says so per screen, in the pager at the foot of the list.
 */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
