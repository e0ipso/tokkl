import type { ReactNode, Ref } from 'react';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { LoadError, Loading } from '../../components/PageState.tsx';
import { t } from '../../i18n/messages.ts';

interface ManageListQuery<T> {
  data: readonly T[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => unknown;
}

/**
 * The body of a manage page (clients, projects, tags): the load error, the loading state, the
 * empty states, and the table of the rows that pass the page's filters.
 *
 * `noun` names the items in the load messages ("clients"). `empty` shows when there are none at
 * all, `noMatch` when the filters hide every one. `headers` are the column headers before the
 * hidden Actions column, and `children` the visible rows.
 */
export function ManageList<T>({
  query,
  visible,
  noun,
  empty,
  noMatch,
  headers,
  tbodyRef,
  children,
}: {
  query: ManageListQuery<T>;
  visible: readonly T[];
  noun: string;
  empty: { icon: IconName; title: string; body: ReactNode };
  noMatch: { title: string; body: ReactNode };
  headers: ReactNode;
  tbodyRef: Ref<HTMLTableSectionElement>;
  children: ReactNode;
}) {
  const { data, isLoading, error, refetch } = query;
  return (
    <>
      {error ? (
        <LoadError message={t('manage.loadFailed', { noun, message: error.message })} onRetry={() => void refetch()} />
      ) : null}
      {isLoading ? <Loading label={t('manage.loadingNoun', { noun })} /> : null}
      {data && visible.length === 0 ? (
        data.length === 0 ? (
          <EmptyState icon={<Icon name={empty.icon} size={32} />} title={empty.title}>
            {empty.body}
          </EmptyState>
        ) : (
          <EmptyState icon={<Icon name="search" size={32} />} title={noMatch.title}>
            {noMatch.body}
          </EmptyState>
        )
      ) : null}

      {visible.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {headers}
                <th>
                  <span className="visually-hidden">{t('manage.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>{children}</tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
