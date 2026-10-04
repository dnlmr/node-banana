/**
 * What a library status says about asking for it again. The recorder and the
 * Assets view both poll the status; neither should poll one that no later
 * answer can change.
 */

import type { LibraryStatus } from "../types";

/**
 * Off for a reason no later answer changes while the page is open: a hosted
 * server, or a request guard that refuses this page. Asking again on a timer
 * would only add a refusal to the server's log each time.
 */
export function libraryOffForGood(status: LibraryStatus | null | undefined): boolean {
  return !!status && !status.available && (status.reasonCode === "hosted" || status.reasonCode === "guard");
}
