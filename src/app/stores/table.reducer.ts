import { createReducer, on } from '@ngrx/store';
import {
  AggregateResult,
  CellValue,
  ChangeCommit,
  CommitStatus,
  FieldChange,
  FilterGroup,
  SavedView,
  TableRow,
  TableState,
} from '../types/table.models';
import * as TableActions from './table.actions';

const EMPTY_AGGREGATE: AggregateResult = { amount: 0, quantity: 0, averageMargin: 0 };

export const EMPTY_FILTER: FilterGroup = {
  kind: 'group',
  id: 'root',
  logic: 'and',
  children: [],
};

export const TABLE_COLUMNS: Array<{ key: keyof TableRow; label: string }> = [
  { key: 'orderNo', label: '订单编号' },
  { key: 'customer', label: '客户名称' },
  { key: 'region', label: '区域' },
  { key: 'category', label: '产品线' },
  { key: 'owner', label: '负责人' },
  { key: 'amount', label: '合同金额' },
  { key: 'quantity', label: '数量' },
  { key: 'margin', label: '毛利率' },
  { key: 'status', label: '状态' },
  { key: 'updatedAt', label: '更新时间' },
];

const initialVisibleColumns = TABLE_COLUMNS.map((column) => column.key);
const initialWidths = Object.fromEntries(
  TABLE_COLUMNS.map((column) => [
    column.key,
    ['orderNo', 'customer'].includes(String(column.key)) ? 190 : 132,
  ]),
);

const initialViews = readViews();
const initialCommits = readCommits();

export const initialState: TableState = {
  rows: [],
  total: 0,
  groups: [],
  aggregates: EMPTY_AGGREGATE,
  loading: false,
  error: null,
  page: 0,
  pageSize: 100,
  sort: { field: 'updatedAt', direction: 'desc' },
  filter: EMPTY_FILTER,
  search: '',
  groupBy: null,
  treeMode: false,
  expandedIds: [],
  selectedIds: [],
  visibleColumns: initialVisibleColumns,
  columnWidths: initialWidths,
  pinnedColumns: ['orderNo', 'customer'],
  density: 'standard',
  elapsedMs: 0,
  savedViews: initialViews,
  activeViewId: null,
  commits: initialCommits,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  lastDataChangeAt: null,
};

