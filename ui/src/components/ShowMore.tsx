import type { LoadMore } from "../api/useLoadMore";
import { Button } from "./Button";
import styles from "./ShowMore.module.css";
import { ErrorBanner } from "./States";

/** "Show more" under an offset-paginated list, with the error of the last attempt. */
export function ShowMore({ more }: { more: LoadMore }) {
  return (
    <>
      {more.loadMoreError && <ErrorBanner>{more.loadMoreError.message}</ErrorBanner>}
      {more.hasMore && (
        <div className={styles.more}>
          <Button disabled={more.loadingMore} onClick={more.loadMore}>
            Show more
          </Button>
        </div>
      )}
    </>
  );
}