export const tableReducer = createReducer(
  initialState,
  on(TableActions.loadPage, (state) => ({ ...state, loading: true, error: null })),
  on(TableActions.loadPageSuccess, (state, { result }) => ({
    ...state,
    rows: applyCommitsToRows(result.rows, state.commits),
    total: result.total,
    groups: result.groups,
    aggregates: result.aggregates,
    loading: false,
    elapsedMs: result.elapsedMs,
  })),
  on(TableActions.loadPageFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(TableActions.setPage, (state, { page }) => ({ ...state, page })),
  on(TableActions.setPageSize, (state, { pageSize }) => ({ ...state, pageSize, page: 0 })),
  on(TableActions.setSort, (state, { sort }) => ({ ...state, sort, page: 0 })),
  on(TableActions.setFilter, (state, { filter }) => ({ ...state, filter, page: 0 })),
  on(TableActions.setSearch, (state, { search }) => ({ ...state, search, page: 0 })),
  on(TableActions.setGroupBy, (state, { groupBy }) => ({ ...state, groupBy, page: 0 })),
  on(TableActions.toggleTreeMode, (state) => ({ ...state, treeMode: !state.treeMode, page: 0 })),
  on(TableActions.toggleExpanded, (state, { id }) => ({
    ...state,
    expandedIds: state.expandedIds.includes(id)
      ? state.expandedIds.filter((item) => item !== id)
      : [...state.expandedIds, id],
  })),
  on(TableActions.setSelection, (state, { ids }) => ({ ...state, selectedIds: ids })),
  on(TableActions.toggleColumn, (state, { key }) => ({
    ...state,
    visibleColumns: state.visibleColumns.includes(key)
      ? state.visibleColumns.filter((item) => item !== key)
      : [...state.visibleColumns, key],
  })),
  on(TableActions.resizeColumn, (state, { key, width }) => ({
    ...state,
    columnWidths: { ...state.columnWidths, [key]: Math.max(88, width) },
  })),
  on(TableActions.togglePinned, (state, { key }) => ({
    ...state,
    pinnedColumns: state.pinnedColumns.includes(key)
      ? state.pinnedColumns.filter((item) => item !== key)
      : [...state.pinnedColumns, key],
  })),
  on(TableActions.setDensity, (state, { density }) => ({ ...state, density })),
  on(TableActions.commitCell, (state, { id, orderNo, key, baseValue, value }) => {
    const now = new Date().toISOString();
    const commits = upsertCommit(state.commits, {
      orderId: id,
      orderNo,
      field: key,
      baseValue,
      newValue: value,
      now,
    });
    const rows = state.rows.map((row) => (row.id === id ? { ...row, [key]: value } : row));
    persistCommits(commits);
    return { ...state, rows, commits, lastDataChangeAt: now };
  }),
  on(TableActions.syncCommits, (state) => {
    if (!state.online) {
      return { ...state, syncing: false };
    }
    const commits = state.commits.map((commit) =>
      commit.status === 'pending' || commit.status === 'failed'
        ? { ...commit, status: 'syncing' as CommitStatus, error: undefined }
        : commit,
    );
    persistCommits(commits);
    return { ...state, commits, syncing: true };
  }),
  on(TableActions.syncCommitsSuccess, (state, { results, syncedAt }) => {
    const resultMap = new Map(results.map((result) => [result.commitId, result]));
    const commits = state.commits.map((commit) => {
      const result = resultMap.get(commit.id);
      if (!result) {
        return commit;
      }
      if (result.status === 'conflict' && result.conflicts?.length) {
        return { ...commit, status: 'conflict' as CommitStatus, conflicts: result.conflicts };
      }
      return {
        ...commit,
        status: 'synced' as CommitStatus,
        syncedAt,
        error: undefined,
        conflicts: undefined,
      };
    });
    persistCommits(commits);
    return {
      ...state,
      commits,
      syncing: false,
      lastDataChangeAt: syncedAt,
      // 服务端已入库，重查以拿到含变更的最新分页与聚合
      page: 0,
    };
  }),
  on(TableActions.syncCommitsFailure, (state, { error }) => {
    const commits = state.commits.map((commit) =>
      commit.status === 'syncing'
        ? { ...commit, status: 'failed' as CommitStatus, error }
        : commit,
    );
    persistCommits(commits);
    return { ...state, commits, syncing: false };
  }),
  on(TableActions.retryCommit, (state, { commitId }) => {
    const commits = state.commits.map((commit) =>
      commit.id === commitId && commit.status === 'failed'
        ? { ...commit, status: 'syncing' as CommitStatus, error: undefined }
        : commit,
    );
    persistCommits(commits);
    return { ...state, commits, syncing: true };
  }),
  on(TableActions.resolveConflict, (state, { commitId, field, choice }) => {
    const now = new Date().toISOString();
    let resolvedCommit: ChangeCommit | undefined;
    const commits = state.commits.map((commit) => {
      if (commit.id !== commitId) {
        return commit;
      }
      const conflict = commit.conflicts?.find((item) => item.field === field);
      if (!conflict) {
        return commit;
      }
      const nextValue = choice === 'remote' ? conflict.remoteValue : conflict.localValue;
      const changes = commit.changes.map((change) =>
        change.field === field ? { ...change, newValue: nextValue } : change,
      );
      const conflicts = commit.conflicts?.filter((item) => item.field !== field) ?? [];
      resolvedCommit = {
        ...commit,
        changes,
        conflicts: conflicts.length ? conflicts : undefined,
        status: conflicts.length ? ('conflict' as CommitStatus) : ('synced' as CommitStatus),
        syncedAt: conflicts.length ? undefined : now,
      };
      return resolvedCommit;
    });
    const rows = resolvedCommit
      ? state.rows.map((row) => {
          if (row.id !== resolvedCommit!.orderId) {
            return row;
          }
          const change = resolvedCommit!.changes.find((item) => item.field === field);
          return change ? { ...row, [field]: change.newValue } : row;
        })
      : state.rows;
    persistCommits(commits);
    return { ...state, rows, commits, lastDataChangeAt: now };
  }),
  on(TableActions.setOnline, (state, { online }) => ({ ...state, online })),
  on(TableActions.clearSyncedCommits, (state) => {
    const commits = state.commits.filter((commit) => commit.status !== 'synced');
    persistCommits(commits);
    return { ...state, commits };
  }),
  on(TableActions.saveView, (state, { name }) => {
    const view: SavedView = {
      id: `view-${Date.now()}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      pageSize: state.pageSize,
      visibleColumns: [...state.visibleColumns],
      columnWidths: { ...state.columnWidths },
      pinnedColumns: [...state.pinnedColumns],
      sort: state.sort,
      filter: state.filter,
      groupBy: state.groupBy,
      treeMode: state.treeMode,
    };
    const savedViews = [...state.savedViews.filter((item) => item.name !== view.name), view];
    persistViews(savedViews);
    return { ...state, savedViews, activeViewId: view.id };
  }),
  on(TableActions.applyView, (state, { view }) => ({
    ...state,
    pageSize: view.pageSize,
    visibleColumns: [...view.visibleColumns],
    columnWidths: { ...view.columnWidths },
    pinnedColumns: [...view.pinnedColumns],
    sort: view.sort,
    filter: view.filter,
    groupBy: view.groupBy,
    treeMode: view.treeMode,
    activeViewId: view.id,
    page: 0,
  })),
  on(TableActions.deleteView, (state, { id }) => {
    const savedViews = state.savedViews.filter((view) => view.id !== id);
    persistViews(savedViews);
    return {
      ...state,
      savedViews,
      activeViewId: state.activeViewId === id ? null : state.activeViewId,
    };
  }),
);

/** 把已提交的字段变更覆盖到服务端行上，得到本地工作副本 */
function applyCommitsToRows(rows: TableRow[], commits: ChangeCommit[]): TableRow[] {
  if (!commits.length) {
    return rows;
  }
  return rows.map((row) => {
    const overrides: Record<string, CellValue> = {};
    for (const commit of commits) {
      if (commit.orderId !== row.id) {
        continue;
      }
      for (const change of commit.changes) {
        overrides[String(change.field)] = change.newValue;
      }
    }
    return Object.keys(overrides).length ? { ...row, ...overrides } : row;
  });
}

/**
 * 同一订单只保留一条待合并提交：
 * - 已存在待提交（或失败待重试）记录，则合并字段变更（同字段保留最早基准、更新为最新值）
 * - 否则新建一条提交
 */
function upsertCommit(
  commits: ChangeCommit[],
  input: {
    orderId: string;
    orderNo: string;
    field: keyof TableRow;
    baseValue: CellValue;
    newValue: CellValue;
    now: string;
  },
): ChangeCommit[] {
  const next = commits.slice();
  const existingIndex = next.findIndex(
    (commit) =>
      commit.orderNo === input.orderNo &&
      (commit.status === 'pending' || commit.status === 'failed'),
  );
  if (existingIndex >= 0) {
    const existing = next[existingIndex];
    const changes = existing.changes.slice();
    const changeIndex = changes.findIndex((change) => change.field === input.field);
    if (changeIndex >= 0) {
      changes[changeIndex] = { field: input.field, baseValue: changes[changeIndex].baseValue, newValue: input.newValue };
    } else {
      changes.push({ field: input.field, baseValue: input.baseValue, newValue: input.newValue });
    }
    next[existingIndex] = { ...existing, changes, status: 'pending', error: undefined };
    return next;
  }
  const commit: ChangeCommit = {
    id: createCommitId(input.orderNo),
    orderId: input.orderId,
    orderNo: input.orderNo,
    changes: [{ field: input.field, baseValue: input.baseValue, newValue: input.newValue }],
    status: 'pending',
    createdAt: input.now,
    clientId: getClientId(),
  };
  next.push(commit);
  return next;
}

function createCommitId(orderNo: string): string {
  return `commit-${getClientId()}-${orderNo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const CLIENT_ID_KEY = 'pair-wise-yy-05:client-id';

function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = `client-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return 'client-unknown';
  }
}

const COMMITS_STORAGE_KEY = 'pair-wise-yy-05:commits';

function readCommits(): ChangeCommit[] {
  try {
    const raw = localStorage.getItem(COMMITS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChangeCommit[]) : [];
  } catch {
    return [];
  }
}

function persistCommits(commits: ChangeCommit[]): void {
  try {
    localStorage.setItem(COMMITS_STORAGE_KEY, JSON.stringify(commits));
  } catch {
    // 副本写入失败时忽略，内存中的提交仍可继续
  }
}

function readViews(): SavedView[] {
  try {
    const raw = localStorage.getItem('pair-wise-yy-05:views');
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

function persistViews(views: SavedView[]): void {
  localStorage.setItem('pair-wise-yy-05:views', JSON.stringify(views));
}
